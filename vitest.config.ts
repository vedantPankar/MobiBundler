import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}", "extensions/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    globalSetup: ["tests/globalSetup.ts"],
    pool: "forks",
    // All DB tests share one SQLite file; run files serially so resets cannot interleave.
    fileParallelism: false,
  },
});
