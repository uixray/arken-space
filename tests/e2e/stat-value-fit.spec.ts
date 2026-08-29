import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";

/**
 * UIX-489 — значение характеристики видно целиком, включая знак.
 *
 * По отчёту обрезались отрицательные значения. Замер показал, что дело шире:
 * при доступных 23 px и нужных 38 не помещалось и «20» — обрезалось всё, что
 * длиннее одной цифры, просто у минуса это заметнее.
 *
 * Заодно замер объяснил, почему карточка выглядела не так, как описана в
 * `styles.css`: правило `.stat-field input` (0,1,1) проигрывало собственному
 * правилу uikit `.g-text-input_size_m .g-text-input__control` (0,2,0), и из
 * блока доезжало только выравнивание. Поэтому проверяется не только «влезло»,
 * но и что задуманное начертание действительно применилось: без этого поле
 * снова «починится» уменьшением шрифта, а это не починка.
 *
 * Тест браузерный по необходимости: обрезание — это `scrollWidth` против
 * `clientWidth`, то есть измеренная раскладка, которой в jsdom нет.
 */
const FIELD = ".stat-field";

/** Крайние значения диапазона характеристики (`STAT_VALUE_RANGE`) и ноль. */
const VALUES = ["-20", "-2", "-1", "0", "20"] as const;

/**
 * Ширина карточки задаётся шириной окна, а не ролью: и мастер, и игрок видят
 * ту же сетку `.stats-grid` в две колонки. Поэтому проверяются рабочие ширины
 * окна, а не два входа.
 */
const VIEWPORT_WIDTHS = [1920, 1280, 900] as const;

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

/** Самое сильное обрезание среди полей и подписей карточки, в пикселях. */
const worstOverflow = (page: Page) =>
  page.evaluate((field) => {
    let value = 0;
    let label = 0;
    for (const row of document.querySelectorAll(field)) {
      const input = row.querySelector("input");
      const caption = row.firstElementChild;
      if (input) value = Math.max(value, input.scrollWidth - input.clientWidth);
      if (caption)
        label = Math.max(label, caption.scrollWidth - caption.clientWidth);
    }
    return { value, label };
  }, FIELD);

test("значение характеристики видно целиком на всех рабочих ширинах", async ({
  page,
  gmToken,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signInAsGm(page, gmToken);
  await page.getByRole("button", { name: "Персонажи" }).click();
  await expect(page.locator(`${FIELD} input`).first()).toBeVisible();

  // Начертание из `styles.css` обязано действительно применяться: 13px/400 от
  // uikit «влезают» в любое поле, и проверка на обрезание стала бы зелёной по
  // причине, ради которой её никто не заводил.
  const applied = await page.evaluate((field) => {
    const input = document.querySelector(`${field} input`);
    if (!input) throw new Error("Поле характеристики не найдено");
    const style = getComputedStyle(input);
    return {
      fontWeight: style.fontWeight,
      borderLeftWidth: style.borderLeftWidth,
    };
  }, FIELD);
  expect(applied.fontWeight).toBe("700");
  expect(applied.borderLeftWidth).toBe("1px");

  for (const width of VIEWPORT_WIDTHS) {
    await page.setViewportSize({ width, height: 1080 });
    for (const value of VALUES) {
      await page.locator(`${FIELD} input`).first().fill(value);
      const overflow = await worstOverflow(page);
      expect(
        overflow.value,
        `значение ${value} обрезано на ширине окна ${width}`,
      ).toBe(0);
      expect(
        overflow.label,
        `подпись характеристики обрезана на ширине окна ${width}`,
      ).toBe(0);
    }
  }
});
