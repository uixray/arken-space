import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "hosted-login-local.spec.ts",
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:14923",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 14923 --strictPort",
    cwd: "apps/web",
    url: "http://127.0.0.1:14923",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
