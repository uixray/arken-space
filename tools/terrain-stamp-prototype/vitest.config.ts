import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tools/terrain-stamp-prototype/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
