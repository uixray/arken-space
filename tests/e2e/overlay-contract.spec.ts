import type { GameSnapshot, SceneDto } from "@arken/contracts";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

const scenes: SceneDto[] = [
  "Начальная сцена",
  "Вторая сцена",
  "Третья сцена",
].map((name, index) => ({
  id: `overlay-scene-${index}`,
  name,
  projection: "ORTHOGRAPHIC_2D",
  mapAssetId: null,
  backgroundFrame: { x: 0, y: 0, width: 1600, height: 1000 },
  width: 1600,
  height: 1000,
  grid: {
    enabled: true,
    size: 64,
    offsetX: 0,
    offsetY: 0,
    color: "#c8b78b",
    opacity: 0.22,
  },
  active: index === 0,
}));

async function install(page: Page, role: "GM" | "PLAYER" = "GM") {
  const current: GameSnapshot = gmSnapshot({ scenes, schemaVersion: 2 });
  current.me.role = role;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
    return route.fulfill({ json: path === "/api/bootstrap" ? current : [] });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((m) => {
      if (m.toString() === "40") socket.send('40{"sid":"navigation"}');
    });
    socket.send(
      '0{"sid":"navigation","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  return current;
}

async function assertHitTarget(target: Locator) {
  await expect(target).toBeVisible();
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return Boolean(hit && element.contains(hit));
      }),
    )
    .toBe(true);
}

for (const width of [1024, 1440]) {
  test(`UIX-644 scene picker real pointer selection and keyboard lifecycle ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await install(page);
    await page.goto("/");
    const trigger = page.getByLabel("Выбрать просматриваемую сцену");
    const list = page.getByRole("listbox", { name: "Сцены", exact: true });
    const switcher = page.locator(".scene-switcher");
    await expect
      .poll(() =>
        switcher.evaluate((element) => {
          const owner = element.getBoundingClientRect();
          return Array.from(element.children).every((child) => {
            const box = child.getBoundingClientRect();
            return (
              box.width === 0 ||
              (box.left >= owner.left - 1 && box.right <= owner.right + 1)
            );
          });
        }),
      )
      .toBe(true);
    await trigger.click();
    const second = list.getByRole("option", { name: /Вторая сцена/ });
    await assertHitTarget(second);
    await second.click();
    await expect(list).toBeHidden();
    await expect(trigger).toContainText("Вторая сцена");
    await expect(trigger).toBeFocused();

    await trigger.press("ArrowDown");
    await expect(
      list.getByRole("option", { name: /Вторая сцена/ }),
    ).toBeFocused();
    await page.keyboard.press("End");
    await expect(
      list.getByRole("option", { name: /Третья сцена/ }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(trigger).toContainText("Третья сцена");
    await expect(list).toBeHidden();
    await trigger.press("ArrowUp");
    await page.keyboard.press("Home");
    await expect(
      list.getByRole("option", { name: /Начальная сцена/ }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.locator(".brand").click();
    await expect(list).toBeHidden();
    await trigger.click();
    await openWorkspaceSection(page, "Сцены");
    await expect(list).toBeHidden();
    await expect(
      page.getByRole("dialog", { name: "Сцены", exact: true }),
    ).toBeVisible();
  });
}

test("UIX-644 hidden desktop picker closes across compact resize and PLAYER stays read-only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await install(page);
  await page.goto("/");
  const trigger = page.getByLabel("Выбрать просматриваемую сцену");
  await trigger.click();
  await assertHitTarget(page.getByRole("option", { name: /Вторая сцена/ }));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trigger).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(
    page.getByRole("listbox", { name: "Сцены", exact: true }),
  ).toBeHidden();
  await page.unroute("**/api/**");
  await install(page, "PLAYER");
  await page.reload();
  await expect(trigger).toHaveCount(0);
  await expect(
    page.getByLabel("Активная сцена", { exact: true }),
  ).toBeVisible();
});

test("UIX-644 short viewport scrolls options without dismissing and keeps focus aligned", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 360 });
  const current = await install(page);
  current.scenes = Array.from({ length: 20 }, (_, index) => ({
    ...scenes[0],
    id: `long-list-${index}`,
    name: `Сцена ${index + 1}`,
    active: index === 0,
  }));
  await page.goto("/");
  const trigger = page.getByLabel("Выбрать просматриваемую сцену");
  await trigger.focus();
  await trigger.press("End");
  const list = page.getByRole("listbox", { name: "Сцены", exact: true });
  const last = list.getByRole("option", { name: /^Сцена 20 / });
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("tabindex", "0");
  await assertHitTarget(last);
  const box = await list.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(352);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1016);
  await page.screenshot({
    path: testInfo.outputPath("scene-picker-short-viewport.png"),
  });
  await last.click();
  await expect(trigger).toContainText("Сцена 20");
  await expect(list).toBeHidden();
});

for (const { role, width, target } of [
  { role: "GM", width: 1024, target: "Сцены" },
  { role: "GM", width: 390, target: "Сцены" },
  { role: "PLAYER", width: 390, target: "Токены" },
] as const) {
  test(`UIX-644 navigation return owner ${role} ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await install(page, role);
    const errors: string[] = [],
      writes: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (
        p.startsWith("/api/") &&
        !["GET", "HEAD"].includes(r.method()) &&
        p !== "/api/chat/read"
      )
        writes.push(`${r.method()} ${p}`);
    });
    await page.goto("/");
    const trigger =
      width === 1024
        ? page.getByLabel("Ещё разделы", { exact: true })
        : page.getByRole("button", { name: "Разделы", exact: true });
    const menu =
      width === 1024
        ? page.locator(".workspace-nav__menu")
        : page.getByRole("dialog", { name: "Разделы", exact: true });
    for (let round = 0; round < 2; round++) {
      await trigger.click();
      await expect(menu).toBeVisible();
      const option = menu.getByRole("button", { name: target, exact: true });
      await assertHitTarget(option);
      await option.click();
      const dialog = page.getByRole("dialog", { name: target, exact: true });
      await expect(dialog).toBeVisible();
      await expect(menu).toBeHidden();
      await expect
        .poll(() =>
          dialog.evaluate((el) => el.contains(document.activeElement)),
        )
        .toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      if (width === 1024) await expect(trigger).toBeFocused();
      else {
        // Compact navigation intentionally restores the previous map surface,
        // not Sections. Preserve that existing owner contract.
        await expect(page.locator("#compact-nav-map")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect
          .poll(() =>
            page.evaluate(() => {
              const map = document.querySelector(".map-shell");
              return Boolean(
                map &&
                (map === document.activeElement ||
                  map.contains(document.activeElement)),
              );
            }),
          )
          .toBe(true);
      }
      await expect(trigger).toBeVisible();
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    await testInfo.attach("navigation-return-receipt", {
      body: JSON.stringify({ role, width, target, writes, errors }),
      contentType: "application/json",
    });
  });
}

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 1024]) {
    test(`UIX-644 music library return owner ${role} ${width}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await install(page, role);
      const errors: string[] = [],
        writes: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const p = new URL(r.url()).pathname;
        if (
          p.startsWith("/api/") &&
          !["GET", "HEAD"].includes(r.method()) &&
          p !== "/api/chat/read"
        )
          writes.push(`${r.method()} ${p}`);
      });
      await page.goto("/");
      const music = page.getByRole("region", { name: "Музыка", exact: true });
      const menu = music.getByLabel("Меню музыки", { exact: true });
      if (role === "GM")
        for (let round = 0; round < 2; round++) {
          await menu.click();
          const open = music.getByRole("button", {
            name: "Открыть библиотеку",
            exact: true,
          });
          await assertHitTarget(open);
          await open.click();
          const dialog = page.getByRole("dialog", {
            name: "Музыкальная библиотека",
            exact: true,
          });
          await expect(dialog).toBeVisible();
          await expect(page.locator(".music-overflow")).not.toHaveAttribute(
            "open",
            "",
          );
          await expect
            .poll(() =>
              dialog.evaluate((el) => el.contains(document.activeElement)),
            )
            .toBe(true);
          await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
          await expect(menu).toBeFocused();
        }
      else await expect(menu).toHaveCount(0);
      const volume = music.getByLabel("Громкость", { exact: true });
      await volume.click();
      const slider = music.getByRole("slider");
      await expect(slider).toBeVisible();
      await assertHitTarget(slider);
      await slider.focus();
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Escape");
      await expect(slider).toBeHidden();
      await expect(volume).toBeFocused();
      await volume.press("Enter");
      await expect(slider).toBeVisible();
      await page.getByLabel("Меню сеанса", { exact: true }).click();
      await expect(slider).toBeHidden();
      // Compact foundation deliberately hides music controls; verify hidden owner
      // closes, not pretend the desktop library is a reachable phone feature.
      await page.keyboard.press("Escape");
      await volume.click();
      await expect(slider).toBeVisible();
      await page.setViewportSize({ width: 390, height: 800 });
      await expect(page.locator(".music-topbar")).toBeHidden();
      await expect(page.locator(".music-volume-control")).not.toHaveAttribute(
        "open",
        "",
      );
      await page.setViewportSize({ width, height: 800 });
      await expect(volume).toBeVisible();
      await expect(slider).toBeHidden();
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
      await testInfo.attach("music-owner-receipt", {
        body: JSON.stringify({ role, width, errors, writes }),
        contentType: "application/json",
      });
    });
  }

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 390]) {
    test(`UIX-644 token tray owner lifecycle ${role} ${width}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const snapshot = await install(page, role);
      snapshot.tokenDefinitions = Array.from({ length: 24 }, (_, i) => ({
        id: `tray-definition-${i}`,
        characterId: null,
        defaultAssetId: null,
        name: `Страж ${String(i + 1).padStart(2, "0")}`,
        ownName: null,
        defaultWidth: 1,
        defaultHeight: 1,
        controllerMembershipIds: [snapshot.me.id],
        revision: 1,
      }));
      const errors: string[] = [],
        writes: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const p = new URL(r.url()).pathname;
        if (
          p.startsWith("/api/") &&
          !["GET", "HEAD"].includes(r.method()) &&
          p !== "/api/chat/read"
        )
          writes.push(`${r.method()} ${p}`);
      });
      await page.goto("/");
      const tray = page.locator(".token-tray"),
        summary = tray.locator("summary"),
        list = tray.locator(".token-tray-list");
      await summary.click();
      await expect(tray).toHaveAttribute("open", "");
      await page.keyboard.press("Tab");
      // Firefox includes the scrollable list itself in native tab order.
      // Do not skip arbitrary controls or programmatically focus a token.
      if (await list.evaluate((el) => el === document.activeElement))
        await page.keyboard.press("Tab");
      await expect(list.getByRole("button").first()).toBeFocused();
      for (let i = 1; i < 24; i++) await page.keyboard.press("Tab");
      const last = list.getByRole("button", { name: "Страж 24", exact: true });
      await expect(last).toBeFocused();
      await assertHitTarget(last);
      await expect
        .poll(() => list.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      expect(writes).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(tray).not.toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
      await summary.press("Enter");
      await expect(list).toBeVisible();
      await last.scrollIntoViewIfNeeded();
      await assertHitTarget(last);
      await expect(tray).toHaveAttribute("open", "");
      await page.getByLabel("Меню сеанса", { exact: true }).click();
      await expect(tray).not.toHaveAttribute("open", "");
      await expect(
        page.getByLabel("Меню сеанса", { exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await summary.click();
      await expect(tray).toHaveAttribute("open", "");
      if (width === 1280)
        await page.setViewportSize({ width: 390, height: 800 });
      await page.locator("#compact-nav-journal").click();
      await expect(tray).toBeHidden();
      await page.locator("#compact-nav-map").click();
      await expect(summary).toBeVisible();
      await expect(tray).not.toHaveAttribute("open", "");
      await summary.click();
      await expect(tray).toHaveAttribute("open", "");
      await page.keyboard.press("Escape");
      await expect(summary).toBeFocused();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      await testInfo.attach("token-tray-receipt", {
        body: JSON.stringify({ role, width, writes, errors }),
        contentType: "application/json",
      });
    });
  }

for (const width of [1280, 390])
  test(`UIX-644 scene editor map owner ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const snapshot = await install(page);
    snapshot.assets = ["Лесная карта", "Карта башни"].map((name, i) => ({
      id: `scene-map-${i}`,
      kind: "MAP" as const,
      name,
      mimeType: "image/svg+xml",
      sizeBytes: 128,
      width: 1600,
      height: 1000,
      durationSeconds: null,
      url: `/api/assets/scene-map-${i}/content`,
      createdAt: new Date(0).toISOString(),
    }));
    await page.route("**/api/assets/*/content", (r) =>
      r.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#637d72"/></svg>',
      }),
    );
    const errors: string[] = [],
      writes: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (
        p.startsWith("/api/") &&
        !["GET", "HEAD"].includes(r.method()) &&
        p !== "/api/chat/read"
      )
        writes.push(`${r.method()} ${p}`);
    });
    await page.goto("/");
    await openWorkspaceSection(page, "Сцены");
    const workspace = page.getByRole("dialog", { name: "Сцены", exact: true });
    const configure = workspace
      .locator(".scene-manager-card")
      .filter({ hasText: "Начальная сцена" })
      .getByRole("button", { name: "Настроить", exact: true });
    await configure.click();
    const editor = page.getByRole("dialog", {
      name: "Настройка: Начальная сцена",
      exact: true,
    });
    const name = editor.getByRole("textbox", { name: "Название", exact: true });
    await name.fill("Черновик леса");
    const trigger = editor.getByRole("combobox", {
      name: "Карта",
      exact: true,
    });
    await trigger.click();
    const popup = page.locator(".arken-form-select-popup");
    const forest = popup.getByRole("option", {
      name: "Лесная карта",
      exact: true,
    });
    await assertHitTarget(forest);
    await forest.click();
    await expect(trigger).toContainText("Лесная карта");
    await trigger.click();
    await expect(popup).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(editor).toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(name).toHaveValue("Черновик леса");
    await trigger.press("ArrowDown");
    await expect(popup).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(trigger).toContainText("Без карты");
    await expect(name).toHaveValue("Черновик леса");
    await trigger.click();
    await page.setViewportSize({ width: 360, height: 480 });
    await expect
      .poll(() =>
        popup.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left >= -1 &&
            r.right <= innerWidth + 1 &&
            r.top >= -1 &&
            r.bottom <= innerHeight + 1
          );
        }),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(workspace).toBeVisible();
    await configure.click();
    await expect(name).toHaveValue("Начальная сцена");
    await expect(trigger).toContainText("Без карты");
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    await testInfo.attach("scene-editor-map-receipt", {
      body: JSON.stringify({ width, writes, errors }),
      contentType: "application/json",
    });
  });
