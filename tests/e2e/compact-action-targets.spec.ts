import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [360]) {
    test(`UIX-624 compact action targets ${role} ${width}`, async ({
      page,
    }, testInfo) => {
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
      const failures: object[] = [];
      const measurements: object[] = [];
      for (const surface of ["map", "journal"] as const) {
        await page.locator(`#compact-nav-${surface}`).click();
        await expect(page.locator(`#compact-nav-${surface}`)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(360);
        const controls = page.locator(
          "button:visible, summary:visible, [role=tab]:visible",
        );
        for (const control of await controls.all()) {
          if (await control.isDisabled()) continue;
          await control.scrollIntoViewIfNeeded();
          const measurement = await control.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return {
              label:
                node.getAttribute("aria-label") ||
                node.getAttribute("title") ||
                node.textContent?.trim(),
              className: node.className,
              width: box.width,
              height: box.height,
              hit: node.contains(
                document.elementFromPoint(
                  box.x + box.width / 2,
                  box.y + box.height / 2,
                ),
              ),
            };
          });
          measurements.push({ surface, ...measurement });
          if (
            measurement.width < 44 ||
            measurement.height < 44 ||
            !measurement.hit
          )
            failures.push({ surface, ...measurement });
        }
      }
      await page.locator("#compact-nav-map").click();
      if (role === "GM") {
        const more = page.locator(".toolbar-overflow summary");
        await more.click();
        const moreAction = page
          .locator(".toolbar-overflow-menu input:visible")
          .first();
        await expect(moreAction).toBeVisible();
        await expect
          .poll(() =>
            moreAction.evaluate((node) => {
              const b = node.getBoundingClientRect();
              return node.contains(
                document.elementFromPoint(
                  b.x + b.width / 2,
                  b.y + b.height / 2,
                ),
              );
            }),
          )
          .toBe(true);
        await moreAction.focus();
        await page.keyboard.press("Escape");
        await expect(moreAction).toBeHidden();
        await expect(more).toBeFocused();
      }
      await page.screenshot({
        path: testInfo.outputPath("compact-map-360.png"),
      });
      await testInfo.attach("compact-action-targets", {
        body: JSON.stringify({ role, width, measurements, failures }, null, 2),
        contentType: "application/json",
      });
      expect(failures).toEqual([]);
      expect(mutations).toEqual([]);
    });
  }
