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
    revision: 0,
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

  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Персонажи" }).click();
  await expect(page.getByRole("heading", { name: "Картограф" })).toBeVisible();
  await expect(page.getByText("Наблюдение")).toBeVisible();

  await page
    .getByRole("dialog", { name: "Персонажи" })
    .getByRole("button", { name: "Закрыть окно" })
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

  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Токены" }).click();
  const tokensDialog = page.getByRole("dialog", { name: "Токены" });
  await expect(tokensDialog).toBeVisible();
  await tokensDialog.getByRole("button", { name: "Создать токен" }).click();
  const tokenEditor = page.getByRole("dialog", { name: "Новый токен" });
  await expect(tokenEditor).toBeVisible();
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
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Файлы" }).click();
  const filesDialog = page.getByRole("dialog", { name: "Файлы" });
  await expect(filesDialog).toBeVisible();
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

test("GM controls music from the top bar and opens the library", async ({
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
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/");

  const music = page.getByRole("region", { name: "Музыка" });
  await expect(music).toContainText("Трек не выбран");
  await music.getByRole("button", { name: "Библиотека" }).click();
  const dialog = page.getByRole("dialog", { name: "Музыкальная библиотека" });
  await expect(dialog.getByText("Библиотека пуста")).toBeVisible();
  await expect(dialog.getByLabel("Аудиофайл")).toBeVisible();
  await expect(
    page.locator(".tabs").getByRole("button", { name: "Музыка" }),
  ).toHaveCount(0);
});

test("scene refresh races do not revoke local music consent", async ({
  page,
}) => {
  const musicSnapshot = structuredClone(snapshot);
  const secondSceneId = "8476b502-02f8-4cd6-9c55-3816d70d44dc";
  const audioAssetId = "9476b502-02f8-4cd6-9c55-3816d70d44dc";
  musicSnapshot.scenes.push({
    ...musicSnapshot.scenes[0]!,
    id: secondSceneId,
    name: "Музыкальная сцена",
    active: false,
  });
  musicSnapshot.assets.push({
    id: audioAssetId,
    kind: "AUDIO",
    name: "Тема экспедиции",
    mimeType: "audio/mpeg",
    sizeBytes: 1024,
    width: null,
    height: null,
    durationSeconds: 120,
    url: "/test-track.mp3",
    createdAt: new Date().toISOString(),
  });
  musicSnapshot.audio = {
    assetId: audioAssetId,
    playing: true,
    positionSeconds: 15,
    loop: true,
    startedAt: new Date().toISOString(),
    revision: 2,
    updatedAt: new Date().toISOString(),
  };

  await page.addInitScript(() => {
    localStorage.setItem("arken.audio.enabled", "true");
    HTMLMediaElement.prototype.play = () =>
      Promise.reject(new DOMException("interrupted", "AbortError"));
  });
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(musicSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/scenes/activate", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );

  await page.goto("/");
  await expect(
    page.getByRole("slider", { name: "Личная громкость" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Просматриваемая сцена" })
    .selectOption(secondSceneId);
  await page.getByRole("button", { name: "Показать игрокам" }).click();

  await expect(
    page.getByRole("slider", { name: "Личная громкость" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("arken.audio.enabled")),
    )
    .toBe("true");
});

test("chat composer and canvas quick rolls submit explicit, server-safe intents", async ({
  page,
}) => {
  const diceRequests: Array<Record<string, unknown>> = [];
  const chatRequests: Array<Record<string, unknown>> = [];
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
  await page.route("**/api/dice", async (route) => {
    diceRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/api/chat", async (route) => {
    chatRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("/");

  const quickRolls = page.locator(".canvas-roll-overlay");
  await expect(quickRolls).toBeVisible();
  await quickRolls
    .getByLabel("Режим быстрого броска")
    .selectOption("ADVANTAGE");
  await quickRolls.getByRole("button", { name: "d20" }).click();
  await expect.poll(() => diceRequests.length).toBe(1);
  expect(diceRequests[0]).toMatchObject({
    formula: "1d20",
    rollMode: "ADVANTAGE",
  });

  const composer = page.locator(".chat-compose textarea");
  await expect(page.locator(".chat-tools select")).toHaveCount(0);
  await composer.fill("/");
  const rollSuggestion = page
    .getByRole("listbox", { name: "Команды чата" })
    .getByRole("option");
  await expect(rollSuggestion).toContainText("/roll");
  await expect(rollSuggestion).toContainText("/roll 1d20 + agility");
  await rollSuggestion.click();
  await expect(composer).toHaveValue("/roll ");
  await composer.fill("Сообщение для группы");
  await composer.press("Enter");
  await expect.poll(() => chatRequests.length).toBe(1);
  expect(chatRequests[0]).toMatchObject({ body: "Сообщение для группы" });

  await composer.fill("/roll 1d20 + agility");
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect.poll(() => diceRequests.length).toBe(2);
  expect(diceRequests[1]).toMatchObject({
    formula: "1d20 + agility",
    rollMode: "NORMAL",
  });
});

test("GM shell keeps essential controls accessible across desktop widths", async ({
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
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(
      page.getByRole("combobox", { name: "Просматриваемая сцена" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Создать сцену" }),
    ).toBeVisible();
    for (const tool of [
      "Перемещение",
      "Открыть туман",
      "Закрыть туман",
      "Рисование",
      "Линейка",
      "Пинг",
    ]) {
      await expect(page.getByRole("button", { name: tool })).toBeVisible();
    }
    await expect(page.locator(".tabs").getByRole("button")).toHaveCount(1);
    await page.locator(".workspace-menu summary").click();
    for (const trigger of [
      "Персонажи",
      "Токены",
      "Сцены",
      "Подготовка",
      "Файлы",
    ]) {
      await expect(page.getByRole("button", { name: trigger })).toBeVisible();
    }
    await page.locator(".workspace-menu summary").click();

    const zoom = page.getByRole("slider", { name: "Масштаб карты" });
    await expect(zoom).toBeVisible();
    const zoomBox = await zoom.boundingBox();
    expect(zoomBox).not.toBeNull();
    expect(zoomBox!.height).toBeGreaterThan(zoomBox!.width);

    const music = page.getByRole("region", { name: "Музыка" });
    await expect(music).toBeVisible();
    const musicBox = await music.boundingBox();
    expect(musicBox).not.toBeNull();
    expect(musicBox!.x).toBeGreaterThanOrEqual(0);
    expect(musicBox!.x + musicBox!.width).toBeLessThanOrEqual(viewport.width);
  }

  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Подготовка" }).click();
  await expect(page.getByRole("dialog", { name: "Подготовка" })).toBeVisible();
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

  await page.locator(".workspace-menu summary").click();
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

test("canvas tools stay selected and token placement targets the GM viewed scene", async ({
  page,
}) => {
  const canvasSnapshot = structuredClone(snapshot);
  const viewedSceneId = "8476b502-02f8-4cd6-9c55-3816d70d44dc";
  const definitionId = "9576b502-02f8-4cd6-9c55-3816d70d44dc";
  canvasSnapshot.scenes.push({
    ...canvasSnapshot.scenes[0]!,
    id: viewedSceneId,
    name: "Секретная сцена",
    active: false,
    revision: 0,
  });
  canvasSnapshot.tokenDefinitions = [
    {
      id: definitionId,
      characterId: null,
      defaultAssetId: null,
      name: "Разведчик",
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [],
      revision: 0,
    },
  ];
  let placementSceneId = "";
  let fogRequests = 0;
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(canvasSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/token-definitions/*/placements", async (route) => {
    placementSceneId = (route.request().postDataJSON() as { sceneId: string })
      .sceneId;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/api/fog-reveals", async (route) => {
    fogRequests += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("/");

  await page.locator(".scene-switcher select").selectOption(viewedSceneId);
  await page.locator(".token-tray summary").click();
  await page
    .locator(".token-tray")
    .getByRole("button", { name: /Разведчик/ })
    .click();
  await expect.poll(() => placementSceneId).toBe(viewedSceneId);

  const canvas = page.locator("canvas").last();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 120, y: bounds!.y + 120 };
  await page.getByRole("button", { name: "Открыть туман" }).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 80);
  await page.mouse.up();
  await expect.poll(() => fogRequests).toBe(1);
  await expect(
    page.getByRole("button", { name: "Открыть туман" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Пинг" }).click();
  await page.mouse.click(start.x + 40, start.y + 40);
  await expect(page.getByRole("button", { name: "Пинг" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Персонажи" }).click();
  await expect(page.locator(".player-character-drawer")).toBeVisible();
  await expect(page.locator(".chat-compose")).toBeVisible();
  await expect(page.getByRole("button", { name: /Наблюдение/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".player-character-drawer")).toBeHidden();
  await expect(page.locator(".workspace-menu summary")).toBeFocused();
});

test("character card submits normal, advantage and disadvantage rolls for GM and player", async ({
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

  const requests: Array<Record<string, unknown>> = [];
  let rejectNext = false;
  let holdNext = false;
  let releaseHeldRoll: (() => void) | undefined;
  let activeSnapshot = playerSnapshot;
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activeSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/dice", async (route) => {
    requests.push(route.request().postDataJSON());
    if (holdNext) {
      await new Promise<void>((resolve) => {
        releaseHeldRoll = resolve;
      });
      holdNext = false;
    }
    if (rejectNext)
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "INVALID_DICE_FORMULA",
          message: "Roll could not be completed",
        }),
      });
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.goto("/");
  await page.locator(".workspace-menu summary").click();
  await page.locator(".workspace-menu__content button").first().click();

  const mode = page.locator(".character-roll-controls select");
  const roll = page.locator(".stats-grid .stat-field button").first();
  await expect(mode).toHaveValue("NORMAL");
  holdNext = true;
  await roll.click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(roll).toBeDisabled();
  await expect(mode).toBeDisabled();
  releaseHeldRoll?.();
  await expect(roll).toBeEnabled();
  await mode.selectOption("ADVANTAGE");
  await roll.click();
  rejectNext = true;
  await mode.selectOption("DISADVANTAGE");
  await roll.click();

  await expect.poll(() => requests.length).toBe(3);
  expect(requests.map((request) => request.rollMode)).toEqual([
    "NORMAL",
    "ADVANTAGE",
    "DISADVANTAGE",
  ]);
  expect(
    requests.every(
      (request) => request.characterId === playerSnapshot.characters[0]!.id,
    ),
  ).toBe(true);
  await expect(page.getByRole("alert")).toContainText(
    "Roll could not be completed",
  );

  activeSnapshot = snapshot;
  rejectNext = false;
  await page.reload();
  await page.locator(".workspace-menu summary").click();
  await page.locator(".workspace-menu__content button").first().click();
  await page
    .locator(".character-roll-controls select")
    .selectOption("ADVANTAGE");
  await page.locator(".stats-grid .stat-field button").first().click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3]).toMatchObject({
    characterId: snapshot.characters[0]!.id,
    rollMode: "ADVANTAGE",
  });
});

test("wallet queues rapid mutations and ignores unchanged blur", async ({
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
  const submittedRevisions: number[] = [];
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
      revision: number;
    };
    submittedGold.push(payload.wallet.gold);
    submittedRevisions.push(payload.revision);
    if (submittedGold.length === 1)
      await new Promise((resolve) => setTimeout(resolve, 100));
    playerSnapshot.characters[0]!.wallet = payload.wallet;
    playerSnapshot.characters[0]!.revision += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot.characters[0]),
    });
  });
  await page.goto("/");
  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Персонажи" }).click();
  const goldRow = page
    .locator(".player-character-drawer .inline-fields")
    .filter({ hasText: /^gold/ });
  const input = goldRow.locator('input[type="number"]');

  await input.focus();
  await page.locator(".arken-workspace-window__header h2").click();
  expect(submittedGold).toEqual([]);

  await goldRow.locator("button").last().click();
  await goldRow.locator("button").last().click();
  await goldRow.locator("button").last().click();
  await input.focus();
  await page.locator(".arken-workspace-window__header h2").click();
  await expect.poll(() => submittedGold).toEqual([1, 2, 3]);
  expect(submittedRevisions).toEqual([1, 2, 3]);
  await expect(input).toHaveValue("3");

  await input.fill("5");
  await goldRow.locator("button").last().click();
  await expect.poll(() => submittedGold).toEqual([1, 2, 3, 6]);
  await expect(input).toHaveValue("6");
});

test("resource conflict replaces the draft with canonical bootstrap data", async ({
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
  playerSnapshot.characters[0]!.resources = {
    mana: { current: 2, maximum: 10 },
  };
  playerSnapshot.members = [playerSnapshot.me];
  let requests = 0;
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    }),
  );
  await page.route("**/api/characters/*/counters", (route) => {
    requests += 1;
    playerSnapshot.characters[0]!.resources = {
      mana: { current: 8, maximum: 10 },
    };
    playerSnapshot.characters[0]!.revision += 1;
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "CHARACTER_CONFLICT",
        revision: playerSnapshot.characters[0]!.revision,
      }),
    });
  });
  await page.goto("/");
  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Персонажи" }).click();
  const resources = page
    .locator(".player-character-drawer textarea:visible")
    .nth(1);
  await resources.fill('{"mana":{"current":5,"maximum":10}}');
  await page.locator(".arken-workspace-window__header h2").click();

  await expect.poll(() => requests).toBe(1);
  await expect(resources).toHaveValue(
    JSON.stringify({ mana: { current: 8, maximum: 10 } }, null, 2),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Ресурсы изменены в другой сессии",
  );
});

test("wallet refreshes and safely reapplies a delta after a stale revision", async ({
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
  let bootstrapCount = 0;
  const submissions: Array<{ gold: number; revision: number }> = [];
  await page.route("**/api/bootstrap", (route) => {
    bootstrapCount += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    });
  });
  await page.route("**/api/characters/*/counters", async (route) => {
    const payload = route.request().postDataJSON() as {
      wallet: (typeof playerSnapshot.characters)[0]["wallet"];
      revision: number;
    };
    submissions.push({ gold: payload.wallet.gold, revision: payload.revision });
    if (submissions.length === 1) {
      playerSnapshot.characters[0]!.wallet.gold = 10;
      playerSnapshot.characters[0]!.revision = 2;
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "CHARACTER_CONFLICT", revision: 2 }),
      });
    }
    playerSnapshot.characters[0]!.wallet = payload.wallet;
    playerSnapshot.characters[0]!.revision += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot.characters[0]),
    });
  });
  await page.goto("/");
  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "Персонажи" }).click();
  const goldRow = page
    .locator(".player-character-drawer .inline-fields")
    .filter({ hasText: /^gold/ });
  await goldRow.locator("button").last().click();

  await expect
    .poll(() => submissions)
    .toEqual([
      { gold: 1, revision: 1 },
      { gold: 11, revision: 2 },
    ]);
  expect(bootstrapCount).toBeGreaterThanOrEqual(2);
  await expect(goldRow.locator('input[type="number"]')).toHaveValue("11");
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
