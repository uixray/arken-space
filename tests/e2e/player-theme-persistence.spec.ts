import { randomUUID } from "node:crypto";
import type { GameSnapshot } from "@arken/contracts";
import type { Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

async function snapshot(page: Page): Promise<GameSnapshot> {
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

async function openThemeSettings(page: Page) {
  await page.locator(".account-menu > summary").click();
  await page.getByRole("button", { name: "Оформление", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Оформление", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectTheme(page: Page, label: RegExp) {
  const dialog = page.getByRole("dialog", { name: "Оформление", exact: true });
  await dialog.getByRole("combobox", { name: "Тема", exact: true }).click();
  await page.getByRole("option", { name: label }).click();
}

test("UIX-317 real player theme persists per membership and distinguishes reset from system", async ({
  page,
  gmToken,
  campaignFactory,
}, testInfo) => {
  test.setTimeout(90_000);
  await signInAsGm(page, gmToken);
  const gmSnapshot = await snapshot(page);
  const character = gmSnapshot.characters[0];
  expect(character).toBeTruthy();
  const inviteResponse = await page.request.post("/api/invites", {
    data: {
      actionId: randomUUID(),
      characterId: character!.id,
      label: "Theme persistence player",
      expiresInHours: 1,
    },
  });
  await expect(inviteResponse).toBeOK();
  const invite = (await inviteResponse.json()) as { url: string };
  await expect(await page.request.post("/api/auth/logout")).toBeOK();
  await page.goto(new URL(invite.url).pathname);
  await page
    .getByLabel("Имя", { exact: true })
    .fill("Theme persistence player");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect((await snapshot(page)).me.role).toBe("PLAYER");

  let dialog = await openThemeSettings(page);
  await selectTheme(page, /^Светлая/);
  await expect(page.locator("html")).toHaveAttribute(
    "data-player-theme",
    "light",
  );
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/me/theme") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    ),
    dialog.getByRole("button", { name: "Сохранить", exact: true }).click(),
  ]);
  await page.reload();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-player-theme",
    "light",
  );

  await expect(await page.request.post("/api/auth/logout")).toBeOK();
  await page.goto(new URL(invite.url).pathname);
  await page
    .getByLabel("Имя", { exact: true })
    .fill("Theme persistence player");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-player-theme",
    "light",
  );

  dialog = await openThemeSettings(page);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/me/theme") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    ),
    dialog
      .getByRole("button", { name: "Сбросить к моей теме", exact: true })
      .click(),
  ]);
  const afterReset = await snapshot(page);
  expect(afterReset.personalTheme?.selectedThemeId).toBeNull();
  const ownDefault = afterReset.personalTheme?.defaultThemeId;
  expect(ownDefault).toBeTruthy();
  await expect(page.locator("html")).toHaveAttribute(
    "data-player-theme",
    ownDefault!,
  );
  if (!(await dialog.isVisible())) dialog = await openThemeSettings(page);
  await selectTheme(page, /^Системное оформление/);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/me/theme") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    ),
    dialog.getByRole("button", { name: "Сохранить", exact: true }).click(),
  ]);
  await page.reload();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-player-theme");

  // The same GM can assign a current-campaign default, but cannot change the
  // player's explicit system override.
  await expect(await page.request.post("/api/auth/logout")).toBeOK();
  await signInAsGm(page, gmToken);
  const preview = await page.request.get(
    `/api/preview/${encodeURIComponent(afterReset.me.id)}`,
  );
  await expect(preview).toBeOK();
  expect(await preview.json()).not.toHaveProperty("personalTheme");
  await openWorkspaceSection(page, "Подготовка");
  const playerPicker = page.getByRole("combobox", {
    name: "Игрок",
    exact: true,
  });
  await playerPicker.click();
  await page
    .getByRole("option", { name: "Theme persistence player", exact: true })
    .click();
  const defaultPicker = page.getByRole("combobox", {
    name: "Тема игрока по умолчанию",
    exact: true,
  });
  await defaultPicker.click();
  await page.getByRole("option", { name: /^Прежнее оформление/ }).click();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/api\/members\/[^/]+\/theme-default$/.test(
          new URL(response.url()).pathname,
        ) &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    ),
    page.getByRole("button", { name: "Назначить тему", exact: true }).click(),
  ]);
  await expect(await page.request.post("/api/auth/logout")).toBeOK();
  await page.goto(new URL(invite.url).pathname);
  await page
    .getByLabel("Имя", { exact: true })
    .fill("Theme persistence player");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator("canvas").first()).toBeVisible();
  expect((await snapshot(page)).personalTheme).toMatchObject({
    selectedThemeId: "system",
    defaultThemeId: "classic-v1",
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-player-theme");

  // A distinct real campaign must not receive this membership's explicit system.
  const otherGmToken = await campaignFactory("UIX-317 theme isolation");
  await expect(await page.request.post("/api/auth/logout")).toBeOK();
  await signInAsGm(page, otherGmToken);
  const other = await snapshot(page);
  expect(other.personalTheme?.selectedThemeId).toBeNull();
  expect(other.personalTheme?.scopeKey).not.toBe(
    afterReset.personalTheme?.scopeKey,
  );
  const otherDefault = other.personalTheme?.defaultThemeId;
  if (!otherDefault) throw new Error("Other campaign has no assigned theme");
  await expect(page.locator("html")).toHaveAttribute(
    "data-player-theme",
    otherDefault,
  );
  const gmDialog = await openThemeSettings(page);
  await selectTheme(page, /^Прежнее оформление/);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/me/theme") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    ),
    gmDialog.getByRole("button", { name: "Сохранить", exact: true }).click(),
  ]);
  await page.reload();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-player-theme",
    "classic-v1",
  );
  await testInfo.attach("player-theme-persistence", {
    body: JSON.stringify({
      playerDefault: ownDefault,
      playerSelectedAfterReset: afterReset.personalTheme?.selectedThemeId,
      otherDefault: other.personalTheme?.defaultThemeId,
    }),
    contentType: "application/json",
  });
});
