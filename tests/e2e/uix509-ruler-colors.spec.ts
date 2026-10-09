import { expect, test } from "./react-console-guard";
import { rulerColorForMembership } from "../../apps/web/src/renderers/ruler-colors";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

const sceneId = "uix509-ruler-scene";
const localMembershipId = "member-under-test";

test("UIX-509 deterministic ruler colors render on synthetic light, dark and busy map regions", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><pattern id="busy" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#df4676"/><path d="M0 0L24 24M24 0L0 24" stroke="#f6dc3d" stroke-width="7"/><circle cx="12" cy="12" r="4" fill="#2366dd"/></pattern></defs><rect width="400" height="800" fill="#f8fafc"/><rect x="400" width="400" height="800" fill="#050608"/><rect x="800" width="400" height="800" fill="url(#busy)"/></svg>`;
  const snapshot = buildGameSnapshot("PLAYER", {
    scenes: [
      {
        id: sceneId,
        name: "Synthetic ruler contrast",
        projection: "ORTHOGRAPHIC_2D",
        mapAssetId: "uix509-map",
        width: 1200,
        height: 800,
        backgroundFrame: { x: 0, y: 0, width: 1200, height: 800 },
        grid: { enabled: false, size: 64, offsetX: 0, offsetY: 0, color: "#cccccc", opacity: 0.2 },
        active: true,
      },
    ],
    assets: [
      {
        id: "uix509-map",
        kind: "MAP",
        name: "Synthetic contrast fixture",
        mimeType: "image/svg+xml",
        sizeBytes: svg.length,
        width: 1200,
        height: 800,
        durationSeconds: null,
        url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
        createdAt: new Date(0).toISOString(),
      },
    ],
  });
  const outgoing: string[] = [];
  let realtimeRulerEchoes = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/soundpad") return route.fulfill({ json: { packs: [], playerPlaybackEnabled: true } });
    if (path === "/api/client-logs") return route.fulfill({ status: 204, body: "" });
    if (path === "/api/story/posts" || path === "/api/canvas/history") return route.fulfill({ json: [] });
    return route.request().method() === "GET"
      ? route.fulfill({ json: [] })
      : route.fulfill({ status: 204, body: "" });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      const text = message.toString();
      outgoing.push(text);
      if (text === "40") socket.send('40{"sid":"uix509-browser"}');
      if (text.startsWith("42")) {
        const [eventName, payload] = JSON.parse(text.slice(2)) as [string, Record<string, unknown>];
        if (eventName === "ruler:update") {
          realtimeRulerEchoes += 1;
          socket.send(`42${JSON.stringify(["ruler:updated", {
            ...payload,
            membershipId: localMembershipId,
            displayName: "Игрок",
            distance: 280,
          }])}`);
        }
      }
    });
    socket.send('0{"sid":"uix509-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}');
  });
  await page.goto("/");
  const map = page.locator(".map-viewport");
  await expect(map).toBeVisible();
  await expect.poll(() => map.locator("canvas").count()).toBeGreaterThan(0);
  const rulerTool = page.getByRole("button", { name: "Линейка", exact: true });
  await rulerTool.click();
  await expect(rulerTool).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Свернуть панель до значков" }).click();
  await page.getByRole("button", { name: "Вписать карту", exact: true }).click();
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  const rect = bounds!;
  const scale = Math.min(rect.width / 1200, rect.height / 800, 3) * 0.92;
  const pointOnScene = (x: number, y: number) => ({
    x: rect.x + rect.width / 2 + (x - 600) * scale,
    y: rect.y + rect.height / 2 + (y - 400) * scale,
  });
  const start = pointOnScene(100, 320);
  const waypoint = pointOnScene(600, 320);
  const end = pointOnScene(1100, 320);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(waypoint.x, waypoint.y, { steps: 4 });
  await page.keyboard.down("Control");
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
  const expectedColor = rulerColorForMembership(localMembershipId);
  const rgb = await map.locator("canvas").evaluateAll((_canvases, color) => {
      const context = document.createElement("canvas").getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    }, expectedColor);
  const samplePoints = [
    pointOnScene(200, 320), // colored segment over light map
    pointOnScene(600, 320), // waypoint over dark map
    pointOnScene(1000, 320), // colored segment over busy map
    pointOnScene(1100, 320), // arrow head
    pointOnScene(1125, 305), // distance label glyph
  ];
  const pixelCounts = await map.locator("canvas").evaluateAll((canvases, params) => params.points.map((point) => {
    let count = 0;
    for (const element of canvases) {
      if (!(element instanceof HTMLCanvasElement)) continue;
      const canvas = element;
      const bounds = canvas.getBoundingClientRect();
      const x = Math.round((point.x - bounds.left) * canvas.width / bounds.width);
      const y = Math.round((point.y - bounds.top) * canvas.height / bounds.height);
      const context = canvas.getContext("2d");
      if (!context) continue;
      const left = Math.max(0, x - 4);
      const top = Math.max(0, y - 4);
      const width = Math.min(canvas.width - left, 9);
      const height = Math.min(canvas.height - top, 9);
      if (width <= 0 || height <= 0) continue;
      const data = context.getImageData(left, top, width, height).data;
      for (let offset = 0; offset < data.length; offset += 4) {
        if (Math.abs(data[offset]! - params.rgb[0]!) <= 2 && Math.abs(data[offset + 1]! - params.rgb[1]!) <= 2 && Math.abs(data[offset + 2]! - params.rgb[2]!) <= 2 && data[offset + 3]! > 0) count += 1;
      }
    }
    return count;
  }), { rgb, points: samplePoints });
  const updatesAfterDraw = outgoing.filter((message) => message.includes("ruler:update")).length;
  console.info(`UIX-509 sample points line/light, waypoint/dark, line/busy, arrow, label=${JSON.stringify(pixelCounts)} for ${expectedColor}; rulerUpdates=${updatesAfterDraw}, same-membership realtime echoes=${realtimeRulerEchoes}`);
  for (const count of pixelCounts) expect(count).toBeGreaterThan(0);
  expect(realtimeRulerEchoes).toBeGreaterThan(0);
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(outgoing.filter((message) => message.includes("ruler:update")).length).toBe(updatesAfterDraw);
  console.info(`UIX-509 local draft and echoed realtime ruler share ${expectedColor}; no additional ruler:update events after pointerup`);
});
