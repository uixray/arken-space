import type { Page } from "@playwright/test";

/** Only for fully mocked authenticated game snapshots, never a live API. */
export async function mockAuthenticatedGameCapabilities(page: Page) {
  await page.route("**/api/soundpad", (route) =>
    route.fulfill({ json: { packs: [], playerPlaybackEnabled: true } }),
  );
  await page.route("**/api/client-logs", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/account/capabilities", (route) =>
    route.fulfill({
      json: {
        accountAuthEnabled: false,
        campaignLinkAccessEnabled: false,
        legacyDevEnabled: true,
      },
    }),
  );
}
