import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { assertModalFocusCycle } from "./modal-focus";

/**
 * UIX-532 — клавиатура не уходит из открытого модального диалога.
 *
 * В постановке задачи я записал «ловушки фокуса в диалогах нет». Это оказалось
 * неверно: `ArkenDialog` действительно только ставит и возвращает фокус, но под
 * ним лежит `Modal` из uikit, а тот держит фокус через `FloatingFocusManager`.
 * Замер это подтвердил — за двадцать нажатий Tab фокус ни разу не достался
 * интерфейсу под диалогом.
 *
 * Раз свойство есть, но принадлежит чужой библиотеке, его стоит закрепить: при
 * обновлении uikit или замене диалога на свой оно исчезнет молча, а узнают об
 * этом клавиатурой в бою.
 *
 * Сторожевые элементы floating-ui из проверки исключены намеренно: `<span
 * data-floating-ui-focus-guard>` — это и есть механизм ловушки, фокус на них
 * задерживается на один кадр и возвращается внутрь. Считать их утечкой значило
 * бы требовать, чтобы ловушка работала без своего механизма.
 */
async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

const TAB_PRESSES = 20;

test("модальный диалог держит Tab внутри себя", async ({ page, gmToken }) => {
  await signInAsGm(page, gmToken);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByLabel("Меню сеанса", { exact: true }).click();

  await page
    .getByRole("button", { name: "Переименовать кампанию", exact: true })
    .click();
  // Keep all 20 keypresses, but record actual focusin escapes rather than
  // sampling body during FloatingFocusManager's next-frame guard handoff.
  // The shared helper accepts only this modal's inside guards and still
  // fails any real background focus hop even when focus later recovers.
  await assertModalFocusCycle(
    page,
    page.getByRole("dialog", { name: "Название кампании", exact: true }),
    "Tab",
    TAB_PRESSES,
  );
});

test("закрытый диалог возвращает фокус тому, кто его открыл", async ({
  page,
  gmToken,
}) => {
  /**
   * Вторая половина того же требования, и без неё первая половина достижима
   * запертым фокусом, из которого некуда вернуться: человек закрывает диалог и
   * оказывается в начале страницы, потеряв место, где работал.
   */
  await signInAsGm(page, gmToken);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByLabel("Меню сеанса", { exact: true }).click();

  const opener = page.getByRole("button", {
    name: "Переименовать кампанию",
    exact: true,
  });
  await opener.click();
  await expect(page.locator('[role="dialog"]').first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(page.getByLabel("Меню сеанса", { exact: true })).toBeFocused();
});

test("первым табом со страницы игры доступен переход к карте", async ({
  page,
  gmToken,
}) => {
  /**
   * UIX-532. Без ссылки путь с клавиатуры к карте проходит через всю верхнюю
   * панель: на каждой сессии, каждый раз.
   *
   * Проверяется наблюдаемое: первое нажатие Tab даёт ссылку, она в этот момент
   * видна (иначе человек не поймёт, куда попал), а переход по ней ставит фокус
   * на карту. Ссылка, спрятанная так, что фокус её не получает, — та же
   * ловушка, только тише.
   */
  await signInAsGm(page, gmToken);
  await expect(page.locator("canvas").first()).toBeVisible();

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Перейти к карте" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});
