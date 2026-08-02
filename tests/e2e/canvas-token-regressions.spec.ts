import { expect, test, type Page } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";

const sceneId = "7376b502-02f8-4cd6-9c55-3816d70d44dc";

const snapshot = {
  campaign: {
    id: "b4c34840-cb11-4a07-884d-680ae85c48db",
    name: "Canvas regression fixture",
    day: 1,
    battleActive: false,
    battleCounter: 0,
    revision: 0,
  },
  me: {
    id: "d21b4bb6-ae66-47b9-b719-610e0440044c",
    role: "GM",
    displayName: "GM",
    characterId: null,
  },
  members: [],
  characters: [],
  catalogEntries: [],
  scenes: [
    {
      id: sceneId,
      name: "Regression scene",
      projection: "ORTHOGRAPHIC_2D",
      mapAssetId: null,
      width: 1600,
      height: 1000,
      backgroundFrame: { x: 0, y: 0, width: 1600, height: 1000 },
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
  tokens: [
    {
      id: "35f46186-2ebc-4cf8-bce7-870097305a6b",
      definitionId: "45f46186-2ebc-4cf8-bce7-870097305a6b",
      definitionRevision: 0,
      controllerMembershipIds: [],
      sceneId,
      characterId: null,
      ownerMembershipId: null,
      assetId: null,
      name: "Selected token",
      x: 384,
      y: 320,
      z: 0,
      levelId: null,
      width: 64,
      height: 64,
      rotation: 0,
      visible: true,
      locked: false,
      revision: 0,
    },
  ],
  tokenDefinitions: [],
  fogReveals: [],
  drawings: [],
  messages: [],
  chatThreads: [],
  chatThreadStates: [],
  assets: [],
  audio: {
    assetId: null,
    playing: false,
    positionSeconds: 0,
    loop: false,
    startedAt: null,
    revision: 0,
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: "2026-08-02T00:00:00.000Z",
} satisfies GameSnapshot;

async function installCanvasRoutes(page: Page) {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

test("Escape leaves DRAW for PAN and clears the selected map object", async ({ page }) => {
  await installCanvasRoutes(page);
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/");

  const map = page.getByRole("region", { name: "Интерактивная карта сцены" });
  await page.getByRole("button", { name: "Рисование" }).click();
  await expect(page.getByRole("button", { name: "Рисование" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Объекты карты", exact: true }).click();
  const selectedToken = page.getByRole("button", { name: "Selected token", exact: true });
  await selectedToken.click();
  await expect(selectedToken).toHaveAttribute("aria-pressed", "true");

  await map.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Перемещение" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Объекты карты", exact: true }).click();
  await expect(page.getByRole("button", { name: "Selected token", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("Ctrl+Z and Ctrl+Shift+Z call authoritative undo and redo once", async ({ page }) => {
  await installCanvasRoutes(page);
  const commands: Array<{ direction: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ status: "APPLIED" }, { status: "UNDONE" }]),
    }),
  );
  await page.route("**/api/canvas/undo", async (route) => {
    commands.push({ direction: "undo", body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/canvas/redo", async (route) => {
    commands.push({ direction: "redo", body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Отменить последнее действие" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Повторить отменённое действие" })).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect.poll(() => commands.length).toBe(1);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => commands.length).toBe(2);

  expect(commands.map(({ direction }) => direction)).toEqual(["undo", "redo"]);
  for (const { body } of commands) {
    expect(body.sceneId).toBe(sceneId);
    expect(body.actionId).toEqual(expect.any(String));
    expect(body.actionId).toMatch(/^[0-9a-f-]{36}$/i);
  }
});
