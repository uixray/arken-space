import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/multiplayer",
  timeout: 240_000,
  retries: 1,
  workers: 1,
  outputDir: "test-results/artifacts",
  reporter: [
    ["line"],
    ["json", { outputFile: "test-results/results.json" }],
    ["junit", { outputFile: "test-results/results.xml" }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:14180",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
