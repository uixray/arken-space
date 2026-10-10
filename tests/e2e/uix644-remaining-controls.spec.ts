import type { Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

const scenes = ["Текущая", "Следующая"].map((name, index) => ({
  id: `uix644-scene-${index}`,
  name,
  projection: "ORTHOGRAPHIC_2D" as const,
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
  active: index === 0,
}));

async function installSnapshot(page: Page) {
  const snapshot = buildGameSnapshot("GM", { scenes });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
    if (route.request().method() !== "GET" && path !== "/api/client-logs")
      throw new Error(
        `Unexpected mutation in UIX-644 read-only test: ${route.request().method()} ${path}`,
      );
    return route.fulfill({ json: [] });
  });
  const sceneViews: unknown[] = [];
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      const wire = message.toString();
      if (wire === "40") socket.send('40{"sid":"uix644-remaining"}');
      if (wire.startsWith('42["scene:view",')) {
        try {
          sceneViews.push(JSON.parse(wire.slice(2))[1]);
        } catch {
          /* ignore non-payload frames */
        }
      }
    });
    socket.send(
      '0{"sid":"uix644-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  return { snapshot, sceneViews };
}

for (const width of [390, 1024]) {
  test(`UIX-644 scene picker selection and focus lifecycle with mocked snapshot (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const { sceneViews } = await installSnapshot(page);
    await page.goto("/");
    await expect(page.locator(".map-viewport")).toBeVisible();
    const trigger = page.getByLabel("Выбрать просматриваемую сцену");
    if (width === 390) {
      await expect(trigger).toBeHidden();
      test.skip(
        true,
        "ScenePicker is intentionally absent from the compact header",
      );
    }
    await expect(trigger).toBeVisible();
    const menu = page.getByRole("menu", { name: "Сцены", exact: true });
    await trigger.click();
    const next = menu.getByRole("menuitemradio", { name: /Следующая/ });
    await expect(next).toBeVisible();
    await next.click();
    await expect(menu).toBeHidden();
    await expect(trigger).toContainText("Следующая");
    await expect(trigger).toBeFocused();
    await expect
      .poll(() => sceneViews)
      .toContainEqual({ sceneId: "uix644-scene-1" });

    await trigger.press("ArrowDown");
    await expect(
      menu.getByRole("menuitemradio", { name: /Следующая/ }),
    ).toBeFocused();
    await page.keyboard.press("Home");
    await expect(
      menu.getByRole("menuitemradio", { name: /Текущая/ }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(trigger).toContainText("Текущая");
    await expect(menu).toBeHidden();
    await expect
      .poll(() => sceneViews)
      .toContainEqual({ sceneId: "uix644-scene-0" });

    await trigger.press("ArrowDown");
    await page.keyboard.press("End");
    await expect(
      menu.getByRole("menuitemradio", { name: /Следующая/ }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText("Текущая");
  });
}

test("UIX-644 PlayerRequests custom selectors retain keyboard focus and state at compact width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const snapshot = buildGameSnapshot("PLAYER", {
    characters: [
      {
        id: "uix644-character",
        name: "Искатель",
        ownerMembershipId: "member-under-test",
        controllerMembershipIds: [],
        portraitAssetId: null,
        stats: {},
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
    ],
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
    if (route.request().method() !== "GET" && path !== "/api/client-logs")
      throw new Error(
        `Unexpected mutation in UIX-644 read-only test: ${route.request().method()} ${path}`,
      );
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") socket.send('40{"sid":"uix644-player"}');
    });
    socket.send(
      '0{"sid":"uix644-player-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  await page.goto("/");
  await openWorkspaceSection(page, "Мои заявки");
  const dialog = page.getByRole("dialog", { name: "Мои заявки" });
  await expect(dialog).toBeVisible();
  const choices = [
    ["Когда", "Сейчас", "До перерыва"],
    ["Кто увидит", "Всем участникам", "Автору и всем мастерам"],
    ["Персонаж (необязательно)", "Без персонажа", "Искатель"],
  ] as const;
  for (const [label, initial, next] of choices) {
    const select = dialog.getByRole("combobox", { name: label, exact: true });
    await select.focus();
    await expect(select).toBeFocused();
    await expect(select).toContainText(initial);
    await select.click();
    await page.keyboard.press("Home");
    const firstOption = page.getByRole("option", {
      name: initial,
      exact: true,
    });
    await expect(firstOption).toBeFocused();
    const option = page.getByRole("option", { name: next, exact: true });
    await expect(option).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(option).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(select).toContainText(next);
    await expect(select).toBeFocused();
  }
  for (const [label, initial, next] of [
    ["Состояние", "Открытые", "Все состояния"],
    ["Срок", "Любой срок", "Сейчас"],
    ["Аудитория", "Любая аудитория", "Всем участникам"],
  ] as const) {
    const filter = dialog.getByRole("combobox", { name: label, exact: true });
    await filter.focus();
    await expect(filter).toBeFocused();
    await expect(filter).toContainText(initial);
    await filter.click();
    await page.keyboard.press("Home");
    const option = page.getByRole("option", { name: next, exact: true });
    await expect(option).toBeVisible();
    if (next === "Все состояния") {
      await page.keyboard.press("End");
    } else {
      await page.keyboard.press("ArrowDown");
    }
    await expect(option).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(filter).toContainText(next);
    await expect(filter).toBeFocused();
  }
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(dialog.getByRole("combobox", { name: "Когда" })).toContainText(
    "До перерыва",
  );
  await expect(
    dialog.getByRole("combobox", { name: "Кто увидит" }),
  ).toContainText("Автору и всем мастерам");
  await expect(
    dialog.getByRole("combobox", { name: "Персонаж (необязательно)" }),
  ).toContainText("Искатель");
});
