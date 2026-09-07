import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import type { Page } from "@playwright/test";
import type { SceneDto } from "@arken/contracts";

async function install(
  page: Page,
  role: "GM" | "PLAYER" = "GM",
  options: { map?: boolean; failFirstSave?: boolean } = {},
) {
  const scene: SceneDto = {
    id: "scene-1",
    name: "Проверка полей",
    projection: "ORTHOGRAPHIC_2D",
    mapAssetId: options.map ? "fixture-map" : null,
    width: 1920,
    height: 1080,
    backgroundFrame: { x: 0, y: 0, width: 1920, height: 1080 },
    grid: {
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#c8b78b",
      opacity: 0.22,
    },
    active: true,
  };
  const snapshot = buildGameSnapshot(role, {
    scenes: [scene],
    schemaVersion: 2,
    assets: options.map
      ? [
          {
            id: "fixture-map",
            kind: "MAP",
            name: "Карта проверки",
            mimeType: "image/svg+xml",
            sizeBytes: 256,
            width: 800,
            height: 600,
            durationSeconds: null,
            url: "/api/assets/fixture-map/content",
            createdAt: "2026-09-07T00:00:00.000Z",
          },
        ]
      : [],
  });
  const saves: unknown[] = [];
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ json: [] }),
  );
  // App loads the story channel with bootstrap. Leaving this request unhandled
  // hit the absent fixture backend and correctly surfaced a global error toast.
  await page.route("**/api/story/posts?limit=50", (route) =>
    route.fulfill({ json: { posts: [], nextCursor: null } }),
  );
  // These fixtures are campaign members, not globally privileged operators.
  await page.route("**/api/operator/feedback/capability", (route) =>
    route.fulfill({ status: 403, json: { message: "OPERATOR_REQUIRED" } }),
  );
  await page.route("**/api/client-logs", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  if (options.map)
    await page.route("**/api/assets/fixture-map/content", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#314c5d"/><path d="M0 0H400V300H0Z M400 300H800V600H400Z" fill="#527b76"/></svg>',
      }),
    );
  await page.route("**/api/scenes/scene-1/canvas", (route) => {
    const body = route.request().postDataJSON();
    saves.push(body);
    if (options.failFirstSave && saves.length === 1)
      return route.fulfill({
        status: 503,
        json: { message: "Проверка: сохранение недоступно" },
      });
    Object.assign(scene, {
      grid: body.grid,
      width: body.world.width,
      height: body.world.height,
      backgroundFrame: body.backgroundFrame,
    });
    return route.fulfill({ json: scene });
  });
  const storyLoaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/story/posts",
  );
  await page.goto("/");
  expect((await storyLoaded).status()).toBe(200);
  await expect(
    page.getByText("Не удалось выполнить запрос", { exact: true }),
  ).toHaveCount(0);
  return saves;
}

test("UIX-421 scene controls enforce native ranges, describe errors and save invisible snapping", async ({
  page,
}, testInfo) => {
  const saves = await install(page);
  await openWorkspaceSection(page, "Сцены");
  await page
    .getByRole("dialog", { name: "Сцены", exact: true })
    .getByRole("button", { name: "Настроить" })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Настройка: Проверка полей",
  });
  const save = editor.getByRole("button", { name: "Сохранить", exact: true });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription(
    "Нет изменений для сохранения.",
  );
  const color = editor.getByLabel("Цвет сетки");
  await expect(color).toHaveAttribute("type", "color");
  await expect(color).toHaveValue("#c8b78b");
  // Gravity scales the dialog while opening; measure the settled geometry,
  // not an intermediate animation frame. Keep the usable-size threshold.
  await expect
    .poll(() => color.evaluate((input) => input.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(36);
  const colorGeometry = await color.evaluate((input) => {
    const style = getComputedStyle(input);
    return {
      height: input.getBoundingClientRect().height,
      contentHeight:
        input.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom),
    };
  });
  expect(colorGeometry.height).toBeGreaterThanOrEqual(36);
  expect(colorGeometry.contentHeight).toBeGreaterThanOrEqual(24);
  await color.fill("#112233");
  const width = editor.getByRole("spinbutton", {
    name: "Ширина (px)",
    exact: true,
  });
  await expect(width).toHaveAttribute("min", "320");
  await expect(width).toHaveAttribute("max", "16384");
  await expect(width).toHaveAttribute("step", "1");
  await expect(width).toHaveAttribute("required", "");
  await width.fill("319");
  expect(
    await width.evaluate(
      (input: HTMLInputElement) => input.validity.rangeUnderflow,
    ),
  ).toBe(true);
  await expect(width).toHaveAttribute("aria-invalid", "true");
  await expect(width).toHaveAccessibleDescription(/Введите значение/);
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription(
    "Исправьте отмеченные поля перед сохранением.",
  );
  await expect(
    page.getByText("Не удалось выполнить запрос", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("scene-controls-invalid.png"),
  });
  expect(saves).toHaveLength(0);
  await width.fill("1920");
  const cell = editor.getByRole("spinbutton", { name: "Размер клетки (px)" });
  await cell.fill("64.5");
  expect(
    await cell.evaluate(
      (input: HTMLInputElement) => input.validity.stepMismatch,
    ),
  ).toBe(true);
  await expect(cell).toHaveAttribute("aria-invalid", "true");
  await cell.fill("64");
  const opacity = editor.getByRole("spinbutton", {
    name: "Непрозрачность (0–1)",
  });
  expect(
    await opacity.evaluate((input: HTMLInputElement) => input.validity.valid),
  ).toBe(true);
  await expect(opacity).toHaveAttribute("min", "0");
  await expect(opacity).toHaveAttribute("max", "1");
  await expect(opacity).toHaveAttribute("step", "any");
  await opacity.fill("0");
  const offset = editor.getByRole("spinbutton", { name: "Смещение X (px)" });
  await offset.fill("");
  await offset.pressSequentially("-0.5");
  await expect(offset).toHaveValue("-0.5");
  await expect(
    editor.getByRole("checkbox", { name: "Сетка: привязка и измерение" }),
  ).toBeChecked();
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toMatchObject({
    grid: { enabled: true, opacity: 0, offsetX: -0.5, color: "#112233" },
  });
  await expect(editor).toBeHidden();
});

test("UIX-421 cancel discards edits on a compact viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const saves = await install(page);
  await openWorkspaceSection(page, "Сцены");
  const manager = page.getByRole("dialog", { name: "Сцены", exact: true });
  await manager.getByRole("button", { name: "Настроить" }).click();
  const editor = page.getByRole("dialog", {
    name: "Настройка: Проверка полей",
  });
  await editor
    .getByRole("spinbutton", { name: "Размер клетки (px)" })
    .fill("128");
  await expect(
    editor.getByRole("spinbutton", { name: "Размер клетки (px)" }),
  ).toBeVisible();
  expect(
    await editor.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await editor.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(saves).toHaveLength(0);
  await manager.getByRole("button", { name: "Настроить" }).click();
  await expect(
    editor.getByRole("spinbutton", { name: "Размер клетки (px)" }),
  ).toHaveValue("64");
});

test("UIX-421 keeps scene management unavailable to PLAYER", async ({
  page,
}) => {
  const saves = await install(page, "PLAYER");
  await expect(page.locator(".workspace-nav")).toBeVisible();
  await expect(page.locator("[data-workspace='scenes']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Создать сцену" })).toHaveCount(
    0,
  );
  expect(saves).toHaveLength(0);
});

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`UIX-421 A2 draft preview stays local and restores on dismiss at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/api/") &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method())
      )
        mutations.push(
          `${request.method()} ${new URL(request.url()).pathname}`,
        );
    });
    const saves = await install(page, "GM", { map: true, failFirstSave: true });
    await openWorkspaceSection(page, "Сцены");
    const manager = page.getByRole("dialog", { name: "Сцены", exact: true });
    const editor = page.getByRole("dialog", {
      name: "Настройка: Проверка полей",
    });
    await manager.getByRole("button", { name: "Настроить" }).click();
    const preview = editor.getByRole("img", {
      name: "Карта и сетка — черновик сцены",
    });
    const cell = editor.getByRole("spinbutton", { name: "Размер клетки (px)" });
    for (const dismiss of ["cancel", "escape", "close"] as const) {
      await cell.fill("80");
      await editor
        .getByRole("spinbutton", { name: "Смещение X (px)", exact: true })
        .fill("-10.5");
      await editor
        .getByRole("spinbutton", { name: "Смещение Y (px)", exact: true })
        .fill("18.25");
      await editor.getByLabel("Цвет сетки").fill("#f0a040");
      await editor
        .getByRole("spinbutton", { name: "Непрозрачность (0–1)" })
        .fill("0.75");
      await expect(preview.locator("pattern")).toHaveAttribute("width", "80");
      await expect(preview.locator("pattern")).toHaveAttribute("x", "-10.5");
      await expect(preview.locator("pattern")).toHaveAttribute("y", "18.25");
      await expect(preview.locator("path")).toHaveAttribute(
        "stroke",
        "#f0a040",
      );
      await expect(
        preview.locator(".scene-grid-preview__grid"),
      ).toHaveAttribute("opacity", "0.75");
      await expect(preview.locator("image")).toHaveAttribute(
        "href",
        "/api/assets/fixture-map/content",
      );
      await expect(preview.locator("image")).toHaveAttribute(
        "preserveAspectRatio",
        "none",
      );
      expect(mutations).toEqual([]);
      if (dismiss === "cancel") {
        await preview.scrollIntoViewIfNeeded();
        await expect(preview).toBeVisible();
        expect(
          await editor.evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
        const box = (await preview.boundingBox())!;
        expect(box.width).toBeGreaterThan(200);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        await editor
          .locator(".scene-grid-preview")
          .screenshot({ path: testInfo.outputPath("scene-draft-preview.png") });
        const pendingMap = {
          name: "replacement.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5XkAAAAASUVORK5CYII=",
            "base64",
          ),
        };
        const fileInput = editor.getByLabel("Загрузить новую карту");
        await fileInput.setInputFiles(pendingMap);
        await expect(preview).toHaveCount(0);
        await expect(
          editor.getByText(
            "Предпросмотр недоступен: Новая карта ещё не сохранена. Сохраните сцену или удалите выбранный файл, чтобы увидеть карту и сетку.",
          ),
        ).toBeVisible();
        expect(mutations).toEqual([]);
        await editor
          .getByRole("button", { name: "Удалить replacement.png" })
          .click();
        await expect(preview.locator("image")).toHaveAttribute(
          "href",
          "/api/assets/fixture-map/content",
        );
        await expect(preview.locator("pattern")).toHaveAttribute("width", "80");
        await expect(preview.locator("pattern")).toHaveAttribute("x", "-10.5");
        await fileInput.setInputFiles(pendingMap);
        await expect(preview).toHaveCount(0);
        await editor
          .getByRole("button", { name: "Отмена", exact: true })
          .click();
      } else if (dismiss === "escape") await cell.press("Escape");
      else
        await editor
          .getByRole("button", { name: "Закрыть диалоговое окно" })
          .click();
      await expect(editor).toBeHidden();
      expect(saves).toEqual([]);
      await manager.getByRole("button", { name: "Настроить" }).click();
      await expect(cell).toHaveValue("64");
      await expect(preview.locator("pattern")).toHaveAttribute("width", "64");
      await expect(preview.locator("pattern")).toHaveAttribute("x", "0");
      await expect(preview.locator("image")).toHaveAttribute(
        "href",
        "/api/assets/fixture-map/content",
      );
      await expect(
        editor.getByText(/Новая карта ещё не сохранена/),
      ).toHaveCount(0);
      await expect(
        editor.getByRole("button", { name: "Удалить replacement.png" }),
      ).toHaveCount(0);
      await expect(preview.locator("path")).toHaveAttribute(
        "stroke",
        "#c8b78b",
      );
      await expect(
        preview.locator(".scene-grid-preview__grid"),
      ).toHaveAttribute("opacity", "0.22");
    }
    await cell.fill("");
    await expect(preview).toHaveCount(0);
    await expect(
      editor.getByText("Предпросмотр недоступен: Размер клетки (px)"),
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Сохранить", exact: true }),
    ).toBeDisabled();
    await cell.fill("96");
    const opacity = editor.getByRole("spinbutton", {
      name: "Непрозрачность (0–1)",
    });
    await opacity.fill("0");
    await expect(preview.locator(".scene-grid-preview__grid")).toHaveAttribute(
      "opacity",
      "0",
    );
    await expect(
      editor.getByText("Линии невидимы; привязка включена."),
    ).toBeVisible();
    const enabled = editor.getByRole("checkbox", {
      name: "Сетка: привязка и измерение",
    });
    await enabled.uncheck();
    await expect(preview.locator(".scene-grid-preview__grid")).toHaveCount(0);
    await enabled.check();
    await expect(preview.locator(".scene-grid-preview__grid")).toHaveAttribute(
      "opacity",
      "0",
    );
    expect(mutations).toEqual([]);
    const save = editor.getByRole("button", { name: "Сохранить", exact: true });
    await save.click();
    await expect.poll(() => saves.length).toBe(1);
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("alert")).toHaveText(
      "Проверка: сохранение недоступно",
    );
    await expect(
      page
        .locator(".g-toast")
        .filter({ hasText: "Проверка: сохранение недоступно" }),
    ).toHaveCount(0);
    await expect(preview.locator("pattern")).toHaveAttribute("width", "96");
    await expect(preview.locator(".scene-grid-preview__grid")).toHaveAttribute(
      "opacity",
      "0",
    );
    await save.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        save.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          return hit !== null && button.contains(hit);
        }),
      )
      .toBe(true);
    await save.click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1]).toMatchObject({
      grid: { enabled: true, size: 96, opacity: 0 },
    });
    await expect(editor).toBeHidden();
  });
}
