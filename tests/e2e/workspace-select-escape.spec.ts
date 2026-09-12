import type { Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

async function install(page: Page, role: "GM" | "PLAYER") {
  const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
  const assetId = "1acf0101-1111-4111-8111-111111111111";
  snapshot.assets = [{
    id: assetId,
    kind: "TOKEN",
    name: "Портрет стража",
    mimeType: "image/svg+xml",
    sizeBytes: 128,
    width: 64,
    height: 64,
    durationSeconds: null,
    url: `/api/assets/${assetId}/content`,
    createdAt: new Date(0).toISOString(),
  }];
  snapshot.tokenDefinitions = [{
    id: "1acf0102-1111-4111-8111-111111111111",
    characterId: null,
    defaultAssetId: assetId,
    name: "Страж",
    ownName: "Страж",
    defaultWidth: 1,
    defaultHeight: 1,
    controllerMembershipIds: [snapshot.me.id],
    revision: 1,
  }];
  const mutations: string[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/client-logs") {
      return route.fulfill({ json: { ok: true } });
    }
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 405, json: { error: "READ_ONLY_FIXTURE" } });
    }
    if (path.endsWith("/content")) {
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#637d72"/></svg>',
      });
    }
    return route.fulfill({
      json: path === "/api/bootstrap" ? snapshot : path === "/api/story/posts"
        ? { posts: [], nextCursor: null } : [],
    });
  });
  return mutations;
}

for (const role of ["GM", "PLAYER"] as const) {
  for (const width of [1280, 390]) {
    test(`UIX-644 ${role} ${width}: first Escape belongs to outer token image select`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const mutations = await install(page, role);
      await page.goto("/");
      await openWorkspaceSection(page, "Токены");
      const workspace = page.getByRole("dialog", { name: "Токены", exact: true });
      const trigger = workspace.getByRole("combobox", { name: "Изображение токена Страж" });
      const menu = page.locator(".arken-form-select-popup");
      await expect(trigger).toContainText("Портрет стража");
      await trigger.click();
      await expect(menu).toBeVisible();
      const option = menu.getByRole("option", { name: "Без изображения", exact: true });
      await expect.poll(() => option.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      })).toBe(true);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(workspace).toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toContainText("Портрет стража");
      expect(mutations).toEqual([]);

      // A closed Select must not swallow the workspace's own Escape action.
      await page.keyboard.press("Escape");
      await expect(workspace).toBeHidden();
      expect(mutations).toEqual([]);
    });
  }
}
