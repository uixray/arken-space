import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";

/**
 * UIX-403 — выключенный курсор мастера не рассылается.
 *
 * Требование задачи именно такое и записано: «выключенный курсор не должен
 * рассылаться». Позиция, которая уходит по сокету и лишь не рисуется, — это не
 * приватность: любой, кто откроет devtools, увидит, куда смотрит мастер. То
 * есть проверять надо отправку, а не отрисовку.
 *
 * Поэтому здесь считаются кадры настоящего веб-сокета, а не вызовы замоканного
 * `emit`. Мок доказывал бы, что клиент вызвал то, что мы сами ему подставили;
 * кадр доказывает, что байты с координатами либо ушли с машины, либо нет.
 *
 * Обратная проверка — «при включённом курсоре кадры идут» — обязательна: без
 * неё тест проходил бы и на наглухо сломанном сокете, то есть закреплял бы
 * тишину вместо приватности.
 */

const CURSOR_MOVE = '"cursor:move"';

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

/**
 * Провести мышью по карте так, как это делает человек: несколько шагов
 * настоящими событиями указателя. Клиент батчит отправку по кадрам анимации,
 * поэтому одного движения мало — важно дать ему повод отправить хоть что-то.
 */
async function sweepPointerOverMap(page: Page) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Карта не отрисована");
  for (let step = 0; step < 6; step += 1)
    await page.mouse.move(
      box.x + box.width / 4 + step * 12,
      box.y + box.height / 4 + step * 9,
    );
  // Кадр анимации плюс серверный порог в 40мс между движениями.
  await page.waitForTimeout(300);
}

test("курсор мастера не уходит по сокету, пока он его не включил", async ({
  page,
  gmToken,
}) => {
  const sentCursorFrames: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (frame) => {
      if (frame.payload.toString().includes(CURSOR_MOVE))
        sentCursorFrames.push(frame.payload.toString());
    }),
  );

  await signInAsGm(page, gmToken);
  await expect(page.locator("canvas").first()).toBeVisible();

  // Мастер начинает приватным — это решение UIX-403, а не случайность
  // хранилища: его курсор ходит по тому, чего игроки не видят.
  await sweepPointerOverMap(page);
  expect(
    sentCursorFrames,
    "приватный курсор мастера ушёл в сокет",
  ).toHaveLength(0);

  await page.locator('button[data-tool="CURSOR_PRESENCE"]').click();
  await page
    .getByRole("group")
    .getByText("Показывать мой курсор игрокам")
    .click();
  await page.keyboard.press("Escape");
  await sweepPointerOverMap(page);
  expect(
    sentCursorFrames.length,
    "включённый курсор не дошёл до сокета — тогда и тишина выше ничего не значит",
  ).toBeGreaterThan(0);

  const afterEnabling = sentCursorFrames.length;
  await page.locator('button[data-tool="CURSOR_PRESENCE"]').click();
  await page
    .getByRole("group")
    .getByText("Показывать мой курсор игрокам")
    .click();
  await page.keyboard.press("Escape");
  await sweepPointerOverMap(page);
  expect(
    sentCursorFrames.length,
    "после выключения кадры продолжили уходить",
  ).toBe(afterEnabling);
});
