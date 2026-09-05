import { type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { GameSnapshot } from "@arken/contracts";
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

/** UIX-475: настоящие счётчики, PATCH и новые броски, без подмены прокрутки. */
async function observeResourceFollow(page: Page) {
  await page.locator(LIST).evaluate((element) => {
    const list = element as HTMLElement & { resourceFollowEvents?: unknown[] };
    if (list.resourceFollowEvents) return;
    const events: unknown[] = [];
    list.resourceFollowEvents = events;
    const record = (type: string, event?: Event) => {
      const focused = document.activeElement;
      const quickRolls = document.querySelector(".quick-roll-panel");
      events.push({
        type,
        at: Math.round(performance.now()),
        key: event instanceof KeyboardEvent ? event.key : undefined,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        bottom: list.scrollHeight - list.scrollTop - list.clientHeight,
        quickRollHeight: quickRolls?.getBoundingClientRect().height,
        sidebar: document
          .querySelector(".sidebar")
          ?.getBoundingClientRect()
          .toJSON(),
        focused: focused
          ? `${focused.tagName}:${focused.getAttribute("aria-label") ?? focused.id}`
          : null,
        newEvents: document.querySelector(".new-messages")?.textContent ?? null,
      });
      if (events.length > 120) events.shift();
    };
    list.addEventListener("scroll", () => record("scroll"), { passive: true });
    for (const type of ["pointerdown", "focusin", "keydown"]) {
      document.addEventListener(type, (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(".resource-counters, .quick-roll-panel")
        ) {
          record(type, event);
        }
      });
    }
    const resize = new ResizeObserver(() => record("resize"));
    resize.observe(list);
    record("initial");
  });
}

for (const role of ["GM", "PLAYER"] as const) {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    test(`UIX-475 real resource edits preserve follow-scroll (${role} ${viewport.width}x${viewport.height})`, async ({
      page,
      browser,
      baseURL,
      gmToken,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      // Проверяемый PLAYER остаётся на странице фикстуры под React console
      // guard; отдельный GM-контекст нужен только для выпуска приглашения.
      const gmContext =
        role === "PLAYER" ? await browser.newContext({ baseURL }) : null;
      const gmPage = gmContext ? await gmContext.newPage() : page;
      const checkpoints: unknown[] = [];
      const capture = async (phase: string) => {
        if ((await page.locator(LIST).count()) === 0) return;
        checkpoints.push({
          phase,
          ...(await page.locator(LIST).evaluate((element) => {
            const list = element as HTMLElement & {
              resourceFollowEvents?: unknown[];
            };
            return {
              scrollTop: list.scrollTop,
              scrollHeight: list.scrollHeight,
              clientHeight: list.clientHeight,
              bottom: list.scrollHeight - list.scrollTop - list.clientHeight,
              sidebar: document
                .querySelector(".sidebar")
                ?.getBoundingClientRect()
                .toJSON(),
              events: list.resourceFollowEvents ?? [],
            };
          })),
        });
      };
      const assertFollowing = async () => {
        expect(
          await page.locator(LIST).evaluate((list) => list.clientHeight),
        ).toBeGreaterThan(0);
        expect(
          await page
            .locator(LIST)
            .evaluate((list) => list.scrollHeight - list.clientHeight),
        ).toBeGreaterThan(400);
        await expect
          .poll(() => distanceToBottom(page))
          .toBeLessThanOrEqual(AT_BOTTOM_TOLERANCE);
        await expect(
          page.getByRole("button", { name: /Новые события/ }),
        ).toHaveCount(0);
      };

      try {
        await signInAsGm(gmPage, gmToken);
        const bootstrap = await gmPage.request.get("/api/bootstrap");
        await expect(bootstrap).toBeOK();
        const initial = (await bootstrap.json()) as GameSnapshot;
        const character = initial.characters[0];
        expect(character.resources.physicalPower.current).toBe(10);
        await seedLog(gmPage, 40);

        if (role === "PLAYER") {
          const response = await gmPage.request.post("/api/invites", {
            data: {
              actionId: randomUUID(),
              characterId: character.id,
              label: "Игрок UIX-475",
              expiresInHours: 1,
            },
          });
          await expect(response).toBeOK();
          const invite = (await response.json()) as { url: string };
          await page.goto(new URL(invite.url).pathname);
          await page.getByLabel("Имя").fill("Игрок UIX-475");
          await page.getByRole("button", { name: "Войти" }).click();
          await expect(page).toHaveURL("/");
        } else {
          await page.reload();
        }
        const session = await page.request.get("/api/bootstrap");
        await expect(session).toBeOK();
        expect(((await session.json()) as GameSnapshot).me.role).toBe(role);
        const counters = page.locator(".resource-counters");
        const input = counters.getByRole("spinbutton", {
          name: "Очки: Выносливость",
        });
        const decrement = counters.getByRole("button", {
          name: "Потратить одно очко: Выносливость",
        });
        const toggle = page.locator(".quick-roll-panel__toggle");
        await expect(input).toHaveValue("10");
        await observeResourceFollow(page);
        await assertFollowing();

        const editAndRoll = async (
          action: () => Promise<void>,
          value: string,
          phase: string,
        ) => {
          await test.step(phase, async () => {
            await assertFollowing();
            const saved = page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname ===
                  `/api/characters/${character.id}/counters` &&
                response.request().method() === "PATCH",
            );
            await action();
            const response = await saved;
            expect(response.ok(), `PATCH counters: ${response.status()}`).toBe(
              true,
            );
            await expect(input).toHaveValue(value);
            if (phase === "input-enter") await expect(input).toBeFocused();
            await capture(`${phase}:after-patch`);
            await assertFollowing();
            const label = `UIX-475 ${phase} ${randomUUID()}`;
            // Настоящий бросок приходит без клика по ленте и перехвата фокуса:
            // потерянное слежение не должно исправиться случайным действием теста.
            const roll = await page.request.post("/api/dice", {
              data: {
                actionId: randomUUID(),
                formula: "1d20",
                label,
                visibility: "PUBLIC",
              },
            });
            await expect(roll).toBeOK();
            await expect(
              page.locator(LIST).locator("article.message").last(),
            ).toContainText(label);
            if (phase === "input-enter") await expect(input).toBeFocused();
            await capture(`${phase}:after-roll`);
            await assertFollowing();
          });
        };
        await editAndRoll(() => decrement.click(), "9", "pointer-decrement");
        await editAndRoll(
          async () => {
            await input.click();
            await input.fill("7");
            await input.press("Enter");
          },
          "7",
          "input-enter",
        );
        await editAndRoll(
          async () => {
            await input.click();
            await input.fill("6");
            await input.press("Tab");
          },
          "6",
          "input-blur",
        );
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await assertFollowing();
        await capture("before-reload");
        await page.reload();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(input).toHaveValue("6");
        await observeResourceFollow(page);
        await editAndRoll(
          () => decrement.click(),
          "5",
          "collapsed-after-reload",
        );
        if (viewport.height === 720) {
          // Предыдущая правка уже подтверждена: здесь проверяется состояние
          // панели, а не судьба незавершённой очереди при размонтировании.
          await capture("before-sidebar-collapse");
          await page
            .getByRole("button", { name: "Свернуть боковую панель" })
            .click();
          await expect(input).toBeHidden();
          await page
            .getByRole("button", { name: "Развернуть боковую панель" })
            .click();
          await expect(input).toHaveValue("5");
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
          await observeResourceFollow(page);
          await capture("sidebar-reopened");
          await assertFollowing();
          await editAndRoll(
            () => decrement.click(),
            "4",
            "sidebar-reopened-edit",
          );
        }
      } finally {
        await capture("final-or-failure");
        await testInfo.attach("resource-follow-scroll", {
          body: JSON.stringify({ role, viewport, checkpoints }, null, 2),
          contentType: "application/json",
        });
        await gmContext?.close();
      }
    });
  }
}
