/**
 * Core domain types and the storage Backend interface.
 *
 * This is the typed, promise-native successor to the legacy lib/backend.js
 * contract. Backends are namespaced (bucketed) key -> set-of-values stores
 * with batched, committed writes.
 */

/** A user identifier. Users are created implicitly by assigning them roles. */
export type UserId = string | number;

/** A role name. `"*"` is reserved to mean "all permissions". */
export type Role = string;

/** A resource name (e.g. a URL or logical resource). */
export type Resource = string;

/** A permission/action name (e.g. `"get"`, `"edit"`). */
export type Permission = string;

/** A key within a bucket. */
export type Key = string | number;

/** A value stored inside a bucket's set. */
export type StoredValue = string | number;

/** One or many of `T` — mirrors the original "accepts string or array" API. */
export type OneOrMany<T> = T | T[];

/** Optional logger; when provided, the Acl instance emits debug output. */
export interface Logger {
  debug(...args: unknown[]): void;
}

/** Names of the internal storage buckets. Overridable via {@link AclOptions}. */
export interface Buckets {
  meta: string;
  parents: string;
  permissions: string;
  resources: string;
  roles: string;
  users: string;
}

/** Options accepted by the Acl constructor. */
export interface AclOptions {
  buckets?: Partial<Buckets>;
}

/** A single entry of the array form of `allow(...)`. */
export interface AllowRule {
  roles: OneOrMany<Role>;
  allows: Array<{
    resources: OneOrMany<Resource>;
    permissions: OneOrMany<Permission>;
  }>;
}

/**
 * Storage backend interface.
 *
 * Writes are not applied immediately: callers obtain a transaction with
 * {@link Backend.begin}, queue mutations with {@link Backend.add},
 * {@link Backend.del} and {@link Backend.remove}, then commit them with
 * {@link Backend.end}. Backends that support it commit atomically.
 *
 * @typeParam T - the backend-specific transaction type produced by `begin`.
 */
export interface Backend<T = unknown> {
  /** Start a transaction (a queue of pending mutations). */
  begin(): T;

  /** Commit a transaction. */
  end(transaction: T): Promise<void>;

  /** Remove all stored data. */
  clean(): Promise<void>;

  /** Get the set of values stored at `bucket`/`key` (empty array if none). */
  get(bucket: string, key: Key): Promise<string[]>;

  /** Union of the sets stored at the given `keys` within one `bucket`. */
  union(bucket: string, keys: Key[]): Promise<string[]>;

  /**
   * Per-bucket union of `keys` across multiple `buckets`, keyed by bucket.
   * Optional — Acl falls back to repeated {@link Backend.union} calls when a
   * backend does not implement it.
   */
  unions?(buckets: string[], keys: Key[]): Promise<Record<string, string[]>>;

  /** Queue: add `values` to the set at `bucket`/`key`. */
  add(transaction: T, bucket: string, key: Key, values: OneOrMany<StoredValue>): void;

  /** Queue: delete the given `keys` from `bucket`. */
  del(transaction: T, bucket: string, keys: OneOrMany<Key>): void;

  /** Queue: remove `values` from the set at `bucket`/`key`. */
  remove(transaction: T, bucket: string, key: Key, values: OneOrMany<StoredValue>): void;
}
