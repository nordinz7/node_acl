import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Integration tests spin up Docker containers via testcontainers and need headroom.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
