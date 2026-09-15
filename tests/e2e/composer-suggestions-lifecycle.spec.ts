import type { GameSnapshot } from "@arken/contracts";
import { starterStatLayout } from "@arken/system";
import { expect, test } from "./react-console-guard";

// Public synthetic App fixture, same shape as the concept harness.
// These mocked routes do not establish backend authorization or live acceptance.
const baseline: GameSnapshot = {
  campaign: {
    id: "b4c34840-cb11-4a07-884d-680ae85c48db",
    name: "Первая экспедиция",
    day: 1,
    paused: false,
    battleActive: false,
    battleCounter: 0,
    statLayout: starterStatLayout,
    initiative: [],
    battleZone: null,
    revision: 0,
  },
  me: {
    id: "d21b4bb6-ae66-47b9-b719-610e0440044c",
    role: "GM",
    displayName: "Мастер",
    characterId: null,
  },
  members: [
    {
      id: "d21b4bb6-ae66-47b9-b719-610e0440044c",
      role: "GM",
      displayName: "Мастер",
      characterId: null,
    },
  ],
  characters: [
    {
      id: "62668dba-d385-434a-a76c-b9e2f8e84de9",
      name: "Картограф",
      ownerMembershipId: null,
      controllerMembershipIds: [],
      portraitAssetId: null,
      lifecycle: "ACTIVE" as const,
      archivedAt: null,
      archivedByMembershipId: null,
      stats: {
        might: 2,
        agility: 3,
        mind: 4,
        spirit: 1,
        presence: 2,
        health: 10,
        focus: 6,
      },
      skills: [
        {
          key: "observe",
          name: "Наблюдение",
          rank: 1,
          formula: "2d6 + mind",
        },
      ],
      spells: [],
      entries: [],
      backstory: "",
      inventory: [],
      resources: {},
      wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
      notes: "Ищет проход к нижнему уровню.",
      revision: 1,
    },
  ],
  scenes: [
    {
      id: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
      name: "Внешний двор",
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
  tokens: [
    {
      id: "35f46186-2ebc-4cf8-bce7-870097305a6b",
      definitionId: "45f46186-2ebc-4cf8-bce7-870097305a6b",
      definitionRevision: 0,
      baseColor: "#8899aa",
      frameColor: null,
      layer: "PLAYER" as const,
      conditions: [],
      sceneId: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
      characterId: "62668dba-d385-434a-a76c-b9e2f8e84de9",
      ownerMembershipId: null,
      assetId: null,
      controllerMembershipIds: [],
      name: "Картограф",
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
  fogReveals: [
    {
      id: "cfb16822-113a-43b8-adb9-d134f3d7c61f",
      sceneId: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
      x: 256,
      y: 192,
      width: 512,
      height: 384,
    },
  ],
  messages: [
    {
      id: "c67832eb-f418-4712-a1fa-a5c8b90bb124",
      sequence: 1,
      membershipId: "d21b4bb6-ae66-47b9-b719-610e0440044c",
      displayName: "Мастер",
      characterId: null,
      body: "Сцена готова.",
      visibility: "PUBLIC",
      kind: "SYSTEM",
      threadId: "11111111-1111-4111-8111-111111111111",
      stream: "TABLE",
      dice: null,
      createdAt: new Date().toISOString(),
    },
  ],
  chatThreads: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      campaignId: "b4c34840-cb11-4a07-884d-680ae85c48db",
      type: "STREAM",
      stream: "TABLE",
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      campaignId: "b4c34840-cb11-4a07-884d-680ae85c48db",
      type: "STREAM",
      stream: "STORY",
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      campaignId: "b4c34840-cb11-4a07-884d-680ae85c48db",
      type: "STREAM",
      stream: "ROLLS",
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z",
    },
  ],
  chatThreadStates: [
    {
      threadId: "11111111-1111-4111-8111-111111111111",
      stream: "TABLE",
      lastReadSequence: 1,
      latestSequence: 1,
      unreadCount: 0,
    },
    {
      threadId: "22222222-2222-4222-8222-222222222222",
      stream: "STORY",
      lastReadSequence: 0,
      latestSequence: 0,
      unreadCount: 0,
    },
    {
      threadId: "33333333-3333-4333-8333-333333333333",
      stream: "ROLLS",
      lastReadSequence: 0,
      latestSequence: 0,
      unreadCount: 0,
    },
  ],
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
  audioTracks: [],
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: new Date().toISOString(),
};

for (const role of ["GM", "PLAYER"] as const) {
  for (const width of [1280, 390]) {
    test(`UIX644 ${role} ${width}px composer popup owns Escape, keyboard and outside dismissal`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const snapshot = structuredClone(baseline);
      snapshot.me.role = role;
      snapshot.members = [snapshot.me];
      snapshot.messages = [];
      snapshot.chatThreadStates = snapshot.chatThreadStates.map((state) => ({
        ...state,
        latestSequence: 0,
        lastReadSequence: 0,
        unreadCount: 0,
      }));
      const rolls: Array<{
        formula: string;
        label: string;
        visibility: string;
        characterId: string | null;
      }> = [];
      await page.route("**/api/bootstrap", (route) =>
        route.fulfill({ json: snapshot }),
      );
      await page.route("**/api/player-access", (route) =>
        route.fulfill({ json: [] }),
      );
      await page.route("**/api/story/posts**", (route) =>
        route.fulfill({ json: { posts: [], nextCursor: null } }),
      );
      await page.route("**/api/canvas/history**", (route) =>
        route.fulfill({ json: [] }),
      );
      await page.route("**/api/dice", async (route) => {
        rolls.push(route.request().postDataJSON() as (typeof rolls)[number]);
        await route.fulfill({ status: 201, json: {} });
      });
      await page.goto("/");
      if (width === 390) await page.locator("#compact-nav-journal").click();
      const panel = page.locator("#chat-panel-activity");
      const composer = panel.getByRole("textbox", {
        name: "Сообщение или бросок",
        exact: true,
      });
      const commands = panel.getByRole("button", {
        name: "Быстрые команды",
        exact: true,
      });
      const popup = panel.getByRole("listbox", { name: "Команды чата" });
      await expect(composer).toBeVisible();

      await commands.click();
      await expect(popup).toBeVisible();
      await commands.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(commands).toBeFocused();
      await expect(panel).toBeVisible(); // First Escape must not close its parent.
      await expect(composer).toBeVisible();
      if (width === 390)
        await expect(page.locator("#compact-nav-journal")).toHaveAttribute(
          "aria-pressed",
          "true",
        );

      await composer.fill("/");
      await expect(popup).toBeVisible();
      await composer.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(composer).toHaveValue("/");
      await expect(composer).toBeFocused();
      await composer.fill("/d");
      await expect(popup).toBeVisible();
      await commands.click(); // Effective typed visibility toggles off.
      await expect(popup).toHaveCount(0);
      await expect(composer).toHaveValue("/d");
      await commands.click();
      await expect(popup.getByRole("option")).toHaveCount(2);

      await commands.press("ArrowDown");
      const options = popup.getByRole("option");
      await expect(options.first()).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(popup).toHaveCount(0);
      expect(
        await composer.evaluate((node) =>
          node
            .closest(".chat-composer-input")
            ?.contains(document.activeElement),
        ),
      ).toBe(false);
      await commands.click();
      await commands.press("ArrowDown");
      await expect(options.first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(options.last()).toBeFocused();
      await page.keyboard.press("Home");
      await expect(options.first()).toBeFocused();
      await page.keyboard.press("Enter");
      await expect.poll(() => rolls.length).toBe(1);
      expect(rolls[0]).toMatchObject({
        formula: "1d20",
        label: "d20",
        visibility: "PUBLIC",
        characterId: null,
      });
      await expect(popup).toHaveCount(0);
      await expect(composer).toBeFocused();
      await expect(composer).toHaveValue("");

      await composer.fill("/");
      await expect(popup).toBeVisible();
      const outside = panel.locator("#activity-message-list");
      await panel.locator(".activity-roll-controls__heading strong").click();
      await expect(popup).toHaveCount(0);
      await expect(composer).toHaveValue("/");
      await commands.click();
      await expect(popup).toBeVisible();
      await outside.focus();
      await expect(popup).toHaveCount(0);
      await expect(outside).toBeFocused();
      await expect(composer).toHaveValue("/");
      expect(rolls).toHaveLength(1);
    });
  }
}
