import { type RedisClientType, createClient } from "redis";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll } from "vitest";
import { RedisBackend } from "../src/backends/redis.js";
import { runAclSuite } from "./shared/acl-suite.js";

let container: StartedTestContainer | undefined;
let client: RedisClientType | undefined;

runAclSuite("Redis backend", async () => {
  container = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
  client = createClient({
    socket: { host: container.getHost(), port: container.getMappedPort(6379) },
  });
  await client.connect();
  return new RedisBackend(client);
});

afterAll(async () => {
  await client?.quit();
  await container?.stop();
});
