import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

/**
 * UIX-532/325 — правка, пришедшая извне, не выбрасывает из поля.
 *
 * Это тот самый дефект, который мастер видел как «Firefox сам открывает поиск
 * по странице»: поле пересоздавалось из-за `key` с ревизией, фокус молча падал
 * на `<body>`, и следующая набранная буква доставалась браузеру.
 *
 * Тест обязан быть браузерным и на живом стенде. Проверяется не «какой ключ у
 * элемента», а наблюдаемое: где оказался фокус и что осталось в поле после
 * настоящей правки, приехавшей с сервера. В jsdom нет ни того, ни другого.
 */

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

/**
 * Открывает лист первого персонажа кампании и отдаёт его id.
 *
 * Персонаж берётся из снимка по имени, а не «первой кнопкой в списке»: рядом
 * с именем в строке стоят закрытие и архивирование, и слепой клик по первой
 * кнопке однажды откроет диалог архивации вместо листа.
 */
async function openFirstSheet(page: Page) {
  const character = await page.evaluate(async () => {
    const bootstrap = await (
      await fetch("/api/bootstrap", { credentials: "include" })
    ).json();
    const first = bootstrap.characters[0];
    return first
      ? { id: first.id as string, name: first.name as string }
      : null;
  });
  if (!character) throw new Error("В кампании нет персонажей");

  await openWorkspaceSection(page, "Персонажи");
  const workspace = page.locator(".character-workspace");
  await expect(workspace).toBeVisible();
  await workspace
    .getByRole("button", { name: character.name, exact: true })
    .click();
  await expect(
    page.locator(`[data-character-sheet-id="${character.id}"]`),
  ).toBeVisible();
  return character.id;
}

/**
 * Правка того же персонажа «со стороны» — так же, как её сделал бы второй
 * клиент. Ревизия читается заново: она и есть то, что раньше пересоздавало поле.
 */
async function patchCharacterElsewhere(
  page: Page,
  characterId: string,
  patch: Record<string, unknown>,
) {
  const status = await page.evaluate(
    async ([id, body]) => {
      const bootstrap = await (
        await fetch("/api/bootstrap", { credentials: "include" })
      ).json();
      const character = bootstrap.characters.find(
        (item: { id: string }) => item.id === id,
      );
      const response = await fetch(`/api/characters/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          revision: character.revision,
          ...(body as Record<string, unknown>),
        }),
      });
      return response.status;
    },
    [characterId, patch] as const,
  );
  expect(status, "правка со стороны не применилась").toBeLessThan(300);
}

const inventoryField = (page: Page) =>
  page.locator("label.field", { hasText: "Инвентарь" }).locator("textarea");

test("фокус в поле инвентаря переживает чужую правку персонажа", async ({
  page,
  gmToken,
}) => {
  await signInAsGm(page, gmToken);
  const characterId = await openFirstSheet(page);

  const field = inventoryField(page);
  await field.click();
  await expect(field).toBeFocused();

  await patchCharacterElsewhere(page, characterId, {
    notes: `правка со стороны ${Date.now()}`,
  });

  // Ждём, пока снимок дойдёт и перерисовка случится: без ожидания тест прошёл
  // бы и на сломанном коде — просто не успев увидеть пересоздание.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const bootstrap = await (
          await fetch("/api/bootstrap", { credentials: "include" })
        ).json();
        return bootstrap.characters[0]?.revision ?? 0;
      }),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(1000);

  await expect(
    field,
    "фокус ушёл из поля — следующая буква достанется браузеру",
  ).toBeFocused();
});

test("набранное в поле не затирается чужой правкой", async ({
  page,
  gmToken,
}) => {
  /**
   * Вторая половина того же решения. Донести чужое значение до поля можно и
   * грубо — присвоением поверх набранного; проверка фокуса такую потерю не
   * заметила бы, потому что фокус при этом остаётся на месте.
   */
  await signInAsGm(page, gmToken);
  const characterId = await openFirstSheet(page);

  const field = inventoryField(page);
  await field.click();
  await field.fill("Верёвка\nФакел\nНедописанное сло");

  await patchCharacterElsewhere(page, characterId, {
    inventory: ["Чужой предмет"],
  });
  await page.waitForTimeout(1500);

  await expect(field).toHaveValue("Верёвка\nФакел\nНедописанное сло");
  await expect(field).toBeFocused();
});

test("чужая правка доходит до поля, которое человек уже правил", async ({
  page,
  gmToken,
}) => {
  /**
   * Обратная проверка, без которой две первые ничего не стоят: «не трогать
   * поле» тривиально достигается тем, чтобы не обновлять его никогда — и
   * человек смотрел бы на устаревшее значение, не зная об этом.
   *
   * Проверяется именно поле, которое уже правили руками. Нетронутому браузер
   * доносит новое значение сам: пока пользователь не печатал, у контрола не
   * поднят флаг «изменён вручную», и смена `defaultValue` видна. После первой
   * же правки флаг поднят навсегда — с этого момента показать чужое значение
   * может только явное присваивание.
   *
   * Чтобы правка осталась несохранённой (иначе на сервере окажется тот же
   * текст и расхождения не будет), сохранение отклоняется конфликтом — так же,
   * как это происходит на игре, когда двое правят одного персонажа.
   */
  await signInAsGm(page, gmToken);
  const characterId = await openFirstSheet(page);
  const field = inventoryField(page);

  await page.route("**/api/characters/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "CHARACTER_CONFLICT" }),
    });
  });
  await field.click();
  await field.fill("Черновик, который не сохранится");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await expect(field).not.toBeFocused();
  await page.unroute("**/api/characters/*");

  await patchCharacterElsewhere(page, characterId, {
    inventory: ["Пришло со стороны"],
  });

  await expect(field).toHaveValue("Пришло со стороны");
});

test("фокус в поле характеристики переживает чужую правку", async ({
  page,
  gmToken,
}) => {
  /**
   * Отдельным тестом, потому что это другой компонент: строки характеристик
   * рисуются списком, и поле там своё. Пересоздание по ревизии стояло и здесь.
   */
  await signInAsGm(page, gmToken);
  const characterId = await openFirstSheet(page);

  const statField = page.locator(".stat-field input").first();
  await statField.click();
  await expect(statField).toBeFocused();

  await patchCharacterElsewhere(page, characterId, {
    notes: `правка со стороны ${Date.now()}`,
  });
  await page.waitForTimeout(1500);

  await expect(statField).toBeFocused();
});
