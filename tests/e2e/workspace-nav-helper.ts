import { expect, type Page } from "@playwright/test";

/**
 * UIX-472: открыть раздел рабочего пространства по названию.
 *
 * Разделы переехали из выпадающего списка в строку, которая при нехватке места
 * прячет часть кнопок под «Ещё». Где именно окажется нужная — зависит от ширины
 * окна и роли, то есть меняется от теста к тесту и от правки к правке. Поэтому
 * ищем сначала в строке, а в меню лезем только если там её нет: тест, жёстко
 * знающий одно из двух мест, ломается от чужой правки подписей.
 */
export async function openWorkspaceSection(
  page: Page,
  name: string,
): Promise<void> {
  const nav = page.locator(".workspace-nav");
  await expect(nav).toBeVisible();

  const inRow = nav
    .locator(".workspace-nav__item")
    .filter({ hasText: name })
    .first();
  if ((await inRow.count()) > 0) {
    await inRow.click();
    return;
  }

  await nav.locator(".workspace-nav__more summary").click();
  await nav
    .locator(".workspace-nav__menu button")
    .filter({ hasText: name })
    .first()
    .click();
}

/**
 * Просматриваемая сцена: выбор переехал с `<select>` на список с картинками.
 *
 * Проверять «какая сцена показана» теперь нечем, кроме подписи в свёрнутом
 * списке: значение больше нигде не хранится. Поэтому и выбор, и проверка идут
 * по названию — оно единственное, что видит и человек.
 */
export function viewedScenePicker(page: Page) {
  return page.getByLabel("Выбрать просматриваемую сцену");
}

export async function selectViewedScene(
  page: Page,
  sceneName: string,
): Promise<void> {
  await viewedScenePicker(page).click();
  await page.getByRole("option", { name: sceneName }).click();
}
