import { expect, test } from "./react-console-guard";
import AxeBuilder from "@axe-core/playwright";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const width of [1280, 390]) {
  test(`operator list filters and next page remain usable at ${width}`, async ({
    page,
  }, info) => {
    const first = {
      id: "first",
      kind: "BUG",
      status: "NEW",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      buildVersion: "old-build",
      buildRevision: null,
      linearKey: null,
      linearUrl: null,
    };
    const second = {
      ...first,
      id: "second",
      kind: "IDEA",
      status: "ACKNOWLEDGED",
      buildVersion: "new-build",
    };
    const queries: Record<string, string>[] = [],
      writes: string[] = [];
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url()),
        path = url.pathname;
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
      if (path === "/api/operator/feedback") {
        queries.push(Object.fromEntries(url.searchParams));
        if (url.searchParams.has("kind"))
          return route.fulfill({ json: { items: [second], nextCursor: null } });
        return route.fulfill({
          json: url.searchParams.has("cursor")
            ? { items: [second], nextCursor: null }
            : { items: [first], nextCursor: "opaque+/=" },
        });
      }
      if (path === "/api/operator/feedback/first")
        return route.fulfill({
          json: {
            ...first,
            status: "ACKNOWLEDGED",
            title: "ДлинныйЗаголовок".repeat(8),
            description: `https://example.invalid/${"fragment".repeat(100)}`,
            attachments: [],
          },
        });
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      return route.fulfill({ json: [] });
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        if (message.toString() === "40") socket.send('40{"sid":"list"}');
      });
      socket.send(
        '0{"sid":"list-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await openWorkspaceSection(page, "Обратная связь");
    const dialog = page.getByRole("dialog", {
      name: "Обратная связь",
      exact: true,
    });
    await expect(dialog.getByRole("button", { name: /Ошибка/ })).toBeVisible();
    await dialog
      .getByRole("button", { name: "Загрузить ещё", exact: true })
      .click();
    await expect(dialog.getByRole("button", { name: /Идея/ })).toBeVisible();
    expect(queries.at(-1)).toEqual({ cursor: "opaque+/=" });
    await expect(
      dialog.getByRole("button", { name: "Загрузить ещё", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("combobox", { name: "Тип обращения", exact: true })
      .selectOption("IDEA");
    await dialog
      .getByRole("combobox", { name: "Статус обращения", exact: true })
      .selectOption("ACKNOWLEDGED");
    await dialog.getByLabel("Сборка", { exact: true }).fill("new-build");
    await dialog.getByLabel("С даты", { exact: true }).fill("2026-09-01T10:00");
    await dialog
      .getByLabel("По дату", { exact: true })
      .fill("2026-09-17T10:00");
    const dates = await page.evaluate(() => ({
      from: new Date("2026-09-01T10:00").toISOString(),
      to: new Date("2026-09-17T10:00").toISOString(),
    }));
    await dialog
      .getByRole("button", { name: "Применить фильтры", exact: true })
      .click();
    await expect(dialog.getByRole("button", { name: /Ошибка/ })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /Идея/ })).toHaveCount(1);
    expect(queries.at(-1)).toEqual({
      ...dates,
      kind: "IDEA",
      status: "ACKNOWLEDGED",
      build: "new-build",
    });
    const bounds = await dialog.evaluate((root) => {
      const box = root.getBoundingClientRect();
      return [...root.querySelectorAll("input, select")].every((node) => {
        const r = node.getBoundingClientRect();
        return r.left >= box.left && r.right <= box.right + 1;
      });
    });
    expect(bounds).toBe(true);
    await dialog
      .getByRole("button", { name: "Сбросить фильтры", exact: true })
      .click();
    await expect(dialog.getByRole("button", { name: /Ошибка/ })).toBeVisible();
    expect(queries.at(-1)).toEqual({});
    await expect(dialog.getByLabel("Сборка", { exact: true })).toHaveValue("");
    expect(writes).toEqual([]);
    const accessibility = await new AxeBuilder({ page })
      .include(".operator-feedback")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    await info.attach("operator-list-accessibility", {
      body: JSON.stringify({
        violations: accessibility.violations,
        incomplete: accessibility.incomplete,
      }),
      contentType: "application/json",
    });
    expect(accessibility.violations).toEqual([]);
    await dialog.getByRole("button", { name: /Ошибка/ }).click();
    await expect(
      dialog.getByRole("heading", { name: "ДлинныйЗаголовок".repeat(8) }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "ДлинныйЗаголовок".repeat(8) }),
    ).toBeFocused();
    const detailSection = dialog.locator(".operator-feedback__grid > section");
    expect(
      await detailSection.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
      "Long report titles and URLs must wrap rather than require horizontal scrolling",
    ).toBe(true);
    const detailAccessibility = await new AxeBuilder({ page })
      .include(".operator-feedback")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    await info.attach("operator-detail-accessibility", {
      body: JSON.stringify({
        violations: detailAccessibility.violations,
        incomplete: detailAccessibility.incomplete,
      }),
      contentType: "application/json",
    });
    expect(detailAccessibility.violations).toEqual([]);
    await info.attach("list-query-receipt", {
      body: JSON.stringify({ width, queries, bounds, writes }),
      contentType: "application/json",
    });
  });
}
