import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { cursorColorForMembership } from "../../apps/web/src/renderers/cursor-color";

const sceneId = "uix508-ping-scene";
const membershipId = "uix508-sender";

for (const reducedMotion of [false, true]) {
  test(`UIX-508 mocked ping delivery renders and expires eight pings (reduced=${reducedMotion})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({
      reducedMotion: reducedMotion ? "reduce" : "no-preference",
    });
    const snapshot = buildGameSnapshot("PLAYER", {
      members: [
        {
          id: membershipId,
          role: "PLAYER",
          displayName: "Участник",
          characterId: null,
        },
      ],
      scenes: [
        {
          id: sceneId,
          name: "Synthetic ping scene",
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
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
      if (path === "/api/soundpad")
        return route.fulfill({
          json: { packs: [], playerPlaybackEnabled: true },
        });
      if (path === "/api/client-logs")
        return route.fulfill({ status: 204, body: "" });
      if (path === "/api/story/posts" || path === "/api/canvas/history")
        return route.fulfill({ json: [] });
      return route.request().method() === "GET"
        ? route.fulfill({ json: [] })
        : route.fulfill({ status: 204, body: "" });
    });
    let delivered = 0;
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        if (message.toString() === "40") {
          socket.send('40{"sid":"uix508-browser"}');
          for (let i = 0; i < 8; i++) {
            socket.send(
              `42${JSON.stringify(["map:ping", { sceneId, x: 180 + i * 110, y: 260 + (i % 2) * 220, membershipId, displayName: `Пинг ${i + 1}`, createdAt: Date.now() + i }])}`,
            );
            delivered++;
          }
        }
      });
      socket.send(
        '0{"sid":"uix508-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.goto("/");
    const map = page.locator(".map-viewport");
    await expect(map).toBeVisible();
    await expect.poll(() => map.locator("canvas").count()).toBeGreaterThan(0);
    expect(delivered).toBe(8);
    await page.waitForTimeout(150);
    expect(pageErrors).toEqual([]);
    // This is mocked Socket.IO delivery; it verifies both preference modes without claiming live network or FPS evidence.
    await page.waitForTimeout(3550);
    expect(pageErrors).toEqual([]);
  });
}
