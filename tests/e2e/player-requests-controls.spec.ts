import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import type { GameSnapshot, PlayerRequestDto } from "@arken/contracts";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

const filterLabels: Record<string, string> = {
  OPEN: "Открытые",
  CLOSED: "Закрытые",
  NOW: "Сейчас",
  BEFORE_BREAK: "До перерыва",
  NEXT_SESSION: "К следующей сессии",
  PUBLIC: "Всем участникам",
  GM_ONLY: "Автору и всем мастерам",
};
async function chooseFilter(
  page: Page,
  dialog: Locator,
  label: string,
  value: string,
) {
  const text =
    value === "ALL"
      ? (
          {
            Состояние: "Все состояния",
            Срок: "Любой срок",
            Аудитория: "Любая аудитория",
          } as Record<string, string>
        )[label]
      : filterLabels[value];
  const control = dialog.getByLabel(label, { exact: true });
  await control.click();
  await page.getByRole("option", { name: text, exact: true }).click();
  await expect(control).toContainText(text);
  await expect(control).toBeFocused();
}

async function bootstrap(page: Page): Promise<GameSnapshot> {
  const response = await page.request.get("/api/bootstrap");
  await expect(response).toBeOK();
  return response.json() as Promise<GameSnapshot>;
}

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page
    .getByRole("button", {
      name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("canvas").first()).toBeVisible();
}

async function signInAsPlayer(page: Page, gmToken: string) {
  await signInAsGm(page, gmToken);
  const character = (await bootstrap(page)).characters[0];
  expect(character).toBeTruthy();
  const inviteResponse = await page.request.post("/api/invites", {
    data: {
      actionId: randomUUID(),
      characterId: character.id,
      label: "Игрок заявок",
      expiresInHours: 1,
    },
  });
  await expect(inviteResponse).toBeOK();
  const invite = (await inviteResponse.json()) as { url: string };
  await expect(await page.request.post("/api/auth/logout")).toBeOK();
  await page.goto(new URL(invite.url).pathname);
  await page.getByLabel(/^Имя(?: в кампании)?$/).fill("Игрок заявок");
  await page
    .getByRole("button", {
      name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("canvas").first()).toBeVisible();
  const playerSnapshot = await bootstrap(page);
  expect(playerSnapshot.me.role).toBe("PLAYER");
  return playerSnapshot;
}

async function createRequest(
  page: Page,
  input: Pick<PlayerRequestDto, "title" | "body" | "horizon" | "audience">,
) {
  const response = await page.request.post("/api/player-requests", {
    data: { ...input, characterId: null, actionId: randomUUID() },
  });
  await expect(response).toBeOK();
  return response.json() as Promise<PlayerRequestDto>;
}

test("UIX644_PLAYER_REQUEST_NATIVE_DRAFT: player Gravity selects keep keyboard focus and draft through compact resize", async ({
  page,
  gmToken,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const playerSnapshot = await signInAsPlayer(page, gmToken);
  await openWorkspaceSection(page, "Мои заявки");
  const dialog = page.getByRole("dialog", { name: "Мои заявки" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Название", { exact: true }).fill("Нужен проводник");
  await dialog
    .getByLabel("Описание", { exact: true })
    .fill("Помогите найти дорогу к северным воротам.");

  const horizon = dialog.getByLabel("Когда", { exact: true });
  await horizon.focus();
  await expect(horizon).toBeFocused();
  await expect(horizon).toContainText("Сейчас");
  await horizon.press("Space");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(horizon).toContainText("До перерыва");
  await expect(horizon).toBeFocused();

  const audience = dialog.getByLabel("Кто увидит", { exact: true });
  await audience.focus();
  await expect(audience).toBeFocused();
  await expect(audience).toContainText("Всем участникам");
  await audience.press("Space");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(audience).toContainText("Автору и всем мастерам");
  await expect(audience).toBeFocused();

  const character = dialog.getByLabel("Персонаж (необязательно)", {
    exact: true,
  });
  const characterName = playerSnapshot.characters[0]!.name;
  await character.focus();
  await expect(character).toContainText("Без персонажа");
  await character.press("Space");
  await expect(
    page.getByRole("option", { name: characterName, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(character).toContainText(characterName);
  await expect(character).toBeFocused();

  // Gravity controls expose an owned listbox. Selection returns focus and
  // must survive viewport changes together with the unsaved request draft.
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(horizon).toContainText("До перерыва");
  await expect(audience).toContainText("Автору и всем мастерам");
  await expect(character).toContainText(characterName);
  await expect(dialog.getByLabel("Название", { exact: true })).toHaveValue(
    "Нужен проводник",
  );
  await expect(dialog.getByLabel("Описание", { exact: true })).toHaveValue(
    "Помогите найти дорогу к северным воротам.",
  );

  await dialog.getByRole("button", { name: "Отправить заявку" }).click();
  const card = dialog.locator(".player-request-card", {
    hasText: "Нужен проводник",
  });
  await expect(card).toBeVisible();
  await expect(card).toContainText("До перерыва");
  await expect(card).toContainText("Автору и всем мастерам");
  await expect(card).toContainText(characterName);

  await chooseFilter(page, dialog, "Состояние", "CLOSED");
  await expect(card).toBeHidden();
  await chooseFilter(page, dialog, "Состояние", "ALL");
  await expect(card).toBeVisible();
  await chooseFilter(page, dialog, "Срок", "NOW");
  await expect(card).toBeHidden();
  await chooseFilter(page, dialog, "Срок", "BEFORE_BREAK");
  await expect(card).toBeVisible();
  await chooseFilter(page, dialog, "Аудитория", "PUBLIC");
  await expect(card).toBeHidden();
  await chooseFilter(page, dialog, "Аудитория", "GM_ONLY");
  await expect(card).toBeVisible();
});

test("UIX644_PLAYER_REQUEST_GM_FILTERS: GM Gravity filters combine state horizon and audience", async ({
  page,
  gmToken,
}) => {
  await signInAsPlayer(page, gmToken);
  await createRequest(page, {
    title: "Открытая публичная заявка",
    body: "Нужно сейчас.",
    horizon: "NOW",
    audience: "PUBLIC",
  });
  const closed = await createRequest(page, {
    title: "Закрытая приватная заявка",
    body: "Нужно к следующей игре.",
    horizon: "NEXT_SESSION",
    audience: "GM_ONLY",
  });
  const cancelResponse = await page.request.post(
    `/api/player-requests/${closed.id}/actions`,
    {
      data: {
        actionId: randomUUID(),
        revision: closed.revision,
        action: "CANCEL",
      },
    },
  );
  await expect(cancelResponse).toBeOK();

  await expect(await page.request.post("/api/auth/logout")).toBeOK();
  await signInAsGm(page, gmToken);
  await openWorkspaceSection(page, "Открытые заявки");
  const dialog = page.getByRole("dialog", { name: "Открытые заявки" });
  await expect(dialog.getByText("Новая заявка", { exact: true })).toHaveCount(
    0,
  );
  await expect(dialog.getByLabel("Название", { exact: true })).toHaveCount(0);
  const openCard = dialog.locator(".player-request-card", {
    hasText: "Открытая публичная заявка",
  });
  const closedCard = dialog.locator(".player-request-card", {
    hasText: "Закрытая приватная заявка",
  });
  await expect(openCard).toBeVisible();
  await expect(closedCard).toBeHidden();

  await chooseFilter(page, dialog, "Состояние", "CLOSED");
  await expect(openCard).toBeHidden();
  await expect(closedCard).toBeVisible();
  await chooseFilter(page, dialog, "Срок", "NEXT_SESSION");
  await chooseFilter(page, dialog, "Аудитория", "GM_ONLY");
  await expect(closedCard).toBeVisible();

  await chooseFilter(page, dialog, "Аудитория", "PUBLIC");
  await expect(closedCard).toBeHidden();
  await expect(dialog).toContainText("Заявок по выбранным фильтрам нет.");

  await dialog.getByRole("button", { name: "Закрыть окно" }).click();
  await expect(dialog).toBeHidden();
  await openWorkspaceSection(page, "Открытые заявки");
  const reopened = page.getByRole("dialog", { name: "Открытые заявки" });
  await expect(reopened.getByLabel("Состояние")).toContainText("Открытые");
  await expect(reopened.getByLabel("Срок")).toContainText("Любой срок");
  await expect(reopened.getByLabel("Аудитория")).toContainText(
    "Любая аудитория",
  );
  await expect(
    reopened.locator(".player-request-card", {
      hasText: "Открытая публичная заявка",
    }),
  ).toBeVisible();
  await expect(
    reopened.locator(".player-request-card", {
      hasText: "Закрытая приватная заявка",
    }),
  ).toBeHidden();
});
