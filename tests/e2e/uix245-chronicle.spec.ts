import { randomUUID } from "node:crypto";
import type { GameSnapshot } from "@arken/contracts";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

/**
 * UIX-245: летопись упорядочена по дню кампании, фильтруется по эпохе, а
 * черновик можно начать из броска — живой backend, мастер и игрок.
 */
const signIn = async (page: Page) => {
  await page
    .getByRole("button", {
      name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("canvas").first()).toBeVisible();
};

async function openStory(page: Page) {
  await openWorkspaceSection(page, "Сюжет");
  const channel = page.getByRole("region", { name: "Сюжет кампании" });
  await expect(channel).toBeVisible();
  return channel;
}

async function createEntry(
  channel: Locator,
  entry: { title: string; body: string; day?: string; era: string },
) {
  const composer = channel.locator(".story-composer");
  await composer.getByLabel("Заголовок").fill(entry.title);
  if (entry.day) await composer.getByLabel("День кампании").fill(entry.day);
  await composer.getByLabel("Эпоха").fill(entry.era);
  await composer.getByLabel("Новая публикация").fill(entry.body);
  await composer.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(article(channel, entry.title)).toBeVisible();
}

const article = (channel: Locator, title: string) =>
  channel.locator("article.story-post").filter({ hasText: title });

async function titlesInOrder(channel: Locator) {
  return channel
    .locator("article.story-post strong")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
}

test("UIX-245 chronicle orders by campaign day, filters by era and seeds a draft from a roll", async ({
  page,
  browser,
  gmToken,
}) => {
  test.setTimeout(120_000);
  await page.goto(`/gm/${gmToken}`);
  await signIn(page);
  const channel = await openStory(page);

  await createEntry(channel, {
    title: "Переправа",
    body: "Отряд перешёл ледяную реку.",
    day: "3",
    era: "Эпоха льда",
  });
  // День не указан — сервер берёт текущий день часов кампании (1).
  await createEntry(channel, {
    title: "Пир",
    body: "Деревня празднует.",
    era: "Эпоха пепла",
  });
  for (const title of ["Переправа", "Пир"])
    await article(channel, title)
      .getByRole("button", { name: "Опубликовать" })
      .click();
  await expect(
    article(channel, "Переправа").getByText("День 3 · Эпоха льда"),
  ).toBeVisible();
  await expect(
    article(channel, "Пир").getByText("День 1 · Эпоха пепла"),
  ).toBeVisible();
  await expect.poll(() => titlesInOrder(channel)).toEqual(["Переправа", "Пир"]);

  const eras = channel.getByRole("group", { name: "Эпохи летописи" });
  await eras.getByRole("button", { name: "Эпоха льда" }).click();
  await expect(
    eras.getByRole("button", { name: "Эпоха льда" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => titlesInOrder(channel)).toEqual(["Переправа"]);
  await eras.getByRole("button", { name: "Все эпохи" }).click();
  await expect.poll(() => titlesInOrder(channel)).toEqual(["Переправа", "Пир"]);

  // Бросок рождает техническое событие; черновик берёт только его тип.
  await expect(
    await page.request.post("/api/dice", {
      data: { actionId: randomUUID(), formula: "1d6", label: "Тайный бросок" },
    }),
  ).toBeOK();
  await channel
    .getByRole("button", { name: "Черновик из события игры" })
    .click();
  await channel
    .getByRole("button", { name: /^Бросок кубиков · / })
    .first()
    .click();
  const seeded = article(channel, "Бросок кубиков");
  await expect(seeded).toBeVisible();
  await expect(seeded).toHaveAttribute("data-story-lifecycle", "DRAFT");
  await expect(seeded).not.toContainText("Тайный бросок");
  await expect(seeded).not.toContainText("1d6");

  // Игрок: только опубликованное, тот же порядок, без черновиков и формы.
  const snapshot = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as GameSnapshot;
  const invite = (await (
    await page.request.post("/api/invites", {
      data: {
        actionId: randomUUID(),
        characterId: snapshot.characters[0]!.id,
        label: "Chronicle player",
        expiresInHours: 1,
      },
    })
  ).json()) as { url: string };
  const playerContext = await browser.newContext();
  try {
    const player = await playerContext.newPage();
    await player.goto(new URL(invite.url).pathname);
    await player.getByLabel(/^Имя(?: в кампании)?$/).fill("Chronicle player");
    await signIn(player);
    // Раздел «Сюжет» — только у мастера; игрок читает летопись карточками
    // в общей ленте «Активность».
    const activity = player.locator("#chat-panel-activity");
    await expect(activity).toBeVisible();
    for (const [title, label] of [
      ["Переправа", "День 3 · Эпоха льда"],
      ["Пир", "День 1 · Эпоха пепла"],
    ] as const)
      await expect(
        article(activity, title).getByText(label, { exact: true }),
      ).toBeVisible();
    await expect(article(activity, "Бросок кубиков")).toHaveCount(0);
    await expect(activity.locator(".story-composer")).toHaveCount(0);
  } finally {
    await playerContext.close();
  }
});
