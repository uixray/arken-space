import type { GameSnapshot } from "@arken/contracts";
import type { Locator, Page, Route, WebSocketRoute } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

const sceneId = "50700000-0000-4000-8000-000000000001";
const tokenId = "50700000-0000-4000-8000-000000000002";
const drawingId = "50700000-0000-4000-8000-000000000003";
function fixture(): GameSnapshot {
  const snapshot = gmSnapshot();
  snapshot.scenes = [
    {
      id: sceneId,
      name: "Проверка выбора",
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
  ];
  snapshot.tokens = [
    {
      id: tokenId,
      definitionId: "50700000-0000-4000-8000-000000000004",
      definitionRevision: 0,
      sceneId,
      characterId: null,
      ownerMembershipId: null,
      controllerMembershipIds: [],
      assetId: null,
      name: "Выбранный токен",
      x: 384,
      y: 320,
      width: 64,
      height: 64,
      z: 0,
      levelId: null,
      rotation: 0,
      visible: true,
      locked: false,
      baseColor: "#8899aa",
      frameColor: null,
      layer: "PLAYER",
      conditions: [],
      revision: 0,
    },
  ];
  snapshot.drawings = [
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
  ];
  return snapshot;
}
async function boundary(page: Page) {
  let snapshot = fixture();
  const sockets = new Set<WebSocketRoute>();
  const writes: Record<string, unknown>[] = [];
  const unexpected: string[] = [];
  let held: Route | undefined;
  let bootstrapReads = 0;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") {
        sockets.add(socket);
        socket.send('40{"sid":"selection-socket"}');
      }
    });
    socket.onClose(() => sockets.delete(socket));
    socket.send(
      '0{"sid":"selection-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") {
      if (path === "/api/bootstrap") {
        bootstrapReads++;
        return route.fulfill({ json: snapshot });
      }
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/player-access" || path === "/api/canvas/history")
        return route.fulfill({ json: [] });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({
          status: 403,
          json: {
            error: "FORBIDDEN",
            message: "Нет доступа к операторскому разделу.",
          },
        });
    }
    if (path === "/api/client-logs" && request.method() === "POST")
      return route.fulfill({ status: 202, body: "" });
    if (path === "/api/canvas/bulk" && request.method() === "POST") {
      writes.push(request.postDataJSON() as Record<string, unknown>);
      if (held) {
        unexpected.push("Concurrent bulk mutation while previous request held");
        return route.abort("blockedbyclient");
      }
      held = route;
      return;
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.abort("blockedbyclient");
  });
  return {
    writes,
    unexpected,
    reads: () => bootstrapReads,
    publish: async (next: GameSnapshot) => {
      snapshot = next;
      await expect.poll(() => sockets.size).toBeGreaterThan(0);
      for (const socket of sockets)
        socket.send(`42${JSON.stringify(["game:snapshot", snapshot])}`);
    },
    reject: async () => {
      expect(held).toBeDefined();
      const response = held!;
      held = undefined;
      await response.fulfill({
        status: 409,
        json: {
          error: "CANVAS_CONFLICT",
          message: "Объекты карты изменились. Повторите действие.",
        },
      });
    },
    accept: async (revision: number) => {
      expect(held).toBeDefined();
      const response = held!;
      held = undefined;
      await response.fulfill({
        json: {
          revisions: {
            tokens: { [tokenId]: revision },
            drawings: { [drawingId]: revision },
          },
        },
      });
    },
    cleanup: async () => {
      if (held) await held.abort("blockedbyclient").catch(() => undefined);
    },
  };
}
async function selectMixed(page: Page) {
  const map = page.locator(".map-viewport");
  const trigger = page.getByRole("button", {
    name: "Объекты карты",
    exact: true,
  });
  await trigger.click();
  await map
    .getByRole("button", { name: "Выбранный токен", exact: true })
    .click();
  await trigger.click();
  const box = (await map.boundingBox())!;
  const right = Number(await map.getAttribute("data-resize-handle-x"));
  const bottom = Number(await map.getAttribute("data-resize-handle-y"));
  const scale = Number(
    await map.getByRole("slider", { name: "Масштаб карты" }).inputValue(),
  );
  expect(scale).toBeGreaterThan(0);
  const point = (x: number, y: number) => ({
    x: box.x + right + (x - 448) * scale,
    y: box.y + bottom + (y - 384) * scale,
  });
  const drawing = point(512, 352);
  await page.keyboard.down("Shift");
  await page.mouse.click(drawing.x, drawing.y);
  await page.keyboard.up("Shift");
  return { map, point, scale };
}
async function inspectSelection(page: Page, counts: string) {
  await page
    .getByRole("button", { name: "Удалить выбранное", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Удалить выбранные объекты?",
    exact: true,
  });
  await expect(dialog).toContainText(counts);
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function redCenter(map: Locator) {
  return map.evaluate((owner) => {
    let total = 0,
      x = 0,
      y = 0;
    const ownerBox = owner.getBoundingClientRect();
    for (const canvas of owner.querySelectorAll("canvas")) {
      const context = canvas.getContext("2d");
      if (!context) continue;
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      const box = canvas.getBoundingClientRect();
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          Math.abs(pixels[i]! - 239) < 5 &&
          Math.abs(pixels[i + 1]! - 68) < 5 &&
          Math.abs(pixels[i + 2]! - 68) < 5 &&
          pixels[i + 3]! > 200
        ) {
          const index = i / 4;
          total++;
          x +=
            box.left -
            ownerBox.left +
            ((index % canvas.width) * box.width) / canvas.width;
          y +=
            box.top -
            ownerBox.top +
            (Math.floor(index / canvas.width) * box.height) / canvas.height;
        }
      }
    }
    return { total, x: x / total, y: y / total };
  });
}

for (const origin of ["token", "drawing"] as const) {
  test(`UIX-507 rejected mixed MOVE from ${origin} converges visually to authoritative socket positions`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await boundary(page);
    try {
      await page.goto("/");
      const { map, point, scale } = await selectMixed(page);
      await inspectSelection(
        page,
        "Выбрано объектов: 2. Токенов: 1. Рисунков: 1.",
      );
      const before = await redCenter(map);
      expect(before.total).toBeGreaterThan(0);
      const originalRight = Number(
        await map.getAttribute("data-resize-handle-x"),
      );
      const start = point(origin === "token" ? 416 : 512, 352);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 64 * scale, start.y, { steps: 4 });
      await page.mouse.up();
      await expect.poll(() => mock.writes.length).toBe(1);
      expect(mock.writes[0]).toMatchObject({
        operation: "MOVE",
        sceneId,
        targets: [
          { targetType: "TOKEN", targetId: tokenId, revision: 0 },
          { targetType: "DRAWING", targetId: drawingId, revision: 0 },
        ],
      });
      await expect
        .poll(async () => (await redCenter(map)).x)
        .toBeCloseTo(before.x + 64 * scale, 0);
      const reads = mock.reads();
      await mock.reject();
      await expect(
        page
          .getByText(/^Объекты карты изменились\. Повторите действие\./)
          .first(),
      ).toBeVisible();
      // A rejected local move must roll back before the later authoritative
      // socket packet; convergence alone would hide a stranded optimistic draft.
      await expect
        .poll(async () => (await redCenter(map)).x)
        .toBeCloseTo(before.x, 0);
      await expect
        .poll(async () =>
          Number(await map.getAttribute("data-resize-handle-x")),
        )
        .toBeCloseTo(originalRight, 0);
      const authoritative = fixture();
      authoritative.snapshotVersion = 2;
      authoritative.tokens[0] = {
        ...authoritative.tokens[0]!,
        x: 416,
        revision: 2,
      };
      if (!authoritative.drawings?.[0])
        throw new Error("Expected drawing in selection fixture");
      authoritative.drawings[0] = {
        ...authoritative.drawings[0]!,
        x: 512,
        revision: 2,
      };
      await mock.publish(authoritative);
      await expect
        .poll(async () => (await redCenter(map)).x)
        .toBeCloseTo(before.x + 32 * scale, 0);
      await page.keyboard.press("Escape");
      const trigger = page.getByRole("button", {
        name: "Объекты карты",
        exact: true,
      });
      await trigger.click();
      await map
        .getByRole("button", { name: "Выбранный токен", exact: true })
        .click();
      await trigger.click();
      const expectedRight = point(480, 384).x - (await map.boundingBox())!.x;
      await expect
        .poll(async () =>
          Number(await map.getAttribute("data-resize-handle-x")),
        )
        .toBeCloseTo(expectedRight, 0);
      expect(mock.reads()).toBe(reads);
      expect(mock.writes).toHaveLength(1);
      expect(mock.unexpected).toEqual([]);
      await testInfo.attach("selection-authoritative-recovery.png", {
        body: await map.screenshot(),
        contentType: "image/png",
      });
    } finally {
      await mock.cleanup();
    }
  });
}

test("UIX-507 rapid mixed MOVE keeps queued members aligned and acknowledges each delta once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const mock = await boundary(page);
  try {
    await page.goto("/");
    const { map, point, scale } = await selectMixed(page);
    await inspectSelection(
      page,
      "Выбрано объектов: 2. Токенов: 1. Рисунков: 1.",
    );
    const before = await redCenter(map);
    for (const index of [0, 1]) {
      const start = point(416 + index * 64, 352);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 64 * scale, start.y, { steps: 4 });
      await page.mouse.up();
      await expect
        .poll(async () => (await redCenter(map)).x)
        .toBeCloseTo(before.x + (index + 1) * 64 * scale, 0);
      if (index === 0) await expect.poll(() => mock.writes.length).toBe(1);
      expect(mock.writes).toHaveLength(1);
    }
    await mock.accept(1);
    await expect.poll(() => mock.writes.length).toBe(2);
    await expect
      .poll(async () => (await redCenter(map)).x)
      .toBeCloseTo(before.x + 128 * scale, 0);
    expect(mock.writes[1]).toMatchObject({
      operation: "MOVE",
      deltaX: 64,
      deltaY: 0,
      targets: [
        { targetType: "TOKEN", targetId: tokenId, revision: 1 },
        { targetType: "DRAWING", targetId: drawingId, revision: 1 },
      ],
    });
    await mock.accept(2);
    const canonical = fixture();
    canonical.snapshotVersion = 2;
    canonical.tokens[0] = { ...canonical.tokens[0]!, x: 512, revision: 2 };
    if (!canonical.drawings?.[0]) throw new Error("Expected drawing fixture");
    canonical.drawings[0] = { ...canonical.drawings[0], x: 608, revision: 2 };
    await mock.publish(canonical);
    await expect
      .poll(async () => (await redCenter(map)).x)
      .toBeCloseTo(before.x + 128 * scale, 0);
    expect(mock.writes).toHaveLength(2);
    expect(mock.unexpected).toEqual([]);
  } finally {
    await mock.cleanup();
  }
});

test("UIX-507 in-place authoritative deletion prunes only the missing selected member", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const mock = await boundary(page);
  try {
    await page.goto("/");
    await selectMixed(page);
    await inspectSelection(
      page,
      "Выбрано объектов: 2. Токенов: 1. Рисунков: 1.",
    );
    const next = fixture();
    next.snapshotVersion = 2;
    next.drawings = [];
    await mock.publish(next);
    // Bulk actions intentionally disappear for one selected object. Check the
    // remaining token's real resize affordance, not a nonexistent count dialog.
    const map = page.locator(".map-viewport");
    await expect(
      page.getByRole("button", { name: "Удалить выбранное", exact: true }),
    ).toHaveCount(0);
    await expect(map).toHaveAttribute("data-resize-handle-x", /\d/);
    await expect.poll(async () => (await redCenter(map)).total).toBe(0);
    next.snapshotVersion = 3;
    next.tokens = [];
    await mock.publish(next);
    await expect(
      page.getByRole("button", { name: "Удалить выбранное", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() => map.getAttribute("data-resize-handle-x"))
      .toBeNull();
    expect(mock.writes).toHaveLength(0);
    expect(mock.unexpected).toEqual([]);
  } finally {
    await mock.cleanup();
  }
});
