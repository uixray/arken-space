import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";

/**
 * UIX-493 — лента открывается на последних записях, а не выше них.
 *
 * Отчёт пришёл дважды: «бегунок стены бросков всегда в самом начале, приходится
 * перематывать до актуальных». Разбор на живом стенде показал механизм:
 * закрепление у дна происходит один раз, через кадр `requestAnimationFrame`, и
 * содержимое, выросшее уже после него — разложившиеся аватары, стикеры,
 * вложения, — оставляет ленту ровно на свою высоту выше дна. Замер: рост на
 * 512 px давал расстояние до дна 512 px, и вернуть ленту могло только следующее
 * сообщение, которого при входе в игру никто не ждёт.
 *
 * Тест живёт в браузере, а не в jsdom, намеренно: проверяется `ResizeObserver`
 * и раскладка. В jsdom нет ни того, ни другого — там пришлось бы подменить
 * наблюдателя своим, то есть проверить подмену.
 *
 * Рост содержимого создаётся вставкой картинки в ленту, а не настоящим
 * стикером: важен сам факт «карточка стала выше уже после закрепления» —
 * ровно то, что делает браузер, доложив картинку. Настоящий стикер добавил бы
 * к проверке загрузку каталога и права на поток, то есть чужие причины падения.
 */
const LIST = "#activity-message-list";

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

/** Расстояние от текущей позиции до самого низа списка, в пикселях. */
const distanceToBottom = (page: Page) =>
  page.evaluate((selector) => {
    const list = document.querySelector(selector);
    if (!(list instanceof HTMLElement)) throw new Error("Лента не найдена");
    return list.scrollHeight - list.scrollTop - list.clientHeight;
  }, LIST);

/** Наполняет журнал так, чтобы лента заведомо переполнилась по высоте. */
async function seedLog(page: Page, count: number) {
  await page.evaluate(async (total) => {
    for (let index = 0; index < total; index += 1) {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          body: `Запись журнала ${index} — достаточно длинная, чтобы занять высоту и переполнить ленту событий.`,
          stream: "TABLE",
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    }
  }, count);
}

/**
 * Имитирует содержимое, доехавшее позже закрепления. `flex-shrink: 0`
 * обязателен: лента — flex-колонка, и без него вставленная карточка ужимается
 * до нескольких пикселей, то есть перестаёт быть тем, что проверяется.
 */
async function growContent(page: Page, height: number) {
  await page.evaluate(
    ({ selector, px }) => {
      const list = document.querySelector(selector);
      if (!(list instanceof HTMLElement)) throw new Error("Лента не найдена");
      const late = document.createElement("div");
      late.dataset.testLateContent = "true";
      late.style.flexShrink = "0";
      late.style.height = `${px}px`;
      list.append(late);
    },
    { selector: LIST, px: height },
  );
}

const AT_BOTTOM_TOLERANCE = 4;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
});

test("лента при входе стоит у последних записей", async ({ page, gmToken }) => {
  await signInAsGm(page, gmToken);
  await expect(page.locator("canvas").first()).toBeVisible();
  await seedLog(page, 40);

  await page.reload();
  await page.locator(LIST).waitFor();

  await expect
    .poll(() => distanceToBottom(page))
    .toBeLessThanOrEqual(AT_BOTTOM_TOLERANCE);
});

test("содержимое, доехавшее после закрепления, возвращает ленту к низу", async ({
  page,
  gmToken,
}) => {
  await signInAsGm(page, gmToken);
  await expect(page.locator("canvas").first()).toBeVisible();
  await seedLog(page, 40);
  await page.reload();
  await page.locator(LIST).waitFor();
  await expect
    .poll(() => distanceToBottom(page))
    .toBeLessThanOrEqual(AT_BOTTOM_TOLERANCE);

  await growContent(page, 500);

  // Это и есть дефект из отчёта: без наблюдателя за размером лента осталась бы
  // на 500 px выше последних записей и сама бы туда не вернулась.
  await expect
    .poll(() => distanceToBottom(page))
    .toBeLessThanOrEqual(AT_BOTTOM_TOLERANCE);
});

test("ушедшего вверх читателя подгрузка не утаскивает вниз", async ({
  page,
  gmToken,
}) => {
  await signInAsGm(page, gmToken);
  await expect(page.locator("canvas").first()).toBeVisible();
  await seedLog(page, 40);
  await page.reload();
  await page.locator(LIST).waitFor();
  await expect
    .poll(() => distanceToBottom(page))
    .toBeLessThanOrEqual(AT_BOTTOM_TOLERANCE);

  // Уводим читателя вверх — дальше порога в 48 px, иначе лента справедливо
  // считает его стоящим у дна.
  await page.evaluate((selector) => {
    const list = document.querySelector(selector);
    if (!(list instanceof HTMLElement)) throw new Error("Лента не найдена");
    list.scrollTo({ top: 0 });
  }, LIST);
  await expect.poll(() => distanceToBottom(page)).toBeGreaterThan(400);

  await growContent(page, 500);
  await page.waitForTimeout(300);

  // Возврат к дну здесь был бы дефектом ровно противоположного знака:
  // человек читает старое, а лента выдёргивает его подгрузившейся картинкой.
  expect(await distanceToBottom(page)).toBeGreaterThan(400);
});

/**
 * UIX-401 — слежение возвращается, когда читатель сам вернулся к дну.
 *
 * Отчёт с игры 09.08: «стоит один раз проскроллить ленту, автопрокрутка
 * отключается навсегда». Починка приехала попутно в UIX-450 (`e62a1a4`) вместе
 * с тестом в jsdom, но в задаче это не отметили, и она осталась в бэклоге.
 * Здесь то же поведение проверяется на живом стенде: в jsdom нет раскладки, а
 * условие приёмки — про допуск у нижнего края, который без раскладки не
 * существует.
 */
test("слежение возвращается, когда читатель сам вернулся к низу", async ({
  page,
  gmToken,
}) => {
  await signInAsGm(page, gmToken);
  await expect(page.locator("canvas").first()).toBeVisible();
  await seedLog(page, 40);
  await page.reload();
  await page.locator(LIST).waitFor();
  await expect
    .poll(() => distanceToBottom(page))
    .toBeLessThanOrEqual(AT_BOTTOM_TOLERANCE);

  await page.locator(LIST).evaluate((list) => list.scrollTo({ top: 0 }));
  const awayFromBottom = await distanceToBottom(page);
  expect(awayFromBottom).toBeGreaterThan(400);

  // Новая запись не должна дёргать ленту под рукой у читающего.
  await seedLog(page, 1);
  await page.waitForTimeout(600);
  expect(await distanceToBottom(page)).toBeGreaterThan(400);

  // Читатель вернулся к дну сам — слежение обязано возобновиться.
  await page
    .locator(LIST)
    .evaluate((list) => list.scrollTo({ top: list.scrollHeight }));
  await seedLog(page, 1);
  await expect
    .poll(() => distanceToBottom(page))
    .toBeLessThanOrEqual(AT_BOTTOM_TOLERANCE);
});
