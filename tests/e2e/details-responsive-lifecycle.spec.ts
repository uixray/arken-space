import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280]) {
    test(`UIX-644 responsive menu lifecycle ${role} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 850 });
      const snapshot = buildGameSnapshot(role);
      snapshot.scenes = [
        {
          id: "64500000-0000-4000-8000-000000000001",
          name: "Проверка меню",
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
      const mutations: string[] = [];
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== "GET" && path !== "/api/client-logs") {
          mutations.push(`${route.request().method()} ${path}`);
          return route.fulfill({
            status: 405,
            json: { error: "READ_ONLY_FIXTURE" },
          });
        }
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
      const menu = page.locator(".music-volume-control");
      const trigger = menu.locator("summary");
      const slider = menu.getByRole("slider", { name: "Личная громкость" });
      await trigger.click();
      await expect(slider).toBeVisible();
      await page.setViewportSize({ width: 390, height: 850 });
      await expect(trigger).toBeHidden();
      await expect(menu).toHaveJSProperty("open", false);
      await expect(page.locator(".topbar")).toHaveCSS("z-index", "1000");
      await page.setViewportSize({ width: 1280, height: 850 });
      await expect(trigger).toBeVisible();
      await expect(slider).toBeHidden();
      await trigger.click();
      await expect(slider).toBeVisible();
      // A visible mixed-control popup need not dismiss for a height-only resize.
      await slider.focus();
      const value = await slider.inputValue();
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(slider).toBeVisible();
      await expect(slider).toBeFocused();
      await expect(slider).toHaveValue(value);
      await page.keyboard.press("Escape");
      await expect(slider).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(mutations).toEqual([]);
    });
  }
