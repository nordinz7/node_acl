# Modernization Plan

Plan to rewrite `node_acl` as a modern, TypeScript, promise-native ACL library published under a new name (e.g. `acl-next` or `@you/acl`).

The original architecture is sound — keep the **users → roles → resources → permissions** model, the **backend abstraction**, the **transaction `begin`/`end`** pattern, and the **bucket** namespacing. Everything else is replaceable.

---

## Target stack

| Concern | Now | Target | Notes |
| --- | --- | --- | --- |
| Language | ES5, `var`, prototypes | **TypeScript** (strict), classes, ESM | Ship dual ESM + CJS |
| Promises | `bluebird` | **native** Promises / `async`/`await` | Delete bluebird |
| Utilities | `lodash@4`, `async@2` | **native** (`Set`, `Array.flat`, spread) | Delete both |
| Arg validation | `contract.js` (runtime) | **TS types** (compile-time) | Delete contract.js entirely |
| API style | dual callback + promise | **promise-only** | Breaking → justifies new major/name |
| Redis driver | `redis@2` | `redis@4+` (promise-native) | API changed significantly |
| Mongo driver | `mongodb@2` | `mongodb@6+` (promise-native) | API changed significantly |
| Tests | mocha + chai, needs local DBs | **vitest** + **testcontainers** | Spins up Redis/Mongo in Docker per run |
| Lint/format | none | **Biome** (or ESLint + Prettier) | Biome = one fast tool |
| CI | Travis (Node 0.10–stable) | **GitHub Actions**, Node 18/20/22 LTS | Matrix |
| Build | none | **tsup** (esbuild) | Emits ESM, CJS, and `.d.ts` |
| Docs | hand-written README | README + **typedoc** | Generated API reference |
| Node support | `>= 0.10` | `>= 18` | |

---

## Phase 0 — Foundation (no logic changes)

Goal: a buildable, lintable, empty TS project skeleton.

1. New repo / package name; update `package.json` (`name`, `type: "module"`, `exports` map, `engines`, `files`).
2. Add `LICENSE` keeping the original MIT notice (`Copyright (c) 2011-2013 Manuel Astudillo`) **plus** your own line. Note "fork of optimalbits/node_acl" in README.
3. `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess`, `target: ES2022`, `moduleResolution: bundler`.
4. tsup config → dual ESM/CJS + declarations.
5. Biome (or ESLint+Prettier) config.
6. GitHub Actions: lint + typecheck + test matrix on Node 18/20/22.
7. `src/` layout: `src/index.ts`, `src/acl.ts`, `src/types.ts`, `src/backends/{memory,redis,mongodb}.ts`.

**Risk:** low. **Output:** green CI on an empty shell.

## Phase 1 — Test harness first (safety net)

Goal: port the existing test suite *before* touching logic, so the rewrite is verified against known-good behavior.

1. Port [test/tests.js](test/tests.js) + [test/backendtests.js](test/backendtests.js) to vitest, keeping the "run the same suite against every backend" structure from [test/runner.js](test/runner.js).
2. Replace the "requires local Redis/Mongo" assumption with **testcontainers** — tests start ephemeral DB containers, so `npm test` works on any machine with Docker and in CI without service config.
3. Keep the Memory backend suite able to run without Docker (fast inner loop).

**Risk:** medium (testcontainers + Docker in CI). **Output:** the full behavioral spec, runnable.

## Phase 2 — Types & backend interface

1. Define `src/types.ts`: `UserId = string | number`, `Role`, `Resource`, `Permission`, and the `Backend` interface (typed version of [lib/backend.js](lib/backend.js)): `get`, `union`, `unions`, `add`, `del`, `remove`, `clean`, `begin`, `end`.
2. Decide the transaction type. Recommended: keep it opaque (`type Transaction = unknown` per backend, or a generic `Backend<T>`), preserving the queue-then-commit model.
3. Make backend methods **return Promises** instead of taking callbacks — this is what lets `acl.ts` drop bluebird's `promisify`.

## Phase 3 — Port backends (memory → redis → mongo)

1. **Memory** first (no external dep, pure logic). Replace lodash with `Set`/`Array.flat`. This validates the test harness end-to-end.
2. **Redis** on `redis@4`: rewrite using native promise API and `multi()` for the transaction commit. Map `begin`→start a command queue, `end`→`exec()`.
3. **MongoDB** on `mongodb@6`: rewrite with the modern collection API; preserve the `useSingle` option (one collection vs per-resource).

**Risk:** medium-high — redis/mongo driver APIs changed a lot between v2 and current. The ported test suite is your guardrail.

## Phase 4 — Port core (`acl.ts`)

1. Translate [lib/acl.js](lib/acl.js) public API to a `class Acl`, **promise-only** (drop the `nodeify`/callback dual path).
2. Replace bluebird chains with `async`/`await`.
3. Replace all lodash/async calls with native equivalents.
4. **Delete `contract.js`** — runtime `params(...)` checks become TS parameter types. (Optionally add light runtime guards only at the public boundary if you want JS-consumer safety.)
5. Keep `'*'` wildcard semantics and case-sensitivity behavior intact (tests enforce this).

## Phase 5 — Express middleware

1. Type `acl.middleware(numPathComponents?, userId?, permissions?)`.
2. Consider decoupling from Express's exact types (accept a minimal `{ url, method, session }`-shaped request) so it works with Express 5, Fastify adapters, etc. — or ship `@types/express` as a peer/optional dep.

## Phase 6 — Packaging, docs, release

1. Verify the `exports` map resolves for both `import` and `require`; test with `arethetypeswrong` and `publint`.
2. Rewrite README for the new name + promise-only API; add a **migration guide** from `node_acl` (callbacks→promises, dropped bluebird-specific behavior).
3. Generate API docs with typedoc.
4. `npm publish` as `1.0.0` (it's a clean break). Add a CHANGELOG and semantic-release if you want automation.

---

## Other suggestions / nice-to-haves

- **Make the package zero-dependency at runtime.** After dropping bluebird/lodash/async, the core needs no deps; the redis/mongo drivers become `peerDependencies` (the consumer brings their own client) so you don't pin their versions. This is the single biggest modernization win.
- **`exactOptionalPropertyTypes` + generics on `Backend<TTransaction>`** for full type safety across backends.
- **Add a `deny`/explicit-denial feature** — listed as "Future work" in the original README and never built. A clean differentiator for the fork.
- **Batch/typed query helpers** and an `isAllowedAny` / `isAllowedAll` distinction for clearer multi-permission semantics.
- **Benchmarks** (e.g. `tinybench`) so dependency changes don't regress performance.
- **`provenance` on publish** (npm `--provenance` via GitHub Actions) for supply-chain trust.
- **Drop Docker requirement for unit tests** by keeping memory-backend tests as the fast path; gate container tests behind a separate `test:integration` script.

---

## Suggested order of attack

Phase 0 → 1 → 3a (memory) → 4 → 5 → 3b/3c (redis/mongo) → 2 is woven through 2–4 → 6.

Rationale: get a buildable shell + ported tests + the memory backend working with the new core **first** (no Docker, no driver upgrades) to prove the whole design, then tackle the higher-risk redis/mongo driver upgrades against a passing suite.
