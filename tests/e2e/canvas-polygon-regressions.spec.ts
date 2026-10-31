import { mockAuthenticatedGameCapabilities } from "./mocked-game-capabilities";
import { type Page } from "@playwright/test";
import { trustedJitterDoubleClick } from "./helpers/trusted-jitter-click";
import { expect, test } from "./react-console-guard";
import type { GameSnapshot } from "@arken/contracts";
const sceneId = "7376b502-02f8-4cd6-9c55-3816d70d44dc";
const tokenId = "35f46186-2ebc-4cf8-bce7-870097305a6b";
const assetId = "65f46186-2ebc-4cf8-bce7-870097305a6b";
const portraitUrl = `/api/assets/${assetId}/content`;

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

async function installCanvasReviewRoutes(page: Page) {
  await installCanvasRoutes(page);
  await page.route("**/api/story/posts?limit=50", (route) =>
    route.fulfill({ json: { posts: [], nextCursor: null } }),
  );
  await page.route("**/api/operator/feedback/capability", (route) =>
    route.fulfill({ status: 403, json: { message: "OPERATOR_REQUIRED" } }),
  );
}

// This timing-sensitive pointer contract is recorded explicitly by the test;
// Playwright tracing adds browser-side work within Konva's 400ms gesture window.
test.use({ trace: "off" });
for (const shifted of [true, false]) {
  for (const tool of ["FOG_POLYGON", "COVER_POLYGON"] as const) {
    for (const scenario of ["cancel", "complete", "delayed-close"] as const) {
      test(`UIX-507 ${shifted ? "Shift" : "Plain"} polygon ${scenario} ${tool}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width: 1280, height: 850 });
        await installCanvasReviewRoutes(page);
        const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/api/**", async (route) => {
          const request = route.request();
          const path = new URL(request.url()).pathname;
          if (["GET", "HEAD"].includes(request.method())) return route.fallback();
          if (path === "/api/chat/read") return route.fulfill({ json: {} });
          writes.push({ path, body: request.postDataJSON() });
          return route.fulfill({ json: {} });
        });
        await mockAuthenticatedGameCapabilities(page);
        await page.goto("/");
        const map = page.locator(".map-viewport");
        const control = page.locator(`.map-tool[data-tool="${tool}"]`);
        await control.click();
        const points = await map.evaluate((node) => {
          const b = node.getBoundingClientRect();
          const x = b.x + b.width * 0.55,
            y = b.y + b.height * 0.55;
          const result = [
            { x, y },
            { x: x + 80, y },
            { x: x + 80, y: y + 80 },
          ];
          for (const p of result)
            if (
              !(document.elementFromPoint(p.x, p.y) instanceof HTMLCanvasElement)
            )
              throw Error("Polygon input is obstructed");
          return result;
        });
        const vertices = async (double = false, jitter = false) => {
          if (shifted) await page.keyboard.down("Shift");
          try {
            for (const [index, point] of points.entries()) {
              if (double && index === points.length - 1) {
                if (jitter) {
                  await page.evaluate(() => {
                    const trackedWindow = window as Window & {
                      __polygonJitterClickHandler?: EventListener;
                    };
                    if (trackedWindow.__polygonJitterClickHandler)
                      window.removeEventListener(
                        "click",
                        trackedWindow.__polygonJitterClickHandler,
                        true,
                      );
                    document.documentElement.dataset.polygonJitterClicks = "[]";
                    const handler: EventListener = (event) => {
                      if (!(event.target instanceof HTMLCanvasElement)) return;
                      const recorded = JSON.parse(
                        document.documentElement.dataset.polygonJitterClicks ??
                          "[]",
                      ) as Array<{
                        time: number;
                        x: number;
                        y: number;
                        detail: number;
                        isTrusted: boolean;
                      }>;
                      recorded.push({
                        time: event.timeStamp,
                        x: (event as MouseEvent).clientX,
                        y: (event as MouseEvent).clientY,
                        detail: (event as MouseEvent).detail,
                        isTrusted: (event as MouseEvent).isTrusted,
                      });
                      document.documentElement.dataset.polygonJitterClicks =
                        JSON.stringify(recorded);
                    };
                    trackedWindow.__polygonJitterClickHandler = handler;
                    window.addEventListener("click", handler, { capture: true });
                  });
                  await trustedJitterDoubleClick(
                    page,
                    info,
                    point,
                    { x: point.x + 2, y: point.y + 1 },
                  );
                  const deliveredClicks = JSON.parse(
                    (await page.locator("html").getAttribute(
                      "data-polygon-jitter-clicks",
                    )) ?? "[]",
                  ) as Array<{
                    time: number;
                    x: number;
                    y: number;
                    detail: number;
                    isTrusted: boolean;
                  }>;
                  await info.attach("polygon-jitter-gesture", {
                    body: JSON.stringify({ tool, shifted, deliveredClicks }),
                    contentType: "application/json",
                  });
                  expect(deliveredClicks).toHaveLength(2);
                  expect(deliveredClicks.map(({ detail }) => detail)).toEqual([
                    1,
                    2,
                  ]);
                  expect(deliveredClicks.every(({ isTrusted }) => isTrusted)).toBe(
                    true,
                  );
                  const interval = deliveredClicks[1]!.time - deliveredClicks[0]!.time;
                  expect(interval).toBeGreaterThanOrEqual(0);
                  expect(interval).toBeLessThanOrEqual(400);
                  expect(deliveredClicks.map(({ x, y }) => [x, y])).toEqual([
                    [Math.floor(point.x), Math.floor(point.y)],
                    [Math.floor(point.x + 2), Math.floor(point.y + 1)],
                  ]);
                  expect(
                    Math.hypot(
                      deliveredClicks[1]!.x - deliveredClicks[0]!.x,
                      deliveredClicks[1]!.y - deliveredClicks[0]!.y,
                    ),
                  ).toBeLessThanOrEqual(4);
                  await page.evaluate(() => {
                    const trackedWindow = window as Window & {
                      __polygonJitterClickHandler?: EventListener;
                    };
                    if (trackedWindow.__polygonJitterClickHandler) {
                      window.removeEventListener(
                        "click",
                        trackedWindow.__polygonJitterClickHandler,
                        true,
                      );
                      delete trackedWindow.__polygonJitterClickHandler;
                    }
                  });
                } else await page.mouse.dblclick(point.x, point.y);
              } else await page.mouse.click(point.x, point.y);
            }
          } finally {
            if (shifted) await page.keyboard.up("Shift");
          }
        };
        const settle = () =>
          map.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
        if (scenario === "cancel") {
          // Cancel complete three-vertex drafts, not merely an incomplete shape.
          await vertices();
          expect(
            writes,
            "Distinct rapid vertex clicks must not complete a polygon",
          ).toEqual([]);
          await map.press("Escape");
          await expect(page.locator('.map-tool[data-tool="PAN"]')).toHaveAttribute(
            "aria-pressed",
            "true",
          );
          await control.click();
          await map.press("Enter");
          await settle();
          expect(writes).toEqual([]);
          await vertices();
          await page.mouse.click(points[2].x, points[2].y, { button: "right" });
          await map.press("Enter");
          await settle();
          expect(writes).toEqual([]);
          await expect(control).toHaveAttribute("aria-pressed", "true");
          expect(errors).toEqual([]);
          await info.attach("polygon-cancellation-contract", {
            body: JSON.stringify({ tool, shifted, writes, errors }),
            contentType: "application/json",
          });
          return;
        }
      if (scenario === "delayed-close") {
        // A close vertex outside Konva's double-click window remains a vertex
        // until the user explicitly confirms the completed polygon with Enter.
        await vertices();
        await page.waitForTimeout(450);
        await page.mouse.click(points[2].x + 2, points[2].y + 1);
        expect(writes).toHaveLength(0);
        await map.press("Enter");
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0]).toMatchObject({
          path: "/api/fog-reveals",
          body: {
            sceneId,
            operation: tool === "COVER_POLYGON" ? "COVER" : "REVEAL",
            geometry: { type: "POLYGON" },
          },
        });
        expect(
          (writes[0].body.geometry as { points: unknown[] }).points,
        ).toHaveLength(4);
        expect(errors).toEqual([]);
        await info.attach("delayed-close-polygon-contract", {
          body: JSON.stringify({ tool, writes, errors }),
          contentType: "application/json",
        });
        return;
      }
        for (const [index, mode] of ["enter", "double", "jitter"].entries()) {
          const double = mode !== "enter";
          await vertices(double, mode === "jitter");
          // Real users finish from canvas focus, without programmatically focusing the map.
          if (!double) await page.keyboard.press("Enter");
          await expect.poll(() => writes.length).toBe(index + 1);
          const write = writes.at(-1)!;
          expect(write).toMatchObject({
            path: "/api/fog-reveals",
            body: {
              sceneId,
              operation: tool === "COVER_POLYGON" ? "COVER" : "REVEAL",
              geometry: { type: "POLYGON" },
            },
          });
          const geometry = write.body.geometry as {
            points: Array<{ x: number; y: number }>;
          };
          expect(geometry.points).toHaveLength(3);
          expect(new Set(geometry.points.map((p) => `${p.x},${p.y}`)).size).toBe(
            3,
          );
          expect(geometry.points[1].x).toBeGreaterThan(geometry.points[0].x);
          expect(geometry.points[2].y).toBeGreaterThan(geometry.points[1].y);
          await expect(
            page.getByRole("button", { name: "Удалить выбранное" }),
          ).toHaveCount(0);
        }
        expect(writes[1].body.geometry).toEqual(writes[0].body.geometry);
        expect(writes[2].body.geometry).toEqual(writes[0].body.geometry);
        expect(errors).toEqual([]);
        await info.attach("shift-polygon-contract", {
          body: JSON.stringify({ tool, writes, errors }),
          contentType: "application/json",
        });
      });
    }
  }
}
