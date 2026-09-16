import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const width of [1280, 390]) {
  test(`UIX-317 startup error exposes alert semantics and keyboard retry recovers ${width}`, async ({
    page,
  }, info) => {
    const current = gmSnapshot({ schemaVersion: 2 });
    const errors: string[] = [];
    const writes: string[] = [];
    let recovering = false,
      retries = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (!["GET", "HEAD"].includes(request.method())) {
        writes.push(`${request.method()} ${path}`);
        // An intentional API failure may produce diagnostic telemetry; chat
        // read is bootstrap bookkeeping. Neither is a gameplay mutation.
        if (path === "/api/client-logs" || path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        return route.abort();
      }
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      return route.fulfill({ json: [] });
    });
    await page.route("**/api/bootstrap", async (route) => {
      if (!recovering)
        return route.fulfill({
          status: 503,
          json: {
            error: "SERVICE_UNAVAILABLE",
            message: "Кампания временно недоступна.",
          },
        });
      retries += 1;
      await held;
      return route.fulfill({ json: current });
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        if (message.toString() === "40") socket.send('40{"sid":"recovery"}');
      });
      socket.send(
        '0{"sid":"recovery-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.setViewportSize({ width, height: 800 });
    try {
      await page.goto("/");
      const alert = page.getByRole("alert");
      await expect(alert).toContainText("Не удалось загрузить данные");
      await expect(alert).toContainText("Кампания временно недоступна.");
      await expect(alert).toHaveAttribute("aria-atomic", "true");
      const retry = alert.getByRole("button", {
        name: "Повторить",
        exact: true,
      });
      const box = (await retry.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await retry.focus();
      recovering = true;
      await retry.press("Enter");
      await expect.poll(() => retries).toBe(1);
      await expect(page.getByRole("status")).toContainText(
        "Загружаем кампанию…",
      );
      await expect(alert).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Повторить", exact: true }),
      ).toHaveCount(0);
      release();
      await expect(page.locator(".app-shell")).toBeVisible();
      await expect(page.locator(".loading")).toHaveCount(0);
      await expect(
        page.getByText("Не удалось загрузить данные", { exact: true }),
      ).toHaveCount(0);
      expect(retries).toBe(1);
      expect(
        writes.filter(
          (path) => !/^POST \/api\/(client-logs|chat\/read)$/.test(path),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
      await info.attach("startup-recovery", {
        body: JSON.stringify({ width, retries, writes, errors }),
        contentType: "application/json",
      });
    } finally {
      release();
    }
  });
}
