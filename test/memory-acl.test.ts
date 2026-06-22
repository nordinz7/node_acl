import { MemoryBackend } from "../src/backends/memory.js";
import { runAclSuite } from "./shared/acl-suite.js";

runAclSuite("Memory backend", () => new MemoryBackend());
