import { expect, test, type Page } from "@playwright/test";

/**
 * UIX-467: полоса «Журнал» с кнопками «Заявка мастеру» и «Свернуть» ложилась
 * поверх карточек ленты.
 *
 * Тест живёт в e2e, а не в jsdom, потому что дефект был чисто раскладочный:
 * `.activity-feed` перечисляла строки грида позиционно, а `InitiativePanel`
 * рендерится только во время боя. С ним дети съезжали на строку вниз, гибкая
 * строка `minmax(0, 1fr)` доставалась полосе журнала вместо ленты и
 * схлопывалась в ноль. Высоту строк считает движок вёрстки — в jsdom её нет,
 * и проверять там нечего.
 *
 * Поэтому бой здесь включается обязательно: без него раскладка сходится сама
 * собой и тест проходит даже на сломанном CSS.
 */

const SIDEBAR_WIDTHS = [280, 360, 600] as const;

/**
 * Переводит бой в нужное состояние.
 *
 * За кодом 409 стоят две разные вещи, и различать их обязательно: при
 * `BATTLE_ALREADY_ACTIVE` бой уже в нужном состоянии — это успех, а при
 * `CAMPAIGN_CONFLICT` ревизия устарела и команда **не применилась**. Первая
 * версия теста считала успехом оба, из-за чего он оказался нестабильным: с
 * устаревшей ревизией бой не начинался, панель очереди не появлялась, и падение
 * приходило на ожидание её видимости — то есть на симптом, а не на причину.
 */
async function setBattle(page: Page, command: "START_BATTLE" | "END_BATTLE") {
  return page.evaluate(async (cmd) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const bootstrap = await (
        await fetch("/api/bootstrap", { credentials: "include" })
      ).json();
      const response = await fetch("/api/campaign/clock", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: cmd,
          revision: bootstrap.campaign.revision,
          actionId: crypto.randomUUID(),
        }),
      });
      if (response.ok) return "applied";
      const body = await response.json().catch(() => ({}));
      if (
        body.error === "BATTLE_ALREADY_ACTIVE" ||
        body.error === "BATTLE_NOT_ACTIVE"
      )
        return "already";
      if (body.error !== "CAMPAIGN_CONFLICT")
        throw new Error(`${cmd}: ${response.status} ${body.error ?? ""}`);
      // Ревизию сдвинул кто-то другой — перечитываем и пробуем снова.
    }
    throw new Error(`${cmd}: не удалось применить из-за конфликта ревизий`);
  }, command);
}

/**
 * Наибольшее вертикальное перекрытие любой пары детей ленты, в пикселях.
 *
 * Считаются только элементы в нормальном потоке. Выведенные из него —
 * плавающая кнопка «Новые события» (`position: absolute`) — обязаны лежать
 * поверх содержимого, это их работа. Без этого исключения тест оказался
 * нестабильным: кнопка появляется, только когда в ленту приходит новое, то
 * есть в одних прогонах она есть, в других нет.
 */
async function worstOverlap(page: Page) {
  return page.evaluate(() => {
    const feed = document.querySelector(".activity-feed");
    if (!feed) throw new Error("Вкладка «Журнал» не отрисована");
    const boxes = [...feed.children]
      .filter((child) => {
        const position = getComputedStyle(child).position;
        return position !== "absolute" && position !== "fixed";
      })
      .map((child) => {
        const rect = child.getBoundingClientRect();
        return { name: child.className.split(" ")[0], ...rect.toJSON() };
      });
    let worst = { pair: "", px: 0 };
    for (let i = 0; i < boxes.length; i += 1)
      for (let j = i + 1; j < boxes.length; j += 1) {
        const overlap =
          Math.min(boxes[i].bottom, boxes[j].bottom) -
          Math.max(boxes[i].top, boxes[j].top);
        if (overlap > worst.px)
          worst = { pair: `${boxes[i].name} / ${boxes[j].name}`, px: overlap };
      }
    return worst;
  });
}

test.describe("лента журнала во время боя", () => {
  test("полоса журнала не перекрывает карточки ни при какой ширине панели", async ({
    page,
  }) => {
    const token = process.env.GM_ACCESS_TOKEN;
    test.skip(
      !token,
      "GM_ACCESS_TOKEN is required for the integration environment",
    );

    await page.goto(`/gm/${token}`);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL("/");

    // `setBattle` сам бросает исключение, если бой не удалось перевести в
    // нужное состояние, — проверять здесь код ответа больше нечего.
    await setBattle(page, "START_BATTLE");

    try {
      await expect(page.locator(".initiative-panel")).toBeVisible();
      await expect(page.locator(".activity-log-toolbar")).toBeVisible();

      for (const width of SIDEBAR_WIDTHS) {
        await page.evaluate((next) => {
          const sidebar = document.querySelector("aside.sidebar");
          if (!sidebar) throw new Error("Боковая панель не найдена");
          (sidebar as HTMLElement).style.width = `${next}px`;
        }, width);

        const worst = await worstOverlap(page);
        expect(
          worst.px,
          `ширина ${width}px: «${worst.pair}» перекрываются на ${Math.round(worst.px)}px`,
        ).toBeLessThanOrEqual(0);
      }
    } finally {
      await setBattle(page, "END_BATTLE");
    }
  });

  test("поле ввода сообщения остаётся на экране при открытой очереди", async ({
    page,
  }) => {
    /**
     * Найдено живой проверкой, тестами не ловилось: блок быстрых бросков был
     * жёстким (`flex: 0 0 auto`), и с открытой очередью боя колонка вылезала за
     * низ экрана — поле ввода уезжало за край, писать было нечем. Перекрытий при
     * этом не возникало, поэтому проверка выше молчала.
     *
     * Проверяется на низком экране: на высоком места хватает и без сжатия.
     */
    const token = process.env.GM_ACCESS_TOKEN;
    test.skip(
      !token,
      "GM_ACCESS_TOKEN is required for the integration environment",
    );

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/gm/${token}`);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL("/");

    await setBattle(page, "START_BATTLE");
    try {
      await expect(page.locator(".initiative-panel")).toBeVisible();
      const fits = await page.evaluate(() => {
        const composer = document.querySelector(".chat-compose");
        const feed = document.querySelector(".activity-feed");
        if (!composer || !feed) throw new Error("Лента не отрисована");
        const box = composer.getBoundingClientRect();
        return {
          bottom: Math.round(box.bottom),
          viewport: window.innerHeight,
          height: Math.round(box.height),
        };
      });
      expect(
        fits.bottom,
        `низ поля ввода ${fits.bottom} при высоте окна ${fits.viewport}`,
      ).toBeLessThanOrEqual(fits.viewport + 1);
      // Поле не должно «поместиться» схлопнувшись в ничто.
      expect(fits.height).toBeGreaterThan(20);
    } finally {
      await setBattle(page, "END_BATTLE");
    }
  });
});
