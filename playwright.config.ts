import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT ?? "5173";
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 1,
  webServer: {
    command: `corepack pnpm --filter @arken/web dev -- --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
