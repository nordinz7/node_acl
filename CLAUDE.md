# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`acl` is a Node.js Access Control List library inspired by Zend_ACL. It models authorization as **users → roles → resources → permissions**, with role hierarchies (parents). It ships three storage backends (Redis, MongoDB, in-memory) and an Express middleware for protecting routes.

## Commands

```bash
npm test                                          # full suite against all 4 backends
npx mocha test/runner.js --reporter spec          # same thing directly
npx mocha test/runner.js --grep "isAllowed"       # run a single test/describe block by name
npm run cover                                      # istanbul coverage
```

**Tests require live Redis and MongoDB** on localhost (Redis `127.0.0.1:6379`, MongoDB `mongodb://localhost:27017/acltest`). Without them the Redis/MongoDB suites fail; the Memory suite still runs. [test/runner.js](test/runner.js) registers four `describe` blocks (MongoDB default, MongoDB useSingle, Redis, Memory) and runs the *same* shared test bodies from [test/tests.js](test/tests.js) and [test/backendtests.js](test/backendtests.js) against each backend's `this.backend`. So a test written once is automatically exercised on every backend.

## Architecture

- **[index.js](index.js)** — entry point. Exports the `Acl` class and lazily exposes `redisBackend`, `memoryBackend`, `mongodbBackend` via getters.
- **[lib/acl.js](lib/acl.js)** — all ACL logic (the public API: `allow`, `isAllowed`, `addUserRoles`, `whatResources`, `middleware`, etc.). This is the only file with business logic; the backends are dumb storage.
- **[lib/backend.js](lib/backend.js)** — the **backend interface contract** (documentation/reference, not instantiated). Any new backend must implement these methods.
- **[lib/{redis,mongodb,memory}-backend.js](lib/)** — the three storage implementations.
- **[lib/contract.js](lib/contract.js)** — a runtime design-by-contract argument validator.

### Backend abstraction (the key concept)

`acl.js` never talks to a database directly — it talks to a backend through a small key/value-of-sets interface defined in [lib/backend.js](lib/backend.js): `get`, `union`, `unions`, `add`, `del`, `remove`, `clean`, plus a **transaction** model via `begin()` / `end(transaction, cb)`.

Writes are batched: callers do `var t = backend.begin()`, queue mutations with `add`/`del`/`remove` (which push onto `t`), then `backend.end(t, cb)` commits them. In the memory backend a transaction is literally an array of closures executed on `end`; Redis/MongoDB map this onto their native multi/batch primitives. When adding or modifying behavior, preserve this batch-then-commit pattern rather than writing eagerly.

Data is organized into **buckets** (namespaces): `meta`, `parents`, `permissions`, `resources`, `roles`, `users`. The header comment in [lib/acl.js](lib/acl.js) documents the exact Redis key layout (e.g. `acl_allows_{resourceName}_{roleName}`).

### Async model

Internally the library is promise-based (bluebird). The constructor **promisifies** the callback-style backend methods (`backend.getAsync`, `unionAsync`, etc.) so `acl.js` can use promises throughout. Public API methods accept an **optional trailing callback** but also return a promise — support both when adding/editing methods (see how existing methods end with `.nodeify(callback)`).

### contract.js

Every backend method and many ACL methods begin with a `contract(arguments).params(...).end()` call that validates argument types at runtime (e.g. `'string|number'`, `'array'`). It is a no-op unless `contract.debug === true`, which [lib/acl.js](lib/acl.js) sets globally. Keep these contract guards in sync when changing a method's signature.

## Conventions

- Plain ES5, `"use strict"`, callback + promise dual API. No build step, no transpilation, no linter configured.
- `'*'` is the wildcard meaning "all permissions".
- User ids, role names, and resource names are **case-sensitive**.
- When adding a feature, add its test once to [test/tests.js](test/tests.js) so it runs across all backends; only put storage-specific tests in [test/backendtests.js](test/backendtests.js).
