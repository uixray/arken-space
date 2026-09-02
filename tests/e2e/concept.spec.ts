import { type Locator } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import type { GameSnapshot } from "@arken/contracts";
import { starterStatLayout } from "@arken/system";
import {
  openWorkspaceSection,
  selectViewedScene,
  viewedScenePicker,
} from "./workspace-nav-helper";
import { WALLET_ADJUST_DELAY_MS } from "../../apps/web/src/wallet";

const snapshot: GameSnapshot = {
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

test.beforeEach(async ({ page }) => {
  await page.route("**/api/story/posts**", async (route) => {
    await route.fulfill({
      status: route.request().method() === "GET" ? 200 : 201,
      contentType: "application/json",
      body: JSON.stringify(
        route.request().method() === "GET"
          ? { posts: [], nextCursor: null }
          : {},
      ),
    });
  });
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
  await page.route("**/api/chat/read", async (route) => {
    const input = route.request().postDataJSON() as {
      threadId: string;
      sequence: number;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        campaignId: snapshot.campaign.id,
        threadId: input.threadId,
        lastReadSequence: input.sequence,
        updatedAt: new Date().toISOString(),
      }),
    });
  });
});

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

  await expect(viewedScenePicker(page)).toContainText(
    snapshot.scenes.find((scene) => scene.active)!.name,
  );
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Перемещение" }),
  ).toHaveAttribute("aria-pressed", "true");

  await openWorkspaceSection(page, "Персонажи");
  await expect(page.getByRole("heading", { name: "Картограф" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Наблюдение", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Закрыть персонажей" }).click();
  await expect(page.getByText("Сцена готова.")).toBeVisible();
  await page.screenshot({
    path: "test-results/concept-shell.png",
    fullPage: true,
  });
});

test("UIX-516 GM sees protected regen deletes before and after reload", async ({
  page,
}) => {
  const repairedSnapshot = structuredClone(snapshot);
  repairedSnapshot.characters[0]!.stats = {
    ...repairedSnapshot.characters[0]!.stats,
    enduranceRegen: 7,
    manaRegen: 4,
  };
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(repairedSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  const expectProtectedControls = async () => {
    await openWorkspaceSection(page, "Персонажи");
    for (const label of ["Реген Выносливости", "Реген Маны"]) {
      const protectedDelete = page.getByRole("button", {
        name: `Нельзя удалить «${label}»: установите значение 0, чтобы отключить восстановление`,
      });
      await expect(protectedDelete).toBeVisible();
      await expect(protectedDelete).toBeDisabled();
      await expect(protectedDelete).toHaveAttribute(
        "title",
        "Системную строку нельзя удалить. Чтобы отключить восстановление, установите значение 0.",
      );
    }
    await expect(
      page.getByRole("button", { name: "Удалить «Сила»" }),
    ).toBeEnabled();
  };

  await page.goto("/");
  await expectProtectedControls();
  await page.reload();
  await expectProtectedControls();
});

test("GM compact chrome keeps actions discoverable at release width", async ({
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
  await page.setViewportSize({ width: 1343, height: 945 });
  await page.goto("/");

  await expect(page.locator(".workspace-nav")).toBeVisible();
  await expect(page.locator(".campaign-name-button__icon")).toBeVisible();
  await expect(page.locator(".scene-token-count")).toBeHidden();
  for (const tool of ["PAN", "FOG", "COVER", "DRAW", "RULER", "PING"]) {
    await expect(
      page.locator(`.map-toolbar .map-tool[data-tool="${tool}"]:visible`),
    ).toHaveCount(1);
  }
  await expect(
    page.locator('.map-toolbar .map-tool[data-tool="PAN"]'),
  ).toHaveAttribute("title", /./);
  await expect(page.locator(".music-topbar__title")).toBeVisible();

  const iconOnlyControls = page.locator(
    [
      ".topbar-icon-button",
      ".account-menu summary",
      ".music-icon-button",
      ".music-volume-control summary",
      ".music-overflow summary",
      ".toolbar-overflow summary",
    ]
      .map((selector) => `${selector}:visible`)
      .join(", "),
  );
  expect(await iconOnlyControls.count()).toBeGreaterThan(0);
  for (const control of await iconOnlyControls.all()) {
    await expect(control).toHaveCSS("width", "30px");
    await expect(control).toHaveCSS("height", "30px");
  }

  await page.locator(".music-overflow summary").click();
  await expect(page.locator(".music-overflow__menu")).toBeVisible();
  await page.locator(".account-menu summary").click();
  await expect(page.locator(".account-menu__content")).toBeVisible();
  await expect(page.locator(".account-menu__content .status")).toBeVisible();
  await expect(page.locator(".account-menu__content .g-button")).toHaveCount(1);
});

test("UIX-386 GM toolbar keeps glyphs and encounter states accessible", async ({
  page,
}) => {
  let activeSnapshot = structuredClone(snapshot);
  activeSnapshot.scenes = [];
  activeSnapshot.tokens = [];
  activeSnapshot.fogReveals = [];
  activeSnapshot.encounters = [];

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
  await page.setViewportSize({ width: 1343, height: 945 });
  await page.goto("/");

  const toolbar = page.getByRole("toolbar", { name: "Инструменты карты" });
  const tool = (id: string) => toolbar.locator(`[data-tool="${id}"]`);
  const pseudoContent = (control: Locator) =>
    control.evaluate((element) =>
      getComputedStyle(element, "::before").content.replace(
        /^(?:"(.*)"|'(.*)')$/,
        "$1$2",
      ),
    );

  await expect(toolbar).toBeVisible();
  await expect(toolbar).not.toHaveClass(/is-collapsed/);

  const labelledTools = [
    ["FOG_BRUSH", "Открыть туман кистью", "Кисть"],
    ["COVER_BRUSH", "Закрыть туман кистью", "Кисть закр."],
    ["FOG_POLYGON", "Открыть туман полигоном", "Полигон"],
    ["COVER_POLYGON", "Закрыть туман полигоном", "Полигон закр."],
  ] as const;
  for (const [id, accessibleName, visibleLabel] of labelledTools) {
    const control = tool(id);
    await expect(control).toHaveAttribute("aria-label", accessibleName);
    await expect(control).toHaveAttribute("title", /\S/);
    await expect(control).toHaveText(visibleLabel);
    expect(
      Number.parseFloat(
        await control.evaluate((item) => getComputedStyle(item).fontSize),
      ),
    ).toBeGreaterThan(0);
  }

  const distinctGlyphs = await Promise.all(
    labelledTools.map(([id]) => pseudoContent(tool(id))),
  );
  expect(distinctGlyphs.every((glyph) => glyph.trim().length > 0)).toBe(true);
  expect(new Set(distinctGlyphs).size).toBe(distinctGlyphs.length);

  const encounterStart = tool("ENCOUNTER_START");
  await expect(encounterStart).toHaveAttribute("aria-label", "Начать бой");
  await expect(encounterStart).toHaveAttribute(
    "title",
    "Начать бой из области сцены или связанной локации",
  );
  await expect(encounterStart).toBeDisabled();

  await tool("COVER").focus();
  await page.keyboard.press("Tab");
  const openBrush = tool("FOG_BRUSH");
  await expect(openBrush).toBeFocused();
  expect(
    await openBrush.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  const focusRing = await openBrush.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focusRing.style).not.toBe("none");
  expect(Number.parseFloat(focusRing.width)).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(openBrush).toHaveAttribute("aria-pressed", "true");
  await expect(tool("COVER_BRUSH")).toHaveAttribute("aria-pressed", "false");

  // Native disabled controls must not become the keyboard stop between Ping
  // and Draw when no scene exists.
  await tool("PING").focus();
  await page.keyboard.press("Tab");
  await expect(tool("DRAW")).toBeFocused();

  // UIX-470 keeps labels in the expanded toolbar. UIX-475 only hides them
  // after the explicit collapse action, while the accessible names remain.
  await tool("PAN").click();
  const collapse = toolbar.locator(".map-toolbar__collapse");
  await expect(collapse).toHaveAttribute(
    "aria-label",
    "Свернуть панель до значков",
  );
  const expandedWidth = (await toolbar.boundingBox())!.width;
  await collapse.click();
  await expect(toolbar).toHaveClass(/is-collapsed/);
  await expect(collapse).toHaveAttribute("aria-expanded", "false");
  await expect(collapse).toHaveAttribute(
    "aria-label",
    "Показать подписи инструментов",
  );
  await expect(collapse).toHaveAttribute(
    "title",
    "Показать подписи инструментов",
  );
  expect((await toolbar.boundingBox())!.width).toBeLessThan(expandedWidth);
  await expect(toolbar.locator(".toolbar-group__title").first()).toBeHidden();
  for (const [id, accessibleName] of labelledTools) {
    const control = tool(id);
    await expect(control).toHaveCSS("font-size", "0px");
    await expect(control).toHaveAttribute("aria-label", accessibleName);
    expect((await pseudoContent(control)).trim().length).toBeGreaterThan(0);
  }

  activeSnapshot = structuredClone(snapshot);
  activeSnapshot.encounters = [];
  await page.reload();

  const enabledStart = page
    .getByRole("toolbar", { name: "Инструменты карты" })
    .locator('[data-tool="ENCOUNTER_START"]');
  await expect(enabledStart).toBeEnabled();
  const startGlyph = await pseudoContent(enabledStart);
  await enabledStart.click();
  await expect(page.getByRole("dialog", { name: "Начать бой" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Начать бой" })).toBeHidden();

  const now = "2026-08-21T08:00:00.000Z";
  activeSnapshot.encounters = [
    {
      id: "f1dfa5a7-f608-4f2d-a3d4-e7bdd70b3641",
      campaignId: snapshot.campaign.id,
      sequence: 1,
      status: "ACTIVE",
      mode: "SCENE_REGION",
      sourceSceneId: snapshot.scenes[0]!.id,
      targetSceneId: snapshot.scenes[0]!.id,
      focusRegion: { x: 64, y: 64, width: 256, height: 192 },
      locationId: null,
      sourceSceneRevision: snapshot.scenes[0]!.revision ?? 0,
      initiatorMembershipId: snapshot.me.id,
      revision: 0,
      startedAt: now,
      endedAt: null,
      endedByMembershipId: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  await page.reload();

  const activeToolbar = page.getByRole("toolbar", {
    name: "Инструменты карты",
  });
  await expect(
    activeToolbar.locator('[data-tool="ENCOUNTER_START"]'),
  ).toHaveCount(0);
  const encounterEnd = activeToolbar.locator('[data-tool="ENCOUNTER_END"]');
  await expect(encounterEnd).toBeEnabled();
  await expect(encounterEnd).toHaveAttribute("aria-label", "Завершить бой");
  await expect(encounterEnd).toHaveAttribute("title", "Завершить текущий бой");
  const endGlyph = await pseudoContent(encounterEnd);
  expect(endGlyph.trim().length).toBeGreaterThan(0);
  expect(endGlyph).not.toBe(startGlyph);
});

test("UIX-462 shortcuts dialog exposes role-safe map commands", async ({
  page,
}) => {
  let activeSnapshot = structuredClone(snapshot);
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

  const openShortcuts = async () => {
    await page.locator(".account-menu summary").click();
    await page
      .getByRole("button", { name: "Клавиши и команды", exact: true })
      .click();
    return page.getByRole("dialog", { name: "Клавиши и команды" });
  };
  const shortcutRow = (dialog: Locator, action: string) =>
    dialog.locator(".guide-row").filter({ hasText: action });

  await page.goto("/");
  const gmDialog = await openShortcuts();
  for (const [action, keys] of [
    ["Перемещение и выделение", ["V"]],
    ["Рисование", ["D"]],
    ["Линейка — измерить расстояние", ["R"]],
    ["Пинг — показать точку остальным", ["P"]],
    ["Открыть туман областью", ["G"]],
    ["Закрыть туман областью", ["Shift", "G"]],
    ["Открыть туман кистью", ["B"]],
    ["Закрыть туман кистью", ["Shift", "B"]],
    ["Открыть туман полигоном", ["L"]],
    ["Закрыть туман полигоном", ["Shift", "L"]],
    ["Бросок с преимуществом", ["Ctrl"]],
    ["Бросок с помехой", ["Alt"]],
  ] as const) {
    await expect(shortcutRow(gmDialog, action).locator("kbd")).toHaveText(keys);
  }

  activeSnapshot = structuredClone(snapshot);
  activeSnapshot.me = {
    ...activeSnapshot.me,
    role: "PLAYER",
    characterId: activeSnapshot.characters[0]!.id,
  };
  activeSnapshot.members = [{ ...activeSnapshot.me }];
  await page.reload();
  const playerDialog = await openShortcuts();
  for (const [action, key] of [
    ["Перемещение и выделение", "V"],
    ["Рисование", "D"],
    ["Линейка — измерить расстояние", "R"],
    ["Пинг — показать точку остальным", "P"],
    ["Бросок с преимуществом", "Ctrl"],
    ["Бросок с помехой", "Alt"],
  ] as const) {
    await expect(shortcutRow(playerDialog, action).locator("kbd")).toHaveText([
      key,
    ]);
  }
  for (const action of [
    "Открыть туман областью",
    "Закрыть туман областью",
    "Открыть туман кистью",
    "Закрыть туман кистью",
    "Открыть туман полигоном",
    "Закрыть туман полигоном",
  ]) {
    await expect(shortcutRow(playerDialog, action)).toHaveCount(0);
  }
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

  await openWorkspaceSection(page, "Токены");
  const tokensDialog = page.getByRole("dialog", { name: "Токены" });
  await expect(tokensDialog).toBeVisible();
  await tokensDialog.getByRole("button", { name: "Создать токен" }).click();
  const tokenEditor = page.getByRole("dialog", {
    name: "Новый токен",
  });
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

  await openWorkspaceSection(page, "Файлы");
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

test("GM checks usage and deletes an unused media asset", async ({ page }) => {
  const assetId = "00000000-0000-4000-8000-000000000610";
  const assetSnapshot = structuredClone(snapshot);
  assetSnapshot.assets = [
    {
      id: assetId,
      kind: "IMAGE",
      name: "Замок.webp",
      mimeType: "image/webp",
      sizeBytes: 1024 * 1024,
      width: 800,
      height: 600,
      durationSeconds: null,
      url: `/api/assets/${assetId}/content`,
      createdAt: new Date(0).toISOString(),
    },
  ];
  let deleted = false;
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...assetSnapshot,
        assets: deleted ? [] : assetSnapshot.assets,
      }),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`**/api/assets/${assetId}/usage`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asset: assetSnapshot.assets[0],
        inUse: false,
        usages: [],
        hiddenUsageCount: 0,
        canDelete: true,
        deletionBlockedReason: null,
      }),
    }),
  );
  await page.route(`**/api/assets/${assetId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route(`**/api/assets/${assetId}`, (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deleted = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assetId,
        deleted: true,
        blobCleanupPending: false,
      }),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openWorkspaceSection(page, "Файлы");
  const filesDialog = page.getByRole("dialog", { name: "Файлы" });
  await expect(filesDialog.getByText("Замок.webp")).toBeVisible();
  await expect(filesDialog.getByText("IMAGE · 1.0 МБ")).toBeVisible();

  await filesDialog.getByText("Проверить использование").click();
  await expect(filesDialog.getByText("Не используется")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await filesDialog.getByText("Удалить файл").click();
  await expect(filesDialog.getByText("Замок.webp")).toHaveCount(0);
});

test("GM manages a bounded in-place character sheet deck", async ({ page }) => {
  const workspaceSnapshot = structuredClone(snapshot);
  workspaceSnapshot.characters.push({
    ...workspaceSnapshot.characters[0]!,
    id: "e49b79b7-4ddf-49fe-9e7d-4ee03806c116",
    name: "Второй персонаж",
  });
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(workspaceSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/");
  /**
   * UIX-561: узла дожидаются до снимка, а не после.
   *
   * Раньше снимок брали сразу после `goto`. Если Konva не успел
   * смонтироваться — на загруженном раннере это обычное дело, — в переменную
   * попадал `null`, и сравнение `null === <canvas>` в конце теста не становилось
   * истинным **никогда**. Проверка при этом выглядела как «не дождались»: она
   * падала по сроку, хотя ждать было нечего, значение уже снято.
   *
   * Отсюда и то, почему UIX-530 не помог. Там сроку подняли потолок с пяти
   * секунд до пятнадцати, приняв симптом за причину; пятнадцати хватило на три
   * дня, после чего тест снова начал красить чужие PR. Срок здесь вообще ни при
   * чём: проверка сверяет тождество узла, а не скорость.
   */
  await page.locator("canvas").first().waitFor();
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    // Страховка от самой себя: пустой снимок сделал бы проверку в конце
    // невыполнимой при любом поведении продукта, то есть превратил бы её из
    // проверки в генератор красных прогонов.
    if (!canvas) throw new Error("Канвас не появился до снятия снимка");
    (window as unknown as { __uix229Canvas: Element | null }).__uix229Canvas =
      canvas;
  });

  await openWorkspaceSection(page, "Персонажи");
  const workspace = page.locator(".character-workspace");
  await expect(workspace).toBeVisible();
  await expect(
    workspace.getByRole("heading", { name: "Персонажи" }),
  ).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Персонажи" })).toHaveCount(0);
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator("canvas").first()).toBeHidden();

  await workspace
    .getByRole("button", { name: "Свернуть список персонажей" })
    .click();
  await expect(workspace.locator(".character-workspace__body")).toHaveClass(
    /is-rail-collapsed/,
  );
  await expect(
    workspace.getByRole("button", { name: "Развернуть список персонажей" }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "Развернуть список персонажей" })
    .click();
  await expect(workspace.locator(".character-workspace__body")).not.toHaveClass(
    /is-rail-collapsed/,
  );

  await workspace
    .getByRole("button", { name: "Второй персонаж", exact: true })
    .click();
  await expect(
    workspace.getByRole("article", {
      name: "Лист персонажа Второй персонаж",
    }),
  ).toBeVisible();
  const secondSheet = workspace.getByRole("article", {
    name: "Лист персонажа Второй персонаж",
  });
  const secondSheetAdvantage = secondSheet
    .locator(".roll-mode-control")
    .getByRole("radio", {
      name: "\u041f\u0440\u0435\u0438\u043c\u0443\u0449\u0435\u0441\u0442\u0432\u043e",
    });
  await secondSheetAdvantage.click();
  await workspace
    .getByRole("button", {
      name: "Свернуть лист Второй персонаж",
    })
    .click();
  await expect(
    workspace.getByRole("button", {
      name: "Развернуть лист Второй персонаж",
    }),
  ).toBeVisible();
  await workspace
    .getByRole("button", {
      name: "Развернуть лист Второй персонаж",
    })
    .click();
  await expect(secondSheetAdvantage).toHaveAttribute("aria-checked", "true");
  await workspace
    .getByRole("article", {
      name: "Лист персонажа Второй персонаж",
    })
    .getByRole("button", {
      name: "Закрыть лист Второй персонаж",
    })
    .click();
  await expect(
    workspace.getByRole("article", {
      name: "Лист персонажа Второй персонаж",
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Закрыть персонажей" }).click();
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect
    /**
     * UIX-530: пятнадцать секунд именно здесь, а не в конфиге.
     *
     * Проверка ловит настоящий и дорогой дефект — пересоздание `<canvas>` при
     * каждом закрытии рабочей области рвёт состояние сцены Konva. Но срок ей
     * достался чужой: пять секунд по умолчанию — тонкий запас на
     * перемонтирование сцены, и на загруженном раннере он кончался. Тест падал
     * и проходил на одном и том же поведении продукта, красил чужие PR и
     * съедал разбор по кругу.
     *
     * Запас поднят точечно: общий потолок в конфиге спрятал бы медленные места
     * там, где медленно — это и есть дефект. Проверяется по-прежнему
     * переиспользование узла, а не скорость, поэтому больший срок ничего не
     * ослабляет: пересозданный canvas не станет прежним ни за пятнадцать
     * секунд, ни за пятьдесят.
     */
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __uix229Canvas: Element | null })
              .__uix229Canvas === document.querySelector("canvas"),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("GM manages one campaign clock surface and confirms a reset", async ({
  page,
}) => {
  let currentSnapshot = structuredClone(snapshot);
  currentSnapshot.characters.push({
    ...currentSnapshot.characters[0]!,
    id: "e49b79b7-4ddf-49fe-9e7d-4ee03806c116",
    name: "Второй персонаж",
  });
  currentSnapshot.campaign = {
    ...currentSnapshot.campaign,
    day: 7,
    battleCounter: 3,
    revision: 12,
  };
  const clockRequests: Array<{
    actionId: string;
    command: string;
    revision: number;
  }> = [];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(currentSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/campaign/clock", async (route) => {
    const body = route.request().postDataJSON() as {
      actionId: string;
      command: string;
      revision: number;
    };
    clockRequests.push(body);
    currentSnapshot = {
      ...currentSnapshot,
      campaign: {
        ...currentSnapshot.campaign,
        day: body.command === "RESET_CLOCK" ? 1 : currentSnapshot.campaign.day,
        battleCounter:
          body.command === "RESET_CLOCK"
            ? 0
            : currentSnapshot.campaign.battleCounter,
        revision: body.revision + 1,
      },
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(currentSnapshot.campaign),
    });
  });
  await page.goto("/");

  await openWorkspaceSection(page, "Персонажи");
  const workspace = page.locator(".character-workspace");
  await expect(workspace).toBeVisible();
  const clockTrigger = workspace.getByRole("button", {
    name: "День 7 · боёв: 3",
  });
  await expect(clockTrigger).toHaveCount(1);
  await clockTrigger.click();

  const clockDialog = page.getByRole("dialog", { name: "Время кампании" });
  await expect(clockDialog).toBeVisible();
  await expect(
    clockDialog.getByRole("button", { name: "Следующий день" }),
  ).toHaveCount(1);
  await expect(
    clockDialog.getByRole("button", { name: "Длинный отдых" }),
  ).toHaveCount(1);
  await expect(clockDialog.getByText("Начать бой")).toHaveCount(0);
  await expect(clockDialog.getByText("Завершить бой")).toHaveCount(0);

  await clockDialog.getByRole("button", { name: "Сбросить время" }).click();
  expect(clockRequests).toHaveLength(0);
  const resetDialog = page.getByRole("dialog", {
    name: "Сбросить время кампании?",
  });
  await expect(resetDialog).toBeVisible();
  await resetDialog.getByRole("button", { name: "Подтвердить сброс" }).click();

  await expect.poll(() => clockRequests).toHaveLength(1);
  expect(clockRequests[0]).toMatchObject({
    command: "RESET_CLOCK",
    revision: 12,
  });
  expect(clockRequests[0]?.actionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect(clockDialog.getByText("День 1")).toBeVisible();
  await expect(
    clockDialog.getByRole("button", { name: "Сбросить время" }),
  ).toBeDisabled();
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
  await music.locator(".music-overflow summary").click();
  await expect(music.getByText("Трек не выбран")).toBeVisible();
  await music
    .getByRole("button", { name: "Открыть библиотеку", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Музыкальная библиотека",
  });
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
    localStorage.setItem("arken.audio.volume", "0.5");
    const probe = { playVolumes: [] as number[] };
    (
      window as typeof window & {
        __arkenMusicProbe: typeof probe;
      }
    ).__arkenMusicProbe = probe;
    HTMLMediaElement.prototype.play = function () {
      probe.playVolumes.push(this.volume);
      return Promise.reject(new DOMException("interrupted", "AbortError"));
    };
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
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __arkenMusicProbe: { playVolumes: number[] };
            }
          ).__arkenMusicProbe.playVolumes.length,
      ),
    )
    .toBeGreaterThan(0);
  const initialPlayVolumes = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __arkenMusicProbe: { playVolumes: number[] };
        }
      ).__arkenMusicProbe.playVolumes,
  );
  expect(
    initialPlayVolumes.every((gain) => Math.abs(gain - 0.25) < 0.001),
  ).toBe(true);
  await page.locator(".music-volume-control summary").click();
  const volumeSlider = page.getByRole("slider", { name: "Личная громкость" });
  await expect(volumeSlider).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".music-volume-popover").evaluate((popover) => {
        const bounds = popover.getBoundingClientRect();
        const target = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return target !== null && popover.contains(target);
      }),
    )
    .toBe(true);
  const playCountBeforeVolumeChange = initialPlayVolumes.length;
  await volumeSlider.fill("0.05");
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((audio) => (audio as HTMLAudioElement).volume),
    )
    .toBeCloseTo(0.0025);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __arkenMusicProbe: { playVolumes: number[] };
            }
          ).__arkenMusicProbe.playVolumes.length,
      ),
    )
    .toBe(playCountBeforeVolumeChange);
  await selectViewedScene(page, "Музыкальная сцена");
  await page
    .getByRole("button", {
      name: "Показать выбранную сцену игрокам",
      exact: true,
    })
    .click();

  // UIX-517: selecting a scene and publishing it are pointer events outside
  // the volume popover, which now dismisses it like every other `details`
  // popover in the app. What this test guards is that the scene refresh does
  // not revoke consent or reset personal gain -- not that the popover stays
  // pinned open over the sidebar -- so the control is reopened before the
  // slider is inspected again.
  await page.locator(".music-volume-control summary").click();
  await expect(
    page.getByRole("slider", { name: "Личная громкость" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((audio) => (audio as HTMLAudioElement).volume),
    )
    .toBeCloseTo(0.0025);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("arken.audio.enabled")),
    )
    .toBe("true");
});

test("UIX-226 chat composer and canvas quick rolls submit explicit, server-safe intents", async ({
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

  const quickRolls = page.locator(".activity-roll-controls");
  await expect(quickRolls).toBeVisible();
  await quickRolls
    .locator(".roll-mode-control")
    .getByRole("radio", {
      name: "\u041f\u0440\u0435\u0438\u043c\u0443\u0449\u0435\u0441\u0442\u0432\u043e",
    })
    .click();
  await quickRolls.getByRole("button", { name: "d6" }).click();
  await expect.poll(() => diceRequests.length).toBe(1);
  expect(diceRequests[0]).toMatchObject({
    formula: "1d6",
    rollMode: "ADVANTAGE",
  });

  await page.locator("#chat-tab-activity").click();
  const activityPanel = page.locator("#chat-panel-activity");
  const composer = activityPanel.locator(".chat-compose textarea");
  await expect(activityPanel.getByText("Сцена готова.")).toBeVisible();
  const sendButton = activityPanel.locator(
    '.chat-composer-actions button[type="submit"]',
  );
  await expect(sendButton).toBeVisible();
  await expect(sendButton).toHaveAttribute("title", /Ctrl\+Enter/);
  await expect(activityPanel.locator(".chat-visibility-check")).toHaveCount(0);
  await composer.fill("/");
  const rollSuggestion = activityPanel
    .locator(".slash-command-suggestions [role=option]")
    .filter({ has: page.locator("code", { hasText: "/roll 1d20 + agility" }) });
  await expect(rollSuggestion).toContainText("/roll");
  await expect(rollSuggestion).toContainText("/roll 1d20 + agility");
  await rollSuggestion.click();
  await expect(composer).toHaveValue("");
  await expect.poll(() => diceRequests.length).toBe(2);
  expect(diceRequests[1]).toMatchObject({
    formula: "1d20 + agility",
    rollMode: "NORMAL",
  });
  await composer.fill("Сообщение для группы");
  await composer.press("Enter");
  await expect.poll(() => chatRequests.length).toBe(1);
  expect(chatRequests[0]).toMatchObject({
    body: "Сообщение для группы",
    visibility: "PUBLIC",
  });

  await composer.fill("Сообщение только мастеру");
  await composer.press("Control+Enter");
  await expect.poll(() => chatRequests.length).toBe(2);
  expect(chatRequests[1]).toMatchObject({
    body: "Сообщение только мастеру",
    visibility: "GM_ONLY",
  });

  await composer.fill("/roll 1d20 + agility");
  await page.locator(".chat-compose button[type=submit]").click();
  await expect.poll(() => diceRequests.length).toBe(3);
  expect(diceRequests[2]).toMatchObject({
    formula: "1d20 + agility",
    rollMode: "NORMAL",
  });

  await composer.fill("d20");
  await composer.press("Enter");
  await expect.poll(() => diceRequests.length).toBe(4);
  expect(diceRequests[3]).toMatchObject({
    formula: "d20",
    rollMode: "NORMAL",
  });
  expect(chatRequests).toHaveLength(2);

  await quickRolls.locator(".canvas-roll-gm-toggle").click();
  await quickRolls
    .getByRole("button", { name: "Формула", exact: true })
    .click();
  const customFormulaDialog = page.getByRole("dialog", {
    name: "Быстрый бросок",
  });
  await expect(customFormulaDialog).toBeVisible();
  await customFormulaDialog
    .getByRole("textbox", { name: "Формула броска" })
    .fill("2d8 + 3");
  await customFormulaDialog.getByRole("button", { name: "Бросить" }).click();
  await expect.poll(() => diceRequests.length).toBe(5);
  expect(diceRequests[4]).toMatchObject({
    formula: "2d8 + 3",
    label: "Быстрый бросок",
    visibility: "GM_ONLY",
    rollMode: "ADVANTAGE",
  });
  await expect(customFormulaDialog).toBeHidden();
});

test("UIX-422 compact layout keeps sidebar custom roll reachable at 390x844", async ({
  page,
}) => {
  test.fixme(
    true,
    "UIX-422: compact in-game layout is not implemented; runtime remains desktop-first with a 960px minimum",
  );
  await page.setViewportSize({ width: 390, height: 844 });
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

  const customRoll = page
    .locator(".activity-roll-controls")
    .getByRole("button", { name: "Формула", exact: true });
  await expect(customRoll).toBeVisible();
  const box = await customRoll.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);

  await customRoll.click();
  await expect(
    page.getByRole("dialog", { name: "Быстрый бросок" }),
  ).toBeVisible();
});

test("UIX-274 activity reloads story posts and exposes empty states and slash action", async ({
  page,
}) => {
  const fixture = structuredClone(snapshot);
  fixture.messages = [];
  fixture.chatThreadStates = fixture.chatThreadStates.map((state) => ({
    ...state,
    lastReadSequence: 0,
    latestSequence: 0,
    unreadCount: 0,
  }));
  let includePublishedPost = false;
  const diceRequests: Array<Record<string, unknown>> = [];
  const timestamp = "2026-07-26T09:00:00.000Z";
  const publishedPost = {
    id: "77777777-7777-4777-8777-777777777777",
    threadId: fixture.chatThreads[1]!.id,
    authorMembershipId: fixture.me.id,
    title: "",
    body: "UIX274_PUBLISHED_STORY",
    lifecycle: "PUBLISHED",
    revision: 1,
    entityLinks: [],
    media: [],
    publishedAt: timestamp,
    correctedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/story/posts**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        posts: includePublishedPost ? [publishedPost] : [],
        nextCursor: null,
      }),
    }),
  );
  await page.route("**/api/dice", async (route) => {
    diceRequests.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.goto("/");
  await expect(page.locator("#chat-tab-activity")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".activity-feed .chat-empty")).toBeVisible();

  includePublishedPost = true;
  await page.reload();
  await expect(page.getByText("UIX274_PUBLISHED_STORY")).toBeVisible();

  await page.locator("#chat-tab-activity").click();
  await expect(page.locator("#chat-panel-activity .chat-empty")).toHaveCount(0);
  const composer = page.locator(".chat-compose textarea");
  const slashAction = page.locator(".composer-slash-action");
  await expect(slashAction).toHaveAttribute("aria-expanded", "false");
  await slashAction.click();
  await expect(
    page.getByRole("listbox", {
      name: "\u041a\u043e\u043c\u0430\u043d\u0434\u044b \u0447\u0430\u0442\u0430",
    }),
  ).toBeVisible();
  await page.getByRole("option", { name: /\/roll/ }).click();
  await expect(composer).toHaveValue("");
  await expect.poll(() => diceRequests.length).toBe(1);
  expect(diceRequests[0]).toMatchObject({
    formula: "1d20 + agility",
    rollMode: "NORMAL",
  });
});

test("activity quick rolls reserve space above the scrollable event history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  const fixture = structuredClone(snapshot);
  const baseMessage = fixture.messages[0]!;
  fixture.messages = Array.from({ length: 24 }, (_, index) => ({
    ...baseMessage,
    id: `activity-layout-message-${index}`,
    sequence: index + 1,
    body: `Activity layout event ${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 6, 26, 9, index)).toISOString(),
  }));
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );

  await page.goto("/");

  const controls = page.locator("#chat-panel-activity .activity-roll-controls");
  const toolbar = page.locator("#chat-panel-activity .activity-log-toolbar");
  const historyControl = page.locator(
    "#chat-panel-activity .activity-log-history-control",
  );
  const history = page.locator("#chat-panel-activity .message-list");
  await expect(controls).toBeVisible();
  await expect(toolbar.getByText("Журнал", { exact: true })).toBeVisible();
  await expect(history).toBeVisible();
  await expect(
    page
      .locator("#chat-panel-activity")
      .getByRole("button", { name: /Заявка мастеру/i }),
  ).toHaveCount(0);

  const filterSummary = toolbar.locator(".activity-filters-summary");
  await expect(filterSummary).toHaveAccessibleName(
    "Показывать: включены все потоки",
  );
  await filterSummary.click();
  await expect(
    page
      .locator("#chat-panel-activity")
      .getByRole("group", { name: "Показывать" }),
  ).toBeVisible();
  await filterSummary.click();

  const historyAction = historyControl.getByRole("button", {
    name: "Показать меньше",
  });
  await expect(historyAction).toBeVisible();
  await expect(historyAction).toHaveAttribute(
    "aria-controls",
    "activity-message-list",
  );
  await historyAction.click();
  await expect(
    historyControl.getByRole("button", { name: "Показать больше" }),
  ).toBeVisible();
  await expect(
    historyControl.locator(".activity-log-truncated-note"),
  ).toHaveText(/Показаны последние 8 из \d+\./);

  const workbench = page.locator(".workbench");
  const sidebar = page.locator(".sidebar");
  for (const width of [280, 360, 600]) {
    await workbench.evaluate((element, sidebarWidth) => {
      (element as HTMLElement).style.setProperty(
        "--sidebar-width",
        `${sidebarWidth}px`,
      );
    }, width);
    await expect
      .poll(() =>
        sidebar.evaluate((element) =>
          Math.round(element.getBoundingClientRect().width),
        ),
      )
      .toBe(width);

    const controlsBox = await controls.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    const historyBox = await history.boundingBox();
    const historyControlBox = await historyControl.boundingBox();
    expect(controlsBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    expect(historyBox).not.toBeNull();
    expect(historyControlBox).not.toBeNull();
    expect(controlsBox!.y + controlsBox!.height).toBeLessThanOrEqual(
      toolbarBox!.y + 1,
    );
    expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(
      historyControlBox!.y + 1,
    );
    expect(
      historyControlBox!.y + historyControlBox!.height,
    ).toBeLessThanOrEqual(historyBox!.y + 1);
    expect(historyBox!.height).toBeGreaterThan(0);
    expect(historyControlBox!.x).toBeGreaterThanOrEqual(historyBox!.x - 1);
    expect(historyControlBox!.x + historyControlBox!.width).toBeLessThanOrEqual(
      historyBox!.x + historyBox!.width + 1,
    );
  }
});

test("chat marks only unambiguous kept natural d20 criticals", async ({
  page,
}) => {
  const fixture = structuredClone(snapshot);
  const baseMessage = fixture.messages[0]!;
  const diceMessage = (
    id: string,
    sequence: number,
    body: string,
    total: number,
    notation: string,
    rolls: number[],
  ): GameSnapshot["messages"][number] => ({
    ...baseMessage,
    id,
    sequence,
    kind: "DICE",
    body,
    dice: {
      formula: notation,
      resolvedFormula: notation,
      terms: [{ notation, rolls, subtotal: rolls.reduce((a, b) => a + b, 0) }],
      modifiers: [],
      total,
    },
  });
  fixture.messages = [
    diceMessage(
      "critical-failure",
      1,
      "Natural one with modifier",
      8,
      "1d20",
      [1],
    ),
    diceMessage(
      "critical-success",
      2,
      "Natural twenty with modifier",
      25,
      "1d20",
      [20],
    ),
    diceMessage("total-only", 3, "Total twenty on d8", 20, "1d8", [8]),
    diceMessage("ambiguous-pool", 4, "Ambiguous d20 pool", 21, "2d20", [1, 20]),
  ];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  await page.goto("/");

  const failure = page.locator(".roll-result--critical-failure");
  const success = page.locator(".roll-result--critical-success");
  await expect(failure).toContainText("Критический провал");
  await expect(success).toContainText("Критический успех");
  await expect(failure).toHaveCSS("border-color", "rgb(217, 87, 87)");
  await expect(success).toHaveCSS("border-color", "rgb(76, 171, 107)");
  await expect(page.locator(".roll-critical-label")).toHaveCount(2);
  await expect(
    page.getByText("Total twenty on d8").locator(".."),
  ).not.toHaveClass(/roll-result--critical/);
  await expect(
    page.getByText("Ambiguous d20 pool").locator(".."),
  ).not.toHaveClass(/roll-result--critical/);
});
test("chat survives malformed client dice and renders local date boundaries", async ({
  page,
}) => {
  const unsafeSnapshot = structuredClone(snapshot);
  unsafeSnapshot.messages = [
    {
      ...unsafeSnapshot.messages[0]!,
      id: "date-one",
      createdAt: "2026-07-21T08:00:00.000Z",
    },
    {
      ...unsafeSnapshot.messages[0]!,
      id: "date-two",
      sequence: 2,
      kind: "DICE",
      body: "Сломанный бросок",
      createdAt: "2026-07-22T08:00:00.000Z",
      dice: { total: 20 } as unknown as NonNullable<
        GameSnapshot["messages"][number]["dice"]
      >,
    },
  ];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(unsafeSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  await page.goto("/");

  await expect(page.locator(".chat-date-divider")).toHaveCount(2);
  await expect(page.getByText("Сломанный бросок")).toBeVisible();
  await expect(page.locator(".app-fatal-error")).toHaveCount(0);
  await expect(page.locator(".roll-result")).toHaveCount(0);
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

    await expect(viewedScenePicker(page)).toBeVisible();
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
      await expect(
        page.getByRole("button", { name: tool, exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("tablist", { name: "Потоки чата" }).getByRole("tab"),
    ).toHaveCount(2);
    // UIX-472: раздел доступен либо кнопкой в строке, либо под «Ещё» —
    // что именно куда попадёт, решает ширина окна, и закреплять это в тесте
    // значит ломать его от любой правки подписей.
    const nav = page.locator(".workspace-nav");
    const more = nav.locator(".workspace-nav__more summary");
    if ((await more.count()) > 0) await more.click();
    for (const trigger of [
      "Персонажи",
      "Токены",
      "Сцены",
      "Подготовка",
      "Файлы",
    ]) {
      await expect(
        nav.locator("button").filter({ hasText: trigger }).first(),
      ).toBeVisible();
    }
    if ((await more.count()) > 0) await more.click();

    const zoom = page.getByRole("slider", {
      name: "Масштаб карты",
    });
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

  await openWorkspaceSection(page, "Подготовка");
  await expect(page.getByRole("dialog", { name: "Подготовка" })).toBeVisible();
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    page.locator(".setup-workspace .arken-workspace-window__drag-handle"),
  ).toHaveAttribute("data-draggable", "false");
  await expect(
    page.getByRole("navigation", { name: "Разделы подготовки" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Общий каталог", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Добавить навык или способность" }),
  ).toBeVisible();
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

  await openWorkspaceSection(page, "Сцены");
  const dialog = page.getByRole("dialog", { name: "Сцены" });
  await expect(dialog.getByText("Показана игрокам")).toBeVisible();
  const secretCard = dialog.locator(".scene-manager-card", {
    hasText: "Тайная комната",
  });
  await secretCard.getByRole("button", { name: "Открыть для мастера" }).click();
  await expect(viewedScenePicker(page)).toContainText("Тайная комната");
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

for (const trayCase of [
  { role: "GM" as const, viewport: { width: 1280, height: 720 } },
  { role: "PLAYER" as const, viewport: { width: 720, height: 640 } },
]) {
  test(`token tray opens upward without covering quick rolls for ${trayCase.role}`, async ({
    page,
  }) => {
    await page.setViewportSize(trayCase.viewport);
    const traySnapshot = structuredClone(snapshot);
    traySnapshot.me = {
      ...traySnapshot.me,
      role: trayCase.role,
      characterId:
        trayCase.role === "PLAYER" ? traySnapshot.characters[0]!.id : null,
    };
    traySnapshot.members = [{ ...traySnapshot.me }];
    traySnapshot.tokenDefinitions = Array.from({ length: 24 }, (_, index) => ({
      id: `9576b502-02f8-4cd6-9c55-${String(index).padStart(12, "0")}`,
      characterId: null,
      defaultAssetId: null,
      name: `Token ${index + 1}`,
      defaultWidth: 64,
      defaultHeight: 64,
      ownName: null,
      controllerMembershipIds: [],
      revision: 0,
    }));

    await page.route("**/api/bootstrap", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(traySnapshot),
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

    const map = page.locator(".map-shell");
    const tray = page.locator(".token-tray");
    const summary = tray.locator("summary");
    const quickRolls = page.locator(".activity-roll-controls");
    const collapsedSummaryBox = await summary.boundingBox();
    expect(collapsedSummaryBox).not.toBeNull();

    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(tray).toHaveAttribute("open", "");

    const [mapBox, trayBox, summaryBox, rollBox] = await Promise.all([
      map.boundingBox(),
      tray.boundingBox(),
      summary.boundingBox(),
      quickRolls.boundingBox(),
    ]);
    expect(mapBox).not.toBeNull();
    expect(trayBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    expect(rollBox).not.toBeNull();
    expect(summaryBox!.y + summaryBox!.height).toBeCloseTo(
      collapsedSummaryBox!.y + collapsedSummaryBox!.height,
      0,
    );
    expect(trayBox!.height).toBeLessThanOrEqual((mapBox!.height - 38) / 2 + 1);
    expect(trayBox!.x + trayBox!.width).toBeLessThanOrEqual(rollBox!.x);

    const listOverflow = await tray
      .locator(".token-tray-list")
      .evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: getComputedStyle(node).overflowY,
      }));
    expect(listOverflow.overflowY).toBe("auto");
    expect(listOverflow.scrollHeight).toBeGreaterThan(
      listOverflow.clientHeight,
    );

    await page.keyboard.press("Enter");
    await expect(tray).not.toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
  });
}

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
      ownName: null,
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

  await selectViewedScene(page, "Секретная сцена");
  await page.locator(".token-tray summary").click();
  await page
    .locator(".token-tray")
    .getByRole("button", { name: /Разведчик/ })
    .click();
  await expect.poll(() => placementSceneId).toBe(viewedSceneId);

  const gesture = await page.locator(".map-viewport").evaluate((node) => {
    const box = node.getBoundingClientRect();
    for (const [xRatio, yRatio] of [
      [0.65, 0.55],
      [0.55, 0.7],
      [0.75, 0.4],
    ] as const) {
      const start = {
        x: box.left + box.width * xRatio,
        y: box.top + box.height * yRatio,
      };
      const end = { x: start.x + 80, y: start.y + 80 };
      if (
        document.elementFromPoint(start.x, start.y) instanceof
          HTMLCanvasElement &&
        document.elementFromPoint(end.x, end.y) instanceof HTMLCanvasElement
      )
        return { start, end };
    }
    throw new Error("No unobstructed fog surface is visible");
  });
  await page
    .getByRole("button", { name: "Открыть туман кистью", exact: true })
    .click();
  await page.mouse.move(gesture.start.x, gesture.start.y);
  await page.mouse.down();
  // The fog draft is React state. Give the discrete pointer-down update one
  // frame before move events consume it, rather than racing the render.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => fogRequests).toBe(1);
  await expect(
    page.getByRole("button", { name: "Открыть туман кистью", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Пинг" }).click();
  await page.mouse.click(gesture.start.x + 40, gesture.start.y + 40);
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
    await page.locator("#chat-tab-activity").click();
    await expect(page.locator(".activity-roll-controls")).toBeVisible();
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
      controlsBottom: document
        .querySelector(".activity-roll-controls")!
        .getBoundingClientRect().bottom,
      composerBottom: document
        .querySelector(".chat-compose")!
        .getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
    }));
    expect(viewportFit.documentScrollHeight).toBe(
      viewportFit.documentClientHeight,
    );
    expect(viewportFit.controlsBottom).toBeLessThanOrEqual(
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

test("GM assigns and revokes additional character sheet access", async ({
  page,
}) => {
  const gmSnapshot = structuredClone(snapshot);
  const ownerId = "f53f4618-2ebc-4cf8-bce7-870097305a6b";
  const additionalId = "a53f4618-2ebc-4cf8-bce7-870097305a6b";
  gmSnapshot.members = [
    gmSnapshot.me,
    {
      id: ownerId,
      role: "PLAYER",
      displayName: "Owner",
      characterId: gmSnapshot.characters[0]!.id,
    },
    {
      id: additionalId,
      role: "PLAYER",
      displayName: "Additional",
      characterId: null,
    },
  ];
  gmSnapshot.characters[0]!.ownerMembershipId = ownerId;
  gmSnapshot.characters[0]!.controllerMembershipIds = [ownerId];

  let revision = gmSnapshot.characters[0]!.revision;
  const requests: Array<{
    controllerMembershipIds: string[];
    revision: number;
  }> = [];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(gmSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/characters/*/controllers", async (route) => {
    const body = route.request().postDataJSON() as {
      controllerMembershipIds: string[];
      revision: number;
    };
    requests.push(body);
    revision += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        controllerMembershipIds: [
          ownerId,
          ...body.controllerMembershipIds.filter((id) => id !== ownerId),
        ],
        revision,
      }),
    });
  });

  await page.goto("/");
  await openWorkspaceSection(
    page,
    "\u041f\u0435\u0440\u0441\u043e\u043d\u0430\u0436\u0438",
  );
  const access = page.locator(".character-controller-access");
  await expect(access).toBeVisible();
  const owner = access.getByLabel("Owner");
  await expect(owner).toBeChecked();
  await expect(owner).toBeDisabled();
  const additional = access.getByLabel("Additional");
  await additional.check();
  await access
    .getByRole("button", {
      name: "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0434\u043e\u0441\u0442\u0443\u043f",
    })
    .click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    revision: gmSnapshot.characters[0]!.revision,
    controllerMembershipIds: [ownerId, additionalId],
  });
  await additional.uncheck();
  await access
    .getByRole("button", {
      name: "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0434\u043e\u0441\u0442\u0443\u043f",
    })
    .click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({
    revision: gmSnapshot.characters[0]!.revision + 1,
    controllerMembershipIds: [ownerId],
  });
});

test("player opens the character workspace while chat remains visible", async ({
  page,
}) => {
  const playerSnapshot = structuredClone(snapshot);
  playerSnapshot.me = {
    id: "f53f4618-2ebc-4cf8-bce7-870097305a6b",
    role: "PLAYER",
    displayName: "Player",
    characterId: playerSnapshot.characters[0]!.id,
  };
  playerSnapshot.characters[0]!.ownerMembershipId = null;
  playerSnapshot.characters[0]!.controllerMembershipIds = [
    playerSnapshot.me.id,
  ];
  playerSnapshot.characters.push({
    ...playerSnapshot.characters[0]!,
    id: "a49b79b7-4ddf-49fe-9e7d-4ee03806c116",
    name: "Чужой персонаж",
    ownerMembershipId: "a21b4bb6-ae66-47b9-b719-610e0440044c",
    controllerMembershipIds: [],
  });
  playerSnapshot.members = [playerSnapshot.me];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    }),
  );
  await page.goto("/");
  await page.locator("#chat-tab-activity").click();
  await expect(page.locator(".chat-compose")).toBeVisible();
  await openWorkspaceSection(page, "Персонажи");
  await expect(page.locator(".character-workspace")).toBeVisible();
  await expect(page.locator(".character-controller-access")).toHaveCount(0);
  await expect(page.locator(".chat-compose")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "\u041d\u0430\u0431\u043b\u044e\u0434\u0435\u043d\u0438\u0435",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".character-rail")
      .getByRole("button", { name: "Чужой персонаж" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".character-workspace")).toBeHidden();
  await expect(page.locator(".workspace-nav__item").first()).toBeFocused();
});

test("unassigned player character workspace exposes no sheets", async ({
  page,
}) => {
  const playerSnapshot = structuredClone(snapshot);
  playerSnapshot.me = {
    id: "c53f4618-2ebc-4cf8-bce7-870097305a6b",
    role: "PLAYER",
    displayName: "Unassigned",
    characterId: null,
  };
  playerSnapshot.members = [playerSnapshot.me];
  playerSnapshot.characters = [];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    }),
  );
  await page.goto("/");
  await openWorkspaceSection(
    page,
    "\u041f\u0435\u0440\u0441\u043e\u043d\u0430\u0436\u0438",
  );
  await expect(page.locator(".character-workspace")).toBeVisible();
  await expect(page.locator(".character-sheet-card")).toHaveCount(0);
  await expect(page.locator(".character-controller-access")).toHaveCount(0);
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
  await openWorkspaceSection(page, "Персонажи");

  const mode = page.locator(".character-roll-controls .roll-mode-control");
  const normalMode = mode.getByRole("radio", {
    name: "\u041e\u0431\u044b\u0447\u043d\u043e",
  });
  const advantageMode = mode.getByRole("radio", {
    name: "\u041f\u0440\u0435\u0438\u043c\u0443\u0449\u0435\u0441\u0442\u0432\u043e",
  });
  const disadvantageMode = mode.getByRole("radio", {
    name: "\u041f\u043e\u043c\u0435\u0445\u0430",
  });
  const roll = page
    .locator(".character-card--stats .stat-field")
    .first()
    .getByRole("button", { name: "Бросок", exact: true });
  // An untouched card deliberately keeps the mode unset so catalog actions
  // can preserve their own legacy preference. Direct stat rolls still fall
  // back to NORMAL, with that neutral action serving as the keyboard tab stop.
  await expect(normalMode).toHaveAttribute("aria-checked", "false");
  await expect(normalMode).toHaveAttribute("tabindex", "0");
  holdNext = true;
  await roll.click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(roll).toBeDisabled();
  await expect(advantageMode).toBeDisabled();
  releaseHeldRoll?.();
  await expect(roll).toBeEnabled();
  await advantageMode.click();
  await roll.click();
  rejectNext = true;
  await disadvantageMode.click();
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
  await expect(
    page.getByRole("alert").filter({ hasText: "Roll could not be completed" }),
  ).toBeVisible();

  activeSnapshot = snapshot;
  rejectNext = false;
  await page.reload();
  await openWorkspaceSection(page, "Персонажи");
  await page
    .locator(".character-roll-controls .roll-mode-control")
    .getByRole("radio", {
      name: "\u041f\u0440\u0435\u0438\u043c\u0443\u0449\u0435\u0441\u0442\u0432\u043e",
    })
    .click();
  await page
    .locator(".character-card--stats .stat-field")
    .first()
    .getByRole("button", { name: "Бросок", exact: true })
    .click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3]).toMatchObject({
    characterId: snapshot.characters[0]!.id,
    rollMode: "ADVANTAGE",
  });
});

test("wallet batches rapid mutations and ignores unchanged blur", async ({
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
  // A legacy snapshot may predate the SP wallet field. Rapid deltas must
  // normalize it before the first queued request instead of producing NaN.
  delete (
    playerSnapshot.characters[0]!.wallet as Partial<
      (typeof playerSnapshot.characters)[0]["wallet"]
    >
  ).sp;
  playerSnapshot.members = [playerSnapshot.me];
  const submittedGold: number[] = [];
  const submittedSp: number[] = [];
  const submittedRevisions: number[] = [];
  let rejectNextCounter = false;
  let releaseFirstResponse!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  const renderErrors: Error[] = [];
  page.on("pageerror", (error) => renderErrors.push(error));
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
    submittedSp.push(payload.wallet.sp);
    submittedRevisions.push(payload.revision);
    if (rejectNextCounter) {
      rejectNextCounter = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "COUNTER_WRITE_FAILED" }),
      });
      return;
    }
    if (submittedGold.length === 1) await firstResponseGate;
    playerSnapshot.characters[0]!.wallet = payload.wallet;
    playerSnapshot.characters[0]!.revision += 1;
    const response =
      submittedGold.length === 2
        ? { duplicate: true }
        : submittedGold.length === 1
          ? Object.fromEntries(
              Object.entries(playerSnapshot.characters[0]!).filter(
                ([key]) => key !== "entries",
              ),
            )
          : playerSnapshot.characters[0];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  await page.clock.install({
    time: new Date("2026-08-29T12:00:00.000Z"),
  });
  await page.goto("/");
  await openWorkspaceSection(page, "Персонажи");
  const goldRow = page
    .locator(".character-workspace .inline-fields")
    .filter({ hasText: /^gold/ });
  const input = goldRow.locator('input[type="number"]');

  await input.focus();
  await page.locator(".character-workspace__header h2").click();
  expect(submittedGold).toEqual([]);

  await page.clock.pauseAt(new Date("2026-08-29T12:01:00.000Z"));

  await goldRow.locator("button").last().click();
  await goldRow.locator("button").last().click();
  await goldRow.locator("button").last().click();
  await expect(input).toHaveValue("3");

  // The regression boundary: until the interaction pause ends, not even the
  // first queued PATCH may reach the server.
  await page.clock.runFor(WALLET_ADJUST_DELAY_MS - 1);
  expect(submittedGold).toEqual([]);
  await page.clock.runFor(1);
  await expect.poll(() => submittedGold).toEqual([3]);

  // A second batch remains optimistic while App serializes it behind the
  // deliberately delayed first response.
  await goldRow.locator("button").last().click();
  await goldRow.locator("button").last().click();
  await expect(input).toHaveValue("5");
  await page.clock.runFor(WALLET_ADJUST_DELAY_MS);
  expect(submittedGold).toEqual([3]);

  // An absolute input made while the batches are still queued must be kept as
  // a compensating SET, even when it equals the older rendered snapshot.
  await input.fill("0");
  await page.locator(".character-workspace__header h2").click();
  await expect(input).toHaveValue("0");
  expect(submittedGold).toEqual([3]);
  releaseFirstResponse();
  await expect.poll(() => submittedGold).toEqual([3, 5, 0]);
  expect(submittedRevisions).toEqual([1, 2, 3]);
  await expect(input).toHaveValue("0");

  // An unfinished manual value plus a click is one absolute target, not a
  // retryable delta applied twice after a conflict.
  await input.fill("0");
  await goldRow.locator("button").last().click();
  await expect(input).toHaveValue("1");
  await page.clock.runFor(WALLET_ADJUST_DELAY_MS);
  await expect.poll(() => submittedGold).toEqual([3, 5, 0, 1]);

  // Manual typing absorbs an active optimistic batch without letting the
  // released pending reservation restore the older canonical snapshot.
  await goldRow.locator("button").last().click();
  await expect(input).toHaveValue("2");
  await input.fill("9");
  expect(submittedGold).toEqual([3, 5, 0, 1]);
  await page.locator(".character-workspace__header h2").click();
  await expect.poll(() => submittedGold).toEqual([3, 5, 0, 1, 9]);
  await expect(input).toHaveValue("9");

  // A relative series that returns to its base is a no-op.
  await goldRow.locator("button").last().click();
  await goldRow.locator("button").first().click();
  await expect(input).toHaveValue("9");
  await page.clock.runFor(WALLET_ADJUST_DELAY_MS);
  expect(submittedGold).toEqual([3, 5, 0, 1, 9]);

  const spRow = page
    .locator(".character-workspace .inline-fields")
    .filter({ hasText: /^sp/ });
  const spRequestsBefore = submittedSp.length;
  for (let index = 0; index < 25; index += 1)
    await spRow.locator("button").last().click();
  await page.clock.runFor(WALLET_ADJUST_DELAY_MS - 1);
  expect(submittedSp.slice(spRequestsBefore)).toEqual([]);
  await page.clock.runFor(1);
  await expect.poll(() => submittedSp.at(-1)).toBe(25);
  expect(submittedSp.slice(spRequestsBefore)).toEqual([25]);
  await expect(spRow.locator('input[type="number"]')).toHaveValue("25");

  // A final server refusal restores the latest canonical wallet instead of
  // leaving the optimistic click visible as if it had been accepted.
  rejectNextCounter = true;
  await goldRow.locator("button").last().click();
  await expect(input).toHaveValue("10");
  await page.clock.runFor(WALLET_ADJUST_DELAY_MS);
  await expect.poll(() => submittedGold.at(-1)).toBe(10);
  await expect(input).toHaveValue("9");
  await expect(
    page
      .locator(".character-workspace")
      .getByText(/Не удалось сохранить кошелёк/),
  ).toBeVisible();
  await expect(page.getByText("Интерфейс временно остановлен")).toHaveCount(0);
  expect(renderErrors.filter((error) => error.name === "TypeError")).toEqual(
    [],
  );
});

test("UIX-468 resource counters batch, rebase and roll back conflicts", async ({
  page,
}) => {
  const playerSnapshot = structuredClone(snapshot);
  playerSnapshot.me = {
    id: "f53f4618-2ebc-4cf8-bce7-870097305a6b",
    role: "PLAYER",
    displayName: "Player",
    characterId: playerSnapshot.characters[0]!.id,
  };
  playerSnapshot.members = [playerSnapshot.me];
  const character = playerSnapshot.characters[0]!;
  character.ownerMembershipId = playerSnapshot.me.id;
  character.controllerMembershipIds = [playerSnapshot.me.id];
  character.resources = {
    physicalPower: { current: 8, maximum: 10, recoverable: true },
    magicPower: { current: 2, maximum: 10, recoverable: true },
  };
  character.stats.enduranceRegen = 3;
  character.stats.manaRegen = 4;

  type CounterPayload = {
    resources: (typeof character)["resources"];
    revision: number;
  };
  const counterRequests: Array<CounterPayload & { method: string }> = [];
  const rollRequests: string[] = [];
  let bootstrapRequests = 0;
  let rejectNextSet = false;
  let conflictResponses = 0;
  let releaseFirstResponse!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname === "/api/dice" ||
      (pathname === "/api/chat" && request.method() === "POST")
    ) {
      rollRequests.push(pathname);
    }
  });
  await page.route("**/api/bootstrap", (route) => {
    bootstrapRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    });
  });
  await page.route("**/api/characters/*/counters", async (route) => {
    const payload = route.request().postDataJSON() as CounterPayload;
    counterRequests.push({ ...payload, method: route.request().method() });

    if (counterRequests.length === 1) await firstResponseGate;
    if (rejectNextSet) {
      rejectNextSet = false;
      conflictResponses += 1;
      character.resources = {
        physicalPower: { current: 9, maximum: 10, recoverable: true },
        magicPower: { current: 7, maximum: 10, recoverable: true },
      };
      character.revision = payload.revision + 1;
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "CHARACTER_CONFLICT",
          revision: character.revision,
        }),
      });
    }

    character.resources = structuredClone(payload.resources);
    character.revision = payload.revision + 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(character),
    });
  });

  await page.goto("/");
  const activityPanel = page.locator("#chat-panel-activity");
  const quickRolls = activityPanel.locator('[aria-label="Быстрые броски"]');
  const counters = activityPanel.locator("details.resource-counters");
  await expect(quickRolls).toBeVisible();
  await expect(counters).toBeVisible();
  await expect(quickRolls.locator(".resource-counters")).toHaveCount(0);
  expect(
    await quickRolls.evaluate((element) =>
      element.nextElementSibling?.matches("details.resource-counters"),
    ),
  ).toBe(true);
  await expect(
    quickRolls.getByRole("button", {
      name: "Реген Выносливости",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    quickRolls.getByRole("button", { name: "Реген Маны", exact: true }),
  ).toHaveCount(0);

  const physical = counters
    .locator(".resource-counters__item")
    .filter({ hasText: "Выносливость" });
  const mana = counters
    .locator(".resource-counters__item")
    .filter({ hasText: "Мана" });
  const physicalInput = counters.getByRole("spinbutton", {
    name: "Очки: Выносливость",
  });
  const manaInput = counters.getByRole("spinbutton", { name: "Очки: Мана" });
  const spendPhysical = physical.getByRole("button", {
    name: "Потратить одно очко: Выносливость",
  });

  await spendPhysical.evaluate((button) => {
    for (let index = 0; index < 3; index += 1)
      (button as HTMLButtonElement).click();
  });
  await expect(physicalInput).toHaveValue("5");
  await expect.poll(() => counterRequests.length).toBe(1);
  expect(counterRequests[0]).toMatchObject({
    method: "PATCH",
    revision: 1,
    resources: {
      physicalPower: { current: 5 },
      magicPower: { current: 2 },
    },
  });

  await mana.getByRole("button", { name: "Восстановить 4: Мана" }).click();
  await expect(manaInput).toHaveValue("6");
  expect(counterRequests).toHaveLength(1);
  releaseFirstResponse();

  await expect.poll(() => counterRequests.length).toBe(2);
  expect(counterRequests[1]).toMatchObject({
    method: "PATCH",
    revision: 2,
    resources: {
      physicalPower: { current: 5 },
      magicPower: { current: 6 },
    },
  });
  await expect(physicalInput).toHaveValue("5");
  await expect(manaInput).toHaveValue("6");

  await physicalInput.fill("7");
  await physicalInput.press("Enter");
  const summary = counters.locator("summary");
  await summary.click();
  await expect(counters).not.toHaveAttribute("open", "");
  await expect(counters.getByLabel("Очки ресурсов")).toBeHidden();
  await expect.poll(() => counterRequests.length).toBe(3);
  await page.waitForTimeout(700);
  expect(counterRequests).toHaveLength(3);
  expect(counterRequests[2]).toMatchObject({
    method: "PATCH",
    revision: 3,
    resources: {
      physicalPower: { current: 7 },
      magicPower: { current: 6 },
    },
  });

  await summary.click();
  await expect(counters).toHaveAttribute("open", "");
  await expect(counters.getByLabel("Очки ресурсов")).toBeVisible();

  const bootstrapsBeforeConflict = bootstrapRequests;
  rejectNextSet = true;
  await manaInput.fill("1");
  await manaInput.press("Enter");
  await expect.poll(() => conflictResponses).toBe(1);
  await expect
    .poll(() => bootstrapRequests)
    .toBeGreaterThan(bootstrapsBeforeConflict);
  await expect(physicalInput).toHaveValue("9");
  await expect(manaInput).toHaveValue("7");
  await expect(
    activityPanel
      .getByRole("alert")
      .filter({ hasText: "Ресурсы уже изменены" }),
  ).toBeVisible();
  expect(counterRequests).toHaveLength(4);
  expect(counterRequests[3]).toMatchObject({
    method: "PATCH",
    revision: 4,
    resources: {
      physicalPower: { current: 7 },
      magicPower: { current: 1 },
    },
  });
  expect(rollRequests).toEqual([]);
});

test("structured resources persist and short rest uses the authoritative counter route", async ({
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
    physicalPower: { current: 1, maximum: 10, recoverable: true },
    magicPower: { current: 2, maximum: 8, recoverable: true },
  };
  playerSnapshot.characters[0]!.stats.enduranceRegen = 6;
  playerSnapshot.characters[0]!.stats.manaRegen = 2;
  playerSnapshot.members = [playerSnapshot.me];
  const payloads: Array<{
    resources?: (typeof playerSnapshot.characters)[0]["resources"];
    rest?: string;
    revision: number;
  }> = [];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    }),
  );
  await page.route("**/api/characters/*/counters", async (route) => {
    const payload = route.request().postDataJSON() as (typeof payloads)[number];
    payloads.push(payload);
    if (payload.resources)
      playerSnapshot.characters[0]!.resources = payload.resources;
    if (payload.rest === "SHORT") {
      playerSnapshot.characters[0]!.resources = Object.fromEntries(
        Object.entries(playerSnapshot.characters[0]!.resources).map(
          ([key, resource]) => [
            key,
            {
              ...resource,
              current: Math.min(
                resource.maximum ?? resource.current,
                resource.current +
                  Math.floor(
                    (playerSnapshot.characters[0]!.stats[
                      key === "physicalPower"
                        ? "enduranceRegen"
                        : key === "magicPower"
                          ? "manaRegen"
                          : ""
                    ] ?? 0) / 2,
                  ),
              ),
            },
          ],
        ),
      );
    }
    playerSnapshot.characters[0]!.revision += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot.characters[0]),
    });
  });

  await page.goto("/");
  await openWorkspaceSection(page, "Персонажи");
  const physical = page
    .locator(".character-power-controls .resource-card")
    .filter({ hasText: "Выносливость" });
  await physical.getByLabel("Текущее").fill("3");
  await page.locator(".character-workspace__header h2").click();
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0]?.resources?.physicalPower.current).toBe(3);

  await page.getByPlaceholder("Новый ресурс").fill("stamina");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect.poll(() => payloads.length).toBe(2);
  await expect(
    page
      .locator(".character-resource-editor .resource-card")
      .filter({ hasText: "stamina" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Короткий отдых", exact: true })
    .click();
  await expect.poll(() => payloads.at(-1)?.rest).toBe("SHORT");
  await expect(physical.getByLabel("Текущее")).toHaveValue("6");
});

test("resource conflict replaces the structured draft with canonical bootstrap data", async ({
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
    mana: { current: 2, maximum: 10, recoverable: true },
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
      mana: { current: 8, maximum: 10, recoverable: true },
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
  await openWorkspaceSection(page, "Персонажи");
  const resourceCard = page
    .locator(".character-resource-editor .resource-card")
    .filter({ hasText: "mana" });
  const currentInput = resourceCard.getByLabel("Текущее");
  await currentInput.fill("5");
  await page.locator(".character-workspace__header h2").click();

  await expect.poll(() => requests).toBe(1);
  await expect(currentInput).toHaveValue("8");
  await expect(
    page.getByRole("alert").filter({ hasText: "Ресурсы изменены" }),
  ).toBeVisible();
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
  await openWorkspaceSection(page, "Персонажи");
  const goldRow = page
    .locator(".character-workspace .inline-fields")
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

test("player fog clips partial foreign tokens while controlled tokens remain visible", async ({
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
      name: "Controlled token",
      x: 128,
      y: 128,
    },
    {
      ...snapshot.tokens[0]!,
      id: "55f46186-2ebc-4cf8-bce7-870097305a6b",
      ownerMembershipId: "a53f4618-2ebc-4cf8-bce7-870097305a6b",
      controllerMembershipIds: ["a53f4618-2ebc-4cf8-bce7-870097305a6b"],
      name: "Partially revealed foreign token",
      x: 256,
      y: 128,
    },
    {
      ...snapshot.tokens[0]!,
      id: "65f46186-2ebc-4cf8-bce7-870097305a6b",
      ownerMembershipId: "a53f4618-2ebc-4cf8-bce7-870097305a6b",
      controllerMembershipIds: ["a53f4618-2ebc-4cf8-bce7-870097305a6b"],
      name: "Covered foreign token",
      x: 384,
      y: 128,
    },
  ];
  playerSnapshot.fogReveals = [
    {
      ...snapshot.fogReveals[0]!,
      id: "75f46186-2ebc-4cf8-bce7-870097305a6b",
      x: 256,
      y: 128,
      width: 32,
      height: 64,
    },
    {
      ...snapshot.fogReveals[0]!,
      id: "85f46186-2ebc-4cf8-bce7-870097305a6b",
      x: 640,
      y: 128,
      width: 32,
      height: 64,
    },
  ];
  let servedSnapshot = playerSnapshot;

  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(servedSnapshot),
    }),
  );
  await page.goto("/");

  const map = page.locator(".map-viewport");
  const mapBox = await map.boundingBox();
  expect(mapBox).not.toBeNull();
  const captureRegion = (x: number, width: number) =>
    page.screenshot({
      animations: "disabled",
      clip: { x: mapBox!.x + x, y: mapBox!.y + 128, width, height: 64 },
    });
  const controlledCell = await captureRegion(128, 64);
  const revealedHalf = await captureRegion(256, 32);
  const coveredHalf = await captureRegion(288, 32);
  const coveredCell = await captureRegion(384, 64);
  // The probes retain the same grid phase and fog state as the corresponding
  // token halves. The revealed half must differ from empty revealed map, while
  // the covered half must be pixel-identical to empty opaque fog. Together
  // these comparisons prove that the partial token is rendered below fog.
  const emptyRevealedHalf = await captureRegion(640, 32);
  const emptyLeftPhase = await captureRegion(512, 32);
  const emptyRightPhase = await captureRegion(544, 32);
  const emptyCell = await captureRegion(512, 64);
  expect(emptyRevealedHalf.equals(emptyLeftPhase)).toBe(false);
  expect(revealedHalf.equals(emptyRevealedHalf)).toBe(false);
  expect(coveredHalf.equals(emptyRightPhase)).toBe(true);
  expect(controlledCell.equals(emptyCell)).toBe(false);
  expect(coveredCell.equals(emptyCell)).toBe(true);

  await map.getByRole("button", { name: "Объекты карты" }).click();
  const objectList = page.getByRole("region", { name: "Объекты карты" });
  await expect(
    objectList.getByRole("button", { name: "Controlled token", exact: true }),
  ).toBeVisible();
  await expect(
    objectList.getByRole("button", {
      name: "Covered foreign token",
      exact: true,
    }),
  ).toHaveCount(0);

  // GM visibility stays unchanged: a token hidden from the player remains
  // visible to the GM. Reuse the same fixture to isolate the role boundary.
  servedSnapshot = {
    ...playerSnapshot,
    me: snapshot.me,
    members: [snapshot.me],
  };
  await page.reload();
  const gmMap = page.locator(".map-viewport");
  const gmMapBox = await gmMap.boundingBox();
  expect(gmMapBox).not.toBeNull();
  const gmCoveredCell = await page.screenshot({
    animations: "disabled",
    clip: {
      x: gmMapBox!.x + 384,
      y: gmMapBox!.y + 128,
      width: 64,
      height: 64,
    },
  });
  const gmEmptyCell = await page.screenshot({
    animations: "disabled",
    clip: {
      x: gmMapBox!.x + 512,
      y: gmMapBox!.y + 128,
      width: 64,
      height: 64,
    },
  });
  expect(gmCoveredCell.equals(gmEmptyCell)).toBe(false);
});

test("map keyboard command core is scoped, observable, and accessible", async ({
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

  const map = page.getByRole("region", {
    name: "\u0418\u043d\u0442\u0435\u0440\u0430\u043a\u0442\u0438\u0432\u043d\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u0441\u0446\u0435\u043d\u044b",
  });
  await expect(map).toHaveAttribute("tabindex", "0");
  await expect(map).toHaveAttribute("aria-keyshortcuts", /V D R P G Shift\+G/);
  await map.focus();
  await expect(map).toBeFocused();

  const canvas = map.locator("canvas").first();
  const beforePan = await canvas.screenshot();
  await page.keyboard.press("ArrowRight");
  const afterPan = await canvas.screenshot();
  expect(afterPan.equals(beforePan)).toBe(false);

  const scale = map.getByRole("slider", {
    name: "\u041c\u0430\u0441\u0448\u0442\u0430\u0431 \u043a\u0430\u0440\u0442\u044b",
  });
  await map.focus();
  await page.keyboard.press("f");
  const fittedScale = await scale.inputValue();
  await map.focus();
  await page.keyboard.press("+");
  await expect(scale).not.toHaveValue(fittedScale);
  await map.focus();
  await page.keyboard.press("0");
  await expect(scale).toHaveValue(fittedScale);
  await map.focus();
  await page.keyboard.press("+");
  await map.focus();
  await page.keyboard.press("f");
  await expect(scale).toHaveValue(fittedScale);

  await map.focus();
  await page.keyboard.press("d");
  await expect(
    page.getByRole("button", {
      name: "\u0420\u0438\u0441\u043e\u0432\u0430\u043d\u0438\u0435",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await map.focus();
  await page.keyboard.press("g");
  await expect(
    page.getByRole("button", {
      name: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0442\u0443\u043c\u0430\u043d",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await map.focus();
  await page.keyboard.press("Shift+g");
  await expect(
    page.getByRole("button", {
      name: "\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u0442\u0443\u043c\u0430\u043d",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");

  // A child input keeps native keyboard behaviour; the map command handler
  // deliberately accepts commands only when the map root itself is targeted.
  await scale.focus();
  const inputScale = Number(await scale.inputValue());
  await page.keyboard.press("ArrowRight");
  // Native range direction differs between browser engines/themes; what
  // matters here is that the child control changes instead of the map handler
  // consuming the key.
  expect(Number(await scale.inputValue())).not.toBe(inputScale);
});

test("player fog shortcut is permission-gated", async ({ page }) => {
  const playerSnapshot = structuredClone(snapshot);
  playerSnapshot.me = { ...playerSnapshot.me, role: "PLAYER" };
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(playerSnapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/");
  const map = page.getByRole("region", {
    name: "\u0418\u043d\u0442\u0435\u0440\u0430\u043a\u0442\u0438\u0432\u043d\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u0441\u0446\u0435\u043d\u044b",
  });
  await expect(
    page.getByRole("button", {
      name: "\u041f\u0435\u0440\u0435\u043c\u0435\u0449\u0435\u043d\u0438\u0435",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await map.focus();
  await page.keyboard.press("g");
  await expect(
    page.getByRole("button", {
      name: "\u041f\u0435\u0440\u0435\u043c\u0435\u0449\u0435\u043d\u0438\u0435",
    }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("map object list preserves Escape priority and Delete cancellation", async ({
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

  const map = page.getByRole("region", {
    name: "\u0418\u043d\u0442\u0435\u0440\u0430\u043a\u0442\u0438\u0432\u043d\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u0441\u0446\u0435\u043d\u044b",
  });
  await map.focus();
  await page.keyboard.press("o");

  const objects = page.getByRole("region", {
    name: "\u041e\u0431\u044a\u0435\u043a\u0442\u044b \u043a\u0430\u0440\u0442\u044b",
  });
  await expect(objects).toBeVisible();
  const token = objects.getByRole("button", {
    name: "\u041a\u0430\u0440\u0442\u043e\u0433\u0440\u0430\u0444",
    exact: true,
  });
  await token.click();
  await expect(token).toHaveAttribute("aria-pressed", "true");

  // Keyboard map commands are intentionally scoped to the map region. Once
  // focus returns there, the first Escape closes the popover without clearing
  // the selected object.
  await map.focus();
  await page.keyboard.press("Escape");
  await expect(objects).toBeHidden();
  const objectListTrigger = page.getByRole("button", {
    name: "\u041e\u0431\u044a\u0435\u043a\u0442\u044b \u043a\u0430\u0440\u0442\u044b",
  });
  await objectListTrigger.click();
  await expect(objects).toBeVisible();
  await expect(
    objects.getByRole("button", {
      name: "\u041a\u0430\u0440\u0442\u043e\u0433\u0440\u0430\u0444",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  // Clicking the trigger leaves focus on the trigger itself. Escape must still
  // close only the popover instead of being swallowed by the map target guard.
  await page.keyboard.press("Escape");
  await expect(objects).toBeHidden();
  await expect(objectListTrigger).toBeFocused();

  await map.focus();
  await page.keyboard.press("Delete");
  const confirm = page.getByRole("dialog", {
    name: "\u0423\u0431\u0440\u0430\u0442\u044c \u0442\u043e\u043a\u0435\u043d \u0441 \u043a\u0430\u0440\u0442\u044b?",
  });
  await expect(confirm).toBeVisible();
  await confirm
    .getByRole("button", { name: "\u041e\u0442\u043c\u0435\u043d\u0430" })
    .click();
  await expect(confirm).toBeHidden();

  await map.focus();
  await page.keyboard.press("o");
  await expect(
    objects.getByRole("button", {
      name: "\u041a\u0430\u0440\u0442\u043e\u0433\u0440\u0430\u0444",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    objects.getByRole("button", {
      name: "\u041a\u0430\u0440\u0442\u043e\u0433\u0440\u0430\u0444",
      exact: true,
    }),
  ).toHaveCount(1);
});

test("selected token keyboard moves serialize delayed responses with ack revisions", async ({
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
      body: JSON.stringify({ enabled: true }),
    }),
  );
  const requests: Array<{
    deltaX: number;
    deltaY: number;
    targets: Array<{ targetId: string; revision: number }>;
  }> = [];
  /*
   * Первый ответ держится до явного сигнала теста, а не таймером.
   *
   * Раньше здесь стоял `setTimeout(150)`, и тест молча полагался на то, что
   * три нажатия успеют пройти внутри этого окна. В Firefox под нагрузкой они
   * не успевали: первый запрос завершался раньше, накопление не происходило, и
   * вместо двух запросов приходило три. Тест флакал именно так, дважды.
   *
   * Окно ожидания нельзя расширить «на всякий случай» — это вернуло бы ту же
   * гонку, только реже. Поэтому ответ висит ровно до того момента, когда
   * остальные нажатия уже сделаны.
   */
  let releaseFirstResponse = () => {};
  const firstResponseHeld = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  await page.route("**/api/canvas/bulk", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (requests.length === 1) await firstResponseHeld;
    const revision = body.targets[0].revision + 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        revisions: {
          tokens: { [body.targets[0].targetId]: revision },
          drawings: {},
        },
      }),
    });
  });
  await page.goto("/");
  const map = page.getByRole("region", {
    name: "\u0418\u043d\u0442\u0435\u0440\u0430\u043a\u0442\u0438\u0432\u043d\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u0441\u0446\u0435\u043d\u044b",
  });
  await map.focus();
  await page.keyboard.press("o");
  const objects = page.getByRole("region", {
    name: "\u041e\u0431\u044a\u0435\u043a\u0442\u044b \u043a\u0430\u0440\u0442\u044b",
  });
  await objects
    .getByRole("button", {
      name: "\u041a\u0430\u0440\u0442\u043e\u0433\u0440\u0430\u0444",
      exact: true,
    })
    .first()
    .click();
  await map.focus();
  await page.keyboard.press("o");
  await expect(objects).toBeHidden();
  await map.focus();
  await page.keyboard.press("ArrowRight");
  // Первое перемещение обязано уйти на сервер до остальных нажатий: именно оно
  // и остаётся в полёте, пока копятся следующие.
  await expect.poll(() => requests.length).toBe(1);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  releaseFirstResponse();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]!.targets[0]!.revision).toBe(
    requests[0]!.targets[0]!.revision + 1,
  );
  expect(requests[1]!.deltaX).toBeGreaterThan(0);
  expect(requests[1]!.deltaY).toBeGreaterThan(requests[1]!.deltaX);
});

test("UIX-498 GM exposes Activity and Story with keyboard tab semantics", async ({
  page,
}) => {
  const fixture = structuredClone(snapshot);
  fixture.messages.push(
    {
      ...fixture.messages[0]!,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sequence: 2,
      threadId: fixture.chatThreads[1]!.id,
      stream: "STORY",
      kind: "TEXT",
      body: "STORY_ONLY_MARKER",
    },
    {
      ...fixture.messages[0]!,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sequence: 3,
      threadId: fixture.chatThreads[2]!.id,
      stream: "ROLLS",
      kind: "DICE",
      body: "ROLLS_ONLY_MARKER",
      dice: {
        formula: "1d20",
        resolvedFormula: "1d20",
        terms: [{ notation: "1d20", rolls: [12], subtotal: 12 }],
        modifiers: [],
        total: 12,
      },
    },
  );
  fixture.chatThreadStates[1] = {
    ...fixture.chatThreadStates[1]!,
    latestSequence: 2,
  };
  fixture.chatThreadStates[2] = {
    ...fixture.chatThreadStates[2]!,
    latestSequence: 3,
  };
  const storyDrafts: Array<Record<string, unknown>> = [];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/story/posts**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: [], nextCursor: null }),
      });
      return;
    }
    storyDrafts.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/api/chat/read", async (route) => {
    const request = route.request().postDataJSON() as {
      threadId: string;
      sequence: number;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        campaignId: fixture.campaign.id,
        threadId: request.threadId,
        lastReadSequence: request.sequence,
        updatedAt: new Date().toISOString(),
      }),
    });
  });
  await page.goto("/");
  const tablist = page.getByRole("tablist", { name: "Потоки чата" });
  const activity = page.locator("#chat-tab-activity");
  const story = page.locator("#chat-tab-story");
  await expect(tablist.getByRole("tab")).toHaveCount(2);
  await expect(page.locator("#chat-tab-table")).toHaveCount(0);
  await expect(page.locator("#chat-tab-rolls")).toHaveCount(0);
  await expect(page.locator("#chat-tab-direct")).toHaveCount(0);
  await expect(activity).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("STORY_ONLY_MARKER")).toBeVisible();
  await expect(page.getByText("ROLLS_ONLY_MARKER")).toBeVisible();
  await activity.press("ArrowRight");
  await expect(story).toBeFocused();
  await expect(story).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("STORY_ONLY_MARKER")).toBeVisible();
  await expect(page.getByText("ROLLS_ONLY_MARKER")).toHaveCount(0);
  const composer = page.getByRole("textbox", {
    name: "\u041d\u043e\u0432\u0430\u044f \u043f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u044f",
  });
  await composer.fill("NEW_STORY_POST");
  await composer.press("Enter");
  await expect.poll(() => storyDrafts.length).toBe(1);
  expect(storyDrafts[0]).toMatchObject({
    body: "NEW_STORY_POST",
    title: "",
    media: [],
    entityLinks: [],
    gmNotes: "",
  });
  await story.press("Home");
  await expect(activity).toBeFocused();
  await expect(activity).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("STORY_ONLY_MARKER")).toBeVisible();
  await expect(page.getByText("ROLLS_ONLY_MARKER")).toBeVisible();
  await activity.press("ArrowLeft");
  await expect(story).toBeFocused();
});

test("UIX-498 PLAYER keeps Story and ROLLS in Activity without private tabs", async ({
  page,
}) => {
  const fixture = structuredClone(snapshot);
  fixture.me = {
    id: "44444444-4444-4444-8444-444444444444",
    role: "PLAYER",
    displayName: "Player",
    characterId: null,
  };
  fixture.members.push(fixture.me);
  fixture.messages.push({
    ...fixture.messages[0]!,
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sequence: 2,
    threadId: fixture.chatThreads[1]!.id,
    stream: "STORY",
    kind: "TEXT",
    body: "PLAYER_STORY_MARKER",
  });
  fixture.messages.push({
    ...fixture.messages[0]!,
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    sequence: 3,
    threadId: fixture.chatThreads[2]!.id,
    stream: "ROLLS",
    kind: "DICE",
    body: "PLAYER_ROLL_MARKER",
    dice: {
      formula: "1d20",
      resolvedFormula: "1d20",
      terms: [{ notation: "1d20", rolls: [10], subtotal: 10 }],
      modifiers: [],
      total: 10,
    },
  });
  fixture.chatThreadStates[1] = {
    ...fixture.chatThreadStates[1]!,
    latestSequence: 2,
  };
  fixture.chatThreadStates[2] = {
    ...fixture.chatThreadStates[2]!,
    latestSequence: 3,
  };
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.route("**/api/story/posts**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ posts: [], nextCursor: null }),
    }),
  );
  await page.route("**/api/chat/read", async (route) => {
    const request = route.request().postDataJSON() as {
      threadId: string;
      sequence: number;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        campaignId: fixture.campaign.id,
        threadId: request.threadId,
        lastReadSequence: request.sequence,
        updatedAt: new Date().toISOString(),
      }),
    });
  });
  await page.goto("/");
  const activity = page.locator("#chat-tab-activity");
  await expect(
    page.getByRole("tablist", { name: "Потоки чата" }).getByRole("tab"),
  ).toHaveCount(1);
  await expect(activity).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#chat-tab-story")).toHaveCount(0);
  await expect(page.locator("#chat-tab-direct")).toHaveCount(0);
  await expect(page.getByText("PLAYER_STORY_MARKER")).toBeVisible();
  await expect(page.getByText("PLAYER_ROLL_MARKER")).toBeVisible();
  await expect(page.locator(".story-composer")).toHaveCount(0);
  await expect(page.locator(".chat-compose textarea")).toBeVisible();
  await activity.press("ArrowRight");
  await expect(activity).toBeFocused();
  await expect(activity).toHaveAttribute("aria-selected", "true");
  await openWorkspaceSection(page, "Мои заявки");
  await expect(page.getByRole("dialog", { name: "Мои заявки" })).toBeVisible();
});

test("UIX-274 activity read state reconciles and stays read after reload", async ({
  page,
}) => {
  const fixture = structuredClone(snapshot);
  const storyThread = fixture.chatThreads[1]!;
  fixture.messages.push({
    ...fixture.messages[0]!,
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    sequence: 4,
    membershipId: "55555555-5555-4555-8555-555555555555",
    threadId: storyThread.id,
    stream: "STORY",
    kind: "TEXT",
    body: "UNREAD_STORY_MARKER",
  });
  fixture.chatThreadStates[1] = {
    threadId: storyThread.id,
    stream: "STORY",
    lastReadSequence: 0,
    latestSequence: 4,
    unreadCount: 1,
  };
  let storyRead = false;
  const reads: Array<{ threadId: string; sequence: number }> = [];
  await page.route("**/api/bootstrap", (route) => {
    const response = structuredClone(fixture);
    if (storyRead)
      response.chatThreadStates[1] = {
        ...response.chatThreadStates[1]!,
        lastReadSequence: 4,
        unreadCount: 0,
      };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/chat/read", async (route) => {
    const request = route.request().postDataJSON() as {
      threadId: string;
      sequence: number;
    };
    reads.push(request);
    if (request.threadId === storyThread.id) storyRead = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        campaignId: fixture.campaign.id,
        threadId: request.threadId,
        lastReadSequence: request.sequence,
        updatedAt: new Date().toISOString(),
      }),
    });
  });
  await page.route("**/api/story/posts**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ posts: [], nextCursor: null }),
    }),
  );
  await page.goto("/");
  const story = page.locator("#chat-tab-story");
  await expect(page.getByText("UNREAD_STORY_MARKER")).toBeVisible();
  await expect
    .poll(() =>
      reads.some(
        (request) =>
          request.threadId === storyThread.id && request.sequence === 4,
      ),
    )
    .toBe(true);
  await expect(story.locator(".chat-unread-badge")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#chat-tab-story .chat-unread-badge")).toHaveCount(
    0,
  );
});

test("UIX-267 direct chat stays private across sender and recipient reloads", async ({
  page,
}) => {
  test.fixme(
    true,
    "UIX-365: личные сообщения скрыты до отдельного редизайна механики",
  );
  const sender = {
    id: "44444444-4444-4444-8444-444444444444",
    role: "PLAYER" as const,
    displayName: "Direct Sender",
    characterId: null,
  };
  const recipient = {
    id: "55555555-5555-4555-8555-555555555555",
    role: "PLAYER" as const,
    displayName: "Direct Recipient",
    characterId: null,
  };
  const playerC = {
    id: "66666666-6666-4666-8666-666666666666",
    role: "PLAYER" as const,
    displayName: "Player C",
    characterId: null,
  };
  const otherGm = {
    id: "77777777-7777-4777-8777-777777777777",
    role: "GM" as const,
    displayName: "Other GM",
    characterId: null,
  };
  const threadId = "88888888-8888-4888-8888-888888888888";
  const direct = {
    id: threadId,
    campaignId: snapshot.campaign.id,
    type: "DIRECT" as const,
    stream: null,
    participants: [
      { membershipId: sender.id, displayName: sender.displayName },
      { membershipId: recipient.id, displayName: recipient.displayName },
    ] as [
      { membershipId: string; displayName: string },
      { membershipId: string; displayName: string },
    ],
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
  };
  let viewer: "sender" | "recipient" | "player-c" | "gm" = "sender";
  let saved = false;
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/bootstrap", (route) => {
    const fixture = structuredClone(snapshot);
    fixture.members = [sender, recipient, playerC, otherGm];
    fixture.me =
      viewer === "sender"
        ? sender
        : viewer === "recipient"
          ? recipient
          : viewer === "player-c"
            ? playerC
            : otherGm;
    fixture.directChatContacts = [sender, recipient, playerC, otherGm]
      .filter((member) => member.id !== fixture.me.id)
      .map((member) => ({
        membershipId: member.id,
        displayName: member.displayName,
      }));
    if (viewer === "sender" || viewer === "recipient") {
      fixture.chatThreads.push(direct);
      fixture.chatThreadStates.push({
        threadId,
        stream: null,
        lastReadSequence: 0,
        latestSequence: saved ? 2 : 0,
        unreadCount: viewer === "recipient" && saved ? 1 : 0,
      });
      if (saved)
        fixture.messages.push({
          ...fixture.messages[0]!,
          id: "99999999-9999-4999-8999-999999999999",
          sequence: 2,
          membershipId: sender.id,
          displayName: sender.displayName,
          body: "UIX267_PRIVATE_MARKER",
          kind: "TEXT",
          threadId,
          stream: null,
        });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    });
  });
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/chat/direct", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      participantMembershipId: recipient.id,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(direct),
    });
  });
  await page.route("**/api/chat/direct/messages", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    saved = true;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/api/chat/read", async (route) => {
    const input = route.request().postDataJSON() as {
      threadId: string;
      sequence: number;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        campaignId: snapshot.campaign.id,
        threadId: input.threadId,
        lastReadSequence: input.sequence,
        updatedAt: new Date().toISOString(),
      }),
    });
  });

  await page.goto("/");
  const directTab = page.locator("#chat-tab-direct");
  await directTab.click();
  const peerSelect = page.locator(".direct-peer-select");
  await expect(peerSelect.locator("option")).toHaveCount(4);
  await expect(peerSelect).not.toContainText(sender.id);
  await peerSelect.selectOption(recipient.id);
  await expect(peerSelect).toHaveValue(recipient.id);
  await page.locator(".direct-compose textarea").fill("UIX267_PRIVATE_MARKER");
  await page.locator(".direct-compose button.primary").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    threadId,
    body: "UIX267_PRIVATE_MARKER",
    attachmentContentIds: [],
  });
  expect(requests[0]).not.toHaveProperty("stream");
  expect(requests[0]).not.toHaveProperty("visibility");

  await page.reload();
  await page.locator("#chat-tab-direct").click();
  await expect(page.locator(".direct-peer-select")).toHaveValue(recipient.id);
  await expect(page.getByText("UIX267_PRIVATE_MARKER")).toBeVisible();

  viewer = "recipient";
  await page.reload();
  await page.locator("#chat-tab-activity").click();
  await expect(page.getByText("UIX267_PRIVATE_MARKER")).toHaveCount(0);
  await page.locator("#chat-tab-direct").click();
  await page.locator(".direct-peer-select").selectOption(sender.id);
  await expect(page.getByText("UIX267_PRIVATE_MARKER")).toBeVisible();

  for (const next of ["player-c", "gm"] as const) {
    viewer = next;
    await page.reload();
    await page.locator("#chat-tab-direct").click();
    await expect(page.getByText("UIX267_PRIVATE_MARKER")).toHaveCount(0);
    await expect(page.locator(".direct-peer-select")).toHaveValue("");
  }
});

test("UIX-268 catalog picker routes authorized stickers and respects stream roles", async ({
  page,
}) => {
  const fixture = structuredClone(snapshot);
  const recipient = {
    id: "55555555-5555-4555-8555-555555555555",
    role: "PLAYER" as const,
    displayName: "Sticker Recipient",
    characterId: null,
  };
  const directId = "88888888-8888-4888-8888-888888888888";
  fixture.members.push(recipient);
  fixture.chatThreads.push({
    id: directId,
    campaignId: fixture.campaign.id,
    type: "DIRECT",
    stream: null,
    participants: [
      { membershipId: fixture.me.id, displayName: fixture.me.displayName },
      { membershipId: recipient.id, displayName: recipient.displayName },
    ],
    createdAt: "2026-07-22T08:00:00.000Z",
    updatedAt: "2026-07-22T08:00:00.000Z",
  });
  fixture.chatThreadStates.push({
    threadId: directId,
    stream: null,
    lastReadSequence: 0,
    latestSequence: 0,
    unreadCount: 0,
  });
  const pack = (
    id: string,
    subject: "COMMON" | "CHARACTER" | "PLAYER" | "NPC" | "CREATURE",
    label: string,
    names: string[],
  ) => ({
    id,
    name: label + " pack",
    subject,
    subjectCharacterId:
      subject === "CHARACTER" ? fixture.characters[0]!.id : null,
    subjectMembershipId: subject === "PLAYER" ? recipient.id : null,
    subjectLabel: label,
    lifecycle: "ACTIVE" as const,
    canSend: true,
    stickers: names.map((name, index) => ({
      id: id.slice(0, -1) + (index + 1),
      packId: id,
      name,
      altText: label + " " + name,
      url: "/api/stickers/" + id.slice(0, -1) + (index + 1) + "/content",
      width: 128,
      height: 128,
      attribution: { authorCredit: null, licenseNote: null },
    })),
  });
  const packs = [
    pack("10000000-0000-4000-8000-000000000000", "COMMON", "Common", ["Wave"]),
    pack("20000000-0000-4000-8000-000000000000", "CHARACTER", "Cartographer", [
      "Compass",
    ]),
    pack("30000000-0000-4000-8000-000000000000", "PLAYER", "Assigned hero", [
      "Cheer",
      "Rest",
    ]),
    pack("40000000-0000-4000-8000-000000000000", "NPC", "GM NPC", ["Warning"]),
    pack("50000000-0000-4000-8000-000000000000", "CREATURE", "GM Creature", [
      "Roar",
    ]),
  ];
  let catalog = packs;
  let playerStory = false;
  const sent: Array<Record<string, unknown>> = [];
  await page.route("**/api/bootstrap", (route) => {
    const next = structuredClone(fixture);
    if (playerStory) {
      next.me = {
        id: "44444444-4444-4444-8444-444444444444",
        role: "PLAYER",
        displayName: "Player",
        characterId: null,
      };
      next.members.push(next.me);
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(next),
    });
  });
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/stickers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(catalog),
    }),
  );
  await page.route("**/api/stickers/*/content", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
    }),
  );
  await page.route("**/api/chat/stickers", async (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(input);
    const isDirect = typeof input.threadId === "string";
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ...fixture.messages[0]!,
        id:
          sent.length === 1
            ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"
            : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
        sequence: sent.length + 3,
        // Sticker presentation is an optional TEXT-message projection; there
        // is no STICKER value in the persisted ChatMessageDto kind enum.
        kind: "TEXT",
        body: "",
        threadId: isDirect ? directId : fixture.chatThreads[0]!.id,
        stream: isDirect ? null : "TABLE",
        stickerId: input.stickerId,
        stickerPresentation: {
          name: "Wave",
          altText: "Common Wave",
          assetUrl: "catalog-asset",
          width: 128,
          height: 128,
        },
      }),
    });
  });

  await page.goto("/");
  await page.locator("#chat-tab-activity").click();
  const picker = page.locator(".chat-compose .sticker-picker");
  await picker.locator(":scope > button").click();
  const panel = picker.locator(".sticker-picker-panel");
  await expect(panel.getByRole("tab")).toHaveCount(5);
  await panel.getByRole("tab").nth(2).click();
  await panel.getByRole("searchbox").fill("assigned");
  const cheer = panel.getByRole("option", { name: "Assigned hero Cheer" });
  const rest = panel.getByRole("option", { name: "Assigned hero Rest" });
  await cheer.focus();
  await cheer.press("ArrowRight");
  await expect(rest).toBeFocused();
  await panel.getByRole("searchbox").fill("");
  await panel.getByRole("tab").first().click();
  await panel.getByRole("option", { name: "Common Wave" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    stream: "TABLE",
    stickerId: "10000000-0000-4000-8000-000000000001",
  });

  await expect(page.locator(".chat-compose .sticker-picker")).toBeVisible();
  await page.locator("#chat-tab-story").click();
  await expect(page.locator(".story-channel .sticker-picker")).toHaveCount(0);
  await expect(page.locator("#chat-tab-direct")).toHaveCount(0);

  playerStory = true;
  await page.reload();
  await expect(page.locator("#chat-tab-story")).toHaveCount(0);
  await expect(page.locator("#chat-tab-direct")).toHaveCount(0);
  await expect(page.locator(".story-channel .sticker-picker")).toHaveCount(0);

  catalog = [];
  playerStory = false;
  await page.reload();
  await page.locator("#chat-tab-activity").click();
  await page.locator(".chat-compose .sticker-picker > button").click();
  await expect(page.locator(".sticker-picker-panel .chat-empty")).toBeVisible();
});

test("UIX-268 reload render and tombstone are safe at narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = structuredClone(snapshot);
  const stickerId = "60000000-0000-4000-8000-000000000001";
  fixture.messages.push(
    {
      ...fixture.messages[0]!,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      sequence: 2,
      kind: "TEXT",
      body: "",
      stickerId,
      stickerPresentation: {
        name: "Reloaded wave",
        altText: "Cartographer waves hello",
        assetUrl: "internal-only-asset-reference",
        width: 192,
        height: 128,
      },
    },
    {
      ...fixture.messages[0]!,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      sequence: 3,
      kind: "TEXT",
      body: "",
      stickerId: null,
      stickerPresentation: {
        name: "Removed sticker",
        altText: "Removed sticker alt",
        assetUrl: "must-not-leak",
        width: 128,
        height: 128,
      },
    },
  );
  fixture.chatThreadStates[0] = {
    ...fixture.chatThreadStates[0]!,
    latestSequence: 3,
  };
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/stickers/**/content", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
    }),
  );

  await page.goto("/");
  const rendered = page.getByRole("img", { name: "Cartographer waves hello" });
  await expect(rendered).toHaveAttribute(
    "src",
    "/api/stickers/" + stickerId + "/content",
  );
  await expect(page.getByText("Reloaded wave")).toBeVisible();
  await expect(page.locator(".chat-sticker-tombstone")).toHaveCount(1);
  await expect(page.locator(".chat-sticker-tombstone img")).toHaveCount(0);
  await expect(page.locator('img[src*="must-not-leak"]')).toHaveCount(0);
  await expect(page.locator(".chat-sticker")).toHaveCount(1);
  const box = await page.locator(".chat-sticker").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);
  await page.reload();
  await expect(
    page.getByRole("img", { name: "Cartographer waves hello" }),
  ).toHaveAttribute("src", "/api/stickers/" + stickerId + "/content");
});

test("GM can move tokens, pan the map, choose drawing color, and republish the active scene", async ({
  page,
}) => {
  let publishRequests = 0;
  let socketConnected = false;
  let movedToken: { tokenId: string; x: number; y: number } | null = null;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      const packet = message.toString();
      if (packet === "40") {
        socketConnected = true;
        socket.send('40{"sid":"concept-test-socket"}');
        return;
      }
      if (!packet.startsWith("42")) return;
      const payloadStart = packet.indexOf("[");
      if (payloadStart < 0) return;
      const payload = JSON.parse(packet.slice(payloadStart)) as [
        string,
        Record<string, unknown>,
      ];
      if (payload[0] === "token:moved")
        movedToken = {
          tokenId: String(payload[1].tokenId),
          x: Number(payload[1].x),
          y: Number(payload[1].y),
        };
      const acknowledgementId = packet.slice(2, payloadStart);
      if (acknowledgementId) socket.send(`43${acknowledgementId}[{"ok":true}]`);
    });
    socket.send(
      '0{"sid":"concept-test-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
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
  await page.route("**/api/scenes/activate", async (route) => {
    publishRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("/");

  const viewport = page.locator(".map-viewport");
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  const canvasState = () =>
    viewport
      .locator("canvas")
      .evaluateAll((canvases) =>
        (canvases as HTMLCanvasElement[])
          .map((canvas) => canvas.toDataURL())
          .join("|"),
      );

  await expect.poll(() => socketConnected).toBe(true);
  await page.mouse.move(bounds!.x + 416, bounds!.y + 352);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(bounds!.x + 480, bounds!.y + 416, { steps: 5 });
  await page.mouse.up({ button: "left" });
  await expect
    .poll(() => movedToken)
    .toMatchObject({
      tokenId: snapshot.tokens[0]!.id,
      x: 448,
      y: 384,
    });

  const beforeRightPan = await canvasState();
  await page.mouse.move(bounds!.x + 240, bounds!.y + 180);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(bounds!.x + 300, bounds!.y + 220, { steps: 4 });
  await page.mouse.up({ button: "right" });
  await expect.poll(canvasState).not.toBe(beforeRightPan);
  await expect(page.locator(".token-menu")).toHaveCount(0);

  await page.mouse.move(bounds!.x + 120, bounds!.y + 120);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(bounds!.x + bounds!.width + 24, bounds!.y + 120, {
    steps: 4,
  });
  await page.mouse.up({ button: "right" });
  const afterOutsideRelease = await canvasState();
  await page.mouse.move(bounds!.x + 160, bounds!.y + 160, { steps: 3 });
  await expect.poll(canvasState).toBe(afterOutsideRelease);

  const beforeTouchpadPan = await canvasState();
  await page.locator(".konvajs-content").dispatchEvent("wheel", {
    deltaX: 32,
    deltaY: 18,
    ctrlKey: false,
  });
  await expect.poll(canvasState).not.toBe(beforeTouchpadPan);

  await page.locator('.map-tool[data-tool="DRAW"]').click();
  const colorPanel = page.locator(".drawing-color-panel");
  await expect(colorPanel).toBeVisible();
  const panelBox = await colorPanel.boundingBox();
  const viewportBox = await viewport.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(viewportBox).not.toBeNull();
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(
    viewportBox!.x + viewportBox!.width,
  );
  expect(panelBox!.y).toBeLessThan(viewportBox!.y + viewportBox!.height / 2);

  const publish = page.locator(".publish-scene");
  await expect(publish).toBeEnabled();
  await expect(publish).toHaveAttribute("aria-pressed", "true");
  await publish.click();
  await expect.poll(() => publishRequests).toBe(1);
});

test("sidebar collapse persists and hidden-chat rolls surface their authoritative total", async ({
  page,
}) => {
  let gameSocket: { send(message: string): void } | null = null;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    gameSocket = socket;
    socket.onMessage((message) => {
      if (message.toString() === "40")
        socket.send('40{"sid":"sidebar-test-socket"}');
    });
    socket.send(
      '0{"sid":"sidebar-test-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.goto("/");

  const map = page.locator(".map-shell");
  const expandedWidth = (await map.boundingBox())!.width;
  await page.locator(".sidebar-collapse-button").click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".sidebar-restore-button")).toBeVisible();
  await expect
    .poll(async () => (await map.boundingBox())!.width)
    .toBeGreaterThan(expandedWidth);
  await expect
    .poll(() =>
      page.evaluate(
        ([campaignId, membershipId]) =>
          localStorage.getItem(
            `arken.sidebarCollapsed:${campaignId}:${membershipId}`,
          ),
        [snapshot.campaign.id, snapshot.me.id],
      ),
    )
    .toBe("true");

  gameSocket = null;
  await page.reload();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect.poll(() => gameSocket !== null).toBe(true);
  const rollId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  gameSocket!.send(
    `42["chat:created",${JSON.stringify({
      sequence: 21,
      actionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      emittedAt: "2026-07-29T02:00:00.000Z",
      data: {
        id: rollId,
        sequence: 21,
        membershipId: snapshot.me.id,
        displayName: snapshot.me.displayName,
        characterId: null,
        body: "1d20 + 4",
        visibility: "PUBLIC",
        kind: "DICE",
        threadId: snapshot.chatThreads[2]!.id,
        stream: "ROLLS",
        dice: {
          formula: "1d20 + 4",
          resolvedFormula: "1d20 + 4",
          terms: [
            {
              notation: "1d20",
              count: 1,
              sides: 20,
              rolls: [17],
              subtotal: 17,
            },
          ],
          modifiers: [{ source: "test", value: 4 }],
          total: 21,
        },
        createdAt: "2026-07-29T02:00:00.000Z",
      },
    })}]`,
  );

  const toast = page.locator(".roll-toast");
  await expect(toast).toContainText("21");
  await toast.locator(".roll-toast-open").click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".roll-toast")).toHaveCount(0);
  await expect(page.locator(`#chat-message-${rollId}`)).toBeFocused();
});

test("map controls float in opposite top corners without covering canvas UI", async ({
  page,
}) => {
  for (const scenario of [
    { role: "GM" as const, width: 1280, height: 720 },
    { role: "PLAYER" as const, width: 720, height: 640 },
  ]) {
    const layoutSnapshot = structuredClone(snapshot);
    layoutSnapshot.me.role = scenario.role;
    layoutSnapshot.me.characterId =
      scenario.role === "PLAYER" ? layoutSnapshot.characters[0]!.id : null;
    layoutSnapshot.members = [
      {
        ...layoutSnapshot.me,
        displayName: scenario.role === "GM" ? "GM" : "Player",
      },
    ];

    await page.setViewportSize({
      width: scenario.width,
      height: scenario.height,
    });
    await page.route("**/api/bootstrap", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(layoutSnapshot),
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

    const viewport = page.locator(".map-viewport");
    const toolbar = page.locator(".map-toolbar");
    const objects = viewport.locator(".map-object-list-trigger");
    await expect(viewport).toBeVisible();
    await expect(toolbar).toBeVisible();
    await expect(objects).toBeVisible();

    const boxes = await Promise.all([
      viewport.boundingBox(),
      toolbar.boundingBox(),
      objects.boundingBox(),
    ]);
    const [viewportBox, toolbarBox, objectsBox] = boxes;
    expect(viewportBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    expect(objectsBox).not.toBeNull();
    expect(toolbarBox!.x).toBeGreaterThanOrEqual(viewportBox!.x + 7);
    expect(toolbarBox!.y).toBeGreaterThanOrEqual(viewportBox!.y + 7);
    expect(objectsBox!.x + objectsBox!.width).toBeLessThanOrEqual(
      viewportBox!.x + viewportBox!.width - 7,
    );
    expect(objectsBox!.y).toBeGreaterThanOrEqual(viewportBox!.y + 7);
    expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(
      objectsBox!.x,
    );

    const fogTool = toolbar.locator('.map-tool[data-tool="FOG"]');
    if (scenario.role === "GM") {
      await expect(fogTool).toBeVisible();
      await toolbar.locator('.map-tool[data-tool="DRAW"]').click();
      const palette = viewport.locator(".drawing-color-panel");
      await expect(palette).toBeVisible();
      await palette.getByRole("button", { name: "Красный: #ef4444" }).click();
      await expect(
        palette.getByRole("button", { name: "Красный: #ef4444" }),
      ).toHaveAttribute("aria-pressed", "true");
      const paletteBox = await palette.boundingBox();
      expect(paletteBox).not.toBeNull();
      expect(paletteBox!.x).toBeGreaterThanOrEqual(
        toolbarBox!.x + toolbarBox!.width,
      );
    } else await expect(fogTool).toHaveCount(0);

    await objects.click();
    const objectPopover = viewport.locator(".map-object-list-popover");
    await expect(objectPopover).toBeVisible();
    const popoverBox = await objectPopover.boundingBox();
    expect(popoverBox).not.toBeNull();
    expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(
      viewportBox!.x + viewportBox!.width - 7,
    );
    expect(popoverBox!.x).toBeGreaterThanOrEqual(
      toolbarBox!.x + toolbarBox!.width,
    );

    await page.unroute("**/api/bootstrap");
    await page.unroute("**/api/player-access");
  }
});
