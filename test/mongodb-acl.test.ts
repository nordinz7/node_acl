import { type Db, MongoClient } from "mongodb";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll } from "vitest";
import { MongoDBBackend, type MongoDbLike } from "../src/backends/mongodb.js";
import { runAclSuite } from "./shared/acl-suite.js";

let container: StartedTestContainer | undefined;
let client: MongoClient | undefined;

/** Start the shared Mongo container once and reuse it for both modes. */
async function connect(): Promise<Db> {
  if (!container) {
    container = await new GenericContainer("mongo:6").withExposedPorts(27017).start();
    const uri = `mongodb://${container.getHost()}:${container.getMappedPort(27017)}`;
    client = new MongoClient(uri);
    await client.connect();
  }
  // biome-ignore lint/style/noNonNullAssertion: client is set above
  return client!.db("acltest");
}

runAclSuite("MongoDB backend (default)", async () => {
  const db = await connect();
  await db.dropDatabase();
  return new MongoDBBackend(db as unknown as MongoDbLike, { prefix: "acl_" });
});

runAclSuite("MongoDB backend (useSingle)", async () => {
  const db = await connect();
  await db.dropDatabase();
  return new MongoDBBackend(db as unknown as MongoDbLike, { prefix: "acl_", useSingle: true });
});

afterAll(async () => {
  await client?.close();
  await container?.stop();
});
