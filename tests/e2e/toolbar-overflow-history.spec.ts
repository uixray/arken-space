import { type Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";

/**
 * UIX-503 — панель карты называет, что отменит.
 *
 * Кнопки отмены и повтора были подписаны «Отменить последнее действие»: верно и
 * бесполезно. На карте боя за минуту происходит десяток правок, и вслепую
 * отменённое движение стоит хода.
 *
 * Спек идёт на живой стенд, а историю подменяет **точечно** — только маршрут
 * `/api/canvas/history`. Полностью замоканный снапшот здесь не подошёл: вид
 * мастера тяжелее игрокского и требует согласованных определений токенов,
 * сцен и сокета, так что падение говорило бы о полноте фикстуры, а не о
 * подписи. Подменять же саму историю необходимо: иначе её пришлось бы сперва
 * создать действиями на канвасе, и проверка подписи упиралась бы в проверку
 * рисования.
 *
 * Вторая половина задачи — пустое меню «•••» у игрока — проверяется структурно
 * в `apps/web/src/toolbar-overflow.test.ts`: это правило о том, как написан
 * код, и роль там задаётся сервером, а не тестом.
 */
async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL("/");
}

const historyEntry = (overrides: Record<string, unknown> = {}) => ({
  sequence: 10,
  type: "TOKEN_MOVE",
  targetType: "TOKEN",
  targetId: "token-1",
  status: "APPLIED",
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

async function withHistory(
  page: Page,
  entries: ReturnType<typeof historyEntry>[],
) {
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(entries),
    }),
  );
}

test("меню дополнительных инструментов доступно мастеру", async ({
  page,
  gmToken,
}) => {
  await signInAsGm(page, gmToken);
  // Локатор по классу, а не по роли: `<summary>` не имеет роли кнопки, и
  // `getByRole("button")` не находит его никогда. Проверка «у игрока меню нет»,
  // написанная через роль, была бы зелёной при любом поведении — вакуумной.
  await expect(page.locator(".toolbar-overflow > summary")).toBeVisible();
  await expect(page.locator(".toolbar-overflow > summary")).toHaveAttribute(
    "aria-label",
    "Дополнительные инструменты",
  );
});

test("отмена и повтор называют действие, которое тронут", async ({
  page,
  gmToken,
}) => {
  await withHistory(page, [
    historyEntry({ sequence: 12, status: "UNDONE", type: "DRAWING_CREATE" }),
    historyEntry({ sequence: 11, status: "APPLIED", type: "TOKEN_RESIZE" }),
    historyEntry({ sequence: 10, status: "APPLIED", type: "TOKEN_MOVE" }),
  ]);
  await signInAsGm(page, gmToken);

  // Берётся самая свежая подходящая — та же запись, которую выберет сервер.
  // Разойдясь с ним, подпись назвала бы одно, а отменилось бы другое.
  const undo = page.locator('[data-tool="UNDO"]');
  await expect(undo).toHaveAttribute(
    "aria-label",
    "Отменить: размер токена изменён",
  );
  // Подсказка и доступное имя — один текст: всплывающая подсказка недоступна
  // ни клавиатуре, ни программе чтения с экрана.
  await expect(undo).toHaveAttribute(
    "title",
    "Отменить: размер токена изменён",
  );

  await expect(page.locator('[data-tool="REDO"]')).toHaveAttribute(
    "aria-label",
    "Повторить: рисунок создан",
  );
});

test("недоступная кнопка не обещает действия, которого нет", async ({
  page,
  gmToken,
}) => {
  await withHistory(page, []);
  await signInAsGm(page, gmToken);
  const undo = page.locator('[data-tool="UNDO"]');
  await expect(undo).toBeDisabled();
  await expect(undo).toHaveAttribute(
    "aria-label",
    "Отменить последнее действие",
  );
});
