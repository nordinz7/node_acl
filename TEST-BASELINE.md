# Test Baseline (pre-modernization)

Captured on the legacy ES5 codebase **before** the TypeScript rewrite, to verify the rewrite preserves behavior. Run on branch `modernize-typescript` at its first commit.

## Result

```
394 passing (676ms)
6 pending
0 failing
```

The suite ([test/runner.js](test/runner.js)) runs the **same** shared specs ([test/tests.js](test/tests.js), [test/backendtests.js](test/backendtests.js)) against four backend configurations:

| Suite | Backend |
| --- | --- |
| MongoDB - Default | per-resource collections |
| MongoDB - useSingle | single collection |
| Redis | redis client |
| Memory | in-memory |

The 6 pending specs are `it.skip`/unimplemented placeholders in the legacy suite (not failures).

## Environment used to capture this

| Item | Value |
| --- | --- |
| Node | v20.19.0 |
| npm | 10.8.2 |
| Redis | local service on `127.0.0.1:6379` |
| MongoDB | Docker `mongo:4.4` on `localhost:27017` |
| Command | `npm test` (`mocha test/runner.js --reporter spec`) |

> Note: the legacy suite requires Redis and MongoDB reachable on localhost. Mongo was provided here via:
> `docker run -d --name acl-mongo-baseline -p 27017:27017 mongo:4.4`

## Acceptance criterion for the rewrite

The modernized suite (vitest + testcontainers) must reproduce **the same passing specs across all four backend configurations** before the rewrite is considered behavior-preserving. The 6 pending specs may be implemented or dropped, but no previously-passing spec may regress.
