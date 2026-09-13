import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./scripts/test-database.ts"],
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
