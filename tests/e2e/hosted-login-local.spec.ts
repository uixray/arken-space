import { expect, test } from "@playwright/test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../helpers/pglite-template.js";
import { provisionHostedAccounts } from "../../apps/server/src/hosted-account-provisioning.js";
import { registerAccountAuthRoutes } from "../../apps/server/src/account-auth-routes.js";
import { registerAccountCampaignRoutes } from "../../apps/server/src/account-campaigns.js";
import { unconfiguredMailAdapter } from "../../apps/server/src/account-mail.js";

test("hosted first login survives reload and requires password change before campaign selection", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const pg = await createMigratedPglite(),
    db = drizzle(pg, { schema }),
    app = Fastify();
  const campaignId = crypto.randomUUID(),
    memberId = crypto.randomUUID();
  const origin = "http://127.0.0.1:14923",
    temporary = "synthetic-temporary-password",
    next = "synthetic-final-password";
  try {
    await db
      .insert(schema.campaigns)
      .values({ id: campaignId, name: "Synthetic campaign" });
    await db
      .insert(schema.memberships)
      .values({
        id: memberId,
        campaignId,
        role: "PLAYER",
        displayName: "Synthetic player",
      });
    await provisionHostedAccounts(db as never, [
      {
        login: "synthetic-user",
        password: temporary,
        memberships: [
          {
            membershipId: memberId,
            campaignId,
            role: "PLAYER",
            displayName: "Synthetic player",
          },
        ],
      },
    ]);
    await app.register(cookie);
    const io = { in: () => ({ disconnectSockets() {} }) };
    const base = {
      enabled: true,
      sessionTtlDays: 3,
      cookieSecure: false,
      accountCookieName: "arken_account",
      gameCookieName: "arken_session",
      csrfCookieName: "arken_account_csrf",
      webOrigin: origin,
    };
    registerAccountAuthRoutes(app as never, db as never, io, {
      ...base,
      registrationEnabled: false,
      legacyDevEnabled: false,
      campaignLinkAccessEnabled: false,
      campaignCreationEnabled: false,
      publicUrl: origin,
      mailRuntimeEnabled: false,
      mail: unconfiguredMailAdapter,
      mailKeyring: null,
    });
    registerAccountCampaignRoutes(app as never, db as never, io, {
      ...base,
      creationEnabled: false,
      creationLimit: 2,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("No synthetic listener");
    await page.route("**/api/account/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: `http://127.0.0.1:${address.port}${url.pathname}${url.search}`,
      });
      await route.fulfill({ response });
    });
    await page.route("**/account", async (route) => {
      const response = await route.fetch({
        url: `${origin}/src/test-support/hosted-login-browser-fixture.html`,
      });
      await route.fulfill({ response });
    });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/src/test-support/hosted-login-browser-fixture.html");
    await page.getByLabel("Логин или email").fill("synthetic-user");
    await page.getByLabel("Пароль", { exact: true }).fill(temporary);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Задайте свой пароль" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Мои кампании" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Задайте свой пароль" }),
    ).toBeVisible();
    await page.getByLabel("Временный пароль").fill(temporary);
    await page.getByLabel("Новый пароль", { exact: true }).fill(next);
    await page.getByLabel("Повторите новый пароль").fill(next);
    await page.getByRole("button", { name: "Сохранить новый пароль" }).click();
    await expect(
      page.getByText("Пароль изменён. Войдите снова."),
    ).toBeVisible();
    await page.getByLabel("Логин или email").fill("synthetic-user");
    await page.getByLabel("Пароль", { exact: true }).fill(next);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Мои кампании" }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic campaign", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Выбрать", exact: true }).click();
    expect(await db.select().from(schema.users)).toHaveLength(1);
    expect((await db.select().from(schema.memberships))[0]?.id).toBe(memberId);
  } finally {
    await app.close();
    await pg.close();
  }
});
