import { type Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import type { GameSnapshot } from "@arken/contracts";

const sceneId = "7376b502-02f8-4cd6-9c55-3816d70d44dc";
const tokenId = "35f46186-2ebc-4cf8-bce7-870097305a6b";
const assetId = "65f46186-2ebc-4cf8-bce7-870097305a6b";
const portraitUrl = `/api/assets/${assetId}/content`;
const stackAlphaId = "75f46186-2ebc-4cf8-bce7-870097305a6b";
const stackBetaId = "85f46186-2ebc-4cf8-bce7-870097305a6b";

const snapshot = {
  campaign: {
    id: "b4c34840-cb11-4a07-884d-680ae85c48db",
    name: "Canvas regression fixture",
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
      id: tokenId,
      definitionId: "45f46186-2ebc-4cf8-bce7-870097305a6b",
      definitionRevision: 0,
      controllerMembershipIds: [],
      sceneId,
      characterId: null,
      ownerMembershipId: null,
      assetId,
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
      baseColor: "#8899aa",
      frameColor: null,
      layer: "PLAYER" as const,
      conditions: [],
      revision: 0,
    },
  ],
  tokenDefinitions: [],
  fogReveals: [],
  drawings: [],
  messages: [],
  chatThreads: [],
  chatThreadStates: [],
  assets: [
    {
      id: assetId,
      kind: "IMAGE",
      name: "Portrait",
      mimeType: "image/png",
      sizeBytes: 68,
      width: 1,
      height: 1,
      durationSeconds: null,
      url: portraitUrl,
      createdAt: "2026-08-02T00:00:00.000Z",
    },
  ],
  audio: {
    assetId: null,
    playing: false,
    positionSeconds: 0,
    loop: false,
    startedAt: null,
    revision: 0,
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
  characterIdentities: [],
  audioTracks: [],
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: "2026-08-02T00:00:00.000Z",
} satisfies GameSnapshot;

async function installCanvasRoutes(page: Page) {
  let portraitRequests = 0;
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
  await page.route(`**${portraitUrl}`, (route) => {
    portraitRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  return { portraitRequestCount: () => portraitRequests };
}

for (const role of ["GM", "PLAYER"] as const) {
  for (const width of [1280, 390]) {
    test(`UIX-584 pause blocks canvas but not sidebar (${role}, ${width})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 850 });
      await installCanvasRoutes(page);
      const current: GameSnapshot = structuredClone(snapshot);
      current.me.role = role;
      current.campaign.paused = role === "PLAYER";
      await page.route("**/api/bootstrap", (route) =>
        route.fulfill({ json: current }),
      );
      const commands: boolean[] = [];
      await page.route("**/api/campaign/pause", async (route) => {
        expect(role).toBe("GM");
        const body = route.request().postDataJSON();
        expect(body.revision).toBe(current.campaign.revision);
        expect(body.actionId).toMatch(/^[0-9a-f-]{36}$/i);
        commands.push(body.paused);
        current.campaign.paused = body.paused;
        current.campaign.revision += 1;
        await route.fulfill({
          json: { paused: body.paused, revision: current.campaign.revision },
        });
      });
      await page.goto("/");
      if (role === "GM")
        await page.getByRole("button", { name: "Начать перерыв" }).click();
      await expect(
        page.getByRole("heading", { name: "Перерыв", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".map-viewport")).toHaveAttribute("inert", "");
      await expect(page.locator(".map-toolbar")).toHaveCount(0);
      expect(
        await page
          .locator("#activity-sidebar")
          .evaluate((node) => node.closest("[inert]") !== null),
      ).toBe(false);
      const box = await page.locator(".game-pause-overlay").boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(width);
      const artwork = page.locator(".game-pause-artwork");
      await expect(artwork).toBeVisible();
      await expect
        .poll(() =>
          artwork.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        )
        .toBe(1672);
      await expect(artwork).toHaveCSS("object-fit", "contain");
      await expect(artwork).toHaveAttribute("alt", "");
      await page.screenshot({ path: testInfo.outputPath("pause-artwork.png") });
      await page.keyboard.press("Control+z");
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Перерыв", exact: true }),
      ).toBeVisible();
      if (role === "GM") {
        await page.getByRole("button", { name: "Продолжить игру" }).click();
        await expect(page.locator(".game-pause-overlay")).toHaveCount(0);
        await expect(page.locator(".map-viewport")).not.toHaveAttribute(
          "inert",
          "",
        );
        expect(commands).toEqual([true, false]);
      } else {
        await expect(
          page.getByRole("button", { name: "Продолжить игру" }),
        ).toHaveCount(0);
        expect(commands).toEqual([]);
      }
    });
  }
}

test("UIX-471 GM changes condition sets through the token menu and keeps server state on rejection", async ({
  page,
}) => {
  await installCanvasRoutes(page);
  const current: GameSnapshot = structuredClone(snapshot);
  const commands: Array<{
    revision: number;
    conditions: string[];
    actionId: string;
  }> = [];
  let reject = false;
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route(`**/api/tokens/${tokenId}/conditions`, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    const body = route.request().postDataJSON();
    commands.push(body);
    expect(body.actionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.revision).toBe(current.tokens[0].revision);
    if (reject) {
      await route.fulfill({ status: 409, json: { error: "CAMPAIGN_PAUSED" } });
      return;
    }
    current.tokens[0].conditions = body.conditions;
    current.tokens[0].revision += 1;
    await route.fulfill({ json: current.tokens[0] });
  });
  await page.goto("/");
  const map = page.locator(".map-viewport");
  const openMenu = async () => {
    if (await page.getByRole("group", { name: "Состояния токена" }).isVisible())
      return;
    const trigger = map.locator(".map-object-list-trigger");
    await trigger.click();
    await map
      .locator(".map-object-list")
      .getByRole("button", { name: "Selected token", exact: true })
      .click();
    await trigger.click();
    await map.press("Enter");
    await expect(
      page.getByRole("group", { name: "Состояния токена" }),
    ).toBeVisible();
  };
  await openMenu();
  await page
    .getByRole("menuitemcheckbox", { name: "Отравлен", exact: true })
    .click();
  await expect.poll(() => commands.length).toBe(1);
  await openMenu();
  await expect(
    page.getByRole("menuitemcheckbox", { name: /Отравлен/ }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("menuitemcheckbox", { name: "Обездвижен", exact: true })
    .click();
  await expect.poll(() => commands.length).toBe(2);
  await openMenu();
  await page.getByRole("menuitemcheckbox", { name: /Отравлен/ }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands.map((command) => command.conditions)).toEqual([
    ["POISONED"],
    ["POISONED", "RESTRAINED"],
    ["RESTRAINED"],
  ]);
  reject = true;
  await openMenu();
  await page
    .getByRole("menuitemcheckbox", { name: "Распластан", exact: true })
    .click();
  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(4);
  await openMenu();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Распластан", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByRole("menuitemcheckbox", { name: /Обездвижен/ }),
  ).toHaveAttribute("aria-checked", "true");
});

async function selectTokenAndResizeFromObservableHandle(
  page: Page,
  delta = 48,
) {
  const map = page.locator(".map-viewport");
  const trigger = map.locator(".map-object-list-trigger");
  await trigger.click();
  await map
    .locator(".map-object-list")
    .getByRole("button", { name: "Selected token", exact: true })
    .click();
  // Escape also changes selection/tool state, so close through the trigger.
  await trigger.click();
  await expect(map).toHaveAttribute("data-resize-handle-x", /\d/);
  await expect(map).toHaveAttribute("data-resize-handle-y", /\d/);
  const [box, localX, localY] = await Promise.all([
    map.boundingBox(),
    map.getAttribute("data-resize-handle-x"),
    map.getAttribute("data-resize-handle-y"),
  ]);
  expect(box).not.toBeNull();
  expect(localX).not.toBeNull();
  expect(localY).not.toBeNull();
  const startX = box!.x + Number(localX);
  const startY = box!.y + Number(localY);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + delta, startY + delta, { steps: 4 });
  await page.mouse.up();
}

test("cold token resize sends one canonical proportional PATCH without rebootstrap", async ({
  page,
}) => {
  let bootstrapRequests = 0;
  const resizeRequests: Array<{
    method: string;
    url: string;
    headerActionId: string | null;
    body: Record<string, unknown>;
  }> = [];
  await page.route("**/api/bootstrap", (route) => {
    bootstrapRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route(`**/api/tokens/${tokenId}/size`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as Record<string, unknown>;
    resizeRequests.push({
      method: request.method(),
      url: new URL(request.url()).pathname,
      headerActionId: await request.headerValue("x-action-id"),
      body,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...snapshot.tokens[0],
        width: body.width,
        height: body.height,
        revision: 1,
      }),
    });
  });

  await page.goto("/");
  const coldBootstrapRequests = bootstrapRequests;
  await selectTokenAndResizeFromObservableHandle(page);
  await expect.poll(() => resizeRequests.length).toBe(1);
  await page.waitForTimeout(100);
  expect(resizeRequests).toHaveLength(1);
  expect(bootstrapRequests).toBe(coldBootstrapRequests);
  expect(resizeRequests[0]).toMatchObject({
    method: "PATCH",
    url: `/api/tokens/${tokenId}/size`,
    body: { revision: 0 },
  });
  expect(resizeRequests[0].body.width).toEqual(expect.any(Number));
  expect(resizeRequests[0].body.height).toEqual(expect.any(Number));
  expect(resizeRequests[0].body.width).toBeGreaterThan(64);
  expect(resizeRequests[0].body.height).toBeGreaterThan(64);
  expect(resizeRequests[0].body.width).toBe(resizeRequests[0].body.height);
  expect(resizeRequests[0].headerActionId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(resizeRequests[0].body.actionId).toBe(
    resizeRequests[0].headerActionId,
  );
});

test("cold token resize conflict keeps socket authority and exposes only safe correlation data", async ({
  page,
}) => {
  const safeRequestId = "resize-conflict-request-01";
  const safeMessage = "Token size changed concurrently";
  const unsafeData = "secret-resize-payload";
  let bootstrapRequests = 0;
  const resizeRequests: Array<{
    headerActionId: string | null;
    body: Record<string, unknown>;
  }> = [];
  await page.route("**/api/bootstrap", (route) => {
    bootstrapRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/client-logs", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route(`**/api/tokens/${tokenId}/size`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as Record<string, unknown>;
    const headerActionId = await request.headerValue("x-action-id");
    resizeRequests.push({ headerActionId, body });
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      headers: {
        "x-request-id": safeRequestId,
        "x-action-id": headerActionId!,
      },
      body: JSON.stringify({
        error: "CONFLICT",
        message: safeMessage,
        ignoredUnsafeData: unsafeData,
      }),
    });
  });

  await page.goto("/");
  const coldBootstrapRequests = bootstrapRequests;
  await selectTokenAndResizeFromObservableHandle(page);
  await expect.poll(() => resizeRequests.length).toBe(1);
  const canonicalActionId = resizeRequests[0].headerActionId;
  expect(canonicalActionId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(resizeRequests[0].body).toMatchObject({ revision: 0 });
  expect(resizeRequests[0].body.actionId).toBe(canonicalActionId);

  const notification = page
    .locator("[data-toast]")
    .filter({ hasText: safeMessage });
  await expect(notification).toBeVisible();
  await expect(notification).toContainText(`requestId: ${safeRequestId}`);
  await expect(notification).toContainText(`actionId: ${canonicalActionId}`);
  const visibleText = await notification.innerText();
  expect(visibleText).not.toContain(tokenId);
  expect(visibleText).not.toContain(`/api/tokens/${tokenId}/size`);
  expect(visibleText).not.toContain(JSON.stringify(resizeRequests[0].body));
  expect(visibleText).not.toContain(unsafeData);
  await page.waitForTimeout(100);
  expect(bootstrapRequests).toBe(coldBootstrapRequests);
});

test("GM stack semantics follow authoritative movement and deletion", async ({
  page,
}) => {
  let tokens: GameSnapshot["tokens"] = [
    {
      ...snapshot.tokens[0],
      id: stackAlphaId,
      definitionId: "95f46186-2ebc-4cf8-bce7-870097305a6b",
      assetId: null,
      name: "Alpha",
    },
    {
      ...snapshot.tokens[0],
      id: stackBetaId,
      definitionId: "a5f46186-2ebc-4cf8-bce7-870097305a6b",
      assetId: null,
      name: "Beta",
    },
  ];
  const bulkRequests: Array<Record<string, unknown>> = [];
  const deleteRequests: Array<{
    method: string;
    body: Record<string, unknown>;
  }> = [];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...snapshot, tokens }),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/canvas/bulk", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bulkRequests.push(body);
    tokens = tokens.map((token) =>
      token.id === stackAlphaId
        ? { ...token, x: token.x + 64, revision: 1 }
        : token,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revisions: { tokens: { [stackAlphaId]: 1 }, drawings: {} },
      }),
    });
  });
  await page.route(`**/api/tokens/${stackAlphaId}`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    deleteRequests.push({ method: route.request().method(), body });
    tokens = tokens.filter((token) => token.id !== stackAlphaId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.goto("/");
  const map = page.locator(".map-viewport");
  await map.locator(".map-object-list-trigger").click();
  const objectList = map.locator(".map-object-list");
  await expect(
    objectList.getByRole("button", {
      name: "Alpha \u00b7 \u0441\u0442\u043e\u043f\u043a\u0430 2",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    objectList.getByRole("button", { name: "Beta", exact: true }),
  ).toBeVisible();

  await objectList
    .getByRole("button", {
      name: "Alpha \u00b7 \u0441\u0442\u043e\u043f\u043a\u0430 2",
      exact: true,
    })
    .click();
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => bulkRequests.length).toBe(1);
  expect(bulkRequests[0]).toMatchObject({
    sceneId,
    operation: "MOVE",
    deltaX: 64,
    deltaY: 0,
    targets: [{ targetType: "TOKEN", targetId: stackAlphaId, revision: 0 }],
  });
  await page.reload();
  await map.locator(".map-object-list-trigger").click();
  await expect(
    objectList.getByRole("button", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await expect(
    objectList.getByRole("button", { name: "Beta", exact: true }),
  ).toBeVisible();
  await expect(
    objectList.getByText(/\u0441\u0442\u043e\u043f\u043a\u0430/),
  ).toHaveCount(0);
  await objectList
    .getByRole("button", {
      name: "\u0423\u0434\u0430\u043b\u0438\u0442\u044c: Alpha",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "\u0423\u0431\u0440\u0430\u0442\u044c \u0442\u043e\u043a\u0435\u043d \u0441 \u043a\u0430\u0440\u0442\u044b?",
  });
  await dialog
    .getByRole("button", {
      name: "\u0423\u0434\u0430\u043b\u0438\u0442\u044c",
      exact: true,
    })
    .click();
  await expect.poll(() => deleteRequests.length).toBe(1);
  expect(deleteRequests[0]).toMatchObject({
    method: "DELETE",
    body: { revision: 1 },
  });
  expect(deleteRequests[0].body.actionId).toEqual(expect.any(String));
  expect(deleteRequests[0].body.actionId).toMatch(/^[0-9a-f-]{36}$/i);

  await page.reload();
  await map.locator(".map-object-list-trigger").click();
  await expect(
    objectList.getByRole("button", { name: "Beta", exact: true }),
  ).toBeVisible();
  await expect(
    objectList.getByRole("button", { name: "Alpha", exact: true }),
  ).toHaveCount(0);
  await expect(
    objectList.getByText(/\u0441\u0442\u043e\u043f\u043a\u0430/),
  ).toHaveCount(0);
});

test("a loaded portrait stays available through authoritative keyboard movement", async ({
  page,
}) => {
  const routes = await installCanvasRoutes(page);
  const moves: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/canvas/bulk", async (route) => {
    moves.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revisions: { tokens: { [tokenId]: 1 }, drawings: {} },
      }),
    });
  });
  await page.goto("/");
  const map = page.locator(".map-viewport");
  await expect(map).toHaveAttribute(
    "data-token-image-states",
    `${tokenId}:loaded`,
  );
  await map.evaluate((element) => {
    const values: Array<string | null> = [];
    (
      window as typeof window & { __portraitStates?: Array<string | null> }
    ).__portraitStates = values;
    new MutationObserver(() =>
      values.push(element.getAttribute("data-token-image-states")),
    ).observe(element, {
      attributes: true,
      attributeFilter: ["data-token-image-states"],
    });
  });
  await map.locator(".map-object-list-trigger").click();
  await page
    .getByRole("button", { name: "Selected token", exact: true })
    .click();
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => moves.length).toBe(1);
  await expect(map).toHaveAttribute(
    "data-token-image-states",
    `${tokenId}:loaded`,
  );
  expect(moves[0]).toMatchObject({
    sceneId,
    operation: "MOVE",
    deltaX: 64,
    deltaY: 0,
    targets: [{ targetType: "TOKEN", targetId: tokenId, revision: 0 }],
  });
  const observed = await page.evaluate(
    () =>
      (window as typeof window & { __portraitStates?: Array<string | null> })
        .__portraitStates ?? [],
  );
  expect(
    observed.every(
      (value) =>
        value === `${tokenId}:loaded` || value === `${tokenId}:retained`,
    ),
  ).toBe(true);
  expect(routes.portraitRequestCount()).toBeGreaterThanOrEqual(1);
  expect(routes.portraitRequestCount()).toBeLessThanOrEqual(2);
});

test("Escape leaves DRAW for PAN and clears the selected map object", async ({
  page,
}) => {
  await installCanvasRoutes(page);
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/");

  const map = page.getByRole("region", { name: "Интерактивная карта сцены" });
  await page.getByRole("button", { name: "Рисование" }).click();
  await expect(page.getByRole("button", { name: "Рисование" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page
    .getByRole("button", { name: "Объекты карты", exact: true })
    .click();
  const selectedToken = page.getByRole("button", {
    name: "Selected token",
    exact: true,
  });
  await selectedToken.click();
  await expect(selectedToken).toHaveAttribute("aria-pressed", "true");

  await map.focus();
  // Первый Escape закрывает верхний слой (список объектов), не теряя выбор.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Объекты карты" })).toHaveCount(
    0,
  );

  // Только следующий Escape очищает map selection и возвращает PAN.
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Перемещение" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page
    .getByRole("button", { name: "Объекты карты", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Selected token", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("Ctrl+Z and Ctrl+Shift+Z call authoritative undo and redo once", async ({
  page,
}) => {
  await installCanvasRoutes(page);
  const commands: Array<{ direction: string; body: Record<string, unknown> }> =
    [];
  let historyEntry = {
    sequence: 21,
    type: "TOKEN_MOVE",
    targetType: "TOKEN",
    targetId: tokenId,
    status: "APPLIED",
    nextDirection: "undo" as "undo" | "redo",
  };
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([historyEntry]),
    }),
  );
  await page.route("**/api/canvas/undo", async (route) => {
    commands.push({ direction: "undo", body: route.request().postDataJSON() });
    historyEntry = {
      ...historyEntry,
      status: "UNDONE",
      nextDirection: "redo",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sequence: 21, status: "UNDONE" }),
    });
  });
  await page.route("**/api/canvas/redo", async (route) => {
    commands.push({ direction: "redo", body: route.request().postDataJSON() });
    historyEntry = {
      ...historyEntry,
      status: "APPLIED",
      nextDirection: "undo",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sequence: 21, status: "APPLIED" }),
    });
  });
  await page.goto("/");

  const undo = page.getByRole("button", {
    name: "Отменить: токен перемещён — Selected token",
  });
  const redo = page.getByRole("button", {
    name: "Повторить: токен перемещён — Selected token",
  });
  await expect(undo).toBeEnabled();
  await expect(redo).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect.poll(() => commands.length).toBe(1);

  // Перехват POST ещё не означает, что команда завершилась: refreshEpoch
  // намеренно скрывает прежнюю историю до нового авторитетного GET. Ждём
  // отличимый post-Undo маркер, а не отправляем Redo по устаревшему состоянию.
  await expect(redo).toBeEnabled();
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => commands.length).toBe(2);
  await expect(undo).toBeEnabled();

  expect(commands.map(({ direction }) => direction)).toEqual(["undo", "redo"]);
  for (const { body } of commands) {
    expect(body.sceneId).toBe(sceneId);
    expect(body.actionId).toEqual(expect.any(String));
    expect(body.actionId).toMatch(/^[0-9a-f-]{36}$/i);
  }
});

test("UIX-507 GM shift-selects a mixed group, moves it and confirms deletion", async ({
  page,
}) => {
  await installCanvasRoutes(page);
  const secondId = "95f46186-2ebc-4cf8-bce7-870097305a6b";
  const drawingId = "a5f46186-2ebc-4cf8-bce7-870097305a6b";
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      json: {
        ...snapshot,
        tokens: [
          ...snapshot.tokens,
          {
            ...snapshot.tokens[0],
            id: secondId,
            x: 464,
            y: 700,
            name: "Scale token",
          },
        ],
        drawings: [
          {
            id: drawingId,
            sceneId,
            authorMembershipId: snapshot.me.id,
            points: [0, 0, 64, 64],
            color: "#ef4444",
            strokeWidth: 8,
            x: 480,
            y: 320,
            revision: 0,
          },
        ],
      },
    }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ json: [] }),
  );
  const bulkRequests: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/bulk", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bulkRequests.push(body);
    return route.fulfill({
      json: {
        revisions: {
          tokens: { [tokenId]: 1 },
          drawings: { [drawingId]: 1 },
        },
      },
    });
  });
  await page.goto("/");
  const map = page.locator(".map-viewport");
  const trigger = map.locator(".map-object-list-trigger");
  await trigger.click();
  await map
    .getByRole("button", { name: "Selected token", exact: true })
    .click();
  await trigger.click();
  await expect(map).toHaveAttribute("data-resize-handle-x", /\d/);
  const box = (await map.boundingBox())!;
  const right = Number(await map.getAttribute("data-resize-handle-x"));
  const bottom = Number(await map.getAttribute("data-resize-handle-y"));
  // Read the actual fit transform by comparing two known token handles.
  await trigger.click();
  await map.getByRole("button", { name: "Scale token", exact: true }).click();
  await trigger.click();
  const secondRight = Number(await map.getAttribute("data-resize-handle-x"));
  const scale = (secondRight - right) / 80;

  // Plain empty-canvas drag remains camera pan and never creates selection.
  await page.keyboard.press("Escape");
  const panStart = {
    x: box.x + right - 80 * scale,
    y: box.y + bottom - 80 * scale,
  };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 40, panStart.y, { steps: 4 });
  await page.mouse.up();
  await expect(
    page.getByRole("status", { name: "Выбрано объектов" }),
  ).toHaveCount(0);
  await trigger.click();
  await map
    .getByRole("button", { name: "Selected token", exact: true })
    .click();
  await trigger.click();
  const rightAfterPan = Number(await map.getAttribute("data-resize-handle-x"));
  const bottomAfterPan = Number(await map.getAttribute("data-resize-handle-y"));
  expect(rightAfterPan).toBeCloseTo(right + 40, 0);
  await page.keyboard.press("Escape");

  const screenPoint = (x: number, y: number) => ({
    x: box.x + rightAfterPan - (snapshot.tokens[0]!.x + 64) * scale + x * scale,
    y:
      box.y + bottomAfterPan - (snapshot.tokens[0]!.y + 64) * scale + y * scale,
  });
  const marqueeStart = screenPoint(350, 285);
  const marqueeEnd = screenPoint(560, 415);
  await page.keyboard.down("Shift");
  await page.mouse.move(marqueeStart.x, marqueeStart.y);
  await page.mouse.down();
  await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const selection = page.getByRole("status", { name: "Выбрано объектов" });
  await expect(selection).toHaveText(
    "Выбрано объектов: 2. Токенов: 1. Рисунков: 1.",
  );

  // Shift+click toggles one drawing without replacing the token selection.
  const drawingPoint = screenPoint(512, 352);
  await page.keyboard.down("Shift");
  await page.mouse.click(drawingPoint.x, drawingPoint.y);
  await page.keyboard.up("Shift");
  await expect(selection).toHaveText(
    "Выбрано объектов: 1. Токенов: 1. Рисунков: 0.",
  );
  await page.keyboard.down("Shift");
  await page.mouse.click(drawingPoint.x, drawingPoint.y);
  await page.keyboard.up("Shift");
  await expect(selection).toHaveText(
    "Выбрано объектов: 2. Токенов: 1. Рисунков: 1.",
  );

  // Dragging either selected member uses the existing queued mixed bulk move.
  const tokenCenter = screenPoint(416, 352);
  await page.mouse.move(tokenCenter.x, tokenCenter.y);
  await page.mouse.down();
  await page.mouse.move(tokenCenter.x + 64 * scale, tokenCenter.y, {
    steps: 6,
  });
  await page.mouse.up();
  await expect.poll(() => bulkRequests.length).toBe(1);
  expect(bulkRequests[0]).toMatchObject({
    operation: "MOVE",
    targets: [
      { targetType: "TOKEN", targetId: tokenId, revision: 0 },
      { targetType: "DRAWING", targetId: drawingId, revision: 0 },
    ],
  });

  await page.getByRole("button", { name: "Удалить выбранное" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Удалить выбранные объекты?",
  });
  await expect(dialog).toContainText(
    "Выбрано объектов: 2. Токенов: 1. Рисунков: 1.",
  );
  expect(bulkRequests).toHaveLength(1);
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect.poll(() => bulkRequests.length).toBe(2);
  expect(bulkRequests[1]).toMatchObject({
    operation: "DELETE",
    targets: [
      { targetType: "TOKEN", targetId: tokenId },
      { targetType: "DRAWING", targetId: drawingId },
    ],
  });
});

test("UIX-507 PLAYER marquee excludes inaccessible objects and reload prunes selection", async ({
  page,
}) => {
  await installCanvasRoutes(page);
  const playerId = "b5f46186-2ebc-4cf8-bce7-870097305a6b";
  const ownDrawingId = "c5f46186-2ebc-4cf8-bce7-870097305a6b";
  let accessEnabled = true;
  let playerMode = false;
  const playerSnapshot = () => ({
    ...snapshot,
    me: {
      ...snapshot.me,
      id: playerId,
      role: playerMode ? ("PLAYER" as const) : ("GM" as const),
    },
    tokens: [
      {
        ...snapshot.tokens[0],
        name: "Owned token",
        controllerMembershipIds: accessEnabled ? [playerId] : [],
        ownerMembershipId: accessEnabled ? playerId : null,
      },
      {
        ...snapshot.tokens[0],
        id: "foreign",
        x: 480,
        assetId: null,
        name: "Foreign token",
      },
      {
        ...snapshot.tokens[0],
        id: "locked",
        x: 560,
        assetId: null,
        name: "Locked token",
        locked: true,
        controllerMembershipIds: [playerId],
      },
      {
        ...snapshot.tokens[0],
        id: "map-layer",
        x: 640,
        assetId: null,
        name: "Map token",
        layer: "MAP" as const,
        controllerMembershipIds: [playerId],
      },
      {
        ...snapshot.tokens[0],
        id: "gm-layer",
        x: 720,
        assetId: null,
        name: "GM token",
        layer: "GM" as const,
        controllerMembershipIds: [playerId],
      },
    ],
    drawings: [
      {
        id: ownDrawingId,
        sceneId,
        authorMembershipId: accessEnabled ? playerId : "other",
        points: [0, 0, 64, 64],
        color: "#ef4444",
        strokeWidth: 8,
        x: 480,
        y: 400,
        revision: 0,
      },
      {
        id: "foreign-drawing",
        sceneId,
        authorMembershipId: "other",
        points: [0, 0, 64, 64],
        color: "#22c55e",
        strokeWidth: 8,
        x: 560,
        y: 400,
        revision: 0,
      },
    ],
    fogReveals: [
      { id: "reveal", sceneId, x: 0, y: 0, width: 1600, height: 1000 },
    ],
  });
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ json: playerSnapshot() }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ json: [] }),
  );
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/canvas/bulk", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        revisions: {
          tokens: { [tokenId]: 1 },
          drawings: { [ownDrawingId]: 1 },
        },
      },
    });
  });
  await page.goto("/");
  const map = page.locator(".map-viewport");
  const trigger = map.locator(".map-object-list-trigger");
  await trigger.click();
  await map.getByRole("button", { name: "Owned token", exact: true }).click();
  await trigger.click();
  const ownedRight = Number(await map.getAttribute("data-resize-handle-x"));
  const ownedBottom = Number(await map.getAttribute("data-resize-handle-y"));
  await trigger.click();
  await map.getByRole("button", { name: "Locked token", exact: true }).click();
  await trigger.click();
  const lockedRight = Number(await map.getAttribute("data-resize-handle-x"));
  const scale = (lockedRight - ownedRight) / (560 - 384);
  const offsetX = ownedRight - (384 + 64) * scale;
  const offsetY = ownedBottom - (320 + 64) * scale;

  playerMode = true;
  await page.reload();
  const box = (await map.boundingBox())!;
  const screenPoint = (x: number, y: number) => ({
    x: box.x + offsetX + x * scale,
    y: box.y + offsetY + y * scale,
  });
  const marqueeStart = screenPoint(350, 285);
  const marqueeEnd = screenPoint(700, 500);
  await page.keyboard.down("Shift");
  await page.mouse.move(marqueeStart.x, marqueeStart.y);
  await page.mouse.down();
  await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const selection = page.getByRole("status", { name: "Выбрано объектов" });
  await expect(selection).toHaveText(
    "Выбрано объектов: 2. Токенов: 1. Рисунков: 1.",
  );
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    operation: "MOVE",
    targets: [
      { targetType: "TOKEN", targetId: tokenId },
      { targetType: "DRAWING", targetId: ownDrawingId },
    ],
  });

  accessEnabled = false;
  await page.reload();
  await expect(selection).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Удалить выбранное" }),
  ).toHaveCount(0);
});

test("UIX-621 compact multiline conditions visual fixture", async ({
  page,
}) => {
  await installCanvasRoutes(page);
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      json: {
        ...snapshot,
        tokens: [
          {
            ...snapshot.tokens[0],
            conditions: ["POISONED", "UNCONSCIOUS", "RESTRAINED", "PRONE"],
          },
        ],
      },
    }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/");
  const map = page.locator(".map-viewport");
  const trigger = map.locator(".map-object-list-trigger");
  await trigger.click();
  await map
    .getByRole("button", { name: "Selected token", exact: true })
    .click();
  await trigger.click();
  await expect(map).toHaveAttribute("data-resize-handle-x", /\d/);
  const box = (await map.boundingBox())!;
  const right = Number(await map.getAttribute("data-resize-handle-x"));
  const bottom = Number(await map.getAttribute("data-resize-handle-y"));
  await page.mouse.move(box.x + right - 15, box.y + bottom - 15);
  await page.waitForTimeout(150);
  await map.screenshot({ path: "test-results/uix-621-compact-conditions.png" });
});

test("UIX-621 rapid conditions render before delayed server confirmation and stay combined", async ({
  page,
}) => {
  await installCanvasRoutes(page);
  const current: GameSnapshot = structuredClone(snapshot);
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ json: [] }),
  );
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const commands: Array<{ revision: number; conditions: string[] }> = [];
  let acknowledged = 0;
  await page.route(`**/api/tokens/${tokenId}/conditions`, async (route) => {
    const body = route.request().postDataJSON();
    commands.push(body);
    if (commands.length === 1) await delayed;
    expect(body.revision).toBe(current.tokens[0].revision);
    current.tokens[0].conditions = body.conditions;
    current.tokens[0].revision += 1;
    await route.fulfill({ json: current.tokens[0] });
    acknowledged += 1;
  });
  await page.goto("/");
  const map = page.locator(".map-viewport");
  const trigger = map.locator(".map-object-list-trigger");
  await trigger.click();
  await map
    .getByRole("button", { name: "Selected token", exact: true })
    .click();
  await trigger.click();
  await map.press("Enter");
  const poison = page.getByRole("menuitemcheckbox", { name: /Отравлен/ });
  const restrained = page.getByRole("menuitemcheckbox", { name: /Обездвижен/ });
  const prone = page.getByRole("menuitemcheckbox", { name: /Распластан/ });
  try {
    await poison.click();
    await restrained.click();
    await prone.click();
    await expect(poison).toHaveAttribute("aria-checked", "true");
    await expect(restrained).toHaveAttribute("aria-checked", "true");
    await expect(prone).toHaveAttribute("aria-checked", "true");
    expect(acknowledged).toBe(0);
    expect(commands).toHaveLength(1);
  } finally {
    release();
  }
  await expect.poll(() => acknowledged).toBe(2);
  expect(commands[1]).toMatchObject({
    revision: 1,
    conditions: ["POISONED", "RESTRAINED", "PRONE"],
  });
  await expect(poison).toHaveAttribute("aria-checked", "true");
  await expect(restrained).toHaveAttribute("aria-checked", "true");
  await expect(prone).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("group", { name: "Состояния токена" }),
  ).toBeHidden();
});
