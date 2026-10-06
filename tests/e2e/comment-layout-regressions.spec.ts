import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const)
  for (const { width, height } of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 1200, height: 918 },
    { width: 1280, height: 918 },
  ]) {
    test(`UIX-672 sidebar and map dice stay usable ${role} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const snapshot = buildGameSnapshot(role);
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
        if (path === "/api/story/posts")
          return route.fulfill({ json: { posts: [], nextCursor: null } });
        if (path === "/api/operator/feedback/capability")
          return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        if (route.request().method() !== "GET")
          return route.fulfill({
            status: 405,
            json: { error: "READ_ONLY_FIXTURE" },
          });
        return route.fulfill({ json: [] });
      });
      await page.routeWebSocket(/\/socket\.io\//, (socket) => {
        socket.onMessage((message) => {
          if (message.toString() === "40")
            socket.send('40{"sid":"comment-layout"}');
        });
        socket.send(
          '0{"sid":"comment-layout","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
        );
      });
      await page.goto("/");

      const dice = page.locator(".map-dice-tray .dice-tray-panel__toolbar");
      await expect(dice).toBeVisible();
      const tops = await dice
        .locator("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getBoundingClientRect().top),
        );
      expect(tops.length).toBeGreaterThanOrEqual(10);
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);

      if (width < 800) await page.locator("#compact-nav-journal").click();
      const sidebar = page.locator("#activity-sidebar");
      await expect(sidebar).toBeVisible();
      const scroll = sidebar.locator(".panel-scroll");
      await expect(scroll).toBeVisible();
      expect((await scroll.boundingBox())?.height ?? 0).toBeGreaterThan(
        width < 800 ? 300 : 400,
      );
      await expect(sidebar.getByRole("textbox")).toBeVisible();

      const journalBar = sidebar.locator(".activity-log-toolbar");
      await expect(journalBar).toHaveCSS("border-top-width", "0px");
      const composer = sidebar.locator("form.chat-compose--single");
      const input = composer.locator(".chat-composer-input");
      const textarea = input.locator("textarea");
      await expect(textarea).toHaveCSS("border-top-width", "0px");
      await expect(textarea).toHaveCSS("box-shadow", "none");
      const [formBox, inputBox] = await Promise.all([
        composer.boundingBox(),
        input.boundingBox(),
      ]);
      expect(formBox).not.toBeNull();
      expect(inputBox).not.toBeNull();
      expect(Math.abs(inputBox!.x - formBox!.x)).toBeLessThan(2);
      expect(Math.abs(inputBox!.width - formBox!.width)).toBeLessThan(2);
    });
  }
