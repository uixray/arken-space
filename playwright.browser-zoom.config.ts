import { defineConfig } from "@playwright/test";

// Separate from the cross-browser E2E suite: requires Chrome's isolated profile
// settings API, not Firefox/WebKit or a CDP device-scale approximation.
export default defineConfig({
  testDir: "./tests/browser-qa",
  testMatch: "real-browser-zoom.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5187" },
});
