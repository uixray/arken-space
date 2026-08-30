import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { SIDEBAR_WIDTH_MIN } from "../../apps/web/src/sidebar-width-preference";

/**
 * UIX-501 — за кого сделан бросок, видно и в узкой панели.
 *
 * Проверка живёт в браузере не ради самой подписи — её решение проверено
 * разбором источника в `roll-character-name.test.ts`, — а ради теснота. Подпись
 * убирали дважды, и во второй раз (UIX-467) доводом была именно ширина: строка
 * заголовка делится между участником, персонажем, временем и пометкой
 * «мастеру». Раскладку считает движок, и в jsdom этой проверки не существует.
 */
/**
 * Имя нарочно длинное. С коротким («Путник» из seed) заголовок не переполнится
 * ни при какой вёрстке, и проверка на переполнение оказалась бы зелёной, ничего
 * не проверяя, — тот самый вакуумный тест, который выглядит как работающий.
 */
const LONG_CHARACTER_NAME = "Тейн Многоимённый из Северных Пределов";

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

test("подпись персонажа читается и не ломает заголовок на узкой панели", async ({
  page,
  gmToken,
}) => {
  await signInAsGm(page, gmToken);
  await expect(page.locator("aside.sidebar")).toBeVisible();

  const characterName = await page.evaluate(async (longName) => {
    const bootstrap = await (
      await fetch("/api/bootstrap", { credentials: "include" })
    ).json();
    const created = await fetch("/api/characters", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId: crypto.randomUUID(), name: longName }),
    });
    if (!created.ok) throw new Error(await created.text());
    const refreshed = await (
      await fetch("/api/bootstrap", { credentials: "include" })
    ).json();
    const character = refreshed.characters?.find(
      (candidate: { name: string }) => candidate.name === longName,
    );
    if (!character) throw new Error("Созданный персонаж не вернулся снапшотом");
    void bootstrap;
    const response = await fetch("/api/chat", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: crypto.randomUUID(),
        body: "проверка подписи",
        stream: "TABLE",
        characterId: character.id,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return character.name as string;
  }, LONG_CHARACTER_NAME);

  const attribution = page.locator("#activity-message-list .message-character");
  await expect(attribution.first()).toHaveText(characterName);

  // Автор строки и персонаж — разные сущности и разные элементы: подпись не
  // должна поглотить имя участника.
  const header = page.locator("#activity-message-list .message header").first();
  await expect(header.locator("strong")).toBeVisible();

  await page.evaluate((width) => {
    const sidebar = document.querySelector<HTMLElement>("aside.sidebar");
    if (!sidebar) throw new Error("Боковая панель не найдена");
    sidebar.style.width = `${width}px`;
  }, SIDEBAR_WIDTH_MIN);

  // Заголовок — flex-строка. Длинное имя без усечения растолкало бы её и отняло
  // место у времени; именно эта теснота была доводом убрать подпись в UIX-467.
  const overflow = await header.evaluate(
    (node) => node.scrollWidth - node.clientWidth,
  );
  expect(
    overflow,
    "заголовок сообщения переполнен на узкой панели",
  ).toBeLessThanOrEqual(1);
  await expect(attribution.first()).toBeVisible();
});
