import { expect, test } from "./react-console-guard";
import type { GameSnapshot } from "@arken/contracts";
import { openWorkspaceSection } from "./workspace-nav-helper";

test("UIX-589 narrow frame targets are at least 44px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBootstrap(page, "GM");
  await page.goto("/");
  await openWorkspaceSection(page, "Токены");
  await page.locator(".token-palette > button").click();
  const editor = page.locator(".g-modal").last();
  await expect(editor.locator(".token-image-generator")).toBeVisible();
  await editor.evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const sizes = await editor
    .locator(".token-image-generator__frame-option")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    );
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
});

const snapshot: GameSnapshot = {
  campaign: {
    id: "b4c34840-cb11-4a07-884d-680ae85c48db",
    name: "РџРµСЂРІР°СЏ СЌРєСЃРїРµРґРёС†РёСЏ",
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
    id: "d21b4bb6-ae66-47b9-b719-610e0440044c",
    role: "GM",
    displayName: "РњР°СЃС‚РµСЂ",
    characterId: null,
  },
  members: [
    {
      id: "d21b4bb6-ae66-47b9-b719-610e0440044c",
      role: "GM",
      displayName: "РњР°СЃС‚РµСЂ",
      characterId: null,
    },
  ],
  characters: [
    {
      id: "62668dba-d385-434a-a76c-b9e2f8e84de9",
      name: "РљР°СЂС‚РѕРіСЂР°С„",
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
          name: "РќР°Р±Р»СЋРґРµРЅРёРµ",
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
      notes: "РС‰РµС‚ РїСЂРѕС…РѕРґ Рє РЅРёР¶РЅРµРјСѓ СѓСЂРѕРІРЅСЋ.",
      revision: 1,
    },
  ],
  scenes: [
    {
      id: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
      name: "Р’РЅРµС€РЅРёР№ РґРІРѕСЂ",
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
      name: "РљР°СЂС‚РѕРіСЂР°С„",
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
      displayName: "РњР°СЃС‚РµСЂ",
      characterId: null,
      body: "РЎС†РµРЅР° РіРѕС‚РѕРІР°.",
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

const sourceAsset = {
  id: "a1111111-1111-4111-8111-111111111111",
  kind: "IMAGE" as const,
  name: "Explorer.png",
  mimeType: "image/png",
  sizeBytes: 1024,
  width: 800,
  height: 600,
  durationSeconds: null,
  url: "/api/assets/a1111111-1111-4111-8111-111111111111/content",
  createdAt: new Date().toISOString(),
};

async function mockBootstrap(
  page: import("@playwright/test").Page,
  role: "GM" | "PLAYER",
) {
  const fixture = structuredClone(snapshot);
  fixture.me = { ...fixture.me, role };
  fixture.members[0] = { ...fixture.members[0]!, role };
  fixture.assets = [sourceAsset];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
  await page.route(
    "**/api/assets/a1111111-1111-4111-8111-111111111111/content",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>',
      }),
  );
}

test("UIX-255 GM generates and assigns a TOKEN asset before saving its definition", async ({
  page,
}) => {
  const generationRequests: Array<{
    body: Record<string, unknown>;
    actionId: string | null;
  }> = [];
  const definitionRequests: Array<Record<string, unknown>> = [];
  await mockBootstrap(page, "GM");
  await page.route(
    "**/api/assets/a1111111-1111-4111-8111-111111111111/token",
    async (route) => {
      generationRequests.push({
        body: route.request().postDataJSON() as Record<string, unknown>,
        actionId: await route.request().headerValue("x-action-id"),
      });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ...sourceAsset,
          id: "b2222222-2222-4222-8222-222222222222",
          kind: "TOKEN",
          name: "Explorer token",
          mimeType: "image/webp",
          width: 512,
          height: 512,
          url: "/api/assets/b2222222-2222-4222-8222-222222222222/content",
        }),
      });
    },
  );
  await page.route("**/api/token-definitions", async (route) => {
    definitionRequests.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.goto("/");
  await openWorkspaceSection(page, "Токены");
  await page.locator(".token-palette > button").click();
  const editor = page.locator(".g-modal").last();
  await expect(editor.locator(".token-image-generator")).toBeVisible();
  await expect(editor.locator(".token-image-generator select")).toHaveValue(
    sourceAsset.id,
  );

  const preview = editor.locator(".token-image-preview");
  await editor.locator('.token-image-generator input[type="range"]').fill("2");
  await preview.focus();
  await preview.press("ArrowRight");
  await preview.press("ArrowDown");
  await editor.locator('input[type="radio"][value="BRONZE"]').check();
  await editor.locator(".token-image-generator__actions button").last().click();

  await expect.poll(() => generationRequests.length).toBe(1);
  expect(generationRequests[0]).toEqual({
    body: {
      cropX: 0.51,
      cropY: 0.51,
      zoom: 2,
      frame: "BRONZE",
      name: "Explorer",
    },
    actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });

  await editor.locator("form input").first().fill("Guard");
  await editor.locator(".dialog-actions button").first().click();
  await expect.poll(() => definitionRequests.length).toBe(1);
  expect(definitionRequests[0]).toMatchObject({
    name: "Guard",
    characterId: null,
    defaultAssetId: "b2222222-2222-4222-8222-222222222222",
    defaultWidth: 64,
    defaultHeight: 64,
    controllerMembershipIds: [],
    actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
});

test("UIX-255 player palette does not expose GM token generator controls", async ({
  page,
}) => {
  await mockBootstrap(page, "PLAYER");
  await page.goto("/");
  await openWorkspaceSection(page, "Токены");
  await expect(page.locator(".token-image-generator")).toHaveCount(0);
  await expect(page.locator(".token-palette > button")).toHaveCount(0);
});

test("UIX-272 empty character select opens above token editor with guidance and create action", async ({
  page,
}) => {
  await mockBootstrap(page, "GM");
  const emptySnapshot = structuredClone(snapshot);
  emptySnapshot.characters = [];
  emptySnapshot.tokens = [];
  emptySnapshot.assets = [];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(emptySnapshot),
    }),
  );

  await page.goto("/");
  await openWorkspaceSection(page, "Токены");
  await page.locator(".token-palette > button").click();

  const editor = page.locator(".g-modal").last();
  await editor.locator(".g-select").first().click();

  const menu = page.locator(".arken-form-select-popup");
  await expect(menu).toBeVisible();
  const guidance = menu.getByText("Персонажей пока нет");
  const create = menu.getByText("Создать персонажа", { exact: true });
  for (const item of [guidance, create]) {
    await expect(item).toBeVisible();
    await expect
      .poll(() =>
        item.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          return element.contains(hit);
        }),
      )
      .toBe(true);
  }
  await create.click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Подготовка" })).toBeVisible();
});

test("UIX-613 GM creates and places token on active scene in one action", async ({
  page,
}) => {
  const tokenRequests: Array<Record<string, unknown>> = [];
  await mockBootstrap(page, "GM");
  await page.route(
    "**/api/assets/a1111111-1111-4111-8111-111111111111/token",
    async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ...sourceAsset,
          id: "b2222222-2222-4222-8222-222222222222",
          kind: "TOKEN",
          name: "Explorer token",
          mimeType: "image/webp",
          width: 512,
          height: 512,
          url: "/api/assets/b2222222-2222-4222-8222-222222222222/content",
        }),
      });
    },
  );
  await page.route("**/api/tokens", async (route) => {
    if (route.request().method() === "POST") {
      tokenRequests.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "35f46186-2ebc-4cf8-bce7-870097305a99",
          definitionId: "45f46186-2ebc-4cf8-bce7-870097305a99",
          definitionRevision: 0,
          baseColor: "#8899aa",
          frameColor: null,
          layer: "PLAYER",
          conditions: [],
          sceneId: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
          characterId: null,
          ownerMembershipId: null,
          controllerMembershipIds: [],
          x: 768,
          y: 468,
          width: 64,
          height: 64,
          rotation: 0,
          assetId: "b2222222-2222-4222-8222-222222222222",
          name: "Ranger",
          character: null,
          asset: null,
          revision: 0,
        }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.goto("/");
  await openWorkspaceSection(page, "Токены");
  await page.locator(".token-palette > button").click();
  const editor = page.locator(".g-modal").last();
  await expect(editor.locator(".token-image-generator")).toBeVisible();

  await editor.locator(".token-image-generator__actions button").last().click();
  await editor.locator("form input").first().fill("Ranger");
  const createAndPlaceButton = editor.locator(
    'button[value="create-and-place"]',
  );
  await expect(createAndPlaceButton).toBeVisible();
  await createAndPlaceButton.click();

  await expect.poll(() => tokenRequests.length).toBe(1);
  expect(tokenRequests[0]).toMatchObject({
    sceneId: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
    name: "Ranger",
    assetId: "b2222222-2222-4222-8222-222222222222",
    width: 64,
    height: 64,
    controllerMembershipIds: [],
    actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
});
