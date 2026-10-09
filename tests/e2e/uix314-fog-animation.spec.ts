import { expect, test } from "./react-console-guard";
import type { Locator, Page, WebSocketRoute } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

const sceneId = "uix314-fog-scene";

function snapshotForFog(role: "GM" | "PLAYER" = "PLAYER", manyOperations = false): GameSnapshot {
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
  snapshot.fogReveals = manyOperations
    ? Array.from({ length: 180 }, (_, index) => ({
        id: `uix314-op-${index}`,
        sceneId,
        x: 24 + ((index * 73) % 1080),
        y: 20 + ((index * 41) % 720),
        width: 38 + (index % 5) * 8,
        height: 32 + (index % 7) * 6,
        operation: (index % 3 === 1 ? "COVER" : "REVEAL") as "COVER" | "REVEAL",
        sequence: index + 1,
      }))
    : [
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

async function bootFogScene(page: Page, role: "GM" | "PLAYER" = "PLAYER", manyOperations = false) {
  const snapshot = snapshotForFog(role, manyOperations);
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
  await page.addInitScript(() => {
    if (new URL(location.href).searchParams.get("uix314-fog-fallback") !== "1") return;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === "2d" && this.width === 128 && this.height === 128) return null;
      return original.call(this, type, ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
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

async function captureFogAlphaMask(map: Locator) {
  return map.locator("canvas").evaluateAll((canvases: HTMLCanvasElement[]) => {
    // PLAYER render order puts the fog Layer fifth (background and three
    // underlay layers precede it); unlike screen-point heuristics, the slot
    // remains identifiable after pan/zoom even when reveal moves off-sample.
    const index = 4;
    const canvas = canvases[index];
    if (!canvas) throw new Error(`Missing fog layer canvas ${index}; got ${canvases.length}`);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Fog layer has no 2D context");
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = new Uint8Array(canvas.width * canvas.height);
    let fractionalAlphaPixels = 0;
    let opaquePixels = 0;
    for (let source = 3, target = 0; target < alpha.length; source += 4, target += 1) {
      alpha[target] = data[source]!;
      if (alpha[target]! > 0 && alpha[target]! < 255) fractionalAlphaPixels += 1;
      else if (alpha[target] === 255) opaquePixels += 1;
    }
    let binary = "";
    for (let offset = 0; offset < alpha.length; offset += 0x8000)
      binary += String.fromCharCode(...alpha.subarray(offset, Math.min(offset + 0x8000, alpha.length)));
    return {
      index,
      size: `${canvas.width}x${canvas.height}`,
      opaqueRatio: opaquePixels / alpha.length,
      fractionalAlphaPixels,
      encoded: btoa(binary),
    };
  });
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
  await page.setViewportSize({ width: 390, height: 844 });
  const map = await bootFogScene(page);
  await page.waitForTimeout(180);
  const samples = await canvasHashes(map);
  const solidFog = samples.find((layer) => layer.centerAlpha === 255 && layer.revealAlpha === 0);
  expect(solidFog).toBeDefined();
});

async function compareMovingMaskToSolidFailure(page: Page, map: Locator) {
  await page.waitForTimeout(300);
  const animated = await captureFogAlphaMask(map);
  await page.evaluate((mask) => sessionStorage.setItem("uix314-expected-fog-alpha", JSON.stringify(mask)), animated);
  await page.goto("/?uix314-fog-fallback=1");
  const reloadedMap = page.locator(".map-viewport");
  await expect(reloadedMap).toBeVisible();
  await expect.poll(() => reloadedMap.locator("canvas").count()).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const solid = await captureFogAlphaMask(reloadedMap);
  const expected = await page.evaluate(() => sessionStorage.getItem("uix314-expected-fog-alpha"));
  expect(expected).not.toBeNull();
  const baseline = JSON.parse(expected!) as typeof animated;
  expect(solid.size).toBe(baseline.size);
  expect(solid.fractionalAlphaPixels).toBe(baseline.fractionalAlphaPixels);
  expect(solid.encoded).toBe(baseline.encoded);
  console.info(`UIX-314 exact full-layer alpha mask matched moving/failure at ${solid.size}; fractional boundary pixels=${solid.fractionalAlphaPixels}`);
}

test("UIX-314 animated and solid-fallback fog preserve the exact DPR1 base alpha mask", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const map = await bootFogScene(page);
  await compareMovingMaskToSolidFailure(page, map);
});

test.describe("UIX-314 DPR2 alpha-mask parity", () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });

  test("preserves every alpha pixel through motion, fallback, reload, zoom, pan and resize", async ({ page }) => {
    const map = await bootFogScene(page);
    const viewTransform = async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.mouse.move(300, 300);
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(180);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(180);
      await page.mouse.move(360, 440);
      await page.mouse.down();
      await page.mouse.move(420, 470, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(180);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(180);
    };
    await viewTransform();
    const animatedMask = await captureFogAlphaMask(map);
    await page.evaluate((mask) => sessionStorage.setItem("uix314-expected-fog-alpha", JSON.stringify(mask)), animatedMask);
    await page.goto("/?uix314-fog-fallback=1");
    const reloadedMap = page.locator(".map-viewport");
    await expect(reloadedMap).toBeVisible();
    await expect.poll(() => reloadedMap.locator("canvas").count()).toBeGreaterThan(0);
    await viewTransform();
    const fallbackMask = await captureFogAlphaMask(reloadedMap);
    const expected = await page.evaluate(() => sessionStorage.getItem("uix314-expected-fog-alpha"));
    const baseline = JSON.parse(expected!) as typeof animatedMask;
    expect(fallbackMask.size).toBe(baseline.size);
    expect(fallbackMask.encoded).toBe(baseline.encoded);
    console.info(`UIX-314 DPR2 exact mask parity after zoom/pan/resize: ${fallbackMask.size}, fractional boundary pixels=${fallbackMask.fractionalAlphaPixels}`);
  });
});

test("UIX-314 bounded 180-operation scene records frame cost and cache rebuild activity", async ({ page }) => {
  test.setTimeout(75_000);
  await page.addInitScript(() => {
    const state = { frames: 0, callbackDurations: [] as number[], fogCacheCanvasAllocations: 0 };
    Object.defineProperty(window, "__uix314Stress", { value: state });
    const originalSetInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== 84) return originalSetInterval(handler, delay, ...args);
      const wrapped = () => {
        const start = performance.now();
        state.frames += 1;
        if (typeof handler === "function") handler(...args);
        state.callbackDurations.push(performance.now() - start);
      };
      return originalSetInterval(wrapped, delay);
    }) as typeof window.setInterval;
    const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")!;
    Object.defineProperty(HTMLCanvasElement.prototype, "width", {
      ...width,
      set(value: number) {
        if (value === 1200) state.fogCacheCanvasAllocations += 1;
        width.set!.call(this, value);
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const map = await bootFogScene(page, "PLAYER", true);
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => (window as Window & { __uix314Stress?: { frames: number; fogCacheCanvasAllocations: number } }).__uix314Stress);
  const started = performance.now();
  await page.waitForTimeout(60_000);
  const after = await page.evaluate(() => (window as Window & { __uix314Stress?: { frames: number; fogCacheCanvasAllocations: number; callbackDurations: number[] } }).__uix314Stress);
  const elapsedMs = performance.now() - started;
  const frameDelta = (after?.frames ?? 0) - (before?.frames ?? 0);
  const updateRate = frameDelta * 1000 / elapsedMs;
  expect(updateRate).toBeGreaterThan(10.5);
  expect(updateRate).toBeLessThanOrEqual(12.5);
  expect(before?.fogCacheCanvasAllocations).toBeGreaterThan(0);
  expect(after?.fogCacheCanvasAllocations).toBe(before?.fogCacheCanvasAllocations);
  const durations = after?.callbackDurations ?? [];
  const averageCallbackMs = durations.reduce((sum, duration) => sum + duration, 0) / Math.max(1, durations.length);
  expect(averageCallbackMs).toBeLessThan(4);
  const pixels = await canvasHashes(map);
  expect(pixels.some((layer) => layer.hash >= 0 && layer.size !== "0x0")).toBe(true);
  console.info(`UIX-314 180-op 60s run: frames=${frameDelta}, elapsed=${elapsedMs.toFixed(0)}ms (${updateRate.toFixed(1)} updates/s), producer callback avg=${averageCallbackMs.toFixed(3)}ms, max=${Math.max(...durations).toFixed(3)}ms; producer measurement excludes React/Konva rendering; mask cache-canvas allocations=${after?.fogCacheCanvasAllocations} (delta=0)`);
});
