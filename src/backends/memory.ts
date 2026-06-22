import type { Backend, Key, OneOrMany, StoredValue } from "../types.js";

/** A queued mutation. The memory transaction is simply a list of these. */
type Mutation = () => void;

/** In-memory transaction: an ordered list of pending mutations. */
export type MemoryTransaction = Mutation[];

const toArray = <T>(value: OneOrMany<T>): T[] => (Array.isArray(value) ? value : [value]);

/** Keys and values are normalized to strings (see migration notes). */
const toStr = (value: Key | StoredValue): string => `${value}`;

/**
 * In-memory storage backend. No external dependencies — ideal for tests and
 * single-process apps. Data lives in a `Map<bucket, Map<key, values[]>>`.
 */
export class MemoryBackend implements Backend<MemoryTransaction> {
  private buckets = new Map<string, Map<string, string[]>>();

  begin(): MemoryTransaction {
    return [];
  }

  async end(transaction: MemoryTransaction): Promise<void> {
    for (const mutation of transaction) {
      mutation();
    }
  }

  async clean(): Promise<void> {
    this.buckets.clear();
  }

  async get(bucket: string, key: Key): Promise<string[]> {
    const values = this.buckets.get(bucket)?.get(toStr(key));
    return values ? [...values] : [];
  }

  async unions(buckets: string[], keys: Key[]): Promise<Record<string, string[]>> {
    const keyStrs = keys.map(toStr);
    const result: Record<string, string[]> = {};

    for (const bucket of buckets) {
      const store = this.buckets.get(bucket);
      if (!store) {
        result[bucket] = [];
        continue;
      }
      const union = new Set<string>();
      for (const key of keyStrs) {
        for (const value of store.get(key) ?? []) {
          union.add(value);
        }
      }
      result[bucket] = [...union];
    }

    return result;
  }

  async union(bucket: string, keys: Key[]): Promise<string[]> {
    let store = this.buckets.get(bucket);

    // Legacy behavior: if no exact bucket matches, treat existing bucket names
    // as regular expressions and use the first that matches `bucket`.
    if (!store) {
      for (const name of this.buckets.keys()) {
        if (new RegExp(`^${name}$`).test(bucket)) {
          store = this.buckets.get(name);
          break;
        }
      }
    }

    if (!store) {
      return [];
    }

    const union = new Set<string>();
    for (const key of keys) {
      for (const value of store.get(toStr(key)) ?? []) {
        union.add(value);
      }
    }
    return [...union];
  }

  add(
    transaction: MemoryTransaction,
    bucket: string,
    key: Key,
    values: OneOrMany<StoredValue>,
  ): void {
    const keyStr = toStr(key);
    const valueStrs = toArray(values).map(toStr);

    transaction.push(() => {
      let store = this.buckets.get(bucket);
      if (!store) {
        store = new Map();
        this.buckets.set(bucket, store);
      }
      const existing = store.get(keyStr);
      // New values first, then existing — matches the legacy union order.
      store.set(
        keyStr,
        existing ? [...new Set([...valueStrs, ...existing])] : [...new Set(valueStrs)],
      );
    });
  }

  del(transaction: MemoryTransaction, bucket: string, keys: OneOrMany<Key>): void {
    const keyStrs = toArray(keys).map(toStr);

    transaction.push(() => {
      const store = this.buckets.get(bucket);
      if (!store) {
        return;
      }
      for (const key of keyStrs) {
        store.delete(key);
      }
    });
  }

  remove(
    transaction: MemoryTransaction,
    bucket: string,
    key: Key,
    values: OneOrMany<StoredValue>,
  ): void {
    const keyStr = toStr(key);
    const toRemove = new Set(toArray(values).map(toStr));

    transaction.push(() => {
      const existing = this.buckets.get(bucket)?.get(keyStr);
      if (existing) {
        this.buckets.get(bucket)?.set(
          keyStr,
          existing.filter((value) => !toRemove.has(value)),
        );
      }
    });
  }
}
