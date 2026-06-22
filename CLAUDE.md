# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`acl-next` is a modern TypeScript Access Control List (ACL / RBAC) library — a maintained fork of optimalbits/node_acl. It models authorization as **users → roles → resources → permissions**, with role hierarchies (parents). It ships three storage backends (Redis, MongoDB, in-memory) and a framework-agnostic Express-style middleware.

The codebase is **promise-native**, **TypeScript strict**, and has **zero runtime dependencies** (`redis` and `mongodb` are optional peer deps — install only what you use).

## Commands

```bash
npm run build       # tsup → dist/ (ESM + CJS + .d.ts)
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # biome check
npm run format      # biome format --write
npm test            # vitest run (all suites)
npx vitest run test/memory-acl.test.ts          # single backend suite
npx vitest run test/unit                        # fast unit tests, no Docker
npx vitest run -t "isAllowed"                   # filter by test name
```

**Test infrastructure:** the Redis and MongoDB suites use [testcontainers](https://testcontainers.com/) to spin up real databases in Docker — **Docker must be running** for them. The Memory suite and `test/unit/*` run without Docker (use these for the fast inner loop). First run pulls `redis:7-alpine` / `mongo:6` images (slow; `hookTimeout` in [vitest.config.ts](vitest.config.ts) is sized for it).

## Architecture

- **[src/index.ts](src/index.ts)** — public entry point; re-exports everything. Default export is `Acl`.
- **[src/acl.ts](src/acl.ts)** — the `Acl<T>` class: all authorization logic (`allow`, `isAllowed`, `whatResources`, `allowedPermissions`, role/resource/user mutations, `middleware()`). This is the only file with business logic; backends are dumb storage.
- **[src/types.ts](src/types.ts)** — domain types and the generic `Backend<T>` storage interface.
- **[src/backends/{memory,redis,mongodb}.ts](src/backends/)** — the three storage implementations.
- **[src/middleware.ts](src/middleware.ts)** — `aclMiddleware`, `aclErrorHandler`, `HttpError`, and structural HTTP types.

### Backend abstraction (the key concept)

`acl.ts` never talks to a database directly — only to a `Backend<T>` (see [src/types.ts](src/types.ts)): a namespaced (bucketed) key → set-of-values store with **batched writes** via a transaction.

Pattern: `const t = backend.begin()` → queue mutations with `add`/`del`/`remove` (these push onto `t`, they do **not** write) → `await backend.end(t)` commits. Implementations map this onto their primitives:

- **Memory**: transaction is an array of closures run on `end`.
- **Redis**: transaction is a `multi()`; mutations queue `sAdd`/`sRem`/`del`, `end` calls `exec()`.
- **MongoDB**: transaction is an array of async thunks run in series; each (bucket,key) is a document whose field names are the set members.

Buckets: `meta`, `parents`, `permissions`, `resources`, `roles`, `users` (overridable via constructor options), plus dynamic `allows_<resource>` buckets for permissions. When adding/changing behavior, preserve the batch-then-commit pattern rather than writing eagerly.

`Backend.unions` is **optional**; when present (Memory, Redis) `allowedPermissions` uses the bulk-query fast path, otherwise it falls back to per-resource `union` calls (MongoDB).

### Decoupling from drivers

The Redis and MongoDB backends define **structural interfaces** (`RedisClientLike`, `MongoDbLike`, etc.) instead of importing driver types, so the package stays driver-agnostic and consumers without a given driver still type-check. tsup marks `redis`/`mongodb` as `external` so they're never bundled.

## Conventions

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Use `import type` for type-only imports. Relative imports use the `.js` extension.
- **Promise-only** public API (the legacy callback dual-API was intentionally dropped).
- IDs (`UserId`) are coerced to **strings** in stored/returned values.
- `'*'` is the wildcard meaning "all permissions"; ids/role/resource names are case-sensitive.
- Lint/format is **Biome** (config in [biome.json](biome.json)); run `npm run lint` before committing.
- **Tests run once per backend** via the shared, ordered, stateful suite in [test/shared/acl-suite.ts](test/shared/acl-suite.ts). Add a behavioral feature there so it's exercised against all backends; put storage-specific cases in `test/unit/`.

## History

[MODERNIZATION.md](MODERNIZATION.md) is the rewrite plan; [TEST-BASELINE.md](TEST-BASELINE.md) records the legacy suite result (394 passing) that the rewrite preserves.
