import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const)
  for (const { width, height } of [
    { width: 1280, height: 850 },
    { width: 360, height: 640 },
  ]) {
    test(`UIX-417 Russian system roles ${role} ${width}x${height}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height });
      const snapshot = buildGameSnapshot(role);
      snapshot.me.displayName = role === "GM" ? "GM Smith" : "Player One";
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
      // The map-scale GM-layer switch was removed; master tools remain in the
      // actual map toolbar, while players must not receive those controls.
      await expect(
        page.getByRole("button", { name: "Показывать скрытый слой мастера" }),
      ).toHaveCount(0);
      if (role === "GM")
        await expect(page.locator('.map-tool[data-tool="FOG"]')).toBeVisible();
      else
        await expect(page.locator('.map-tool[data-tool="FOG"]')).toHaveCount(0);
      if (width === 360) {
        await page.locator("#compact-nav-menu").click();
        const menu = page.getByRole("region", { name: "Меню кампании" });
        await expect(menu.locator(".compact-menu-user-name")).toHaveText(
          snapshot.me.displayName,
        );
        await expect(menu.locator(".compact-menu-user-role")).toHaveText(
          role === "GM" ? "Гейммастер (GM)" : "Игрок",
        );
      } else {
        const session = page.locator(".account-menu");
        await session.locator("summary").click();
        const identity = session.locator(".account-menu__identity");
        await expect(identity).toHaveText(
          role === "GM" ? "GM Smith · Мастер" : "Вы играете как: Player One",
        );
        await expect(identity).toBeVisible();
      }
      await page.screenshot({
        path: testInfo.outputPath(`session-role-${role}-${width}.png`),
      });
      expect(mutations).toEqual([]);
    });
  }
