import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const width of [360, 640]) {
  test(`UIX-644 cursor popup keyboard owner navigation ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 640 ? 360 : 850 });
    const snapshot = buildGameSnapshot("GM");
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
    const writes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== "GET") {
        writes.push(`${route.request().method()} ${path}`);
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
          socket.send('40{"sid":"cursor-socket"}');
      });
      socket.send(
        '0{"sid":"cursor-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.goto("/");
    const trigger = page.getByRole("button", {
      name: "Настроить видимость курсоров",
      exact: true,
      includeHidden: true,
    });
    const popup = page.getByRole("dialog", {
      name: "Видимость курсоров",
      exact: true,
    });
    for (let cycle = 0; cycle < 2; cycle++) {
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      await trigger.press("Enter");
      await expect(popup).toBeVisible();
      await expect(trigger).toHaveAttribute(
        "aria-controls",
        (await popup.getAttribute("id")) as string,
      );
      await expect(page.getByRole("dialog")).toHaveCount(1);
      const receive = popup.getByRole("switch").first();
      await expect(receive).toBeFocused();
      const journal = page.locator("#compact-nav-journal");
      await journal.focus();
      await journal.press("Enter");
      await expect(journal).toHaveAttribute("aria-pressed", "true");
      await expect(popup).toBeHidden();
      await expect(trigger).toBeHidden();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(
              document.activeElement?.closest("#activity-sidebar") &&
              !document.activeElement?.closest("[hidden], [inert]"),
            ),
          ),
        )
        .toBe(true);
      const map = page.locator("#compact-nav-map");
      await map.focus();
      await map.press("Enter");
      await expect(map).toHaveAttribute("aria-pressed", "true");
      await expect(popup).toBeHidden();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    }
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await expect(popup).toBeVisible();
    await popup.getByRole("switch").first().press("Escape");
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}
