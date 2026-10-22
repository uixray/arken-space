import { randomUUID } from "node:crypto";
import type { GameSnapshot } from "@arken/contracts";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

/**
 * UIX-245: мастер связывает запись летописи с сущностями мира через поиск в
 * редакторе; игрок видит только связь с опубликованной сущностью — живой
 * backend, мастер и игрок.
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

const article = (scope: Locator, title: string) =>
  scope.locator("article.story-post").filter({ hasText: title });

async function createWorldEntity(
  page: Page,
  entity: { name: string; type: string; publish: boolean },
) {
  const created = await page.request.post("/api/world-content", {
    data: {
      actionId: randomUUID(),
      slug: `uix245-${randomUUID().slice(0, 8)}`,
      type: entity.type,
      name: entity.name,
    },
  });
  await expect(created).toBeOK();
  const row = (await created.json()) as { id: string; revision: number };
  if (entity.publish)
    await expect(
      await page.request.post(`/api/world-content/${row.id}/lifecycle`, {
        data: {
          actionId: randomUUID(),
          revision: row.revision,
          lifecycle: "PUBLISHED",
        },
      }),
    ).toBeOK();
}

test("UIX-245 chronicle links to world entities and hides unpublished ones from players", async ({
  page,
  browser,
  gmToken,
}) => {
  test.setTimeout(120_000);
  // Канон мира общий для всех кампаний — имена уникальны для этого прогона.
  const marker = randomUUID().slice(0, 6);
  const published = `Переправа ${marker}`;
  const secret = `Тайный культ ${marker}`;
  await page.goto(`/gm/${gmToken}`);
  await signIn(page);
  await createWorldEntity(page, {
    name: published,
    type: "LOCATION",
    publish: true,
  });
  await createWorldEntity(page, {
    name: secret,
    type: "FACTION",
    publish: false,
  });

  await openWorkspaceSection(page, "Сюжет");
  const channel = page.getByRole("region", { name: "Сюжет кампании" });
  const composer = channel.locator(".story-composer");
  await composer.getByLabel("Заголовок").fill("Связанная запись");
  await composer.getByLabel("Новая публикация").fill("Отряд нашёл культ.");
  await composer.getByLabel("Найти цель для связи").fill(marker);
  await composer.getByLabel("Найти цель для связи").press("Enter");
  const results = composer.getByRole("list", { name: "Найденные цели" });
  await results
    .getByRole("button", { name: `Связать: Сущность мира · ${published}` })
    .click();
  await results
    .getByRole("button", { name: `Связать: Сущность мира · ${secret}` })
    .click();
  await composer.getByRole("button", { name: "Сохранить черновик" }).click();

  const entry = article(channel, "Связанная запись");
  await expect(entry).toBeVisible();
  const links = entry.getByRole("list", { name: "Связи записи" });
  await expect(links.getByRole("listitem")).toHaveText([
    `Сущность мира${published}`,
    `Сущность мира${secret}скрыто от игроков`,
  ]);
  await entry.getByRole("button", { name: "Опубликовать" }).click();
  await expect(entry).toHaveAttribute("data-story-lifecycle", "PUBLISHED");

  const snapshot = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as GameSnapshot;
  const invite = (await (
    await page.request.post("/api/invites", {
      data: {
        actionId: randomUUID(),
        characterId: snapshot.characters[0]!.id,
        label: "Links player",
        expiresInHours: 1,
      },
    })
  ).json()) as { url: string };
  const playerContext = await browser.newContext();
  try {
    const player = await playerContext.newPage();
    await player.goto(new URL(invite.url).pathname);
    await player.getByLabel(/^Имя(?: в кампании)?$/).fill("Links player");
    await signIn(player);
    const activity = player.locator("#chat-panel-activity");
    const playerEntry = article(activity, "Связанная запись");
    await expect(
      playerEntry
        .getByRole("list", { name: "Связи записи" })
        .getByRole("listitem"),
    ).toHaveText([`Сущность мира${published}`]);
    await expect(activity).not.toContainText(secret);
    await expect(activity.getByLabel("Найти цель для связи")).toHaveCount(0);
  } finally {
    await playerContext.close();
  }
});
