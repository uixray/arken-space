import { type Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";
import type { GameSnapshot } from "@arken/contracts";

const snapshot = {
  campaign: {
    id: "campaign-input",
    name: "Input diagnostics",
    day: 1,
    battleActive: false,
    battleCounter: 0,
    statLayout: [],
    initiative: [],
    revision: 0,
  },
  me: { id: "gm-input", role: "GM", displayName: "GM", characterId: null },
  members: [
    { id: "gm-input", role: "GM", displayName: "GM", characterId: null },
  ],
  characters: [
    {
      id: "character-input",
      name: "Keyboard tester",
      ownerMembershipId: null,
      controllerMembershipIds: [],
      portraitAssetId: null,
      lifecycle: "ACTIVE" as const,
      archivedAt: null,
      archivedByMembershipId: null,
      stats: {
        might: 1,
        agility: 1,
        mind: 1,
        spirit: 1,
        presence: 1,
        health: 10,
        focus: 10,
      },
      skills: [],
      spells: [],
      entries: [],
      backstory: "",
      inventory: ["Rope"],
      resources: {},
      wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
      notes: "",
      revision: 1,
    },
  ],
  scenes: [
    {
      id: "scene-input",
      name: "Input scene",
      projection: "ORTHOGRAPHIC_2D",
      mapAssetId: null,
      backgroundFrame: { x: 0, y: 0, width: 1200, height: 800 },
      width: 1200,
      height: 800,
      grid: {
        enabled: true,
        size: 64,
        offsetX: 0,
        offsetY: 0,
        color: "#ffffff",
        opacity: 0.2,
      },
      active: true,
    },
  ],
  tokens: [],
  fogReveals: [],
  messages: [],
  chatThreads: [],
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
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  characterIdentities: [],
  chatThreadStates: [],
  audioTracks: [],
  snapshotVersion: 1,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "input-test",
  serverTime: "2026-08-01T00:00:00.000Z",
} as GameSnapshot;

async function openInventory(page: Page) {
  await openWorkspaceSection(
    page,
    "\u041f\u0435\u0440\u0441\u043e\u043d\u0430\u0436\u0438",
  );
  const workspace = page.locator(".character-workspace");
  const inventory = workspace.getByLabel(
    /\u0418\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u044c \(/,
  );
  await expect(inventory).toBeVisible();
  return { inventory, workspace };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/story/posts**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ posts: [], nextCursor: null }),
    }),
  );
});

test("inventory keeps focus while typing and owns editable undo and Escape", async ({
  page,
}) => {
  const canvasUndoRequests: string[] = [];
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ status: "APPLIED" }]),
    }),
  );
  await page.route("**/api/canvas/undo", (route) => {
    canvasUndoRequests.push(route.request().url());
    return route.fulfill({ status: 200, body: "{}" });
  });
  await page.goto("/");
  const { inventory, workspace } = await openInventory(page);
  await inventory.fill("Rope\nTorch");
  await expect(inventory).toBeFocused();
  await expect(inventory).toHaveValue("Rope\nTorch");
  await page.keyboard.press("Control+z");
  await expect(inventory).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inventory).toBeFocused();
  await expect(workspace).toBeVisible();
  expect(canvasUndoRequests).toEqual([]);
});

test("IME composition events retain inventory focus", async ({ page }) => {
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/");
  const { inventory } = await openInventory(page);
  await inventory.focus();
  await inventory.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Process",
        code: "KeyA",
        isComposing: true,
      }),
    );
    element.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        inputType: "insertCompositionText",
        data: "\u0444",
        isComposing: true,
      }),
    );
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "\u0444" }),
    );
  });
  await expect(inventory).toBeFocused();
});

test("diagnostics redact printable keys across layout variants", async ({
  page,
}) => {
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/?input-diagnostics=1");
  const { inventory } = await openInventory(page);
  await inventory.focus();
  await inventory.evaluate((element) => {
    for (const variant of [
      { key: "\u0444", ctrlKey: false, shiftKey: false },
      { key: "a", ctrlKey: true, shiftKey: true },
    ]) {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "KeyA",
          altKey: true,
          ...variant,
        }),
      );
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          inputType: "insertText",
          data: variant.key,
        }),
      );
    }
  });
  const diagnostics = await page.evaluate(() =>
    (
      window as Window & {
        __arkenInputDiagnostics?: () => Array<Record<string, unknown>>;
      }
    ).__arkenInputDiagnostics?.(),
  );
  const keyEvents = diagnostics?.filter((event) => event.event === "keydown");
  expect(keyEvents).toEqual([
    expect.objectContaining({
      key: "printable",
      code: "KeyA",
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
      metaKey: false,
    }),
    expect.objectContaining({
      key: "printable",
      code: "KeyA",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      metaKey: false,
    }),
  ]);
  const serialized = JSON.stringify(diagnostics);
  expect(serialized).not.toContain("\u0444");
  expect(serialized).not.toMatch(/"key":"a"/);
  expect(serialized).not.toMatch(/"(?:value|data)"/);
  await expect(inventory).toBeFocused();
});
