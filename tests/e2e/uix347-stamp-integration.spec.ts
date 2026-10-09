import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { DrawingDto, GameSnapshot } from "@arken/contracts";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

const png = (key: "forest" | "mountains" | "clouds") =>
  readFileSync(
    resolve(process.cwd(), `apps/server/assets/terrain-stamps/${key}.png`),
  );
const sceneId = "uix347-scene";
const makeStamp = (
  id: string,
  layer: "PUBLIC" | "GM" = "PUBLIC",
): DrawingDto => ({
  id,
  sceneId,
  authorMembershipId: "uix347-gm",
  points: [],
  color: "#ffffff",
  x: 500,
  y: 400,
  revision: 1,
  kind: "STAMP",
  assetKey: "forest",
  packId: "builtin-terrain-v1",
  size: 120,
  rotation: 0,
  layer,
});
function snapshotFor(role: "GM" | "PLAYER", count = 0): GameSnapshot {
  const snapshot = buildGameSnapshot(role, {
    scenes: [
      {
        id: sceneId,
        name: "Stamp QA",
        projection: "ORTHOGRAPHIC_2D",
        mapAssetId: null,
        width: 1200,
        height: 800,
        backgroundFrame: { x: 0, y: 0, width: 1200, height: 800 },
        grid: {
          enabled: false,
          size: 64,
          offsetX: 0,
          offsetY: 0,
          color: "#cccccc",
          opacity: 0.2,
        },
        active: true,
      },
    ],
  });
  if (role === "PLAYER") snapshot.me.role = "PLAYER";
  snapshot.drawings = Array.from({ length: count }, (_, index) =>
    makeStamp(`stamp-${index}`, "PUBLIC"),
  );
  return snapshot;
}
async function installMocks(
  page: Page,
  snapshot: GameSnapshot,
  options: { holdStampAck?: boolean } = {},
) {
  const commands: Array<{ path: string; body: any }> = [];
  const assetRequests: string[] = [];
  const historyEntries: Array<Record<string, unknown>> = [];
  let releaseStampAck: (() => void) | null = null;
  let ws: WebSocketRoute | null = null;
  const stampAckGate = options.holdStampAck
    ? new Promise<void>((resolve) => {
        releaseStampAck = resolve;
      })
    : Promise.resolve();
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (
      path === "/api/terrain-stamps/assets/forest" ||
      path === "/api/terrain-stamps/assets/mountains" ||
      path === "/api/terrain-stamps/assets/clouds"
    ) {
      const key = path.split("/").at(-1) as "forest" | "mountains" | "clouds";
      assetRequests.push(path);
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "cache-control": "private, no-store" },
        body: png(key),
      });
    }
    if (path === "/api/terrain-stamps/catalog") {
      if (snapshot.me.role !== "GM")
        throw new Error("PLAYER requested GM stamp catalog");
      return route.fulfill({
        json: {
          packId: "builtin-terrain-v1",
          stamps: ["forest", "mountains", "clouds"].map((assetKey) => ({
            assetKey,
            packId: "builtin-terrain-v1",
          })),
        },
      });
    }
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/client-logs")
      return route.fulfill({ status: 204, body: "" });
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/canvas/history")
      return route.fulfill({ json: historyEntries });
    if (request.method() === "POST" && path === "/api/drawings") {
      const body = request.postDataJSON();
      commands.push({ path, body });
      await stampAckGate;
      historyEntries.unshift({
        sequence: 1,
        type: "DRAWING_CREATE",
        targetType: "DRAWING",
        targetId: "created",
        status: "APPLIED",
        nextDirection: "undo",
      });
      return route.fulfill({
        status: 201,
        json: {
          ...body,
          id: `created-${commands.length}`,
          authorMembershipId: snapshot.me.id,
          revision: 1,
        },
      });
    }
    if (path.startsWith("/api/drawings/") && request.method() !== "GET") {
      const body = request.postDataJSON();
      commands.push({ path: `${request.method()} ${path}`, body });
      const id = path.split("/").at(-1)!;
      const original =
        snapshot.drawings?.find((item) => path.includes(item.id)) ??
        makeStamp(id);
      if (path.endsWith("/copy"))
        return route.fulfill({
          status: 201,
          json: {
            ...original,
            id: `copy-${id}`,
            x: original.x + 16,
            y: original.y + 16,
            revision: 1,
          },
        });
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/api/canvas/bulk" && request.method() === "POST") {
      const body = request.postDataJSON();
      commands.push({ path, body });
      return route.fulfill({
        json: {
          revisions: {
            tokens: {},
            drawings: Object.fromEntries(
              (body.targets ?? [])
                .filter((target: any) => target.targetType === "DRAWING")
                .map((target: any) => [target.targetId, target.revision + 1]),
            ),
          },
        },
      });
    }
    if (
      (path === "/api/canvas/undo" || path === "/api/canvas/redo") &&
      request.method() === "POST"
    ) {
      commands.push({ path, body: request.postDataJSON() });
      return route.fulfill({ json: { ok: true } });
    }
    if (request.method() === "PATCH" && path.startsWith("/api/drawings/")) {
      const body = request.postDataJSON();
      commands.push({ path, body });
      const original = snapshot.drawings?.find((item) =>
        path.endsWith(item.id),
      );
      return route.fulfill({
        json: { ...original, ...body, revision: (original?.revision ?? 1) + 1 },
      });
    }
    if (request.method() === "GET") return route.fulfill({ json: [] });
    if (path === "/api/client-logs")
      return route.fulfill({ status: 204, body: "" });
    throw new Error(
      `Unexpected UIX-347 test API request: ${request.method()} ${path}`,
    );
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    ws = socket;
    socket.onMessage((message) => {
      const wire = message.toString();
      if (wire === "40") socket.send('40{"sid":"uix347-mock"}');
    });
    socket.send(
      '0{"sid":"uix347-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  return {
    commands,
    assetRequests,
    releaseStampAck: () => releaseStampAck?.(),
    sendSnapshot: (next: GameSnapshot) =>
      ws?.send(`42["game:snapshot",${JSON.stringify(next)}]`),
  };
}

test("UIX-347 GM palette places one authoritative stamp; cancel emits nothing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1077, height: 900 });
  const { commands, assetRequests } = await installMocks(
    page,
    snapshotFor("GM"),
  );
  await page.goto("/");
  await expect(page.locator(".map-viewport")).toBeVisible();
  await page.getByRole("button", { name: "Штамп рельефа" }).click();
  await expect(
    page.getByRole("group", { name: "Выбрать штамп" }),
  ).toBeVisible();
  await expect.poll(() => assetRequests.length).toBe(3);
  await page.getByRole("button", { name: "Горы" }).click();
  const size = page.getByLabel("Размер штампа");
  await size.focus();
  for (let step = 0; step < 5; step++) await size.press("ArrowRight");
  const rotation = page.getByLabel("Поворот штампа");
  await rotation.focus();
  for (let step = 0; step < 3; step++) await rotation.press("ArrowRight");
  const map = page.locator(".map-viewport");
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no bounds");
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await expect
    .poll(
      () => commands.filter((entry) => entry.path === "/api/drawings").length,
    )
    .toBe(1);
  const command = commands[0]!.body;
  expect(command).toMatchObject({
    kind: "STAMP",
    assetKey: "mountains",
    packId: "builtin-terrain-v1",
    size: 240,
    rotation: 45,
    layer: "PUBLIC",
    sceneId,
  });
  expect(command.actionId).toBeTruthy();
  await expect(page.locator(".map-viewport")).toHaveAttribute(
    "data-terrain-stamp-count",
    "1",
  );
  const undo = page.locator('.map-tool[data-tool="UNDO"]');
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect
    .poll(() => commands.some((entry) => entry.path === "/api/canvas/undo"))
    .toBe(true);

  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => commands.length).toBe(3);
  const canvas = page.locator(".map-viewport canvas").first();
  await canvas.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width * 0.75,
    clientY: box.y + box.height * 0.6,
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
      }),
    ),
  );
  await expect.poll(() => commands.length).toBe(3);
});

test("UIX-347 canonical socket snapshot during pending create acknowledgement does not resurrect or duplicate", async ({
  page,
}) => {
  const snapshot = snapshotFor("GM");
  const { commands, releaseStampAck, sendSnapshot } = await installMocks(
    page,
    snapshot,
    { holdStampAck: true },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Штамп рельефа" }).click();
  const map = page.locator(".map-viewport");
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no bounds");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect
    .poll(
      () => commands.filter((entry) => entry.path === "/api/drawings").length,
    )
    .toBe(1);
  const body = commands[0]!.body;
  const canonical = {
    ...body,
    id: "created-1",
    authorMembershipId: snapshot.me.id,
    revision: 1,
  };
  const updated = {
    ...snapshot,
    snapshotVersion: snapshot.snapshotVersion + 1,
    drawings: [canonical],
  };
  sendSnapshot(updated);
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "1");
  releaseStampAck();
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "1");
  sendSnapshot(updated);
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "1");
  expect(
    commands.filter((entry) => entry.path === "/api/drawings"),
  ).toHaveLength(1);
});

test("UIX-347 late create acknowledgement cannot resurrect a canonical deletion", async ({
  page,
}) => {
  const snapshot = snapshotFor("GM");
  const { commands, releaseStampAck, sendSnapshot } = await installMocks(
    page,
    snapshot,
    { holdStampAck: true },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Штамп рельефа" }).click();
  const map = page.locator(".map-viewport");
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no bounds");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect
    .poll(
      () => commands.filter((entry) => entry.path === "/api/drawings").length,
    )
    .toBe(1);
  const body = commands[0]!.body;
  const canonical = {
    ...body,
    id: "created-1",
    authorMembershipId: snapshot.me.id,
    revision: 1,
  };
  sendSnapshot({
    ...snapshot,
    snapshotVersion: snapshot.snapshotVersion + 1,
    drawings: [canonical],
  });
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "1");
  sendSnapshot({
    ...snapshot,
    snapshotVersion: snapshot.snapshotVersion + 2,
    drawings: [],
  });
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "0");
  releaseStampAck();
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "0");
  expect(
    commands.filter((entry) => entry.path === "/api/drawings"),
  ).toHaveLength(1);
});

test("UIX-347 late create acknowledgement stays out of a newly selected scene", async ({
  page,
}) => {
  const snapshot = snapshotFor("GM");
  const secondScene = {
    ...snapshot.scenes[0]!,
    id: "uix347-other-scene",
    name: "Other QA scene",
    active: false,
  };
  snapshot.scenes.push(secondScene);
  const { commands, releaseStampAck } = await installMocks(page, snapshot, {
    holdStampAck: true,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Штамп рельефа" }).click();
  const map = page.locator(".map-viewport");
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no bounds");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect
    .poll(
      () => commands.filter((entry) => entry.path === "/api/drawings").length,
    )
    .toBe(1);

  await page.locator(".scene-picker summary").click();
  await page.getByRole("menuitemradio", { name: /Other QA scene/ }).click();
  await expect(page.locator(".scene-picker summary")).toContainText(
    "Other QA scene",
  );
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "0");
  releaseStampAck();
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "0");

  await page.locator(".scene-picker summary").click();
  await page.getByRole("menuitemradio", { name: /Stamp QA/ }).click();
  await expect(page.locator(".scene-picker summary")).toContainText("Stamp QA");
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "0");
});

test("UIX-347 PLAYER renders a public stamp but requests no GM catalog and cannot edit it", async ({
  page,
}) => {
  const snapshot = snapshotFor("PLAYER", 1);
  const { commands, assetRequests } = await installMocks(page, snapshot);
  await page.goto("/");
  await expect(page.locator(".map-viewport")).toHaveAttribute(
    "data-terrain-stamp-count",
    "1",
  );
  await expect.poll(() => assetRequests.length).toBe(1);
  await expect(page.getByRole("button", { name: "Штамп рельефа" })).toHaveCount(
    0,
  );
  expect(assetRequests).toEqual(["/api/terrain-stamps/assets/forest"]);
  expect(commands).toHaveLength(0);
});

test("UIX-347 GM selects, moves, copies and deletes a stamp through shared canvas commands", async ({
  page,
}) => {
  const snapshot = snapshotFor("GM", 1);
  snapshot.drawings = [
    makeStamp("stamp-target"),
    { ...makeStamp("stamp-target-2"), x: 800, y: 520 },
  ];
  const { commands } = await installMocks(page, snapshot);
  await page.goto("/");
  const map = page.locator(".map-viewport");
  await expect(map).toHaveAttribute("data-terrain-stamp-count", "2");
  await page.getByRole("button", { name: "Объекты карты" }).click();
  const list = page.getByRole("region", { name: "Объекты карты", exact: true });
  await list.getByRole("button", { name: "Рисунок 1", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Панель параметров рисунка" }),
  ).toBeVisible();
  await expect(page.getByLabel("Размер выбранного штампа")).toBeVisible();
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => commands.some((entry) => entry.path === "/api/canvas/bulk"))
    .toBe(true);
  expect(
    commands.find((entry) => entry.path === "/api/canvas/bulk")?.body,
  ).toMatchObject({
    operation: "MOVE",
    targets: [{ targetType: "DRAWING", targetId: "stamp-target" }],
  });
  await list.getByRole("button", { name: "Дублировать: Рисунок 1" }).click();
  await expect
    .poll(() =>
      commands.some(
        (entry) => entry.path === "POST /api/drawings/stamp-target/copy",
      ),
    )
    .toBe(true);
  await list.getByRole("button", { name: "Удалить: Рисунок 1" }).click();
  await expect
    .poll(() =>
      commands.some(
        (entry) => entry.path === "DELETE /api/drawings/stamp-target",
      ),
    )
    .toBe(true);
});

test("UIX-347 marquee selects stamps and mixed selection uses shared move/delete commands", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const snapshot = snapshotFor("GM", 0);
  snapshot.drawings = [
    { ...makeStamp("stamp-left"), x: 430, y: 400 },
    { ...makeStamp("stamp-right"), x: 650, y: 400 },
  ];
  const { commands } = await installMocks(page, snapshot);
  await page.goto("/");
  const map = page.locator(".map-viewport");
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no bounds");
  // Shift+drag on blank canvas is the existing PAN-tool marquee gesture.
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.73, box.y + box.height * 0.62, {
    steps: 8,
  });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(
    page.getByRole("button", { name: "Удалить выбранное" }),
  ).toBeVisible();
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() =>
      commands.some(
        (entry) =>
          entry.path === "/api/canvas/bulk" && entry.body.operation === "MOVE",
      ),
    )
    .toBe(true);
  const move = commands.find(
    (entry) =>
      entry.path === "/api/canvas/bulk" && entry.body.operation === "MOVE",
  )!;
  expect(
    move.body.targets
      .map((target: { targetId: string }) => target.targetId)
      .sort(),
  ).toEqual(["stamp-left", "stamp-right"]);
  await page.getByRole("button", { name: "Удалить выбранное" }).click();
  await expect(
    page.getByRole("dialog", { name: "Удалить выбранные объекты?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect
    .poll(() =>
      commands.some(
        (entry) =>
          entry.path === "/api/canvas/bulk" &&
          entry.body.operation === "DELETE",
      ),
    )
    .toBe(true);
  const remove = commands.find(
    (entry) =>
      entry.path === "/api/canvas/bulk" && entry.body.operation === "DELETE",
  )!;
  expect(
    remove.body.targets
      .map((target: { targetId: string }) => target.targetId)
      .sort(),
  ).toEqual(["stamp-left", "stamp-right"]);
});

for (const count of [100, 500]) {
  test(`UIX-347 actual protected raster ${count}-stamp render sample`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { assetRequests } = await installMocks(
      page,
      snapshotFor("GM", count),
    );
    const started = Date.now();
    await page.goto("/");
    await expect(page.locator(".map-viewport")).toHaveAttribute(
      "data-terrain-stamp-count",
      String(count),
    );
    await expect.poll(() => assetRequests.length).toBe(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const elapsedMs = Date.now() - started;
    const canvasCount = await page.locator(".map-viewport canvas").count();
    console.log(
      JSON.stringify({
        pool: "UIX-347",
        count,
        elapsedMsToMountedAndFrame: elapsedMs,
        canvasCount,
        protectedAssetFetches: assetRequests.length,
      }),
    );
    expect(canvasCount).toBeGreaterThan(0);
  });
}
