import type { Backend, Key, OneOrMany, StoredValue } from "../types.js";

/**
 * Minimal structural types for the mongodb v4+ driver, declared here so this
 * module stays decoupled from the driver (mongodb is an optional peer dep).
 */
export interface MongoCollectionLike {
  findOne(filter: object, options?: object): Promise<Record<string, unknown> | null>;
  find(filter: object, options?: object): { toArray(): Promise<Record<string, unknown>[]> };
  updateOne(filter: object, update: object, options?: object): Promise<unknown>;
  deleteMany(filter: object): Promise<unknown>;
  createIndex(spec: object): Promise<string>;
  drop(): Promise<boolean>;
}

export interface MongoDbLike {
  collection(name: string): MongoCollectionLike;
  collections(): Promise<MongoCollectionLike[]>;
}

/** Each queued mutation is an async function; the transaction runs them in series. */
export type MongoTransaction = Array<() => Promise<void>>;

export interface MongoDBBackendOptions {
  prefix?: string;
  /** Store every bucket in one collection (distinguished by `_bucketname`). */
  useSingle?: boolean;
  /** Use bucket names verbatim as collection names (skip sanitization). */
  useRawCollectionNames?: boolean;
}

/** Collection that holds meta + all `allows_*` buckets when `useSingle` is on. */
const SINGLE_COLLECTION = "resources";

const toArray = <T>(value: OneOrMany<T>): T[] => (Array.isArray(value) ? value : [value]);

/** Field names cannot contain dots; encode keys/values before storing. */
function encode(text: Key | StoredValue): string | number {
  if (typeof text === "string") {
    return encodeURIComponent(text).replace(/\./g, "%2E");
  }
  return text;
}

const decode = (text: string): string => decodeURIComponent(text);

/**
 * MongoDB storage backend (mongodb v4+ driver).
 *
 * Each (bucket, key) pair is a document whose field names are the set members
 * (stored as `{ <member>: true }`), since MongoDB has no native set type.
 */
export class MongoDBBackend implements Backend<MongoTransaction> {
  private readonly db: MongoDbLike;
  private readonly prefix: string;
  private readonly useSingle: boolean;
  private readonly useRawCollectionNames: boolean;

  constructor(db: MongoDbLike, options: MongoDBBackendOptions = {}) {
    this.db = db;
    this.prefix = options.prefix ?? "";
    this.useSingle = options.useSingle ?? false;
    this.useRawCollectionNames = options.useRawCollectionNames ?? false;
  }

  begin(): MongoTransaction {
    return [];
  }

  async end(transaction: MongoTransaction): Promise<void> {
    for (const mutation of transaction) {
      await mutation();
    }
  }

  async clean(): Promise<void> {
    const collections = await this.db.collections();
    await Promise.all(collections.map((collection) => collection.drop().catch(() => false)));
  }

  async get(bucket: string, key: Key): Promise<string[]> {
    const collection = this.collection(bucket);
    const doc = await collection.findOne(this.filter(bucket, encode(key)), {
      projection: { _bucketname: 0 },
    });
    if (!doc) {
      return [];
    }
    return this.members(doc);
  }

  async union(bucket: string, keys: Key[]): Promise<string[]> {
    const collection = this.collection(bucket);
    const filter = this.useSingle
      ? { _bucketname: bucket, key: { $in: keys.map(encode) } }
      : { key: { $in: keys.map(encode) } };

    const docs = await collection.find(filter, { projection: { _bucketname: 0 } }).toArray();
    const union = new Set<string>();
    for (const doc of docs) {
      for (const member of this.members(doc)) {
        union.add(member);
      }
    }
    return [...union];
  }

  add(
    transaction: MongoTransaction,
    bucket: string,
    key: Key,
    values: OneOrMany<StoredValue>,
  ): void {
    if (key === "key") {
      throw new Error("Key name 'key' is not allowed.");
    }
    const filter = this.filter(bucket, encode(key));
    const doc = this.buildDoc(values);

    transaction.push(async () => {
      await this.collection(bucket).updateOne(filter, { $set: doc }, { upsert: true });
    });
    transaction.push(async () => {
      await this.collection(bucket).createIndex({ _bucketname: 1, key: 1 });
    });
  }

  del(transaction: MongoTransaction, bucket: string, keys: OneOrMany<Key>): void {
    const encoded = toArray(keys).map(encode);
    const filter = this.useSingle
      ? { _bucketname: bucket, key: { $in: encoded } }
      : { key: { $in: encoded } };

    transaction.push(async () => {
      await this.collection(bucket).deleteMany(filter);
    });
  }

  remove(
    transaction: MongoTransaction,
    bucket: string,
    key: Key,
    values: OneOrMany<StoredValue>,
  ): void {
    const filter = this.filter(bucket, encode(key));
    const doc = this.buildDoc(values);

    transaction.push(async () => {
      await this.collection(bucket).updateOne(filter, { $unset: doc }, { upsert: true });
    });
  }

  // --- helpers ---------------------------------------------------------------

  private collection(bucket: string): MongoCollectionLike {
    const name = this.useSingle ? SINGLE_COLLECTION : bucket;
    return this.db.collection(this.prefix + this.sanitizeCollectionName(name));
  }

  private filter(bucket: string, key: string | number): Record<string, unknown> {
    return this.useSingle ? { _bucketname: bucket, key } : { key };
  }

  /** Build a `{ <encoded member>: true }` doc from one or many values. */
  private buildDoc(values: OneOrMany<StoredValue>): Record<string, true> {
    const doc: Record<string, true> = {};
    for (const value of toArray(values)) {
      doc[`${encode(value)}`] = true;
    }
    return doc;
  }

  /** Decode a stored document's field names back into set members. */
  private members(doc: Record<string, unknown>): string[] {
    return Object.keys(doc)
      .filter((field) => field !== "key" && field !== "_id")
      .map(decode);
  }

  private sanitizeCollectionName(name: string): string {
    if (this.useRawCollectionNames) {
      return name;
    }
    // Collection names cannot contain slashes or whitespace.
    return decodeURIComponent(name).replace(/[/\s]/g, "_");
  }
}
