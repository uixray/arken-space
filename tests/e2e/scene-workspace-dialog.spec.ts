import { expect, test } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";

const snapshot: GameSnapshot = {
  campaign: { id: "campaign-1", name: "Проверка сцен" },
  me: {
    id: "gm-1",
    role: "GM",
    displayName: "Мастер",
    characterId: null,
  },
  members: [
    { id: "gm-1", role: "GM", displayName: "Мастер", characterId: null },
  ],
  characters: [],
  scenes: [
    {
      id: "scene-1",
      name: "Длинный переход через забытые руины",
      projection: "ORTHOGRAPHIC_2D",
      mapAssetId: null,
      width: 1600,
      height: 1000,
      grid: {
        enabled: true,
        size: 64,
        offsetX: 0,
        offsetY: 0,
        color: "#c8b78b",
        opacity: 0.22,
      },
      active: true,
    },
  ],
  tokens: [],
  fogReveals: [],
  messages: [],
  assets: [],
  catalogEntries: [],
  tokenDefinitions: [],
  audio: {
    assetId: null,
    playing: false,
    positionSeconds: 0,
    loop: false,
    startedAt: null,
    revision: 0,
    updatedAt: new Date().toISOString(),
  },
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: new Date().toISOString(),
};

const longTokenName =
  "Невероятнодлинноеназваниежетонакотороенедолжноломатькарточкупалитры";
const tokenSnapshot: GameSnapshot = {
  ...snapshot,
  tokenDefinitions: [
    {
      id: "token-definition-1",
      characterId: null,
      defaultAssetId: null,
      name: longTokenName,
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [],
      revision: 1,
    },
  ],
};

async function mockBootstrap(
  page: import("@playwright/test").Page,
  source: GameSnapshot,
) {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(source),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

test("scene editor stays above the workspace and restores its interaction", async ({
  page,
}) => {
  await mockBootstrap(page, snapshot);
  await page.goto("/");

  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Сцены" }).click();

  const manager = page.getByRole("dialog", { name: "Сцены" });
  await expect(manager).toBeVisible();
  const configure = manager.getByRole("button", { name: "Настроить" });
  await configure.click();

  const editor = page.getByRole("dialog", { name: /Настройка:/ });
  const name = editor.getByLabel("Название");
  await expect(editor).toBeVisible();
  expect(
    await editor.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const modal = document.querySelector<HTMLElement>(".g-modal");
        const workspace = document.querySelector<HTMLElement>(
          ".arken-workspace-window",
        );
        if (!modal || !workspace) return false;
        return (
          Number.parseInt(getComputedStyle(modal).zIndex, 10) >
          Number.parseInt(getComputedStyle(workspace).zIndex, 10)
        );
      }),
    )
    .toBe(true);

  await name.fill("Сцена с проверенным фокусом");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(manager).toBeVisible();
  await expect(configure).toBeFocused();

  await manager.getByRole("button", { name: "Создать сцену" }).click();
  await expect(page.getByRole("dialog", { name: "Новая сцена" })).toBeVisible();
});

test("long token names remain inside a palette card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await mockBootstrap(page, tokenSnapshot);
  await page.goto("/");

  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Токены" }).click();
  const tokens = page.getByRole("dialog", { name: "Токены" });
  const card = tokens
    .locator(".palette-card")
    .filter({ hasText: longTokenName });
  const title = card.locator(".palette-card__title");

  await expect(title).toHaveText(longTokenName);
  expect(
    await card.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(await title.evaluate((element) => element.clientHeight <= 36)).toBe(
    true,
  );
});
