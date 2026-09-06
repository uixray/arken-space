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
    return route.fulfill({ json: path === "/api/bootstrap" ? current : [] });
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
