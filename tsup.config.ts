import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // Downlevel output so it runs on the widest supported Node (engines: >=16).
  target: "node16",
  // redis / mongodb are optional peer deps — never bundle them.
  external: ["redis", "mongodb"],
});
