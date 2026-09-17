import { expect, test } from "./react-console-guard";
import type { Locator, Page, Route, WebSocketRoute } from "@playwright/test";
import type {
  AssetDto,
  ChatReadCursorDto,
  GameSnapshot,
  TokenDefinitionDto,
} from "@arken/contracts";
import { openWorkspaceSection } from "./workspace-nav-helper";
import {
  tokenParitySource,
  tokenParityReference,
  tokenPreviewDifference,
} from "../../apps/server/src/token-preview-parity.test-support";

async function chooseEmbeddedSource(editor: Locator) {
  const source = editor.getByRole("combobox", {
    name: "Исходное изображение",
    exact: true,
  });
  const noImage = editor
    .getByRole("group", { name: "Изображение токена из файлов", exact: true })
    .getByRole("button", { name: "Без изображения", exact: true });
  await expect(source).toHaveValue("");
  await expect(noImage).toHaveAttribute("aria-pressed", "true");
  await source.selectOption(sourceAsset.id);
  await expect(source).toHaveValue(sourceAsset.id);
  await expect(noImage).toHaveAttribute("aria-pressed", "false");
}

async function settleFiniteAnimations(owner: Locator) {
  await owner.evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations({ subtree: true })
        .filter((animation) =>
          Number.isFinite(
            Number(animation.effect?.getComputedTiming().endTime),
          ),
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

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
  image = sourceAsset,
) {
  const fixture = structuredClone(snapshot);
  fixture.me = { ...fixture.me, role };
  fixture.members[0] = { ...fixture.members[0]!, role };
  fixture.assets = [image];
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
    (url) =>
      [
        "/api/story/posts",
        "/api/canvas/history",
        "/api/operator/feedback/capability",
      ].includes(url.pathname),
    (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/canvas/history") return route.fulfill({ json: [] });
      return route.fulfill({
        status: 403,
        json: {
          error: "FORBIDDEN",
          message: "Нет доступа к операторскому разделу.",
        },
      });
    },
  );
  await page.route(
    (url) => ["/api/chat/read", "/api/client-logs"].includes(url.pathname),
    (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      if (new URL(route.request().url()).pathname === "/api/client-logs")
        return route.fulfill({ status: 202, body: "" });
      const body = route.request().postDataJSON() as {
        threadId: string;
        sequence: number;
      };
      const state = fixture.chatThreadStates?.find(
        (entry) => entry.threadId === body.threadId,
      );
      expect(
        state,
        "read cursor targets a known synthetic thread",
      ).toBeDefined();
      expect(Number.isInteger(body.sequence) && body.sequence >= 0).toBe(true);
      if (!state) throw new Error("Unknown synthetic read thread");
      // /api/chat/read returns a cursor, not 204. The actual action passes
      // this receipt into reconcileChatRead; an empty body would supply null.
      const cursor: ChatReadCursorDto = {
        campaignId: fixture.campaign.id,
        threadId: body.threadId,
        lastReadSequence: Math.max(
          state.lastReadSequence,
          Math.min(body.sequence, state.latestSequence),
        ),
        updatedAt: fixture.serverTime,
      };
      return route.fulfill({ status: 200, json: cursor });
    },
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
  return fixture;
}

for (const size of [
  { name: "landscape", width: 640, height: 400 },
  { name: "portrait", width: 400, height: 640 },
]) {
  test(`UIX-589 ${size.name} preview agrees with the real WebP renderer`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const source = await tokenParitySource(size.width, size.height);
    const original = Buffer.from(source);
    await mockBootstrap(page, "GM", { ...sourceAsset, ...size });
    await page.route(`**${sourceAsset.url}`, (route) =>
      route.fulfill({ contentType: "image/png", body: source }),
    );
    await page.goto("/");
    await openWorkspaceSection(page, "Токены");
    await page.locator(".token-palette > button").click();
    const editor = page.getByRole("dialog", {
      name: "Новый токен",
      exact: true,
    });
    await chooseEmbeddedSource(editor);
    const preview = editor.locator(".token-image-preview");
    await expect
      .poll(() =>
        preview.locator("img").evaluate((node) => ({
          width: (node as HTMLImageElement).naturalWidth,
          height: (node as HTMLImageElement).naturalHeight,
        })),
      )
      .toEqual({ width: size.width, height: size.height });
    await editor
      .getByRole("slider", { name: "Масштаб изображения токена" })
      .fill("2.3");
    await preview.focus();
    await preview.press("Shift+ArrowRight");
    await preview.press("Shift+ArrowUp");
    for (const frame of ["NONE", "BRONZE", "SILVER", "OBSIDIAN"] as const) {
      await editor.locator(`input[type="radio"][value="${frame}"]`).check();
      const box = await preview.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeCloseTo(box!.height, 3);
      const actual = await preview.screenshot({ animations: "disabled" });
      const reference = await tokenParityReference(source, {
        cropX: 0.6,
        cropY: 0.4,
        zoom: 2.3,
        frame,
      });
      expect(reference.metadata).toMatchObject({
        format: "webp",
        width: 512,
        height: 512,
        hasAlpha: true,
      });
      const difference = await tokenPreviewDifference(actual, reference.bytes);
      await info.attach(`${size.name}-${frame}-preview`, {
        body: actual,
        contentType: "image/png",
      });
      await info.attach(`${size.name}-${frame}-server`, {
        body: reference.bytes,
        contentType: "image/webp",
      });
      await info.attach(`${size.name}-${frame}-difference`, {
        body: JSON.stringify(difference),
        contentType: "application/json",
      });
      // Different browser/libvips scaling and lossy WebP are not byte-equal.
      // Compare content plus ring samples, excluding antialiased outer edges.
      expect(difference.samples).toBeGreaterThan(3000);
      // A fractional viewport position can add one capture pixel to one edge.
      expect(
        Math.abs(difference.width - difference.height),
      ).toBeLessThanOrEqual(1);
      expect(difference.mean).toBeLessThan(3);
      expect(difference.maximum).toBeLessThan(12);
      for (const value of difference.ringDifferences)
        expect(value).toBeLessThan(24);
      if (frame === "NONE") {
        const wrongCrop = await tokenParityReference(source, {
          cropX: 0.3,
          cropY: 0.7,
          zoom: 1.1,
          frame,
        });
        const negative = await tokenPreviewDifference(actual, wrongCrop.bytes);
        expect(
          negative.mean,
          "oracle rejects a genuinely different crop",
        ).toBeGreaterThan(15);
      }
    }
    expect(source).toEqual(original);
  });
}

test("UIX-589 GM saves crop and definition with one confirmation", async ({
  page,
}) => {
  const generationRequests: Array<{
    body: Record<string, unknown>;
    actionId: string | null;
  }> = [];
  const definitionRequests: Array<Record<string, unknown>> = [];
  const fixture = await mockBootstrap(page, "GM");
  const sourceBytes = await tokenParitySource(800, 600);
  const reference = await tokenParityReference(sourceBytes, {
    cropX: 0.51,
    cropY: 0.51,
    zoom: 2,
    frame: "BRONZE",
  });
  const derivative: AssetDto = {
    ...sourceAsset,
    id: "b2222222-2222-4222-8222-222222222222",
    kind: "TOKEN",
    name: "Explorer token",
    mimeType: "image/webp",
    sizeBytes: reference.bytes.length,
    width: 512,
    height: 512,
    url: "/api/assets/b2222222-2222-4222-8222-222222222222/content",
  };
  await page.route(`**${sourceAsset.url}`, (route) =>
    route.fulfill({ contentType: "image/png", body: sourceBytes }),
  );
  await page.route(`**${derivative.url}`, (route) =>
    route.fulfill({ contentType: "image/webp", body: reference.bytes }),
  );
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
        body: JSON.stringify(derivative),
      });
    },
  );
  await page.route("**/api/token-definitions", async (route) => {
    definitionRequests.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    const definition: TokenDefinitionDto = {
      id: "45f46186-2ebc-4cf8-bce7-870097305a99",
      name: "Guard",
      ownName: "Guard",
      characterId: null,
      defaultAssetId: derivative.id,
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [],
      revision: 0,
    };
    fixture.assets = [derivative, sourceAsset];
    fixture.tokenDefinitions = [definition];
    fixture.snapshotVersion += 1;
    await route.fulfill({ status: 201, json: definition });
  });

  await page.goto("/");
  await openWorkspaceSection(page, "Токены");
  await page.locator(".token-palette > button").click();
  const editor = page.locator(".g-modal").last();
  await expect(editor.locator(".token-image-generator")).toBeVisible();
  await chooseEmbeddedSource(editor);

  const preview = editor.locator(".token-image-preview");
  await editor.locator('.token-image-generator input[type="range"]').fill("2");
  await preview.focus();
  await preview.press("ArrowRight");
  await preview.press("ArrowDown");
  await editor.locator('input[type="radio"][value="BRONZE"]').check();
  await expect(
    editor.getByRole("button", { name: "Создать изображение токена" }),
  ).toHaveCount(0);
  await editor.locator("form input").first().fill("Guard");
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();

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
  await expect(
    page.getByRole("status").filter({ hasText: "Токен создан." }),
  ).toHaveText("Токен создан.");
  const card = page.locator(".palette-card").filter({ hasText: "Guard" });
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toHaveAttribute("src", derivative.url);
  await expect
    .poll(() =>
      card.locator("img").evaluate((node) => ({
        complete: (node as HTMLImageElement).complete,
        width: (node as HTMLImageElement).naturalWidth,
        height: (node as HTMLImageElement).naturalHeight,
      })),
    )
    .toEqual({ complete: true, width: 512, height: 512 });
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

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "narrow", width: 390, height: 844 },
]) {
  test(`UIX-272 UIX-502 token modal character popup and inline image picker at ${viewport.name} viewport`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockBootstrap(page, "GM");
    const apiWrites: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      if (["GET", "HEAD"].includes(request.method())) return route.fallback();
      apiWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort("blockedbyclient");
    });
    const emptySnapshot = structuredClone(snapshot);
    emptySnapshot.characters = [];
    emptySnapshot.tokens = [];
    emptySnapshot.assets = [{ ...sourceAsset, kind: "TOKEN" }];
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

    const editor = page.getByRole("dialog", { name: "Новый токен" });
    // The image field is the real inline AssetPicker, not a second popup.
    const images = editor.getByRole("group", {
      name: "Изображение токена из файлов",
    });
    await settleFiniteAnimations(editor);
    // One layout snapshot: sequential boundingBox calls can see different
    // frames while the parent modal changes position.
    const rows = await editor.evaluate((node) => {
      const character = Array.from(node.querySelectorAll("label")).find(
        (label) => /^\s*Персонаж/.test(label.textContent ?? ""),
      );
      const images = node.querySelector(
        '[role="group"][aria-label="Изображение токена из файлов"]',
      )?.parentElement;
      if (!character || !images) throw new Error("Token form rows are missing");
      return {
        character: character.getBoundingClientRect().toJSON(),
        images: images.getBoundingClientRect().toJSON(),
      };
    });
    expect(rows.images.y).toBeGreaterThanOrEqual(
      rows.character.y + rows.character.height,
    );
    const image = images.getByRole("button", { name: sourceAsset.name });
    const noImage = images.getByRole("button", { name: "Без изображения" });
    await image.scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ),
          );
        }),
      )
      .toBe(true);
    const imageBox = await image.boundingBox();
    expect(imageBox).not.toBeNull();
    expect(imageBox!.x).toBeGreaterThanOrEqual(0);
    expect(imageBox!.y).toBeGreaterThanOrEqual(0);
    expect(imageBox!.x + imageBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(imageBox!.y + imageBox!.height).toBeLessThanOrEqual(viewport.height);
    await image.click();
    await expect(image).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".arken-form-select-popup")).toBeHidden();
    await page.keyboard.press("ArrowLeft");
    await expect(noImage).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(noImage).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowRight");
    await expect(image).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(image).toHaveAttribute("aria-pressed", "true");
    // Only the character field uses FormSelect; keep its empty-state case.
    const select = editor.locator("label").filter({ hasText: /^\s*Персонаж/ });
    const trigger = select.locator('[role="combobox"]');
    const nameInput = editor.getByLabel("Название");
    const menu = page.locator(".arken-form-select-popup");
    await trigger.click();

    await expect(menu).toBeVisible();
    const guidance = menu.getByText("Персонажей пока нет");
    const create = menu.getByText("Создать персонажа", { exact: true });
    // Resize while the FIRST character popup is open, before Escape or the
    // transition to Setup. This keeps the original failure phase observable.
    for (const width of [
      viewport.name === "desktop" ? 1120 : 360,
      viewport.width,
    ]) {
      await page.setViewportSize({ width, height: viewport.height });
      await expect(menu).toBeVisible();
      await expect
        .poll(() =>
          menu.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return (
              box.left >= 0 &&
              box.top >= 0 &&
              box.right <= innerWidth &&
              box.bottom <= innerHeight
            );
          }),
        )
        .toBe(true);
      await expect
        .poll(() =>
          create.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return node.contains(
              document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              ),
            );
          }),
        )
        .toBe(true);
    }
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
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(
      viewport.height + 1,
    );
    const screenshotPath = testInfo.outputPath(
      "token-modal-character-popup.png",
    );
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("token-modal-character-popup", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(editor).toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(image).toHaveAttribute("aria-pressed", "true");

    await trigger.click();
    await expect(menu).toBeVisible();
    await nameInput.click();
    await expect(menu).toBeHidden();
    await expect(editor).toBeVisible();

    await trigger.click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    // This is a workspace transition after the editor closes, not nesting.
    const workspaceDialog = page.getByRole("dialog", { name: "Подготовка" });
    await expect(workspaceDialog).toBeVisible();
    await expect(editor).toBeHidden();
    await expect
      .poll(() =>
        workspaceDialog.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          return element.contains(hit);
        }),
      )
      .toBe(true);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    // App may mark the visible chat as read during bootstrap. That POST was
    // blocked too: no request may reach a real backend from this UI fixture.
    // It is not a token/editor mutation and must not mask any other write.
    expect(
      apiWrites.filter((write) => write !== "POST /api/chat/read"),
    ).toEqual([]);
    await testInfo.attach("blocked-api-writes", {
      body: JSON.stringify(apiWrites),
      contentType: "application/json",
    });
  });
}

test("UIX-613 GM creates and places token on active scene in one action", async ({
  page,
}, info) => {
  const tokenRequests: Array<Record<string, unknown>> = [];
  const writeOrder: string[] = [];
  const fixture = await mockBootstrap(page, "GM");
  fixture.assets = [];
  const sourceBytes = await tokenParitySource(800, 600);
  const uploadedSource: AssetDto = {
    ...sourceAsset,
    sizeBytes: sourceBytes.length,
  };
  const reference = await tokenParityReference(sourceBytes, {
    cropX: 0.5,
    cropY: 0.5,
    zoom: 1,
    frame: "NONE",
  });
  const derivative: AssetDto = {
    ...sourceAsset,
    id: "b2222222-2222-4222-8222-222222222222",
    kind: "TOKEN",
    name: "Explorer token",
    mimeType: "image/webp",
    sizeBytes: reference.bytes.length,
    width: 512,
    height: 512,
    url: "/api/assets/b2222222-2222-4222-8222-222222222222/content",
  };
  const sockets = new Set<WebSocketRoute>();
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") {
        sockets.add(socket);
        socket.send('40{"sid":"token-success-socket"}');
      }
    });
    socket.onClose(() => sockets.delete(socket));
    socket.send(
      '0{"sid":"token-success-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  await page.route(`**${sourceAsset.url}`, (route) =>
    route.fulfill({ contentType: "image/png", body: sourceBytes }),
  );
  await page.route(`**${derivative.url}`, (route) =>
    route.fulfill({ contentType: "image/webp", body: reference.bytes }),
  );
  await page.route(
    (url) => url.pathname === "/api/assets",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      expect(new URL(route.request().url()).searchParams.get("kind")).toBe(
        "IMAGE",
      );
      const request = route.request();
      const form = await new Response(
        new Uint8Array(request.postDataBuffer()!),
        {
          headers: { "content-type": request.headers()["content-type"]! },
        },
      ).formData();
      expect([...form.keys()]).toEqual(["file"]);
      const file = form.get("file");
      if (!file || typeof file === "string")
        throw new Error("Expected local image File");
      expect(file.name).toBe("Explorer.png");
      expect(file.type).toBe("image/png");
      expect(Buffer.from(await file.arrayBuffer())).toEqual(sourceBytes);
      writeOrder.push("upload");
      fixture.assets = [uploadedSource];
      fixture.snapshotVersion += 1;
      await route.fulfill({ status: 201, json: uploadedSource });
    },
  );
  await page.route(
    "**/api/assets/a1111111-1111-4111-8111-111111111111/token",
    async (route) => {
      writeOrder.push("derivative");
      expect(route.request().postDataJSON()).toEqual({
        cropX: 0.5,
        cropY: 0.5,
        zoom: 1,
        frame: "NONE",
        name: "Explorer",
      });
      // Bootstrap remains without TOKEN until placement commits.
      await route.fulfill({ status: 201, json: derivative });
    },
  );
  await page.route("**/api/tokens", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writeOrder.push("placement");
    const body = route.request().postDataJSON() as Record<string, unknown>;
    tokenRequests.push(body);
    const definition: TokenDefinitionDto = {
      id: "45f46186-2ebc-4cf8-bce7-870097305a99",
      name: "Ranger",
      ownName: "Ranger",
      characterId: null,
      defaultAssetId: derivative.id,
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [],
      revision: 0,
    };
    const placed: GameSnapshot["tokens"][number] = {
      id: "35f46186-2ebc-4cf8-bce7-870097305a99",
      definitionId: definition.id,
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
      z: 0,
      levelId: null,
      visible: true,
      locked: false,
      width: 64,
      height: 64,
      rotation: 0,
      assetId: derivative.id,
      name: "Ranger",
      revision: 0,
    };
    fixture.assets = [derivative, uploadedSource];
    fixture.tokenDefinitions = [definition];
    fixture.tokens = [placed];
    fixture.snapshotVersion += 1;
    expect(sockets.size).toBeGreaterThan(0);
    for (const socket of sockets)
      socket.send(`42${JSON.stringify(["game:snapshot", fixture])}`);
    await route.fulfill({ status: 201, json: placed });
  });
  await page.goto("/");
  await expect.poll(() => sockets.size).toBeGreaterThan(0);
  await openWorkspaceSection(page, "Токены");
  await page.locator(".token-palette > button").click();
  const editor = page.getByRole("dialog", { name: "Новый токен", exact: true });
  await expect(
    editor.getByRole("button", { name: "Без изображения", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await editor
    .getByLabel("Загрузить новое изображение", { exact: true })
    .setInputFiles({
      name: "Explorer.png",
      mimeType: "image/png",
      buffer: sourceBytes,
    });
  await expect(
    editor.getByRole("combobox", { name: "Исходное изображение", exact: true }),
  ).toHaveValue(sourceAsset.id);
  await expect(
    editor.getByRole("button", { name: "Без изображения", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() =>
      editor.locator(".token-image-preview img").evaluate((node) => ({
        width: (node as HTMLImageElement).naturalWidth,
        height: (node as HTMLImageElement).naturalHeight,
      })),
    )
    .toEqual({ width: 800, height: 600 });
  await expect(
    editor.getByRole("button", { name: "Создать изображение токена" }),
  ).toHaveCount(0);
  await editor.getByLabel("Название", { exact: true }).fill("Ranger");
  await editor.locator('button[value="create-and-place"]').click();
  await expect.poll(() => tokenRequests.length).toBe(1);
  expect(writeOrder).toEqual(["upload", "derivative", "placement"]);
  expect(tokenRequests[0]).toMatchObject({
    sceneId: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
    name: "Ranger",
    assetId: derivative.id,
    width: 64,
    height: 64,
    controllerMembershipIds: [],
    actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  await expect(editor).toHaveCount(0);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Токен создан и размещён на карте." }),
  ).toHaveText("Токен создан и размещён на карте.");
  const card = page.locator(".palette-card").filter({ hasText: "Ranger" });
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toHaveAttribute("src", derivative.url);
  await expect
    .poll(() =>
      card.locator("img").evaluate((node) => ({
        complete: (node as HTMLImageElement).complete,
        width: (node as HTMLImageElement).naturalWidth,
        height: (node as HTMLImageElement).naturalHeight,
      })),
    )
    .toEqual({ complete: true, width: 512, height: 512 });
  await expect(page.locator(".map-viewport")).toHaveAttribute(
    "data-token-image-states",
    "35f46186-2ebc-4cf8-bce7-870097305a99:loaded",
  );
  const screenshot = info.outputPath("token-created-and-placed.png");
  await page.screenshot({ path: screenshot });
  await info.attach("token-created-and-placed", {
    path: screenshot,
    contentType: "image/png",
  });
  const palette = page.getByRole("dialog", { name: "Токены", exact: true });
  await palette
    .getByRole("button", { name: "Закрыть окно", exact: true })
    .click();
  await expect(palette).toHaveCount(0);
  const map = page.locator(".map-viewport");
  await expect(map).toBeVisible();
  await expect(map.locator("canvas").first()).toBeVisible();
  await expect(map).toHaveAttribute(
    "data-token-image-states",
    "35f46186-2ebc-4cf8-bce7-870097305a99:loaded",
  );
  const mapScreenshot = info.outputPath("token-created-and-placed-map.png");
  await map.screenshot({ path: mapScreenshot, animations: "disabled" });
  await info.attach("token-created-and-placed-map", {
    path: mapScreenshot,
    contentType: "image/png",
  });
});

for (const outcome of ["failure", "cancel"] as const) {
  test(`UIX-589 held generation ${outcome} never creates a definition or placement`, async ({
    page,
  }) => {
    await mockBootstrap(page, "GM");
    const generationRequests: Array<Record<string, unknown>> = [];
    const definitionWrites: string[] = [];
    let held: Route | undefined;
    await page.route(
      "**/api/assets/a1111111-1111-4111-8111-111111111111/token",
      (route) => {
        generationRequests.push(
          route.request().postDataJSON() as Record<string, unknown>,
        );
        held = route;
      },
    );
    for (const path of ["/api/token-definitions", "/api/tokens"]) {
      await page.route(`**${path}`, async (route) => {
        definitionWrites.push(path);
        await route.abort("blockedbyclient");
      });
    }
    try {
      await page.goto("/");
      await openWorkspaceSection(page, "Токены");
      await page.locator(".token-palette > button").click();
      const editor = page.getByRole("dialog", {
        name: "Новый токен",
        exact: true,
      });
      await chooseEmbeddedSource(editor);
      const name = editor.getByLabel("Название", { exact: true });
      await name.fill("Generation draft");
      const save = editor.getByRole("button", {
        name: "Сохранить",
        exact: true,
      });
      await save.click();
      await expect.poll(() => generationRequests.length).toBe(1);
      await expect(save).toBeDisabled();
      await page.keyboard.press("Enter");
      // keyboard.press has dispatched keyup; cross a rendering checkpoint so
      // its native submit handling and any synchronous guarded action settle.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      expect(generationRequests).toHaveLength(1);
      expect(definitionWrites).toEqual([]);
      if (!held) throw new Error("Generation did not reach its held boundary");
      if (outcome === "cancel") {
        await page.keyboard.press("Escape");
        await expect(editor).toHaveCount(0);
        await page.locator(".token-palette > button").click();
        await editor
          .getByLabel("Название", { exact: true })
          .fill("New draft B");
        // generateTokenImage awaits load() after the derivative response.
        // Bind the resulting bootstrap body's completion before releasing A,
        // rather than asserting B before the old operation resumes.
        const refreshed = page.waitForEvent(
          "requestfinished",
          (request) =>
            request.method() === "GET" &&
            new URL(request.url()).pathname === "/api/bootstrap",
        );
        await held.fulfill({
          status: 201,
          json: {
            ...sourceAsset,
            id: "b2222222-2222-4222-8222-222222222222",
            kind: "TOKEN",
            width: 512,
            height: 512,
          },
        });
        held = undefined;
        await refreshed;
        // Let bootstrap JSON/load/generation continuations and React's next
        // paint finish before checking that cancelled A did not affect B.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await expect(editor).toBeVisible();
        await expect(
          editor.getByLabel("Название", { exact: true }),
        ).toHaveValue("New draft B");
        await expect(
          editor.getByRole("combobox", {
            name: "Исходное изображение",
            exact: true,
          }),
        ).toHaveValue("");
        await expect(
          editor
            .getByRole("group", {
              name: "Изображение токена из файлов",
              exact: true,
            })
            .getByRole("button", { name: "Без изображения", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
      } else {
        await held.fulfill({
          status: 500,
          json: { error: "GENERATION_FAILED", message: "Generation failed" },
        });
        held = undefined;
        await expect(save).toBeEnabled();
        await expect(name).toHaveValue("Generation draft");
        await expect(editor.getByRole("alert")).toHaveText("Generation failed");
      }
      expect(generationRequests).toHaveLength(1);
      expect(definitionWrites).toEqual([]);
    } finally {
      await held?.abort("blockedbyclient").catch(() => undefined);
    }
  });
}

for (const size of [
  {
    name: "wide",
    width: 640,
    height: 400,
    key: "ArrowRight",
    axis: "left",
    pinned: "top",
  },
  {
    name: "portrait",
    width: 400,
    height: 640,
    key: "ArrowDown",
    axis: "top",
    pinned: "left",
  },
] as const) {
  test(`UIX-589 zoom-one overflow pan ${size.name} keyboard moves only the overflowing axis`, async ({
    page,
  }) => {
    await mockBootstrap(page, "GM", { ...sourceAsset, ...size });
    const source = await tokenParitySource(size.width, size.height);
    await page.route(`**${sourceAsset.url}`, (route) =>
      route.fulfill({ contentType: "image/png", body: source }),
    );
    await page.goto("/");
    await openWorkspaceSection(page, "Токены");
    await page.locator(".token-palette > button").click();
    const editor = page.getByRole("dialog", {
      name: "Новый токен",
      exact: true,
    });
    await chooseEmbeddedSource(editor);
    const preview = editor.locator(".token-image-preview");
    const image = preview.locator("img");
    await expect
      .poll(() =>
        image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(size.width);
    const position = () =>
      image.evaluate((node) => ({
        left: parseFloat((node as HTMLElement).style.left),
        top: parseFloat((node as HTMLElement).style.top),
      }));
    const before = await position();
    await expect(
      editor.getByRole("slider", {
        name: "Масштаб изображения токена",
        exact: true,
      }),
    ).toHaveValue("1");
    await preview.focus();
    await preview.press(size.key);
    await expect
      .poll(async () => (await position())[size.axis])
      .toBeLessThan(before[size.axis]);
    expect((await position())[size.pinned]).toBe(before[size.pinned]);
    // The orthogonal key cannot expose a blank edge on the fitted axis.
    await preview.press(size.key === "ArrowRight" ? "ArrowDown" : "ArrowRight");
    expect((await position())[size.pinned]).toBe(before[size.pinned]);
  });
}

async function openCropEditor(page: Page, width: number, height: number) {
  const source = await tokenParitySource(width, height);
  await mockBootstrap(page, "GM", { ...sourceAsset, width, height });
  await page.route(`**${sourceAsset.url}`, (route) =>
    route.fulfill({ contentType: "image/png", body: source }),
  );
  await page.goto("/");
  await openWorkspaceSection(page, "Токены");
  await page.locator(".token-palette > button").click();
  const editor = page.getByRole("dialog", { name: "Новый токен", exact: true });
  await chooseEmbeddedSource(editor);
  const preview = editor.locator(".token-image-preview");
  const image = preview.locator("img");
  await expect
    .poll(() =>
      image.evaluate((node) => ({
        width: (node as HTMLImageElement).naturalWidth,
        height: (node as HTMLImageElement).naturalHeight,
      })),
    )
    .toEqual({ width, height });
  await settleFiniteAnimations(editor);
  await preview.scrollIntoViewIfNeeded();
  return { source, editor, preview, image };
}

async function cropGeometry(preview: Locator) {
  return preview.evaluate((node) => {
    const image = node.querySelector("img");
    if (!image) throw new Error("Crop image is missing");
    const box = node.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    return {
      box: box.toJSON(),
      imageX: imageBox.x - box.x,
      imageY: imageBox.y - box.y,
    };
  });
}

async function settleCropGeometry(editor: Locator, preview: Locator) {
  await settleFiniteAnimations(editor);
  await preview.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      preview.evaluate(async (node) => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const before = node.getBoundingClientRect();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const after = node.getBoundingClientRect();
        return Math.max(
          Math.abs(after.x - before.x),
          Math.abs(after.y - before.y),
          Math.abs(after.width - before.width),
          Math.abs(after.height - before.height),
        );
      }),
    )
    .toBeLessThanOrEqual(0.001);
  // Both rectangles belong to the same layout snapshot.
  return cropGeometry(preview);
}

for (const size of [
  { name: "wide", width: 640, height: 400 },
  { name: "portrait", width: 400, height: 640 },
]) {
  for (const zoom of [1, 2]) {
    test(`UIX-589 ${size.name} mouse pan follows pointer one-to-one at zoom ${zoom}`, async ({
      page,
    }) => {
      const { editor, preview } = await openCropEditor(
        page,
        size.width,
        size.height,
      );
      await editor
        .getByRole("slider", {
          name: "Масштаб изображения токена",
          exact: true,
        })
        .fill(String(zoom));
      const before = await settleCropGeometry(editor, preview);
      const box = before.box;
      const expectedX = zoom === 1 && size.name === "portrait" ? 0 : 12;
      const expectedY = zoom === 1 && size.name === "wide" ? 0 : 12;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      try {
        await page.mouse.move(
          box.x + box.width / 2 + 12,
          box.y + box.height / 2 + 12,
          { steps: 4 },
        );
        await expect
          .poll(async () => {
            const after = await cropGeometry(preview);
            return Math.max(
              Math.abs(after.imageX - before.imageX - expectedX),
              Math.abs(after.imageY - before.imageY - expectedY),
            );
          })
          .toBeLessThanOrEqual(1);
      } finally {
        await page.mouse.up();
      }
    });
  }
  test(`UIX-589 ${size.name} off-center zoom-one preview matches real renderer`, async ({
    page,
  }, info) => {
    const { source, preview, image } = await openCropEditor(
      page,
      size.width,
      size.height,
    );
    const before = await image.evaluate((node) => ({
      left: (node as HTMLElement).style.left,
      top: (node as HTMLElement).style.top,
    }));
    await preview.focus();
    await preview.press(
      size.name === "wide" ? "Shift+ArrowRight" : "Shift+ArrowDown",
    );
    await expect
      .poll(() =>
        image.evaluate((node) => ({
          left: (node as HTMLElement).style.left,
          top: (node as HTMLElement).style.top,
        })),
      )
      .not.toEqual(before);
    const actual = await preview.screenshot({ animations: "disabled" });
    const reference = await tokenParityReference(source, {
      cropX: size.name === "wide" ? 0.6 : 0.5,
      cropY: size.name === "portrait" ? 0.6 : 0.5,
      zoom: 1,
      frame: "NONE",
    });
    const difference = await tokenPreviewDifference(actual, reference.bytes);
    expect(difference.samples).toBeGreaterThan(3000);
    expect(difference.mean).toBeLessThan(3);
    expect(difference.maximum).toBeLessThan(12);
    await info.attach("zoom-one-parity", {
      body: JSON.stringify(difference),
      contentType: "application/json",
    });
  });
}

test("UIX-589 compact real touch pan keeps fitted axis pinned", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Real touch input uses Chromium CDP");
  await page.setViewportSize({ width: 390, height: 844 });
  const { editor, preview } = await openCropEditor(page, 640, 400);
  const before = await settleCropGeometry(editor, preview);
  const box = before.box;
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 12, y: y + 12, id: 1 }],
    });
    await expect
      .poll(async () => {
        const after = await cropGeometry(preview);
        return Math.max(
          Math.abs(after.imageX - before.imageX - 12),
          Math.abs(after.imageY - before.imageY),
        );
      })
      .toBeLessThanOrEqual(1);
  } finally {
    await session
      .send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      .catch(() => undefined);
    await session.detach();
  }
});

test("UIX-589 compact accessible zoom controls clamp sync reset and remain touch-sized", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { editor, preview } = await openCropEditor(page, 640, 400);
  const percent = editor.getByRole("spinbutton", {
    name: "Масштаб изображения токена, проценты",
    exact: true,
  });
  const range = editor.getByRole("slider", {
    name: "Масштаб изображения токена",
    exact: true,
  });
  const minus = editor.getByRole("button", {
    name: "Уменьшить масштаб",
    exact: true,
  });
  const plus = editor.getByRole("button", {
    name: "Увеличить масштаб",
    exact: true,
  });
  const reset = editor.getByRole("button", { name: "Сбросить", exact: true });
  await expect(percent).toHaveAttribute("min", "100");
  await expect(percent).toHaveAttribute("max", "800");
  await expect(percent).toHaveAttribute("step", "10");
  await expect(percent).toHaveValue("100");
  await expect(minus).toBeDisabled();
  await plus.click();
  await expect(percent).toHaveValue("110");
  await expect(range).toHaveValue("1.1");
  await minus.click();
  await expect(range).toHaveValue("1");
  await percent.fill("950");
  await percent.press("Enter");
  await expect(percent).toHaveValue("800");
  await expect(range).toHaveValue("8");
  await expect(plus).toBeDisabled();
  await percent.fill("20");
  await percent.press("Tab");
  await expect(percent).toHaveValue("100");
  await expect(range).toHaveValue("1");
  await range.fill("2");
  await expect(percent).toHaveValue("200");
  await editor.getByRole("radio", { name: "Бронза", exact: true }).check();
  await preview.focus();
  await preview.press("Shift+ArrowRight");
  await reset.click();
  await expect(range).toHaveValue("1");
  await expect(percent).toHaveValue("100");
  await expect(
    editor.getByRole("radio", { name: "Без рамки", exact: true }),
  ).toBeChecked();
  await settleFiniteAnimations(editor);
  for (const control of [
    minus,
    plus,
    percent,
    range,
    reset,
    ...(await editor.locator(".token-image-generator__frame-option").all()),
  ]) {
    const box = await control.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const element = node as HTMLElement;
      return {
        x: rect.x,
        width: Number(rect.width.toFixed(3)),
        height: Number(rect.height.toFixed(3)),
        logicalWidth: element.offsetWidth,
        logicalHeight: element.offsetHeight,
      };
    });
    // Normalize sub-millipixel engine noise, not undersized touch targets:
    // both the measured dimensions and native logical layout must be >=44.
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.logicalWidth).toBeGreaterThanOrEqual(44);
    expect(box.logicalHeight).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
  }
  expect(
    await editor.evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const box = await preview.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeCloseTo(box!.height, 3);
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Создать изображение токена" }),
  ).toHaveCount(0);
  await editor
    .locator(".token-image-generator__zoom-controls")
    .scrollIntoViewIfNeeded();
  const screenshot = info.outputPath("crop-controls-390.png");
  await page.screenshot({ path: screenshot });
  await info.attach("crop-controls-390", {
    path: screenshot,
    contentType: "image/png",
  });
});

for (const width of [1280, 360]) {
  test(`UIX-644 native token source lifecycle ${width}`, async ({
    page,
  }, testInfo) => {
    const writes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        path.startsWith("/api/") &&
        request.method() !== "GET" &&
        !["/api/chat/read", "/api/client-logs"].includes(path)
      )
        writes.push(`${request.method()} ${path}`);
    });
    await page.setViewportSize({ width, height: 800 });
    const { editor, preview } = await openCropEditor(page, 800, 600);
    const name = editor.getByLabel("Название", { exact: true });
    await name.fill("Портрет для стража");
    const source = editor.getByRole("combobox", {
      name: "Исходное изображение",
      exact: true,
    });
    const zoom = editor.getByRole("spinbutton", {
      name: "Масштаб изображения токена, проценты",
      exact: true,
    });
    await zoom.fill("200");
    await zoom.press("Tab");
    await expect(zoom).toHaveValue("200");
    await page.setViewportSize({
      width: width === 360 ? 390 : 1180,
      height: 640,
    });
    await expect(name).toHaveValue("Портрет для стража");
    await expect(source).toHaveValue(sourceAsset.id);
    await expect(zoom).toHaveValue("200");
    await source.scrollIntoViewIfNeeded();
    expect(
      await source.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return (
          r.left >= 0 &&
          r.right <= innerWidth &&
          r.top >= 0 &&
          r.bottom <= innerHeight &&
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
            element
        );
      }),
    ).toBe(true);
    await source.focus();
    await source.press("Home");
    await expect(source).toHaveValue("");
    await expect(source).toBeFocused();
    await expect(zoom).toHaveValue("100");
    await expect(preview.locator("img")).toHaveCount(0);
    await expect(name).toHaveValue("Портрет для стража");
    await source.press("End");
    await expect(source).toHaveValue(sourceAsset.id);
    await expect(source).toBeFocused();
    await expect(preview.locator("img")).toBeVisible();
    await expect(zoom).toHaveValue("100");
    await editor.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(editor).toBeHidden();
    await testInfo.attach("native-token-source", {
      body: JSON.stringify({ width, writes, errors }),
      contentType: "application/json",
    });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
