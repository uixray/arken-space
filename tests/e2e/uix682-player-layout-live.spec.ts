import { randomUUID } from "node:crypto";
import type { GameSnapshot } from "@arken/contracts";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

/**
 * UIX-682 C01/C12 на живом backend: UI → PATCH → PostgreSQL → reload.
 * uix682-player-ui.spec.ts проверяет тот же UI на замоканном API, а
 * character-stat-layout-routes.integration.test.ts — сервер на PGlite; здесь
 * они сходятся в одном пути, который видит игрок.
 */

async function snapshot(page: Page): Promise<GameSnapshot> {
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

async function invitePlayer(gm: Page, characterId: string, label: string) {
  const response = await gm.request.post("/api/invites", {
    data: { actionId: randomUUID(), characterId, label, expiresInHours: 1 },
  });
  await expect(response).toBeOK();
  return ((await response.json()) as { url: string }).url;
}

async function signInAsPlayer(
  browser: Browser,
  inviteUrl: string,
  name: string,
) {
  const context = await browser.newContext({
    viewport: { width: 1331, height: 918 },
  });
  const page = await context.newPage();
  await page.goto(new URL(inviteUrl).pathname);
  await page.getByLabel(/^Имя(?: в кампании)?$/).fill(name);
  await page
    .getByRole("button", {
      name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL("/");
  expect((await snapshot(page)).me.role).toBe("PLAYER");
  return page;
}

function rowLabels(snap: GameSnapshot, characterId: string) {
  const character = snap.characters.find((item) => item.id === characterId);
  expect(character).toBeTruthy();
  return character!.statLayout.flatMap((group) =>
    group.rows.map((row) => row.label),
  );
}

test("UIX-682 C01 live: PLAYER edits only the own character layout, it survives reload, and a foreign PATCH is denied", async ({
  page,
  browser,
  gmToken,
}) => {
  test.setTimeout(120_000);
  await signInAsGm(page, gmToken);
  const created = await page.request.post("/api/characters", {
    data: { actionId: randomUUID(), name: "Чужой герой UIX682" },
  });
  await expect(created).toBeOK();
  const gmBefore = await snapshot(page);
  const own = gmBefore.characters.find(
    (item) => item.name !== "Чужой герой UIX682",
  )!;
  const foreign = gmBefore.characters.find(
    (item) => item.name === "Чужой герой UIX682",
  )!;
  expect(own).toBeTruthy();
  expect(foreign).toBeTruthy();
  const campaignLayoutBefore = JSON.stringify(gmBefore.campaign.statLayout);
  const foreignLabelsBefore = rowLabels(gmBefore, foreign.id);

  const ownerInvite = await invitePlayer(page, own.id, "Владелец UIX682");
  const otherInvite = await invitePlayer(page, foreign.id, "Сосед UIX682");
  const owner = await signInAsPlayer(browser, ownerInvite, "Владелец UIX682");
  const other = await signInAsPlayer(browser, otherInvite, "Сосед UIX682");

  // C12: a PLAYER with exactly one character gets the compact workspace.
  await openWorkspaceSection(owner, "Персонажи");
  const sheet = owner.getByRole("article", {
    name: `Лист персонажа ${own.name}`,
    exact: true,
  });
  await expect(sheet).toBeVisible();
  await expect(
    owner.locator(".character-workspace.is-single-player-character"),
  ).toBeVisible();

  // C01: create through the real UI and the real PATCH route.
  const stats = sheet.locator(".character-card--stats");
  const saved = owner.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/characters/${own.id}/stat-layout`) &&
      response.request().method() === "PATCH",
  );
  await stats.getByRole("button", { name: "Добавить строку" }).click();
  const dialog = owner.getByRole("dialog", {
    name: "Новая строка — Характеристики",
  });
  await dialog.getByRole("textbox", { name: "Название" }).fill("Смекалка live");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    stats.getByRole("button", { name: "Смекалка live", exact: true }),
  ).toBeVisible();

  // Reload reads PostgreSQL, not client state.
  await owner.reload();
  await openWorkspaceSection(owner, "Персонажи");
  await expect(
    owner
      .getByRole("article", { name: `Лист персонажа ${own.name}`, exact: true })
      .locator(".character-card--stats")
      .getByRole("button", { name: "Смекалка live", exact: true }),
  ).toBeVisible();

  // A sibling PLAYER cannot write the owner's layout, even with a valid body.
  const otherView = await snapshot(other);
  const otherCharacter = otherView.characters.find(
    (item) => item.id === foreign.id,
  )!;
  const forged = await other.request.patch(
    `/api/characters/${own.id}/stat-layout`,
    {
      data: {
        actionId: randomUUID(),
        revision: otherCharacter.revision,
        layout: otherCharacter.statLayout,
      },
    },
  );
  expect([403, 404]).toContain(forged.status());

  // Canonical state: only the owner's character changed.
  const gmAfter = await snapshot(page);
  expect(rowLabels(gmAfter, own.id)).toContain("Смекалка live");
  expect(rowLabels(gmAfter, foreign.id)).toEqual(foreignLabelsBefore);
  expect(JSON.stringify(gmAfter.campaign.statLayout)).toBe(
    campaignLayoutBefore,
  );

  await owner.context().close();
  await other.context().close();
});
