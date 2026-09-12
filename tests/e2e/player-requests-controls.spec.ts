import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { GameSnapshot, PlayerRequestDto } from "@arken/contracts";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

async function bootstrap(page: Page): Promise<GameSnapshot> {
  const response = await page.request.get("/api/bootstrap");
  await expect(response).toBeOK();
  return response.json() as Promise<GameSnapshot>;
}

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
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
  await page.getByLabel("Имя", { exact: true }).fill("Игрок заявок");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
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

test("UIX644_PLAYER_REQUEST_NATIVE_DRAFT: player selects keep keyboard focus and draft through compact resize", async ({
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
  await expect(horizon).toHaveValue("NOW");
  await horizon.press("ArrowDown");
  await expect(horizon).toHaveValue("BEFORE_BREAK");
  await expect(horizon).toBeFocused();

  const audience = dialog.getByLabel("Кто увидит", { exact: true });
  await audience.focus();
  await expect(audience).toBeFocused();
  await expect(audience).toHaveValue("PUBLIC");
  await audience.press("End");
  await expect(audience).toHaveValue("GM_ONLY");
  await expect(audience).toBeFocused();

  const character = dialog.getByLabel("Персонаж (необязательно)", {
    exact: true,
  });
  const characterName = playerSnapshot.characters[0]!.name;
  await expect(
    character.locator(`option[value="${playerSnapshot.characters[0]!.id}"]`),
  ).toHaveText(characterName);
  await character.focus();
  await expect(character).toHaveValue("");
  await character.press("ArrowDown");
  await expect(character).toHaveValue(playerSnapshot.characters[0]!.id);
  await expect(character).toBeFocused();

  // Native select menus belong to the OS, so the contract is the control's
  // value and focus, not a synthetic DOM popup.
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(horizon).toHaveValue("BEFORE_BREAK");
  await expect(audience).toHaveValue("GM_ONLY");
  await expect(character).toHaveValue(playerSnapshot.characters[0]!.id);
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

  await dialog.getByLabel("Состояние").selectOption("CLOSED");
  await expect(card).toBeHidden();
  await dialog.getByLabel("Состояние").selectOption("ALL");
  await expect(card).toBeVisible();
  await dialog.getByLabel("Срок").selectOption("NOW");
  await expect(card).toBeHidden();
  await dialog.getByLabel("Срок").selectOption("BEFORE_BREAK");
  await expect(card).toBeVisible();
  await dialog.getByLabel("Аудитория").selectOption("PUBLIC");
  await expect(card).toBeHidden();
  await dialog.getByLabel("Аудитория").selectOption("GM_ONLY");
  await expect(card).toBeVisible();
});

test("UIX644_PLAYER_REQUEST_GM_FILTERS: GM native filters combine state horizon and audience", async ({
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

  await dialog.getByLabel("Состояние").selectOption("CLOSED");
  await expect(openCard).toBeHidden();
  await expect(closedCard).toBeVisible();
  await dialog.getByLabel("Срок").selectOption("NEXT_SESSION");
  await dialog.getByLabel("Аудитория").selectOption("GM_ONLY");
  await expect(closedCard).toBeVisible();

  await dialog.getByLabel("Аудитория").selectOption("PUBLIC");
  await expect(closedCard).toBeHidden();
  await expect(dialog).toContainText("Заявок по выбранным фильтрам нет.");

  await dialog.getByRole("button", { name: "Закрыть окно" }).click();
  await expect(dialog).toBeHidden();
  await openWorkspaceSection(page, "Открытые заявки");
  const reopened = page.getByRole("dialog", { name: "Открытые заявки" });
  await expect(reopened.getByLabel("Состояние")).toHaveValue("OPEN");
  await expect(reopened.getByLabel("Срок")).toHaveValue("ALL");
  await expect(reopened.getByLabel("Аудитория")).toHaveValue("ALL");
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
