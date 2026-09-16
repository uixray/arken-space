import { expect, test } from "./react-console-guard";
import type { Route } from "@playwright/test";
import { playerSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const width of [1280, 360]) {
  test(`UIX-317 pending invitation preserves submitted identity ${width}`, async ({
    page,
  }, info) => {
    const pending: Route[] = [];
    const payloads: unknown[] = [];
    const errors: string[] = [];
    const unexpected: string[] = [];
    const current = playerSnapshot({ schemaVersion: 2 });
    current.me.displayName = "Уточнённое имя";
    let authenticated = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!["GET", "HEAD"].includes(route.request().method())) {
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        unexpected.push(`${route.request().method()} ${path}`);
        return route.abort();
      }
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      return route.fulfill({ json: [] });
    });
    await page.route("**/api/bootstrap", (route) =>
      authenticated
        ? route.fulfill({ json: current })
        : route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } }),
    );
    await page.route("**/api/auth/invite", (route) => {
      payloads.push(route.request().postDataJSON());
      pending.push(route);
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        if (message.toString() === "40") socket.send('40{"sid":"invite"}');
      });
      socket.send(
        '0{"sid":"invite-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/join/pending-invite-test");
    const form = page.getByRole("form", { name: "Вход в игру" });
    const name = form.getByLabel("Имя", { exact: true });
    const enter = form.getByRole("button", { name: "Войти", exact: true });
    try {
      await name.fill("Первое имя");
      await enter.click();
      await expect.poll(() => pending.length).toBe(1);
      await expect(name).not.toBeEditable();
      await expect(name).toBeEnabled();
      await expect(form).toHaveAttribute("aria-busy", "true");
      await expect(enter).toBeDisabled();
      await name.focus();
      await name.press("ControlOrMeta+A");
      expect(
        await name.evaluate((node) => (node as HTMLInputElement).selectionEnd),
      ).toBe("Первое имя".length);
      await name.press("Backspace");
      await name.press("Enter");
      await expect(name).toHaveValue("Первое имя");
      expect(payloads).toHaveLength(1);
      await pending.shift()!.fulfill({
        status: 503,
        json: { error: "UNAVAILABLE", message: "Вход временно недоступен" },
      });
      await expect(form.getByRole("alert")).toHaveText(
        "Вход временно недоступен",
      );
      await expect(name).toBeEditable();
      await expect(name).toHaveValue("Первое имя");
      await expect(form).toHaveAttribute("aria-busy", "false");
      await expect(enter).toBeEnabled();
      await name.fill("Уточнённое имя");
      await name.press("Enter");
      await expect.poll(() => pending.length).toBe(1);
      await expect(name).not.toBeEditable();
      await expect(form.getByRole("alert")).toHaveCount(0);
      authenticated = true;
      await pending.shift()!.fulfill({ json: { ok: true } });
      await expect(page.locator(".app-shell")).toBeVisible();
      await expect(form).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
      expect(payloads).toEqual([
        { token: "pending-invite-test", displayName: "Первое имя" },
        { token: "pending-invite-test", displayName: "Уточнённое имя" },
      ]);
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
      await info.attach("invite-pending", {
        body: JSON.stringify({ width, payloads, errors, unexpected }),
        contentType: "application/json",
      });
    } finally {
      for (const route of pending)
        await route
          .fulfill({ status: 503, json: { error: "TEST_CLEANUP" } })
          .catch(() => undefined);
    }
  });
}
