import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { expect, test } from "./react-console-guard";
import {
  assertPingReceiverForeground,
  createPingFrameRecorder,
  observePingOverlay,
  parsePingFrame,
} from "../multiplayer/ping-pixel-observer";

const color = "rgb(240, 80, 160)";

test.beforeEach(async ({ page }) => {
  await page.bringToFront();
  // Deliberately offset and 2x backing resolution: DOM position and CSS pixels
  // must determine the final composite, not raw canvas-buffer coordinates.
  await page.setContent(`<div class="map-viewport" style="position:relative;margin:30px;width:300px;height:240px">
    <div style="position:absolute;left:20px;top:10px">
      <canvas id="below" width="560" height="460" style="position:absolute;width:280px;height:230px"></canvas>
      <canvas id="fog" width="560" height="460" style="position:absolute;width:280px;height:230px"></canvas>
      <canvas id="above" width="560" height="460" style="position:absolute;width:280px;height:230px;opacity:0.6"></canvas>
    </div></div>`);
  await page.locator("#fog").evaluate((node: HTMLCanvasElement) => {
    const ctx = node.getContext("2d")!;
    ctx.fillStyle = "#080807";
    ctx.fillRect(0, 0, node.width, node.height);
  });
});

test("ping pixel observer retains a visible transient composite frame", async ({
  page,
}) => {
  const observer = await observePingOverlay(
    page.locator(".map-viewport"),
    { x: 150, y: 120 },
    color,
  );
  try {
    await page
      .locator("#above")
      .evaluate(async (node: HTMLCanvasElement, stroke) => {
        const ctx = node.getContext("2d")!;
        ctx.scale(2, 2);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(130, 110, 24, 0, Math.PI * 2);
        ctx.stroke();
        // Clear before the runner reads the result; the exact matched frame,
        // rather than a later screenshot after expiry, must remain as evidence.
        for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
        ctx.clearRect(0, 0, node.width, node.height);
      }, color);
    const result = await observer.result();
    expect(result.elapsedMs).toBeLessThan(3_000);
    expect(result.diagnostic.capturedCount).toBeGreaterThan(0);
    expect(result.diagnostic.sampleCount).toBeGreaterThanOrEqual(
      result.diagnostic.capturedCount,
    );
    expect(result.diagnostic.recentSamples.length).toBeLessThanOrEqual(32);
    expect(result.maxMatchedPixels).toBeGreaterThanOrEqual(24);
    expect(result.after).not.toBe(result.before);
    expect(result.after).toMatch(/^data:image\/png;base64,/);
  } finally {
    await observer.dispose();
  }
});

for (const failure of [
  "missing",
  "below-fog",
  "hidden",
  "wrong-colour",
  "elsewhere",
] as const) {
  test(`ping pixel observer rejects ${failure} overlay`, async ({ page }) => {
    const observer = await observePingOverlay(
      page.locator(".map-viewport"),
      { x: 150, y: 120 },
      color,
    );
    try {
      await page.evaluate(
        ({ failure, color }) => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            failure === "below-fog" ? "#below" : "#above",
          )!;
          if (failure === "hidden") canvas.style.visibility = "hidden";
          const ctx = canvas.getContext("2d")!;
          ctx.scale(2, 2);
          if (failure !== "missing") {
            ctx.strokeStyle =
              failure === "wrong-colour" ? "rgb(80, 240, 120)" : color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(
              failure === "elsewhere" ? 230 : 130,
              110,
              24,
              0,
              Math.PI * 2,
            );
            ctx.stroke();
          }
          // A visible unrelated map change cannot satisfy the local ring oracle.
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 20, 20);
        },
        { failure, color },
      );
      await expect(observer.result()).rejects.toThrow(
        "Ping pixels not visible over fog within 3000ms (max=0): no matching lower arc",
      );
      const receipt = await observer.receipt();
      expect(receipt.matched).toBe(false);
      expect(receipt.maxMatchedPixels).toBe(0);
      expect(receipt.diagnostic.capturedCount).toBeGreaterThan(0);
      expect(receipt.diagnostic.maxCaptureMs).toBeGreaterThanOrEqual(0);
      expect(receipt.diagnostic.recentSamples.length).toBeLessThanOrEqual(32);
      expect(receipt.before).toMatch(/^data:image\/png;base64,/);
      expect(receipt.after).toMatch(/^data:image\/png;base64,/);
    } finally {
      await observer.dispose();
    }
  });
}

test("ping receiver precondition rejects synthetic hidden or unfocused state", async ({
  page,
}) => {
  await page.bringToFront();
  await assertPingReceiverForeground(page);
  // Headless engines can report multiple pages as visible and focused. These
  // are explicit guard-unit controls, NOT proof of browser focus scheduling.
  for (const state of [
    { visibility: "visible", focused: false },
    { visibility: "hidden", focused: true },
  ]) {
    const fixture = await page.evaluateHandle((state) => {
      const focus = Object.getOwnPropertyDescriptor(document, "hasFocus");
      const visibility = Object.getOwnPropertyDescriptor(
        document,
        "visibilityState",
      );
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: () => state.focused,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state.visibility,
      });
      return {
        restore() {
          if (focus) Object.defineProperty(document, "hasFocus", focus);
          else Reflect.deleteProperty(document, "hasFocus");
          if (visibility)
            Object.defineProperty(document, "visibilityState", visibility);
          else Reflect.deleteProperty(document, "visibilityState");
        },
      };
    }, state);
    try {
      await expect(assertPingReceiverForeground(page)).rejects.toThrow(
        "Ping pixel receiver must be visible and focused",
      );
    } finally {
      await fixture.evaluate((fixture) => fixture.restore());
      await fixture.dispose();
    }
    await assertPingReceiverForeground(page);
  }
});

test("ping pixel observer rejects a ring first painted after the deadline", async ({
  page,
}) => {
  const observer = await observePingOverlay(
    page.locator(".map-viewport"),
    { x: 150, y: 120 },
    color,
  );
  try {
    await page.locator("#above").evaluate((node: HTMLCanvasElement, stroke) => {
      // Deliberately block this fixture's frame loop, not a product timeout.
      // A visible late ring must never be promoted to deadline-bound PASS.
      const until = performance.now() + 3_050;
      while (performance.now() < until) {
        /* bounded fixture-only starvation */
      }
      const ctx = node.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(130, 110, 24, 0, Math.PI * 2);
      ctx.stroke();
    }, color);
    await expect(observer.result()).rejects.toThrow(
      "Ping pixels not visible over fog within 3000ms",
    );
    const receipt = await observer.receipt();
    expect(receipt.matched).toBe(false);
    expect(receipt.elapsedMs).toBeGreaterThanOrEqual(3_000);
    expect(receipt.diagnostic.failureCaptureMs).not.toBeNull();
    expect(receipt.diagnostic.failureCaptureError).toBeNull();
    expect(receipt.after).not.toBe(receipt.before);
    expect(receipt.diagnostic.recentSamples.length).toBeLessThanOrEqual(32);
    expect(receipt.after).toMatch(/^data:image\/png;base64,/);
  } finally {
    await observer.dispose();
  }
});

const pingFrame = {
  sceneId: "synthetic-scene",
  membershipId: "synthetic-member",
  x: 10,
  y: 20,
  createdAt: "2026-10-19T00:00:00.000Z",
};

test("ping frame parser ignores malformed or unrelated events and strips extras", () => {
  for (const frame of [
    undefined,
    Buffer.from("42[]"),
    "2",
    "42",
    "42{",
    "42null",
    "42[]",
    '42["game:snapshot",{}]',
    '42["map:ping",null]',
    '42["map:ping",{"sceneId":"scene"}]',
    `42${JSON.stringify(["map:ping", { ...pingFrame, x: "10" }])}`,
    `42${JSON.stringify(["map:ping", { ...pingFrame, createdAt: "invalid" }])}`,
  ])
    expect(parsePingFrame(frame)).toBeNull();
  expect(
    parsePingFrame(
      `42${JSON.stringify([
        "map:ping",
        {
          ...pingFrame,
          displayName: "not retained",
          token: "synthetic-not-retained",
        },
      ])}`,
    ),
  ).toEqual(pingFrame);
});

test("page ping recorder bounds sanitized receipts and disposes frame listeners", async ({
  page,
}) => {
  // A real loopback WebSocket is required: routeWebSocket replaces the browser
  // constructor and does not prove page.on("websocket") frame observation.
  const http = createServer();
  const io = new Server(http, { transports: ["websocket"] });
  const connected = new Promise<Socket>((resolve) =>
    io.once("connection", resolve),
  );
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("No loopback port");
  const recorder = createPingFrameRecorder();
  recorder.attach(page);
  try {
    const pageSocket = page.waitForEvent("websocket");
    await page.evaluate((port) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`,
      );
      socket.addEventListener("message", ({ data }) => {
        if (typeof data === "string" && data.startsWith("0")) socket.send("40");
      });
    }, address.port);
    const nativeSocket = await pageSocket;
    const serverSocket = await connected;
    serverSocket.emit("game:snapshot", { private: "not retained" });
    for (let x = 0; x < 20; x++)
      serverSocket.emit("map:ping", { ...pingFrame, x, token: "not retained" });
    await expect.poll(() => recorder.snapshot().at(-1)?.x).toBe(19);
    const receipts = recorder.snapshot();
    expect(receipts).toHaveLength(16);
    expect(receipts[0]!.x).toBe(4);
    expect(Object.keys(receipts[0]!).sort()).toEqual([
      "createdAt",
      "membershipId",
      "receivedAt",
      "sceneId",
      "x",
      "y",
    ]);
    expect(receipts[0]!.receivedAt).toBeGreaterThan(0);
    recorder.dispose();
    const deliveredAfterDispose = nativeSocket.waitForEvent("framereceived", {
      predicate: ({ payload }) => parsePingFrame(payload)?.x === 99,
    });
    serverSocket.emit("map:ping", { ...pingFrame, x: 99 });
    await deliveredAfterDispose;
    expect(recorder.snapshot()).toEqual(receipts);
    recorder.clear();
    expect(recorder.snapshot()).toEqual([]);
  } finally {
    recorder.dispose();
    await new Promise<void>((resolve) => io.close(() => resolve()));
  }
});
