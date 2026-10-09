import { expect, test, type Page } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

const rows = [
  { key: "strength", label: "Сила", source: "STAT" as const },
  { key: "agility", label: "Ловкость", source: "STAT" as const },
];

function snapshot(): GameSnapshot {
  const value = buildGameSnapshot("GM", {
    scenes: [
      {
        id: "uix644-scene",
        name: "Текущая сцена",
        projection: "ORTHOGRAPHIC_2D",
        mapAssetId: null,
        width: 1200,
        height: 800,
        backgroundFrame: { x: 0, y: 0, width: 1200, height: 800 },
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
  });
  value.campaign.statLayout = [
    { id: "characteristics", label: "Характеристики", rows },
  ];
  value.characters = [
    {
      id: "uix644-character",
      name: "Проверочный герой",
      ownerMembershipId: value.me.id,
      controllerMembershipIds: [],
      portraitAssetId: null,
      stats: { strength: 8, agility: 10 },
      skills: [],
      spells: [],
      notes: "",
      backstory: "",
      inventory: [],
      resources: {},
      wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
      entries: [],
      revision: 1,
      lifecycle: "ACTIVE",
      archivedAt: null,
      archivedByMembershipId: null,
    },
  ];
  return value;
}

async function install(page: Page) {
  const data = snapshot();
  const unexpected: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ json: data });
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/player-access") return route.fulfill({ json: [] });
    if (path === "/api/canvas/history") return route.fulfill({ json: [] });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({
        status: 403,
        json: { message: "OPERATOR_REQUIRED" },
      });
    if (path === "/api/client-logs")
      return route.fulfill({ json: { ok: true } });
    if (["GET", "HEAD", "OPTIONS"].includes(request.method()))
      return route.fulfill({ json: [] });
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({
      status: 500,
      json: { error: "UNEXPECTED_MOCKED_REQUEST" },
    });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") socket.send('40{"sid":"uix644-tail"}');
    });
    socket.send(
      '0{"sid":"uix644-tail-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  return { unexpected };
}

for (const width of [1280, 390]) {
  test(`UIX-644 scene manager edit cancel restores focus without saving (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const { unexpected } = await install(page);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/api/") &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method())
      )
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await page.goto("/");
    await openWorkspaceSection(page, "Сцены");
    const manager = page.getByRole("dialog", { name: "Сцены", exact: true });
    const configure = manager.getByRole("button", {
      name: "Настроить",
      exact: true,
    });
    await configure.click();
    const editor = page.getByRole("dialog", {
      name: "Настройка: Текущая сцена",
    });
    const name = editor.getByRole("textbox", { name: "Название" });
    await name.fill("Несохранённый черновик");
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    await expect(manager).toBeVisible();
    await expect(configure).toBeFocused();
    expect(writes).toEqual([]);
    expect(unexpected).toEqual([]);
  });
}

for (const owner of ["character", "campaign"] as const) {
  for (const width of [1280, 390]) {
    test(`UIX-644 ${owner} StatLayoutCard row actions dismiss and place within viewport (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const { unexpected } = await install(page);
      await page.goto("/");
      if (owner === "character") {
        await openWorkspaceSection(page, "Персонажи");
        await page
          .locator(".character-rail__item > button:not(.character-rail__close)")
          .click();
        await page.getByRole("tab", { name: "Показатели" }).click();
      } else {
        await openWorkspaceSection(page, "Подготовка");
        await page
          .getByRole("button", { name: "Общий каталог", exact: true })
          .click();
      }

      const ownerRoot =
        owner === "character"
          ? page.locator("[data-character-section='stats']")
          : page.getByRole("region", { name: "Характеристики кампании" });
      const summary = ownerRoot.getByLabel("Действия строки «Сила»");
      const menu = summary.locator("xpath=..");
      const popup = menu.locator(".stat-field__menu-items");
      await summary.click();
      await expect(menu).toHaveAttribute("open", "");
      await expect(menu).toHaveAttribute("data-menu-side", /^(above|below)$/);
      const popupBox = await popup.boundingBox();
      expect(popupBox).not.toBeNull();
      expect(popupBox!.y).toBeGreaterThanOrEqual(0);
      expect(popupBox!.y + popupBox!.height).toBeLessThanOrEqual(844);
      await page.keyboard.press("Escape");
      await expect(menu).not.toHaveAttribute("open", "");
      await expect(summary).toBeFocused();

      const nextSummary = ownerRoot.getByLabel("Действия строки «Ловкость»");
      const nextMenu = nextSummary.locator("xpath=..");
      await nextSummary.click();
      await expect(nextMenu).toHaveAttribute("open", "");
      await expect(nextMenu).toHaveAttribute(
        "data-menu-side",
        /^(above|below)$/,
      );
      await ownerRoot
        .getByRole("heading", { name: "Характеристики", exact: true })
        .click();
      await expect(nextMenu).not.toHaveAttribute("open", "");
      expect(unexpected).toEqual([]);
    });
  }
}
