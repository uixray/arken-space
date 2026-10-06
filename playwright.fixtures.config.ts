import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig(baseConfig, {
  testMatch: [
    "**/modal-owner-close-lifecycle.spec.ts",
    "**/modal-owner-contract.spec.ts",
    "**/player-theme-states.spec.ts",
    "**/select-element-resize.spec.ts",
  ],
});
