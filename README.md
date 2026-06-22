# acl-next

> Modern TypeScript Access Control Lists (ACL / RBAC) for Node.js — with Redis, MongoDB and in-memory backends, and Express middleware.

A maintained, modernized fork of [optimalbits/node_acl](https://github.com/optimalbits/node_acl) (MIT). Same proven model — users → roles → resources → permissions, with role hierarchies — rebuilt as **TypeScript**, **promise-native**, and **zero runtime dependencies**.

## What changed from `node_acl`

- **TypeScript**, with full type declarations.
- **Promise-only** API — the legacy callback signatures are gone (use `await`).
- **No runtime dependencies.** `bluebird`, `lodash` and `async` are removed. `redis` and `mongodb` are now **optional peer dependencies** — install only the driver you use.
- Modern drivers: **redis v4+**, **mongodb v4+**.
- IDs are normalized to **strings** in stored/returned values.
- Dual **ESM + CommonJS** build.

See the [Migration guide](#migration-from-node_acl) below.

## Install

```bash
npm install acl-next
# plus the backend driver you use (optional peer deps):
npm install redis        # for RedisBackend
npm install mongodb      # for MongoDBBackend
# MemoryBackend needs nothing
```

## Quick start

```ts
import { Acl, MemoryBackend } from "acl-next";

const acl = new Acl(new MemoryBackend());

// Roles get permissions over resources (roles/resources created implicitly):
await acl.allow("guest", "blogs", "view");
await acl.allow("member", "blogs", ["edit", "view", "delete"]);

// Users get roles (users created implicitly):
await acl.addUserRoles("joed", "guest");

// Query:
await acl.isAllowed("joed", "blogs", "view"); // => true
await acl.isAllowed("joed", "blogs", "edit"); // => false
```

### Role hierarchies

```ts
await acl.addRoleParents("baz", ["foo", "bar"]); // baz inherits foo + bar
```

### Bulk permissions

```ts
await acl.allow([
  {
    roles: ["guest", "member"],
    allows: [
      { resources: "blogs", permissions: "get" },
      { resources: ["forums", "news"], permissions: ["get", "put", "delete"] },
    ],
  },
]);
```

### Wildcard

```ts
await acl.allow("admin", ["blogs", "forums"], "*"); // all permissions
```

## Backends

```ts
import { Acl, RedisBackend, MongoDBBackend, MemoryBackend } from "acl-next";

// In-memory (no deps) — great for tests / single process:
new Acl(new MemoryBackend());

// Redis (node-redis v4+):
import { createClient } from "redis";
const redis = createClient();
await redis.connect();
new Acl(new RedisBackend(redis, "acl" /* key prefix */));

// MongoDB (mongodb v4+):
import { MongoClient } from "mongodb";
const client = new MongoClient("mongodb://localhost:27017");
await client.connect();
new Acl(new MongoDBBackend(client.db("mydb"), { prefix: "acl_", useSingle: false }));
```

Bring your own backend by implementing the `Backend<T>` interface (see [`src/types.ts`](src/types.ts)).

## Express middleware

```ts
import { aclErrorHandler } from "acl-next";

// Protect a route — resource defaults to req.url, permission to req.method:
app.put("/blogs/:id", acl.middleware(), handler);

// Only the first N path components form the resource name:
app.put("/blogs/:id/comments/:commentId", acl.middleware(3), handler);

// Custom userId (value or resolver) and explicit permission:
app.put("/blogs/:id", acl.middleware(3, (req) => req.user.id, "post"), handler);

// Render the 401/403 errors it raises:
app.use(aclErrorHandler("json")); // or "html", or omit for plain text
```

The middleware resolves the user from (in order): the `userId` argument, `req.session.userId`, then `req.user.id`.

## API

All methods return Promises.

| Method | Description |
| --- | --- |
| `addUserRoles(userId, roles)` | Assign role(s) to a user |
| `removeUserRoles(userId, roles)` | Remove role(s) from a user |
| `userRoles(userId)` | Roles assigned to a user |
| `roleUsers(role)` | Users that have a role |
| `hasRole(userId, role)` | Whether a user has a role |
| `addRoleParents(role, parents)` | Add parent role(s) (inheritance) |
| `removeRoleParents(role, parents?)` | Remove parent role(s) (all if omitted) |
| `removeRole(role)` | Remove a role and its permissions |
| `removeResource(resource)` | Remove a resource |
| `allow(roles, resources, permissions)` / `allow(rules[])` | Grant permissions |
| `removeAllow(role, resources, permissions?)` | Revoke permissions |
| `allowedPermissions(userId, resources)` | Map of resource → permissions for a user |
| `isAllowed(userId, resource, permissions)` | Whether a user has all permissions |
| `areAnyRolesAllowed(roles, resource, permissions)` | Whether any role qualifies |
| `whatResources(roles)` / `whatResources(roles, permissions)` | Resources a role can access |
| `middleware(numPathComponents?, userId?, actions?)` | Express middleware factory |

## Migration from `node_acl`

1. **Rename the import:** `acl` → `acl-next`.
2. **Drop callbacks, use `await`:**

   ```ts
   // before
   acl.isAllowed("joed", "blogs", "view", (err, allowed) => { ... });
   // after
   const allowed = await acl.isAllowed("joed", "blogs", "view");
   ```

3. **Constructor uses imported backends** (no more `new acl.redisBackend(...)`):

   ```ts
   import { Acl, RedisBackend } from "acl-next";
   const acl = new Acl(new RedisBackend(redisClient));
   ```
4. **MongoDB options are an object:** `new MongoDBBackend(db, { prefix, useSingle })` instead of positional args.
5. **Upgrade drivers** to `redis@4+` / `mongodb@4+`.
6. **Numeric IDs come back as strings** (e.g. `roleUsers` returns `["3"]`, not `[3]`).

## Development

```bash
npm run build       # ESM + CJS + .d.ts via tsup
npm run typecheck   # tsc --noEmit
npm run lint        # biome
npm test            # vitest (Redis/Mongo suites use testcontainers → Docker required)
```

The Redis/MongoDB suites spin up real databases with [testcontainers](https://testcontainers.com/) (needs Docker). The Memory and unit suites run without Docker.

## License

[MIT](LICENSE). Original work © 2011-2013 Manuel Astudillo; modernization © 2026 contributors.
