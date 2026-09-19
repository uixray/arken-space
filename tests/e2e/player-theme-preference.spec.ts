import type { Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { PLAYER_THEMES } from "../../apps/web/src/design-system/player-themes";
import { openWorkspaceSection } from "./workspace-nav-helper";

async function preferenceFixture(page: Page, role: "GM" | "PLAYER") {
  const snapshot = buildGameSnapshot(role);
  snapshot.scenes = [
    {
      id: "31700000-0000-4000-8000-000000000001",
      name: "Темы",
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
  snapshot.personalTheme = {
    scopeKey: snapshot.me.id,
    selectedThemeId: null,
    defaultThemeId: "forest",
    revision: 0,
    publishedThemes: [...PLAYER_THEMES],
  };
  const writes: { selectedThemeId: string | null; expectedRevision: number }[] =
    [];
  const unexpected: string[] = [];
  const assignments: { defaultThemeId: string; expectedRevision: number }[] =
    [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "PATCH" && path.endsWith("/theme-default")) {
      const member = snapshot.members.find(
        (entry) => path === `/api/members/${entry.id}/theme-default`,
      );
      if (!member || role !== "GM")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      const body = request.postDataJSON() as (typeof assignments)[number];
      assignments.push(body);
      member.defaultThemeId = body.defaultThemeId;
      member.defaultThemeRevision = (member.defaultThemeRevision ?? 0) + 1;
      return route.fulfill({
        json: {
          id: member.id,
          defaultThemeId: member.defaultThemeId,
          revision: member.defaultThemeRevision,
        },
      });
    }
    if (request.method() === "PATCH" && path === "/api/me/theme") {
      const body = request.postDataJSON() as (typeof writes)[number];
      writes.push(body);
      const current = snapshot.personalTheme!;
      if (body.expectedRevision !== current.revision) {
        return route.fulfill({
          status: 409,
          json: { error: "THEME_PREFERENCE_CONFLICT", personalTheme: current },
        });
      }
      snapshot.personalTheme = {
        ...current,
        selectedThemeId: body.selectedThemeId,
        revision: current.revision + 1,
      };
      return route.fulfill({ json: snapshot.personalTheme });
    }
    if (request.method() !== "GET") {
      unexpected.push(`${request.method()} ${path}`);
      return route.fulfill({
        status: 405,
        json: { error: "UNEXPECTED_MUTATION" },
      });
    }
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/me/theme")
      return route.fulfill({ json: snapshot.personalTheme });
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") socket.send('40{"sid":"theme-socket"}');
    });
    socket.send(
      '0{"sid":"theme-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  return { snapshot, writes, assignments, unexpected, errors };
}

async function openSettings(page: Page) {
  await page.locator(".account-menu > summary").click();
  await page.getByRole("button", { name: "Оформление", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Оформление", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const width of [1280, 390]) {
  test(`UIX-644 GM default-theme menu lifecycle ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 850 });
    const fixture = await preferenceFixture(page, "GM");
    fixture.snapshot.members.push({
      id: "31700000-0000-4000-8000-000000000002",
      role: "PLAYER",
      displayName: "Участник темы",
      characterId: null,
      defaultThemeId: "forest",
      defaultThemeRevision: 0,
    });
    await page.goto("/");
    await openWorkspaceSection(page, "Подготовка");
    const participant = page.getByRole("combobox", {
      name: "Игрок",
      exact: true,
    });
    await participant.click();
    await page
      .getByRole("option", { name: "Участник темы", exact: true })
      .click();
    const trigger = page.getByRole("combobox", {
      name: "Тема игрока по умолчанию",
      exact: true,
    });
    const popup = page.locator(".arken-form-select-popup");
    await trigger.click();
    await expect(popup).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press("ArrowDown");
    await expect(popup).toBeVisible();
    await page.keyboard.press("Escape");
    await trigger.click();
    const option = page.getByRole("option", { name: "Светлая", exact: true });
    const box = await option.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await option.click();
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    await page
      .getByRole("button", { name: "Назначить тему", exact: true })
      .click();
    await expect.poll(() => fixture.assignments.length).toBe(1);
    expect(fixture.assignments[0]).toEqual({
      defaultThemeId: "light",
      expectedRevision: 0,
    });
    // Changing another member's default never changes the GM's own preference.
    await expect(page.locator("html")).toHaveAttribute(
      "data-player-theme",
      "forest",
    );
    await trigger.click();
    await page
      .getByRole("heading", { name: "Проверка видимости", exact: true })
      .click();
    await expect(popup).toBeHidden();
    await info.attach("member-default-menu", {
      body: JSON.stringify({
        width,
        assignments: fixture.assignments,
        errors: fixture.errors,
      }),
      contentType: "application/json",
    });
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

async function chooseTheme(page: Page, name: RegExp) {
  const dialog = page.getByRole("dialog", { name: "Оформление", exact: true });
  await dialog.getByRole("combobox", { name: "Тема", exact: true }).click();
  const option = page.getByRole("option", { name });
  await expect(option).toBeVisible();
  // A real portal option click, never selectOption/DOM mutation/force.
  await option.click();
}

for (const role of ["GM", "PLAYER"] as const) {
  for (const width of [1280, 390]) {
    test(`UIX-317 personal theme preview save reset reload ${role} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 850 });
      const fixture = await preferenceFixture(page, role);
      await page.goto("/");
      await expect(page.locator(".map-viewport")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute(
        "data-player-theme",
        "forest",
      );
      let dialog = await openSettings(page);
      await chooseTheme(page, /^Светлая/);
      await expect(page.locator("html")).toHaveAttribute(
        "data-player-theme",
        "light",
      );
      await expect(page.locator(".g-root").first()).toHaveClass(
        /g-root_theme_light/,
      );
      expect(fixture.writes).toEqual([]);
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator("html")).toHaveAttribute(
        "data-player-theme",
        "forest",
      );

      dialog = await openSettings(page);
      await chooseTheme(page, /^Прежнее оформление/);
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/me/theme") &&
            response.request().method() === "PATCH" &&
            response.status() === 200,
        ),
        dialog.getByRole("button", { name: "Сохранить", exact: true }).click(),
      ]);
      await expect.poll(() => fixture.writes.length).toBe(1);
      expect(fixture.writes[0]).toEqual({
        selectedThemeId: "classic-v1",
        expectedRevision: 0,
      });
      await page.reload();
      await expect(page.locator(".map-viewport")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute(
        "data-player-theme",
        "classic-v1",
      );

      dialog = await openSettings(page);
      await dialog
        .getByRole("button", { name: "Сбросить к моей теме", exact: true })
        .click();
      await expect.poll(() => fixture.writes.length).toBe(2);
      await expect(page.locator("html")).toHaveAttribute(
        "data-player-theme",
        "forest",
      );
      expect(fixture.writes[1]).toEqual({
        selectedThemeId: null,
        expectedRevision: 1,
      });
      // Saving/resetting may keep the settings open; reopen through its owner if closed.
      if (!(await dialog.isVisible())) dialog = await openSettings(page);
      await chooseTheme(page, /^Системное оформление/);
      await dialog
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect.poll(() => fixture.writes.length).toBe(3);
      expect(fixture.writes[2]).toEqual({
        selectedThemeId: "system",
        expectedRevision: 2,
      });
      await page.reload();
      await expect(page.locator(".map-viewport")).toBeVisible();
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-player-theme",
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await info.attach("preference-fixture-receipt", {
        body: JSON.stringify({
          role,
          width,
          writes: fixture.writes,
          unexpected: fixture.unexpected,
          errors: fixture.errors,
        }),
        contentType: "application/json",
      });
      expect(fixture.unexpected).toEqual([]);
      expect(fixture.errors).toEqual([]);
    });
  }
}
