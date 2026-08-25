import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";

/**
 * UIX-469 — растягивание панели быстрых бросков обязано показывать больше кнопок.
 *
 * До этого у `.activity-quick-rolls` были собственные `max-height: 110px` и
 * `overflow: auto` — вторая прокрутка внутри уже прокручиваемого тела панели.
 * Ручка растила коробку вокруг запертого списка: панель становилась выше, а
 * кнопок было видно ровно столько же.
 *
 * Прежний тест проверял устройство — «тело прокручивается, ручка вне него», —
 * и потому ошибку пропустил: устройство было ровно такое, как заявлено, а
 * пользы от растягивания не было. Здесь проверяется наблюдаемое свойство:
 * выше панель — больше видимых кнопок. И тест обязан быть e2e: высоты считает
 * движок вёрстки, в jsdom их нет.
 */

/**
 * Сколько кнопок человек действительно видит.
 *
 * Видимость проверяется попаданием точки, а не сравнением рамок с телом панели:
 * при вложенной прокрутке кнопка обрезана внутренним списком, но её координаты
 * по-прежнему лежат внутри тела. Сравнение рамок этого не замечает — на нём
 * первая версия теста прошла даже с возвращённой ошибкой.
 */
async function visibleButtons(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".quick-roll-panel");
    const body = panel?.querySelector(".quick-roll-panel__body");
    if (!panel || !body)
      throw new Error("Панель быстрых бросков не отрисована");
    const buttons = [...body.querySelectorAll("button")];
    const fits = buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return hit === button || button.contains(hit);
    }).length;
    // Прокрутка ищется по всей панели: она может завестись и у вложенного
    // списка, а не только у тела — именно так и выглядела ошибка.
    const scrolls = [body, ...body.querySelectorAll("*")].some(
      (element) => element.scrollHeight > element.clientHeight + 1,
    );
    return { fits, total: buttons.length, scrolls };
  });
}

/**
 * Высота, при которой кнопки заведомо помещаются целиком.
 *
 * Раньше здесь стояло 420 пикселей — число, подобранное на одной машине. Оно
 * оказалось граничным: в CI при той же высоте помещалось 12 кнопок из 13, и
 * тест падал в обоих браузерах, хотя проверяемое свойство не нарушено. Высота
 * строки зависит от шрифтов машины, а число кнопок — от навыков персонажа;
 * ни то, ни другое тест не выбирает.
 *
 * Поэтому высота измеряется: панели даётся заведомо избыточный размер, у
 * последней кнопки берётся нижняя граница, к ней добавляются отступ тела и
 * та часть панели, которая телом не является. Проверяемое намерение — «высоты
 * с запасом хватает на все кнопки» — сохраняется, а зависимость от конкретной
 * машины уходит.
 */
async function heightThatFitsAllButtons(page: Page): Promise<number> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".quick-roll-panel");
    const body = panel?.querySelector<HTMLElement>(".quick-roll-panel__body");
    if (!panel || !body)
      throw new Error("Панель быстрых бросков не отрисована");

    const previous = panel.style.height;
    panel.style.height = `${window.innerHeight * 3}px`;

    const buttons = [...body.querySelectorAll("button")];
    const last = buttons.at(-1);
    if (!last) throw new Error("В панели нет кнопок быстрых бросков");

    const bodyBox = body.getBoundingClientRect();
    const paddingBottom =
      Number.parseFloat(getComputedStyle(body).paddingBottom) || 0;
    const content = last.getBoundingClientRect().bottom - bodyBox.top;
    // Всё, что панель занимает помимо тела: заголовок, ручка, рамки.
    const chrome = panel.getBoundingClientRect().height - bodyBox.height;

    panel.style.height = previous;
    /* Восемь пикселей сверху — не подобранное число, а защита от округления:
       дробные высоты строк дают остаток в доли пикселя, и панель ровно по
       содержимому иногда заводит прокрутку на пустом месте. Исход проверки
       этот запас не решает — его решает измерение выше. */
    return Math.ceil(content + paddingBottom + chrome) + 8;
  });
}

async function setPanelHeight(page: Page, height: number) {
  await page.evaluate((next) => {
    const panel = document.querySelector<HTMLElement>(".quick-roll-panel");
    if (!panel) throw new Error("Панель быстрых бросков не отрисована");
    panel.style.height = `${next}px`;
  }, height);
}

test("выше панель — больше видимых кнопок быстрых бросков", async ({
  page,
  gmToken,
}) => {
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".quick-roll-panel")).toBeVisible();

  await setPanelHeight(page, 120);
  const short = await visibleButtons(page);
  await setPanelHeight(page, 260);
  const medium = await visibleButtons(page);
  const roomy = await heightThatFitsAllButtons(page);
  await setPanelHeight(page, roomy);
  const tall = await visibleButtons(page);

  const seen = `120px → ${short.fits}, 260px → ${medium.fits}, ${roomy}px → ${tall.fits} из ${tall.total}`;

  // Сама суть задачи: растягивание должно окупаться кнопками, а не пустой
  // коробкой вокруг того же скролла.
  expect(short.fits, seen).toBeLessThan(short.total);
  expect(medium.fits, seen).toBeGreaterThan(short.fits);
  // Главная проверка. Роста самого по себе мало: с запертым внутренним списком
  // кнопки тоже прибавлялись — пока тело было меньше его потолка, — а потом
  // упирались. Высоты с запасом обязано хватить на все кнопки без остатка.
  expect(tall.fits, seen).toBe(tall.total);
});

test("прокрутка появляется только когда кнопки не помещаются", async ({
  page,
  gmToken,
}) => {
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".quick-roll-panel")).toBeVisible();

  await setPanelHeight(page, 120);
  const short = await visibleButtons(page);
  expect(short.fits).toBeLessThan(short.total);
  expect(short.scrolls, "кнопки не помещаются — прокрутка нужна").toBe(true);

  // Высоты хватает на все кнопки: полоса прокрутки при этом лишняя.
  await setPanelHeight(page, await heightThatFitsAllButtons(page));
  const tall = await visibleButtons(page);
  expect(tall.fits).toBe(tall.total);
  expect(tall.scrolls, "всё помещается — прокрутки быть не должно").toBe(false);
});
