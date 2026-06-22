import type { Backend, Key, OneOrMany, StoredValue } from "../types.js";

/**
 * Minimal structural type for a node-redis v4+ client. Declared here (rather
 * than importing from `redis`) so this module stays decoupled from the driver:
 * any compatible client works, and consumers without `redis` installed can
 * still type-check the rest of the package.
 */
export interface RedisClientLike {
  multi(): RedisMultiLike;
  sMembers(key: string): Promise<string[]>;
  sUnion(keys: string[]): Promise<string[]>;
  keys(pattern: string): Promise<string[]>;
  del(keys: string | string[]): Promise<number>;
}

export interface RedisMultiLike {
  sAdd(key: string, members: string | string[]): RedisMultiLike;
  sRem(key: string, members: string | string[]): RedisMultiLike;
  del(keys: string | string[]): RedisMultiLike;
  exec(): Promise<unknown[]>;
}

const toArray = <T>(value: OneOrMany<T>): T[] => (Array.isArray(value) ? value : [value]);
const toStr = (value: Key | StoredValue): string => `${value}`;

/** Redis storage backend (node-redis v4+). Sets map directly to Redis sets. */
export class RedisBackend implements Backend<RedisMultiLike> {
  private readonly redis: RedisClientLike;
  private readonly prefix: string;

  constructor(redis: RedisClientLike, prefix = "acl") {
    this.redis = redis;
    this.prefix = prefix;
  }

  begin(): RedisMultiLike {
    return this.redis.multi();
  }

  async end(transaction: RedisMultiLike): Promise<void> {
    await transaction.exec();
  }

  async clean(): Promise<void> {
    const keys = await this.redis.keys(`${this.prefix}*`);
    if (keys.length) {
      await this.redis.del(keys);
    }
  }

  get(bucket: string, key: Key): Promise<string[]> {
    return this.redis.sMembers(this.bucketKey(bucket, key));
  }

  async unions(buckets: string[], keys: Key[]): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    await Promise.all(
      buckets.map(async (bucket) => {
        result[bucket] = await this.redis.sUnion(this.bucketKeys(bucket, keys));
      }),
    );
    return result;
  }

  union(bucket: string, keys: Key[]): Promise<string[]> {
    return this.redis.sUnion(this.bucketKeys(bucket, keys));
  }

  add(transaction: RedisMultiLike, bucket: string, key: Key, values: OneOrMany<StoredValue>): void {
    transaction.sAdd(this.bucketKey(bucket, key), toArray(values).map(toStr));
  }

  del(transaction: RedisMultiLike, bucket: string, keys: OneOrMany<Key>): void {
    transaction.del(toArray(keys).map((key) => this.bucketKey(bucket, key)));
  }

  remove(
    transaction: RedisMultiLike,
    bucket: string,
    key: Key,
    values: OneOrMany<StoredValue>,
  ): void {
    transaction.sRem(this.bucketKey(bucket, key), toArray(values).map(toStr));
  }

  private bucketKey(bucket: string, key: Key): string {
    return `${this.prefix}_${bucket}@${key}`;
  }

  private bucketKeys(bucket: string, keys: Key[]): string[] {
    return keys.map((key) => this.bucketKey(bucket, key));
  }
}
