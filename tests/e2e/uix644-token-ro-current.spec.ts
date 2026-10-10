import type { Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

async function install(page: Page) {
  const snapshot = buildGameSnapshot("GM", {
    scenes: [
      {
        id: "ro-test-scene",
        name: "RO test scene",
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
    characters: [
      {
        id: "ro-character-a",
        name: "Проводник",
        ownerMembershipId: null,
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
      {
        id: "ro-character-b",
        name: "Картограф",
        ownerMembershipId: null,
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
    if (path === "/api/player-access") return route.fulfill({ json: [] });
    if (path === "/api/story/posts" || path === "/api/canvas/history")
      return route.fulfill({ json: [] });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
    if (route.request().method() !== "GET" && path !== "/api/client-logs")
      throw new Error(
        `Unexpected mutation in read-only RO reproduction: ${route.request().method()} ${path}`,
      );
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") socket.send('40{"sid":"uix644-ro"}');
    });
    socket.send(
      '0{"sid":"uix644-ro-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
}

async function collectResizeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/ResizeObserver/i.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(() => {
    const NativeResizeObserver = window.ResizeObserver;
    const events: Array<{
      targets: Array<{
        tag: string;
        className: string;
        width: number;
        height: number;
      }>;
    }> = [];
    Object.defineProperty(window, "__uix644ResizeObserverEvents", {
      value: events,
    });
    window.addEventListener("error", (event) => {
      if (/ResizeObserver/i.test(event.message))
        events.push({
          targets: [
            {
              tag: "window-error",
              className: event.message,
              width: 0,
              height: 0,
            },
          ],
        });
    });
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          events.push({
            targets: entries.map((entry) => ({
              tag: entry.target.tagName,
              className:
                typeof entry.target.className === "string"
                  ? entry.target.className
                  : "",
              width: entry.contentRect.width,
              height: entry.contentRect.height,
            })),
          });
          callback(entries, observer);
        });
      }
    };
  });
  return errors;
}

test("UIX-644 current TokenPalette character popup ResizeObserver transition", async ({
  page,
}, testInfo) => {
  const errors = await collectResizeErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await install(page);
  await page.goto("/");
  await expect(page.locator(".map-viewport")).toBeVisible();
  await openWorkspaceSection(page, "Токены");
  await page
    .getByRole("button", { name: "Создать токен", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Новый токен", exact: true });
  await expect(editor).toBeVisible();
  const character = editor.getByRole("combobox", { name: /^Персонаж/ });
  await character.click();
  const list = page.getByRole("listbox").last();
  await expect(
    list.getByRole("option", { name: "Проводник", exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1180, height: 760 });
  await expect(editor).toBeVisible();
  await expect(list).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const observation = await page.evaluate(() => ({
    observerEvents:
      (
        window as Window & {
          __uix644ResizeObserverEvents?: Array<{
            targets: Array<{
              tag: string;
              className: string;
              width: number;
              height: number;
            }>;
          }>;
        }
      ).__uix644ResizeObserverEvents ?? [],
    viewport: { width: innerWidth, height: innerHeight },
  }));
  const popupMinWidth = await page
    .locator(".arken-form-select-popup__content")
    .last()
    .evaluate((node) => (node as HTMLElement).style.minWidth);
  const triggerWidth = await character.evaluate(
    (node) => node.getBoundingClientRect().width,
  );
  await testInfo.attach("current-token-ro-transition", {
    body: JSON.stringify({ ...observation, popupMinWidth, triggerWidth }),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
  expect(observation.observerEvents.length).toBeGreaterThan(0);
  expect(
    observation.observerEvents.filter((entry) =>
      entry.targets.some((target) => target.className === "window-error"),
    ),
  ).toEqual([]);
  expect(observation.viewport).toEqual({ width: 1180, height: 760 });
  expect(popupMinWidth).toMatch(/^\d+(\.\d+)?px$/);
  expect(
    Math.abs(
      Number.parseFloat(popupMinWidth) -
        Math.min(triggerWidth, observation.viewport.width - 20),
    ),
  ).toBeLessThanOrEqual(1);
  await expect(
    list.getByRole("option", { name: "Картограф", exact: true }),
  ).toBeVisible();
});
