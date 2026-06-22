import { beforeEach, describe, expect, it } from "vitest";
import { MemoryBackend } from "../../src/backends/memory.js";

describe("MemoryBackend", () => {
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
  });

  /** Helper: run a single queued mutation through a transaction. */
  const commit = async (queue: (t: ReturnType<MemoryBackend["begin"]>) => void) => {
    const t = backend.begin();
    queue(t);
    await backend.end(t);
  };

  it("returns an empty array for missing bucket/key", async () => {
    expect(await backend.get("nope", "missing")).toEqual([]);
  });

  it("does not apply mutations until the transaction is committed", async () => {
    const t = backend.begin();
    backend.add(t, "users", "u1", "admin");
    expect(await backend.get("users", "u1")).toEqual([]); // not committed yet
    await backend.end(t);
    expect(await backend.get("users", "u1")).toEqual(["admin"]);
  });

  it("adds values as a set (deduplicated, union with existing)", async () => {
    await commit((t) => backend.add(t, "users", "u1", ["a", "b"]));
    await commit((t) => backend.add(t, "users", "u1", ["b", "c"]));
    expect((await backend.get("users", "u1")).sort()).toEqual(["a", "b", "c"]);
  });

  it("coerces numeric keys and values to strings", async () => {
    await commit((t) => backend.add(t, "roles", "guest", 42));
    expect(await backend.get("roles", "guest")).toEqual(["42"]);
    await commit((t) => backend.add(t, "users", 7, "guest"));
    expect(await backend.get("users", 7)).toEqual(["guest"]);
    expect(await backend.get("users", "7")).toEqual(["guest"]);
  });

  it("removes values from a key", async () => {
    await commit((t) => backend.add(t, "users", "u1", ["a", "b", "c"]));
    await commit((t) => backend.remove(t, "users", "u1", ["b"]));
    expect((await backend.get("users", "u1")).sort()).toEqual(["a", "c"]);
  });

  it("deletes keys", async () => {
    await commit((t) => backend.add(t, "users", "u1", "a"));
    await commit((t) => backend.del(t, "users", "u1"));
    expect(await backend.get("users", "u1")).toEqual([]);
  });

  it("unions keys within a bucket", async () => {
    await commit((t) => {
      backend.add(t, "perm", "r1", ["view", "edit"]);
      backend.add(t, "perm", "r2", ["edit", "delete"]);
    });
    expect((await backend.union("perm", ["r1", "r2"])).sort()).toEqual(["delete", "edit", "view"]);
  });

  it("unions keys across multiple buckets", async () => {
    await commit((t) => {
      backend.add(t, "b1", "k", ["x"]);
      backend.add(t, "b2", "k", ["y"]);
    });
    const result = await backend.unions(["b1", "b2", "missing"], ["k"]);
    expect(result.b1).toEqual(["x"]);
    expect(result.b2).toEqual(["y"]);
    expect(result.missing).toEqual([]);
  });

  it("clean() wipes all data", async () => {
    await commit((t) => backend.add(t, "users", "u1", "a"));
    await backend.clean();
    expect(await backend.get("users", "u1")).toEqual([]);
  });
});
