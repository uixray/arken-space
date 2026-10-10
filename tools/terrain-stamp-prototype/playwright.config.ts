import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { defineConfig, devices } = createRequire(import.meta.url)(
  "@playwright/test",
) as typeof import("@playwright/test");

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  testDir: resolve(repositoryRoot, "tests/e2e"),
  testMatch: "terrain-stamp-prototype.spec.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  outputDir: resolve(repositoryRoot, ".data/qa-prep/terrain-stamp-prototype"),
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:14244",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node apps/web/node_modules/vite/bin/vite.js --config tools/terrain-stamp-prototype/vite.config.ts --host 127.0.0.1 --port 14244 --strictPort",
    cwd: repositoryRoot,
    url: "http://127.0.0.1:14244",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
