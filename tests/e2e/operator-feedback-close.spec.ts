import type { Route } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

test("operator close cancels late clipboard export without leaking detail on reopen", async ({
  page,
}) => {
  const detail = {
    id: "report",
    kind: "BUG",
    status: "NEW",
    title: "Тестовый отчёт",
    description: "Только тестовые данные",
    attachments: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    buildVersion: null,
    buildRevision: null,
    linearKey: null,
    linearUrl: null,
  };
  let pending: Route | undefined;
  const writes: string[] = [];
  await page.addInitScript(() => {
    const captured: string[] = [];
    Object.defineProperty(window, "testClipboardWrites", { value: captured });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          captured.push(value);
        },
      },
    });
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!["GET", "HEAD"].includes(route.request().method())) {
      if (path === "/api/chat/read")
        return route.fulfill({ json: { ok: true } });
      writes.push(path);
      return route.abort();
    }
    if (path === "/api/bootstrap")
      return route.fulfill({ json: gmSnapshot({ schemaVersion: 2 }) });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({ json: { allowed: true } });
    if (path === "/api/operator/feedback")
      return route.fulfill({ json: { items: [detail], nextCursor: null } });
    if (path === "/api/operator/feedback/report")
      return route.fulfill({ json: detail });
    if (path === "/api/operator/feedback/report/export") {
      pending = route;
      return;
    }
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") socket.send('40{"sid":"operator"}');
    });
    socket.send(
      '0{"sid":"operator-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await openWorkspaceSection(page, "Обратная связь");
  const dialog = page.getByRole("dialog", {
    name: "Обратная связь",
    exact: true,
  });
  await dialog.getByRole("button", { name: /Ошибка/ }).click();
  await expect(dialog.getByText(detail.title, { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", {
      name: "Копировать обезличенную версию",
      exact: true,
    })
    .click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await dialog
    .getByRole("button", { name: "Закрыть окно", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const delivered = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/report/export"),
  );
  await pending!.fulfill({ json: { description: "REDACTED-EXPORT" } });
  await delivered;
  await openWorkspaceSection(page, "Обратная связь");
  await expect(dialog.getByRole("button", { name: /Ошибка/ })).toBeVisible();
  await expect(dialog.getByText(detail.title, { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByText("Обезличенная копия скопирована.", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "testClipboardWrites")),
  ).toEqual([]);
  expect(writes).toEqual([]);
});
