import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import type { Page } from "@playwright/test";
import type { SceneDto } from "@arken/contracts";

async function install(page: Page, role: "GM" | "PLAYER" = "GM") {
  const scene: SceneDto = {
    id: "scene-1",
    name: "Проверка полей",
    projection: "ORTHOGRAPHIC_2D",
    mapAssetId: null,
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
  await page.route("**/api/scenes/scene-1/canvas", (route) => {
    const body = route.request().postDataJSON();
    saves.push(body);
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
