import { expect, test } from "./react-console-guard";
import type { GameSnapshot } from "@arken/contracts";
import type { Page } from "@playwright/test";
import { openWorkspaceSection } from "./workspace-nav-helper";
const snapshot: GameSnapshot = {
  campaign: {
    id: "campaign-1",
    name: "Проверка сцен",
    day: 1,
    paused: false,
    battleActive: false,
    battleCounter: 0,
    statLayout: [],
    initiative: [],
    battleZone: null,
    revision: 0,
  },
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
      backgroundFrame: { x: 0, y: 0, width: 1600, height: 1000 },
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
  characterIdentities: [],
  chatThreadStates: [],
  audioTracks: [],
  chatThreads: [],
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: new Date().toISOString(),
};

async function install(page: Page, role: "GM" | "PLAYER") {
  const current = structuredClone(snapshot);
  current.me.role = role;
  current.campaign.name = "Campaign name consumes header space";
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ json: [] }),
  );
  return current;
}

test("UIX-423 world editor and reader names match their dialogs on desktop and compact", async ({
  page,
}) => {
  await install(page, "GM");
  await page.route("**/api/world-content**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/");
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ["Редактор мира", "Справочник мира"]) {
      await openWorkspaceSection(page, name);
      const dialog = page.getByRole("dialog", { name, exact: true });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: "Закрыть окно", exact: true })
        .click();
      await expect(dialog).toBeHidden();
    }
  }
});

test("UIX-416 header omits campaign name while GM rename remains in session menu", async ({
  page,
}) => {
  const current = await install(page, "GM");
  const patches: unknown[] = [];
  await page.route("**/api/campaign", (route) => {
    const body = route.request().postDataJSON();
    patches.push(body);
    current.campaign = { ...current.campaign, name: body.name, revision: 1 };
    return route.fulfill({ json: current.campaign });
  });
  await page.goto("/");
  await expect(page.locator(".brand")).not.toContainText(current.campaign.name);
  const [brandBox, productBox] = await Promise.all([
    page.locator(".brand").boundingBox(),
    page.locator(".brand strong").boundingBox(),
  ]);
  expect(brandBox).not.toBeNull();
  expect(productBox).not.toBeNull();
  expect(brandBox!.width).toBeLessThanOrEqual(productBox!.width + 2);
  await page.getByLabel("Меню сеанса").click();
  await page.getByRole("button", { name: "Переименовать кампанию" }).click();
  const dialog = page.getByRole("dialog", { name: "Название кампании" });
  await dialog
    .getByRole("textbox", { name: "Название кампании" })
    .fill("Новая кампания");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toMatchObject({ name: "Новая кампания", revision: 0 });
  await expect(dialog).toBeHidden();
  await expect(page.locator(".brand")).not.toContainText("Новая кампания");
});

for (const role of ["GM", "PLAYER"] as const) {
  test(`UIX-416 ${role} active overflow survives wide narrow wide and keyboard navigation`, async ({
    page,
  }) => {
    const current = await install(page, role);
    await page.setViewportSize({ width: 2000, height: 900 });
    await page.goto("/");
    await openWorkspaceSection(page, "Токены");
    const nav = page.locator(".workspace-nav");
    await expect(
      nav.locator(":scope > button[data-workspace='tokens']"),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(nav).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "Основные области" }),
    ).toBeVisible();
    // UIX-642: P1 uses compact sections below 1024px; priority+ overflow
    // remains a desktop contract. Keep both sides of the breakpoint covered.
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(nav).toBeVisible();
    const directActive = nav.locator(
      ":scope > button[data-workspace='tokens']",
    );
    const more = nav.locator("summary");
    await expect(
      nav.locator(
        ":scope > button[data-workspace='tokens'][aria-pressed='true'], summary[data-active-workspace='tokens']",
      ),
    ).toHaveCount(1);
    // Font metrics can place PLAYER tokens in either location at 1024px.
    // GM must still exercise the overflow keyboard contract.
    if (role === "GM" || (await directActive.count()) === 0) {
      await expect(more).toHaveAttribute("data-active-workspace", "tokens");
      await expect(more).toContainText("Токены");
      await more.focus();
      await page.keyboard.press("Enter");
      const option = nav.locator(
        ".workspace-nav__menu [data-workspace='tokens']",
      );
      await expect(option).toBeVisible();
      await expect(option).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await expect(option).toBeHidden();
      await expect(more).toBeFocused();
    } else {
      await expect(directActive).toBeVisible();
      await expect(directActive).toHaveAttribute("aria-pressed", "true");
    }
    await page.setViewportSize({ width: 2000, height: 900 });
    await expect(
      nav.locator(":scope > button[data-workspace='tokens']"),
    ).toBeVisible();
    await expect(
      nav.locator(":scope > button[data-workspace='tokens']"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".brand")).not.toContainText(
      current.campaign.name,
    );
    if (role === "PLAYER") {
      await page.getByLabel("Меню сеанса").click();
      await expect(
        page.getByRole("button", { name: "Переименовать кампанию" }),
      ).toHaveCount(0);
    }
  });
}

for (const role of ["GM", "PLAYER"] as const) {
  test(`UIX-416 ${role} font loading remeasures navigation without horizontal clipping`, async ({
    page,
  }) => {
    await install(page, role);
    await page.setViewportSize({ width: 2000, height: 900 });
    await page.goto("/");
    const nav = page.locator(".workspace-nav");
    const direct = nav.locator(":scope > button");
    await expect.poll(() => direct.count()).toBeGreaterThan(0);
    const before = await direct.count();
    await page.addStyleTag({
      content:
        ".workspace-nav__item, .workspace-nav__measure > span { font-size: 70px !important; }",
    });
    await page.evaluate(() =>
      document.fonts.dispatchEvent(new Event("loadingdone")),
    );
    await expect.poll(() => direct.count()).toBeLessThan(before);
    await expect
      .poll(() =>
        nav.evaluate((el) => {
          const row = el.getBoundingClientRect();
          return Array.from(el.children)
            .filter((child) => child.matches("button, details"))
            .every((child) => {
              const box = child.getBoundingClientRect();
              return box.left >= row.left - 1 && box.right <= row.right + 1;
            });
        }),
      )
      .toBe(true);
  });
}
