import { expect, test } from "./react-console-guard";
import type { Locator, Page, WebSocketRoute } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

const sceneId = "uix314-fog-scene";

function snapshotForFog(role: "GM" | "PLAYER" = "PLAYER"): GameSnapshot {
  const snapshot = buildGameSnapshot(role, {
    scenes: [
      {
        id: sceneId,
        name: "Fog animation QA",
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
  snapshot.fogReveals = [
    {
      id: "uix314-reveal",
      sceneId,
      x: 180,
      y: 160,
      width: 260,
      height: 220,
      operation: "REVEAL",
      sequence: 1,
    },
    {
      id: "uix314-cover",
      sceneId,
      x: 260,
      y: 220,
      width: 90,
      height: 80,
      operation: "COVER",
      sequence: 2,
    },
  ];
  return snapshot;
}

async function bootFogScene(page: Page, role: "GM" | "PLAYER" = "PLAYER") {
  const snapshot = snapshotForFog(role);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/soundpad")
      return route.fulfill({ json: { packs: [], playerPlaybackEnabled: true } });
    if (path === "/api/client-logs") return route.fulfill({ status: 204, body: "" });
    if (path === "/api/story/posts" || path === "/api/canvas/history")
      return route.fulfill({ json: [] });
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket: WebSocketRoute) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") socket.send('40{"sid":"uix314-mock"}');
    });
    socket.send(
      '0{"sid":"uix314-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  await page.goto("/");
  const map = page.locator(".map-viewport");
  await expect(map).toBeVisible();
  await expect.poll(() => map.locator("canvas").count()).toBeGreaterThan(0);
  return map;
}

async function canvasHashes(map: Locator): Promise<Array<{ size: string; hash: number; centerAlpha: number; revealAlpha: number }>> {
  return map.locator("canvas").evaluateAll((canvases: HTMLCanvasElement[]) =>
    canvases.map((canvas) => {
      const context = canvas.getContext("2d");
      if (!context) return { size: `${canvas.width}x${canvas.height}`, hash: -1, centerAlpha: -1, revealAlpha: -1 };
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let index = 0; index < pixels.length; index += 1)
        hash = Math.imul(hash ^ pixels[index]!, 16777619);
      // Sample inside the large solid fog field, away from stage controls, and
      // inside the clear REVEAL rectangle in the real rendered layer.
      const centerX = Math.floor(canvas.width * 0.05);
      const centerY = Math.floor(canvas.height * 0.05);
      const revealX = Math.floor(canvas.width * 0.61);
      const revealY = Math.floor(canvas.height * 0.39);
      const centerAlpha = pixels[(centerY * canvas.width + centerX) * 4 + 3]!;
      const revealAlpha = pixels[(revealY * canvas.width + revealX) * 4 + 3]!;
      return { size: `${canvas.width}x${canvas.height}`, hash: hash >>> 0, centerAlpha, revealAlpha };
    }),
  );
}

test("UIX-314 integrated fog animates on its real Konva layer and stays responsive across viewports", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { value: 8 });
    Object.defineProperty(navigator, "deviceMemory", { value: 8 });
    const state = { delays: [] as number[], ticks: 0, patterns: 0 };
    Object.defineProperty(window, "__uix314FogTimerState", { value: state });
    const originalPattern = CanvasRenderingContext2D.prototype.createPattern;
    CanvasRenderingContext2D.prototype.createPattern = function (source, repetition) {
      if (source instanceof HTMLCanvasElement && source.width === 128 && source.height === 128)
        state.patterns += 1;
      return originalPattern.call(this, source, repetition);
    };
    const original = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout !== undefined && timeout >= 80 && timeout <= 90) {
        state.delays.push(timeout);
        const wrapped = () => {
          state.ticks += 1;
          if (typeof handler === "function") handler(...args);
        };
        return original(wrapped, timeout);
      }
      return original(handler, timeout, ...args);
    }) as typeof window.setInterval;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const map = await bootFogScene(page);
  const before = await canvasHashes(map);
  const started = performance.now();
  await page.waitForTimeout(500);
  const after = await canvasHashes(map);
  const changedLayers = after.filter((layer, index) => layer.hash !== before[index]?.hash);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(150);
  const ticksWhenHiddenSettled = await page.evaluate(() =>
    (window as Window & { __uix314FogTimerState?: { ticks: number } }).__uix314FogTimerState?.ticks ?? 0,
  );
  await page.waitForTimeout(180);
  const ticksWhileHidden = await page.evaluate(() =>
    (window as Window & { __uix314FogTimerState?: { ticks: number } }).__uix314FogTimerState?.ticks ?? 0,
  );
  expect(ticksWhileHidden).toBe(ticksWhenHiddenSettled);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(180);
  const ticksAfterResume = await page.evaluate(() =>
    (window as Window & { __uix314FogTimerState?: { ticks: number } }).__uix314FogTimerState?.ticks ?? 0,
  );
  expect(ticksAfterResume).toBeGreaterThan(ticksWhileHidden);
  const opaqueFogLayer = changedLayers.find((layer) => layer.centerAlpha === 255 && layer.revealAlpha === 0);
  expect(opaqueFogLayer).toBeDefined();
  const intervals = await page.evaluate(() =>
    (window as Window & { __uix314FogTimerState?: { delays: number[] } }).__uix314FogTimerState?.delays ?? [],
  );
  expect(intervals.length).toBeGreaterThan(0);
  expect(intervals.every((delay) => delay === 84)).toBe(true);
  expect(changedLayers.length).toBeGreaterThan(0);
  const elapsedMs = performance.now() - started;

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(map).toBeVisible();
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(180);
  const resized = await canvasHashes(map);
  expect(resized.length).toBeGreaterThan(0);
  console.info(
    `UIX-314 observed ${changedLayers.length} changing canvas layer(s) in ${elapsedMs.toFixed(0)}ms at 390px; ${ticksAfterResume - ticksWhenHiddenSettled} frames resumed after hidden pause; covered/revealed alpha=${opaqueFogLayer?.centerAlpha}/${opaqueFogLayer?.revealAlpha}; tile=128x128, cap=12fps`,
  );
});

test("UIX-314 reduced-motion scene keeps a deterministic static fog layer", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const map = await bootFogScene(page);
  await page.waitForTimeout(150);
  const first = await canvasHashes(map);
  await page.waitForTimeout(350);
  const second = await canvasHashes(map);
  expect(second).toEqual(first);
  const fogLayer = first.find((layer) => layer.centerAlpha === 255 && layer.revealAlpha === 0);
  expect(fogLayer).toBeDefined();
});

test("UIX-314 keeps GM opacity on fog base while reveal geometry remains transparent", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const map = await bootFogScene(page, "GM");
  await page.waitForTimeout(180);
  const samples = await canvasHashes(map);
  const gmFog = samples.find((layer) => layer.centerAlpha >= 85 && layer.centerAlpha <= 95 && layer.revealAlpha === 0);
  expect(gmFog).toBeDefined();
});

test("UIX-314 canvas allocation failure keeps the solid fog mask and reveal", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === "2d" && this.width === 128 && this.height === 128) return null;
      return original.call(this, type, ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const map = await bootFogScene(page);
  await page.waitForTimeout(180);
  const samples = await canvasHashes(map);
  const solidFog = samples.find((layer) => layer.centerAlpha === 255 && layer.revealAlpha === 0);
  expect(solidFog).toBeDefined();
});
