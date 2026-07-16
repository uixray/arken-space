import { expect, test } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";

const snapshot: GameSnapshot = {
  campaign: {
    id: "b4c34840-cb11-4a07-884d-680ae85c48db",
    name: "Первая экспедиция",
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
      portraitAssetId: null,
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
        { key: "observe", name: "Наблюдение", rank: 1, formula: "2d6 + mind" },
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
      dice: null,
      createdAt: new Date().toISOString(),
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
    updatedAt: new Date().toISOString(),
  },
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: new Date().toISOString(),
};

test("concept shell keeps the map primary and exposes core tools", async ({
  page,
}) => {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
  await page.goto("/");

  await expect(
    page.getByRole("combobox", { name: "Просматриваемая сцена" }),
  ).toHaveValue(snapshot.scenes.find((scene) => scene.active)?.id);
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Перемещение" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Персонаж" }).click();
  await expect(page.getByRole("heading", { name: "Картограф" })).toBeVisible();
  await expect(page.getByText("Наблюдение")).toBeVisible();

  await page
    .getByRole("dialog", { name: "Персонажи" })
    .getByRole("button", { name: "Закрыть диалоговое окно" })
    .click();
  await page.getByRole("button", { name: /Чат/ }).click();
  await expect(page.getByText("Сцена готова.")).toBeVisible();
  await page.screenshot({
    path: "test-results/concept-shell.png",
    fullPage: true,
  });
});

test("GM opens token and file workflows without leaving the canvas", async ({
  page,
}) => {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
  await page.goto("/");

  const tabs = page.locator(".tabs").getByRole("button");
  await tabs.nth(2).click();
  const tokensDialog = page.getByRole("dialog");
  await expect(
    tokensDialog.getByRole("heading", { name: "Токены" }),
  ).toBeVisible();
  await tokensDialog.getByRole("button", { name: "Создать токен" }).click();
  await expect(page.getByRole("dialog", { name: "Новый токен" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await tabs.nth(6).click();
  const filesDialog = page.getByRole("dialog");
  await expect(
    filesDialog.getByRole("heading", { name: "Файлы" }),
  ).toBeVisible();
  for (const section of [
    "Карты",
    "Изображения токенов",
    "Портреты персонажей",
    "Другие изображения",
    "Музыка и звуки",
  ]) {
    await expect(filesDialog.getByText(section, { exact: true })).toBeVisible();
  }
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("GM prepares a scene locally before publishing it to players", async ({
  page,
}) => {
  const sceneSnapshot = structuredClone(snapshot);
  sceneSnapshot.scenes[0]!.revision = 2;
  sceneSnapshot.scenes[0]!.backgroundFrame = {
    x: 0,
    y: 0,
    width: 1600,
    height: 1000,
  };
  sceneSnapshot.scenes.push({
    ...sceneSnapshot.scenes[0]!,
    id: "8476b502-02f8-4cd6-9c55-3816d70d44dc",
    name: "Тайная комната",
    active: false,
    revision: 0,
  });
  let publishedSceneId = "";
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sceneSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/scenes/activate", async (route) => {
    publishedSceneId = (route.request().postDataJSON() as { sceneId: string })
      .sceneId;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Сцены" }).click();
  const dialog = page.getByRole("dialog", { name: "Сцены" });
  await expect(dialog.getByText("Показана игрокам")).toBeVisible();
  const secretCard = dialog.locator(".scene-manager-card", {
    hasText: "Тайная комната",
  });
  await secretCard.getByRole("button", { name: "Открыть для мастера" }).click();
  await expect(page.locator(".scene-switcher select")).toHaveValue(
    "8476b502-02f8-4cd6-9c55-3816d70d44dc",
  );
  await expect(secretCard.getByText("Просматривается мастером")).toBeVisible();
  expect(publishedSceneId).toBe("");

  await secretCard.getByRole("button", { name: "Показать игрокам" }).click();
  await expect
    .poll(() => publishedSceneId)
    .toBe("8476b502-02f8-4cd6-9c55-3816d70d44dc");
  await secretCard.getByRole("button", { name: "Настроить" }).click();
  const editor = page.getByRole("dialog", { name: /Настройка/ });
  await expect(editor.getByLabel("Название")).toHaveValue("Тайная комната");
  await expect(editor.getByText("Игровая область")).toBeVisible();
  await expect(editor.getByText("Рамка изображения")).toBeVisible();
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test(`long chat scrolls only its history at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const longSnapshot = structuredClone(snapshot);
    longSnapshot.messages = Array.from({ length: 200 }, (_, index) => ({
      ...snapshot.messages[0]!,
      id: `message-${index}`,
      sequence: index + 1,
      body:
        index === 100
          ? `Длинное сообщение ${"с переносом ".repeat(60)}`
          : `История ${index + 1}`,
    }));
    await page.route("**/api/bootstrap", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(longSnapshot),
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: /Чат/ }).click();

    await expect(page.locator(".chat-tools")).toBeVisible();
    await expect(page.locator(".chat-compose")).toBeVisible();
    const dimensions = await page
      .locator(".message-list")
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    const viewportFit = await page.evaluate(() => ({
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      toolsBottom: document
        .querySelector(".chat-tools")!
        .getBoundingClientRect().bottom,
      composerBottom: document
        .querySelector(".chat-compose")!
        .getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
    }));
    expect(viewportFit.documentScrollHeight).toBe(
      viewportFit.documentClientHeight,
    );
    expect(viewportFit.toolsBottom).toBeLessThanOrEqual(
      viewportFit.viewportHeight,
    );
    expect(viewportFit.composerBottom).toBeLessThanOrEqual(
      viewportFit.viewportHeight,
    );
    const longBodyWraps = await page
      .getByText(/^Длинное сообщение/)
      .evaluate((element) => element.scrollWidth <= element.clientWidth);
    expect(longBodyWraps).toBe(true);
    await page.locator(".message-list").evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(page.locator(".chat-compose textarea")).toBeVisible();
  });
}

test("player opens the character drawer while chat remains visible", async ({
  page,
}) => {
  const playerSnapshot = structuredClone(snapshot);
  playerSnapshot.me = {
    id: "f53f4618-2ebc-4cf8-bce7-870097305a6b",
    role: "PLAYER",
    displayName: "Player",
    characterId: playerSnapshot.characters[0]!.id,
  };
  playerSnapshot.characters[0]!.ownerMembershipId = playerSnapshot.me.id;
  playerSnapshot.members = [playerSnapshot.me];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    }),
  );
  await page.goto("/");
  await expect(page.locator(".chat-compose")).toBeVisible();
  await page.getByRole("button", { name: "Персонаж" }).click();
  await expect(page.locator(".player-character-drawer")).toBeVisible();
  await expect(page.locator(".chat-compose")).toBeVisible();
  await expect(page.getByRole("button", { name: /Наблюдение/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".player-character-drawer")).toBeHidden();
  await expect(page.getByRole("button", { name: "Персонаж" })).toBeFocused();
});

test("wallet draft sends one intended mutation and ignores unchanged blur", async ({
  page,
}) => {
  const playerSnapshot = structuredClone(snapshot);
  playerSnapshot.me = {
    id: "f53f4618-2ebc-4cf8-bce7-870097305a6b",
    role: "PLAYER",
    displayName: "Player",
    characterId: playerSnapshot.characters[0]!.id,
  };
  playerSnapshot.characters[0]!.ownerMembershipId = playerSnapshot.me.id;
  playerSnapshot.members = [playerSnapshot.me];
  const submittedGold: number[] = [];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    }),
  );
  await page.route("**/api/characters/*/counters", async (route) => {
    const payload = route.request().postDataJSON() as {
      wallet: (typeof playerSnapshot.characters)[0]["wallet"];
    };
    submittedGold.push(payload.wallet.gold);
    playerSnapshot.characters[0]!.wallet = payload.wallet;
    playerSnapshot.characters[0]!.revision += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot.characters[0]),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Персонаж" }).click();
  const goldRow = page
    .locator(".player-character-drawer .inline-fields")
    .filter({ hasText: /^gold/ });
  const input = goldRow.locator('input[type="number"]');

  await input.focus();
  await page.locator(".drawer-heading strong").click();
  expect(submittedGold).toEqual([]);

  await goldRow.locator("button").last().click();
  await expect.poll(() => submittedGold).toEqual([1]);
  await expect(input).toHaveValue("1");

  await input.fill("5");
  await goldRow.locator("button").last().click();
  await expect.poll(() => submittedGold).toEqual([1, 6]);
  await expect(input).toHaveValue("6");
});

test("player fog keeps covered foreign tokens hidden while owned tokens remain visible", async ({
  page,
}) => {
  const playerSnapshot = structuredClone(snapshot);
  const playerId = "f53f4618-2ebc-4cf8-bce7-870097305a6b";
  playerSnapshot.me = {
    id: playerId,
    role: "PLAYER",
    displayName: "Player",
    characterId: playerSnapshot.characters[0]?.id ?? null,
  };
  playerSnapshot.members = [playerSnapshot.me];
  playerSnapshot.tokens = [
    {
      ...snapshot.tokens[0]!,
      id: "45f46186-2ebc-4cf8-bce7-870097305a6b",
      ownerMembershipId: playerId,
      controllerMembershipIds: [playerId],
      name: "Owned token",
      x: 96,
      y: 96,
    },
    {
      ...snapshot.tokens[0]!,
      id: "55f46186-2ebc-4cf8-bce7-870097305a6b",
      ownerMembershipId: "a53f4618-2ebc-4cf8-bce7-870097305a6b",
      controllerMembershipIds: ["a53f4618-2ebc-4cf8-bce7-870097305a6b"],
      name: "Covered foreign token",
      x: 192,
      y: 96,
    },
  ];
  playerSnapshot.fogReveals = [];

  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    }),
  );
  await page.goto("/");

  await expect(page.locator(".map-viewport")).toHaveScreenshot(
    "player-fog-opaque.png",
    { animations: "disabled", maxDiffPixelRatio: 0.02 },
  );
});
