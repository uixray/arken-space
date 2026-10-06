import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error(
    "E2E_BASE_URL is required for the production-build E2E suite",
  );
}
const { webServer: _devServer, ...releaseBase } = baseConfig;

// These four specs import Vite-only /tests/fixtures/ pages. They run separately
// with playwright.fixtures.config.ts and must not create false release failures.
export default defineConfig({
  ...releaseBase,
  testIgnore: [
    "**/modal-owner-close-lifecycle.spec.ts",
    "**/modal-owner-contract.spec.ts",
    "**/player-theme-states.spec.ts",
    "**/select-element-resize.spec.ts",
  ],
  use: { ...baseConfig.use, baseURL },
});
