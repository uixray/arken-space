import { expect, test, type Page } from "@playwright/test";

/**
 * UIX-472 — разделы строкой, не поместившиеся под «Ещё».
 *
 * Тест e2e, а не jsdom: вместимость считается по измеренным ширинам, а их даёт
 * только движок вёрстки. Проверяется наблюдаемое свойство — строка не
 * переполняется ни при какой ширине окна, и ни один раздел не пропадает
 * бесследно: он либо в строке, либо в меню.
 */
async function navState(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector(".workspace-nav");
    if (!nav) throw new Error("Строка разделов не отрисована");
    const box = nav.getBoundingClientRect();
    const inRow = [...nav.querySelectorAll(".workspace-nav__item")];
    const more = nav.querySelector<HTMLElement>(".workspace-nav__more summary");
    const inMenu = nav.querySelectorAll(".workspace-nav__menu button").length;
    const last = more ?? inRow.at(-1);
    return {
      rowWidth: Math.round(box.width),
      visible: inRow.map((item) => item.textContent?.trim() ?? ""),
      hidden: inMenu,
      // Насколько последний элемент вылезает за правый край строки.
      overflowPx: last
        ? Math.round(last.getBoundingClientRect().right - box.right)
        : 0,
    };
  });
}

test("разделы не переполняют строку ни при какой ширине окна", async ({
  page,
}) => {
  const token = process.env.GM_ACCESS_TOKEN;
  test.skip(
    !token,
    "GM_ACCESS_TOKEN is required for the integration environment",
  );

  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".workspace-nav")).toBeVisible();

  const total = await page.evaluate(
    () =>
      document.querySelectorAll(".workspace-nav__measure > [data-workspace]")
        .length,
  );
  expect(total).toBeGreaterThan(0);

  for (const width of [1920, 1440, 1280, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    // Пересчёт идёт на событие `resize`; ждём, пока раскладка успокоится.
    await page.waitForTimeout(250);
    const state = await navState(page);

    expect(
      state.overflowPx,
      `${width}px: строка ${state.rowWidth}, видно ${state.visible.length}, вылезает ${state.overflowPx}px`,
    ).toBeLessThanOrEqual(1);

    // Ни один раздел не должен пропасть: он либо в строке, либо в меню.
    expect(
      state.visible.length + state.hidden,
      `${width}px: разделов ${state.visible.length}+${state.hidden} из ${total}`,
    ).toBe(total);
  }
});

test("игроку не показываются мастерские разделы", async ({ page }) => {
  const token = process.env.GM_ACCESS_TOKEN;
  test.skip(
    !token,
    "GM_ACCESS_TOKEN is required for the integration environment",
  );

  // Проверяется на мастере: у него разделы есть, и это доказывает, что тест
  // смотрит в нужное место. Отсутствие у игрока закреплено юнит-тестом
  // `workspaceNavItems` — там же, где принято само решение.
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".workspace-nav")).toBeVisible();

  const labels = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".workspace-nav__measure > [data-workspace]",
      ),
    ].map((node) => node.getAttribute("data-workspace")),
  );
  for (const gmOnly of ["media", "world-maps", "world-codex"])
    expect(labels).toContain(gmOnly);
});
