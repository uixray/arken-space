import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 390]) {
    test(`UIX-645 shell SVG contract ${role} ${width}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 850 });
      const snapshot = buildGameSnapshot(role);
      snapshot.scenes = [
        {
          id: "64500000-0000-4000-8000-000000000001",
          name: "Проверка иконок",
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
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
        if (path === "/api/story/posts")
          return route.fulfill({ json: { posts: [], nextCursor: null } });
        if (path === "/api/operator/feedback/capability")
          return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
        return route.fulfill({ json: [] });
      });
      await page.routeWebSocket(/\/socket\.io\//, (socket) => {
        socket.onMessage((message) => {
          if (message.toString() === "40")
            socket.send('40{"sid":"icons-socket"}');
        });
        socket.send(
          '0{"sid":"icons-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
        );
      });
      await page.goto("/");
      await expect(page.locator(".map-viewport")).toBeVisible();
      const icons = page.locator("svg.arken-icon:visible");
      expect(await icons.count()).toBeGreaterThan(5);
      for (const icon of await icons.all()) {
        await expect(icon).toHaveAttribute("aria-hidden", "true");
        await expect(icon).toHaveAttribute("focusable", "false");
        await expect(icon).toHaveAttribute("stroke", "currentColor");
        await expect(icon).toHaveAttribute("stroke-width", "2");
        const box = await icon.boundingBox();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.height).toBeGreaterThan(0);
      }
      const controls = page
        .locator("button:visible,summary:visible")
        .filter({ has: page.locator("svg.arken-icon") });
      for (const control of await controls.all()) {
        await expect(control).toHaveAccessibleName(/\S/);
        const box = await control.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(24);
        expect(box!.height).toBeGreaterThanOrEqual(24);
      }
      await page.screenshot({
        path: testInfo.outputPath(`shell-${role}-${width}.png`),
        fullPage: true,
      });
    });
  }
