import { readdir, readFile } from "node:fs/promises";
import { expect, test } from "./react-console-guard";
import type { BrowserContext, Page } from "@playwright/test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@arken/db";
import { env } from "../../apps/server/src/env.js";
import { hashToken } from "../../apps/server/src/security.js";
import { registerRoutes } from "../../apps/server/src/routes.js";

const webOrigin = "http://localhost:5173";
test.use({ trace: "off" });
const gmLinkToken = "synthetic-local-gm-link-01234567890123456789";
const playerGrantToken = "synthetic-local-player-grant-0123456789012345";
let database: PGlite;
let apiServer: ReturnType<typeof Fastify>;
let apiOrigin = "";
let playerContext: BrowserContext | null = null;
let previousEnv: Record<string, unknown> = {};

function connectLocalApi(page: Page) {
  return page.route("**/api/**", async (route) => {
    const requestUrl = route.request().url();
    const path = new URL(requestUrl).pathname;
    const response = await route.fetch({ url: `${apiOrigin}${path}${new URL(requestUrl).search}` });
    const [headers, body] = await Promise.all([response.headers(), response.body()]);
    await route.fulfill({ status: response.status(), headers, body });
  });
}

test.beforeAll(async () => {
  previousEnv = {
    NODE_ENV: env.NODE_ENV,
    ACCOUNT_AUTH_ENABLED: env.ACCOUNT_AUTH_ENABLED,
    CAMPAIGN_LINK_ACCESS_ENABLED: env.CAMPAIGN_LINK_ACCESS_ENABLED,
    WEB_ORIGIN: env.WEB_ORIGIN,
    PUBLIC_URL: env.PUBLIC_URL,
  };
  Object.assign(env, {
    NODE_ENV: "test",
    ACCOUNT_AUTH_ENABLED: true,
    CAMPAIGN_LINK_ACCESS_ENABLED: true,
    WEB_ORIGIN: webOrigin,
    PUBLIC_URL: webOrigin,
  });
  database = new PGlite();
  const migrations = new URL("../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  const db = drizzle(database, { schema });
  const campaignId = crypto.randomUUID();
  const gmMembershipId = crypto.randomUUID();
  const playerMembershipId = crypto.randomUUID();
  const sceneId = crypto.randomUUID();
  await db.insert(schema.campaigns).values({ id: campaignId, name: "Synthetic direct-link table" });
  await db.insert(schema.scenes).values({
    id: sceneId, campaignId, name: "Synthetic opening scene",
    grid: { enabled: false, size: 50, offsetX: 0, offsetY: 0, color: "#ffffff", opacity: 0.2 },
  });
  await db.update(schema.campaigns).set({ activeSceneId: sceneId }).where((await import("drizzle-orm")).eq(schema.campaigns.id, campaignId));
  await db.insert(schema.memberships).values([
    { id: gmMembershipId, campaignId, role: "GM", displayName: "Synthetic GM" },
    { id: playerMembershipId, campaignId, role: "PLAYER", displayName: "Synthetic Player" },
  ]);
  await db.insert(schema.gmAccessCredentials).values({ campaignId, tokenHash: hashToken(gmLinkToken) });
  await db.insert(schema.playerAccessGrants).values({ campaignId, membershipId: playerMembershipId, label: "Synthetic player grant", tokenHash: hashToken(playerGrantToken) });

  apiServer = Fastify();
  await apiServer.register(cookie);
  const io = {
    in: () => ({ fetchSockets: async () => [], disconnectSockets: () => undefined }),
    to: () => ({ emit: () => undefined }),
  };
  registerRoutes(apiServer as never, db as never, io as never);
  await apiServer.listen({ host: "127.0.0.1", port: 0 });
  const address = apiServer.server.address();
  if (!address || typeof address === "string") throw new Error("isolated campaign-link QA server failed to bind");
  apiOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await apiServer?.close();
  await database?.close();
  Object.assign(env, previousEnv);
});
test.afterEach(async () => { await playerContext?.close(); playerContext = null; });

test("real local GM link creates role-specific game bootstrap in account mode", async ({ page }) => {
  await connectLocalApi(page);
  await page.goto(`/gm/${gmLinkToken}`);
  await expect(page.getByRole("heading", { name: "Войти как мастер по ссылке" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/gm");
  const bootstrap = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/bootstrap" && response.status() === 200);
  await page.getByRole("button", { name: "Продолжить в игру" }).click();
  const snapshot = await (await bootstrap).json();
  expect(snapshot.me.role).toBe("GM");
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("real local PLAYER grant link creates isolated role-specific game bootstrap", async ({ page, browser }) => {
  playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await connectLocalApi(playerPage);
  await playerPage.goto(`/join/${playerGrantToken}`);
  await expect(playerPage.getByRole("heading", { name: "Присоединиться по ссылке" })).toBeVisible();
  await expect.poll(() => playerPage.evaluate(() => location.pathname)).toBe("/join");
  await playerPage.getByLabel("Имя в кампании").fill("Synthetic Browser Player");
  const bootstrap = playerPage.waitForResponse((response) => new URL(response.url()).pathname === "/api/bootstrap" && response.status() === 200);
  await playerPage.getByRole("button", { name: "Продолжить в игру" }).click();
  const snapshot = await (await bootstrap).json();
  expect(snapshot.me.role).toBe("PLAYER");
  expect(snapshot.me.displayName).toBe("Synthetic Browser Player");
  expect(snapshot.members.map((member: { role: string }) => member.role)).toEqual(["PLAYER"]);
  await expect(playerPage.locator(".app-shell")).toBeVisible();
});
