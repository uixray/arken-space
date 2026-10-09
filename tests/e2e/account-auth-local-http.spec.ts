import { readdir, readFile } from "node:fs/promises";
import { expect, test } from "./react-console-guard";
import type { BrowserContext, Page } from "@playwright/test";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@arken/db";
import { createTestMailKeyring, createTestMailOutbox } from "../../apps/server/src/account-mail.js";
import { drainAccountMailOutboxOnce } from "../../apps/server/src/account-mail-outbox.js";
import { registerAccountAuthRoutes } from "../../apps/server/src/account-auth-routes.js";
import { registerAccountCampaignRoutes } from "../../apps/server/src/account-campaigns.js";

const webOrigin = "http://localhost:5173";
test.use({ trace: "off" });
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let apiServer: ReturnType<typeof Fastify>;
let apiOrigin = "";
let outbox: ReturnType<typeof createTestMailOutbox>;
let mailKeyring: ReturnType<typeof createTestMailKeyring>;
let playerContext: BrowserContext | null = null;

function connectLocalApi(page: Page) {
  return page.route("**/api/**", (route) => {
    const requestUrl = route.request().url();
    const path = new URL(requestUrl).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ status: 401, json: { error: "AUTH_REQUIRED" } });
    return route.fetch({ url: `${apiOrigin}${path}${new URL(requestUrl).search}` }).then((response) => route.fulfill({ response }));
  });
}

test.beforeAll(async () => {
  database = new PGlite();
  const migrations = new URL("../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  outbox = createTestMailOutbox();
  mailKeyring = createTestMailKeyring();
  apiServer = Fastify();
  await apiServer.register(cookie);
  apiServer.get("/api/bootstrap", async (_request: FastifyRequest, reply: FastifyReply) => reply.code(401).send({ error: "AUTH_REQUIRED" }));
  const realtime = { in: (_room: string) => ({ disconnectSockets: () => undefined }) };
  registerAccountAuthRoutes(apiServer as never, db as never, realtime, {
    enabled: true, registrationEnabled: true, legacyDevEnabled: false,
    campaignLinkAccessEnabled: false, campaignCreationEnabled: true,
    sessionTtlDays: 3, cookieSecure: false,
    accountCookieName: "arken_account", gameCookieName: "arken_session", csrfCookieName: "arken_account_csrf",
    webOrigin, publicUrl: webOrigin, mail: outbox.adapter, mailRuntimeEnabled: true, mailKeyring,
  });
  registerAccountCampaignRoutes(apiServer as never, db as never, realtime, {
    enabled: true, creationEnabled: true, creationLimit: 3,
    sessionTtlDays: 3, cookieSecure: false,
    accountCookieName: "arken_account", gameCookieName: "arken_session", csrfCookieName: "arken_account_csrf", webOrigin,
  });
  await apiServer.listen({ host: "127.0.0.1", port: 0 });
  const address = apiServer.server.address();
  if (!address || typeof address === "string") throw new Error("local account QA server did not bind a TCP port");
  apiOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await apiServer?.close();
  await database?.close();
});
test.afterEach(async () => { await playerContext?.close(); playerContext = null; });

async function deliverQueuedMail() {
  return drainAccountMailOutboxOnce(db as never, {
    keyring: mailKeyring, adapter: outbox.adapter, workerId: "isolated-browser-qa", batchSize: 1,
  });
}

test("real local HTTP account lifecycle and campaign create/select in browser", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await connectLocalApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Войти в аккаунт" })).toBeVisible();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByLabel("Email").fill("owner@example.invalid");
  await page.getByLabel(/Пароль/).fill("synthetic safe account password");
  await page.getByLabel("Повторите пароль").fill("synthetic safe account password");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByText(/запрос на подтверждение принят/i)).toBeVisible();
  await deliverQueuedMail();
  const verificationMessage = outbox.read()[0]?.text ?? "";
  const verificationToken = /#token=([A-Za-z0-9_-]+)/.exec(verificationMessage)?.[1];
  expect(verificationToken).toBeTruthy();

  await page.goto(`/account/verify#token=${verificationToken}`);
  await expect(page.getByRole("heading", { name: "Подтвердить email" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await page.getByRole("button", { name: "Подтвердить email" }).click();
  await expect(page.getByText("Email подтверждён. Теперь войдите в аккаунт.")).toBeVisible();

  await page.getByLabel("Email").fill("owner@example.invalid");
  await page.getByLabel("Пароль").fill("synthetic safe account password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("heading", { name: "Мои кампании" })).toBeVisible();
  await page.getByLabel("Новая кампания").fill("Local synthetic table");
  const creationResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/account/campaigns" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Создать кампанию" }).click();
  const created = await creationResponse;
  expect(created.status(), `campaign API error: ${(await created.json().catch(() => ({}))).error ?? "unknown"}`).toBe(201);
  await expect(page.getByText("Local synthetic table", { exact: true })).toBeVisible();
  await page.getByLabel("Приглашение игроку").fill("Synthetic player");
  await page.getByRole("button", { name: "Создать ссылку-приглашение" }).click();
  const inviteLink = page.getByRole("link", { name: /account\/join#token=/ });
  await expect(inviteLink).toBeVisible();
  const inviteUrl = await inviteLink.getAttribute("href");
  const inviteToken = inviteUrl ? new URL(inviteUrl).hash.slice("#token=".length) : "";
  expect(inviteToken.length).toBeGreaterThan(20);
  const context = await browser.newContext();
  playerContext = context;
  const playerPage = await context.newPage();
  await connectLocalApi(playerPage);
  await playerPage.goto(webOrigin);
  await expect(playerPage.getByRole("heading", { name: "Войти в аккаунт" })).toBeVisible();

  await playerPage.getByRole("button", { name: "Создать аккаунт" }).click();
  await playerPage.getByLabel("Email").fill("player@example.invalid");
  await playerPage.getByLabel(/Пароль/).fill("synthetic player account password");
  await playerPage.getByLabel("Повторите пароль").fill("synthetic player account password");
  await playerPage.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(playerPage.getByText(/запрос на подтверждение принят/i)).toBeVisible();
  await deliverQueuedMail();
  const playerVerifyText = outbox.read()[1]?.text ?? "";
  const playerVerifyToken = /#token=([A-Za-z0-9_-]+)/.exec(playerVerifyText)?.[1];
  expect(playerVerifyToken).toBeTruthy();
  await playerPage.goto(`${webOrigin}/account/verify#token=${playerVerifyToken}`);
  await playerPage.getByRole("button", { name: "Подтвердить email" }).click();
  await expect(playerPage.getByText("Email подтверждён. Теперь войдите в аккаунт.")).toBeVisible();
  await playerPage.getByLabel("Email").fill("player@example.invalid");
  await playerPage.getByLabel("Пароль").fill("synthetic player account password");
  await playerPage.getByRole("button", { name: "Войти" }).click();
  await expect(playerPage.getByRole("heading", { name: "Мои кампании" })).toBeVisible();
  await playerPage.goto(`${webOrigin}/account/join#token=${inviteToken}`);
  await expect(playerPage.getByRole("heading", { name: "Присоединиться" })).toBeVisible();
  await playerPage.getByRole("button", { name: "Принять приглашение" }).click();
  await expect(playerPage.getByText("Вы присоединились к кампании. Выберите её, чтобы открыть игровой стол.")).toBeVisible();
  await expect(playerPage.getByText("Local synthetic table", { exact: true })).toBeVisible();
  await expect(playerPage.getByRole("button", { name: "Открыть кампанию" })).toBeVisible();
});
