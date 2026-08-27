import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { SIDEBAR_WIDTH_MIN } from "../../apps/web/src/sidebar-width-preference";

/**
 * UIX-419 — композер на самой узкой панели.
 *
 * Дефект был раскладочный: подсказка «Enter — всем · Ctrl+Enter — только
 * мастеру» стояла видимой строкой рядом с полем, и на узкой панели два текста
 * налезали друг на друга. Границу панели тянет пользователь, ширина переживает
 * сессию (`sidebar-width-preference.ts`), поэтому попасть в это состояние и
 * остаться в нём было легко.
 *
 * Подсказку убрали из потока: она осталась в разметке для программ чтения с
 * экрана и во всплывающей подсказке кнопки отправки. Тест закрепляет не это
 * решение, а требование задачи — «при любой допустимой ширине тексты не
 * перекрываются», — и потому переживёт смену способа: вернуть подсказку строкой
 * ниже можно, вернуть её поверх поля нельзя.
 *
 * Тест обязан быть браузерным: перекрытие считает движок вёрстки, в jsdom
 * геометрии нет и проверять там нечего. Ширина берётся минимально допустимая —
 * это худший случай, и он же тот, в котором дефект видели.
 */

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

/**
 * Замеры композера при заданной ширине панели.
 *
 * Считается не «красиво ли», а два наблюдаемых свойства: дети формы не лезут
 * друг на друга, и колонка значков не стоит поверх места, где человек пишет.
 * Второе — та же ошибка, что и первая, только с другой стороны: отступ под
 * значки задан числом (`padding-right`), и четвёртый значок сделал бы поле
 * снова перекрытым, ничего не сломав в потоке.
 */
async function measureComposer(page: Page) {
  return page.evaluate(() => {
    const form = document.querySelector(".activity-feed .chat-compose");
    if (!form) throw new Error("Композер не отрисован");
    const inFlow = [...form.children].filter((child) => {
      const position = getComputedStyle(child).position;
      return position !== "absolute" && position !== "fixed";
    });
    let worst = { pair: "", px: 0 };
    for (let i = 0; i < inFlow.length; i += 1)
      for (let j = i + 1; j < inFlow.length; j += 1) {
        const a = inFlow[i]!.getBoundingClientRect();
        const b = inFlow[j]!.getBoundingClientRect();
        const overlap =
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0 &&
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0
            ? Math.min(
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
                Math.min(a.right, b.right) - Math.max(a.left, b.left),
              )
            : 0;
        if (overlap > worst.px)
          worst = {
            pair: `${inFlow[i]!.className.split(" ")[0]} / ${inFlow[j]!.className.split(" ")[0]}`,
            px: overlap,
          };
      }

    const textarea = form.querySelector("textarea");
    const actions = form.querySelector(".chat-composer-actions");
    if (!textarea || !actions)
      throw new Error("Поле ввода или значки не найдены");
    const style = getComputedStyle(textarea);
    const box = textarea.getBoundingClientRect();
    // Правый край места, где помещается текст: рамка и отступ под значки не в счёт.
    const writableRight =
      box.right -
      Number.parseFloat(style.borderRightWidth) -
      Number.parseFloat(style.paddingRight);
    const writableLeft =
      box.left +
      Number.parseFloat(style.borderLeftWidth) +
      Number.parseFloat(style.paddingLeft);
    return {
      worst,
      writableWidth: writableRight - writableLeft,
      iconsOverlapText: writableRight - actions.getBoundingClientRect().left,
    };
  });
}

test("композер не накладывается сам на себя на самой узкой панели", async ({
  page,
  gmToken,
}) => {
  await signInAsGm(page, gmToken);
  await expect(page.locator(".activity-feed .chat-compose")).toBeVisible();

  await page.evaluate((width) => {
    const sidebar = document.querySelector<HTMLElement>("aside.sidebar");
    if (!sidebar) throw new Error("Боковая панель не найдена");
    sidebar.style.width = `${width}px`;
  }, SIDEBAR_WIDTH_MIN);

  const measured = await measureComposer(page);

  expect(
    measured.worst.px,
    `«${measured.worst.pair}» перекрываются на ${Math.round(measured.worst.px)}px`,
  ).toBeLessThanOrEqual(0);
  expect(
    measured.iconsOverlapText,
    `значки заходят на текст на ${Math.round(measured.iconsOverlapText)}px`,
  ).toBeLessThanOrEqual(0);
  // Освободить место можно и отступом во всю ширину — писать станет негде.
  // Ширина взята от печатной строки, а не от числа пикселей на глаз: в неё
  // должно помещаться хотя бы несколько слов.
  expect(
    measured.writableWidth,
    `под текст осталось ${Math.round(measured.writableWidth)}px`,
  ).toBeGreaterThan(100);
});

test("способ отправить только мастеру виден и на узкой панели", async ({
  page,
  gmToken,
}) => {
  /**
   * Отдельным тестом, потому что это отдельное требование задачи: подсказка про
   * Ctrl+Enter — единственное место, где про приватную отправку узнают. Убрать
   * её ради ширины значило бы потерять функцию, а не украшение, и проверка
   * перекрытий такую потерю бы не заметила — она стала бы только чище.
   */
  await signInAsGm(page, gmToken);
  await page.evaluate((width) => {
    const sidebar = document.querySelector<HTMLElement>("aside.sidebar");
    if (!sidebar) throw new Error("Боковая панель не найдена");
    sidebar.style.width = `${width}px`;
  }, SIDEBAR_WIDTH_MIN);

  const send = page.locator(".activity-feed .composer-send-action");
  await expect(send).toBeVisible();
  await expect(send).toHaveAttribute("title", /Ctrl\+Enter/);
  // И то же самое — программе чтения с экрана, которой всплывающая подсказка
  // недоступна: текст живёт в описании поля ввода.
  await expect(
    page.locator(".activity-feed #activity-composer-hint"),
  ).toHaveText(/Ctrl\+Enter/);
});
