import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";

/**
 * UIX-560 — лента событий не схлопывается на невысоком экране.
 *
 * Найдено замером при разборе UIX-493. `.activity-feed` — flex-колонка, и
 * лента в ней объявлена `flex: 1 1 0`, то есть «возьму остаток». Пока она
 * готова отдать всю высоту, переполнения не возникает и соседям незачем
 * ужиматься: свои высоты сначала забирают блок бросков, ресурсы, полоса
 * журнала и поле ввода. На 1280×720 остаток оказался равен 24 px — одна
 * строка при 1865 px содержимого.
 *
 * Тест браузерный по необходимости: высоту здесь считает движок вёрстки, в
 * jsdom её нет вовсе.
 *
 * Соседний `activity-feed-layout.spec.ts` этого не ловит и не должен: он про
 * перекрытие карточек и доступность поля ввода, а схлопнувшаяся до 24 px лента
 * обе проверки проходит — она ничего не перекрывает и никому не мешает.
 */
const FEED = ".activity-feed";
const LIST = "#activity-message-list";

/**
 * Пол из `styles.css`. Продублирован намеренно: тест обязан падать, когда
 * минимум убирают, а вычитанный из той же строки он падать перестал бы.
 */
const MIN_LIST_HEIGHT = 160;

/** Высоты окна, на которых играют. 720 — ноутбук, ради которого всё и затеяно. */
const VIEWPORT_HEIGHTS = [720, 900, 1080] as const;

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

const heights = (page: Page) =>
  page.evaluate(
    ({ feed, list }) => {
      const column = document.querySelector(feed);
      const messages = document.querySelector(list);
      if (!(column instanceof HTMLElement))
        throw new Error("Панель событий не найдена");
      if (!(messages instanceof HTMLElement))
        throw new Error("Лента не найдена");
      const columnBox = column.getBoundingClientRect();
      const listBox = messages.getBoundingClientRect();
      return {
        list: listBox.height,
        // Насколько нижний край последнего ребёнка вылезает за низ колонки.
        overflowBelow: Math.max(
          0,
          Math.max(
            ...[...column.children].map(
              (child) => child.getBoundingClientRect().bottom,
            ),
          ) - columnBox.bottom,
        ),
      };
    },
    { feed: FEED, list: LIST },
  );

test("лента сохраняет читаемую высоту на всех рабочих экранах", async ({
  page,
  gmToken,
}) => {
  await page.setViewportSize({ width: 1280, height: 1080 });
  await signInAsGm(page, gmToken);
  await expect(page.locator(LIST)).toBeVisible();

  for (const height of VIEWPORT_HEIGHTS) {
    await page.setViewportSize({ width: 1280, height });
    // Ждём, пока движок пересчитает колонку под новую высоту окна.
    await expect
      .poll(async () => (await heights(page)).list)
      .toBeGreaterThanOrEqual(MIN_LIST_HEIGHT);

    // Второе условие обязательно: минимум, выданный за счёт выезда поля ввода
    // за нижний край, — это не починка, а размен одного дефекта на худший.
    expect(
      (await heights(page)).overflowBelow,
      `на высоте окна ${height} панель вылезает за низ колонки`,
    ).toBeLessThanOrEqual(1);
  }
});
