/**
 * acl-next — modern TypeScript ACL / RBAC.
 *
 * Fork of optimalbits/node_acl (MIT, (c) 2011-2013 Manuel Astudillo).
 *
 * Public surface is filled in across the modernization phases:
 *   - Phase 2: types & Backend interface
 *   - Phase 3: backends (memory, redis, mongodb)
 *   - Phase 4: the Acl class
 *   - Phase 5: express middleware
 */

export const VERSION = "1.0.0-alpha.0";

export { Acl } from "./acl.js";
export { Acl as default } from "./acl.js";
export { MemoryBackend } from "./backends/memory.js";
export type { MemoryTransaction } from "./backends/memory.js";

export type {
  AclOptions,
  AllowRule,
  Backend,
  Buckets,
  Key,
  Logger,
  OneOrMany,
  Permission,
  Resource,
  Role,
  StoredValue,
  UserId,
} from "./types.js";
