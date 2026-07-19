import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/multiplayer",
  // The full GM + 6 story intentionally includes image builds, concurrent
  // browser activity, a network outage and backend restart. Docker Desktop on
  // Windows can exceed six minutes even when every bounded assertion passes.
  timeout: 600_000,
  retries: 0,
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
