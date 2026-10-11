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
import { openWorkspaceSection } from "./workspace-nav-helper";

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
    const response = await route.fetch({
      url: `${apiOrigin}${path}${new URL(requestUrl).search}`,
    });
    const [headers, body] = await Promise.all([
      response.headers(),
      response.body(),
    ]);
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
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  const db = drizzle(database, { schema });
  const campaignId = crypto.randomUUID();
  const gmMembershipId = crypto.randomUUID();
  const playerMembershipId = crypto.randomUUID();
  const sceneId = crypto.randomUUID();
  await db
    .insert(schema.campaigns)
    .values({ id: campaignId, name: "Synthetic direct-link table" });
  await db.insert(schema.scenes).values({
    id: sceneId,
    campaignId,
    name: "Synthetic opening scene",
    grid: {
      enabled: false,
      size: 50,
      offsetX: 0,
      offsetY: 0,
      color: "#ffffff",
      opacity: 0.2,
    },
  });
  await db
    .update(schema.campaigns)
    .set({ activeSceneId: sceneId })
    .where((await import("drizzle-orm")).eq(schema.campaigns.id, campaignId));
  await db.insert(schema.memberships).values([
    { id: gmMembershipId, campaignId, role: "GM", displayName: "Synthetic GM" },
    {
      id: playerMembershipId,
      campaignId,
      role: "PLAYER",
      displayName: "Synthetic Player",
    },
  ]);
  await db
    .insert(schema.gmAccessCredentials)
    .values({ campaignId, tokenHash: hashToken(gmLinkToken) });
  await db.insert(schema.playerAccessGrants).values({
    campaignId,
    membershipId: playerMembershipId,
    label: "Synthetic player grant",
    tokenHash: hashToken(playerGrantToken),
  });
  await db.insert(schema.characters).values({
    campaignId,
    name: "Synthetic personal hero",
    ownerMembershipId: playerMembershipId,
  });

  apiServer = Fastify();
  await apiServer.register(cookie);
  const io = {
    in: () => ({
      fetchSockets: async () => [],
      disconnectSockets: () => undefined,
    }),
    to: () => ({ emit: () => undefined }),
  };
  registerRoutes(apiServer as never, db as never, io as never);
  await apiServer.listen({ host: "127.0.0.1", port: 0 });
  const address = apiServer.server.address();
  if (!address || typeof address === "string")
    throw new Error("isolated campaign-link QA server failed to bind");
  apiOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await apiServer?.close();
  await database?.close();
  Object.assign(env, previousEnv);
});
test.afterEach(async () => {
  await playerContext?.close();
  playerContext = null;
});

test("real local GM link creates role-specific game bootstrap in account mode", async ({
  page,
}) => {
  await connectLocalApi(page);
  await page.goto(`/gm/${gmLinkToken}`);
  await expect(
    page.getByRole("heading", { name: "Войти как мастер по ссылке" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/gm");
  const bootstrap = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/bootstrap" &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Продолжить в игру" }).click();
  const snapshot = await (await bootstrap).json();
  expect(snapshot.me.role).toBe("GM");
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("real local PLAYER grant link creates isolated role-specific game bootstrap", async ({
  browser,
}) => {
  playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await connectLocalApi(playerPage);
  await playerPage.goto(`/join/${playerGrantToken}`);
  await expect(
    playerPage.getByRole("heading", { name: "Присоединиться по ссылке" }),
  ).toBeVisible();
  await expect
    .poll(() => playerPage.evaluate(() => location.pathname))
    .toBe("/join");
  await playerPage
    .getByLabel("Имя в кампании")
    .fill("Synthetic Browser Player");
  const bootstrap = playerPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/bootstrap" &&
      response.status() === 200,
  );
  await playerPage.getByRole("button", { name: "Продолжить в игру" }).click();
  const snapshot = await (await bootstrap).json();
  expect(snapshot.me.role).toBe("PLAYER");
  expect(snapshot.me.displayName).toBe("Synthetic Browser Player");
  expect(
    snapshot.members.map((member: { role: string }) => member.role),
  ).toEqual(["PLAYER"]);
  await expect(playerPage.locator(".app-shell")).toBeVisible();
});

test("PLAYER creates personal skill and ability through the sheet, survives reload and leaves the shared catalog unchanged", async ({
  browser,
}) => {
  playerContext = await browser.newContext();
  const page = await playerContext.newPage();
  await connectLocalApi(page);
  await page.goto(`/join/${playerGrantToken}`);
  await page.getByLabel("Имя в кампании").fill("Personal entry player");
  await page.getByRole("button", { name: "Продолжить в игру" }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const snapshot = () =>
    page.evaluate(async () => (await fetch("/api/bootstrap")).json());
  const before = await snapshot();
  expect(before.characters).toHaveLength(1);
  for (const kind of ["SKILL", "ABILITY"] as const) {
    await openWorkspaceSection(page, "Персонажи");
    await page
      .getByRole("button", {
        name:
          kind === "SKILL" ? "+ Добавить навык…" : "+ Добавить способность…",
      })
      .click();
    await page.getByRole("button", { name: "+ Создать новую запись" }).click();
    const form = page.locator(".catalog-entry-form");
    if (kind === "ABILITY") {
      await form.getByRole("combobox").first().click();
      await page
        .getByRole("option", { name: "Способность / заклинание", exact: true })
        .click();
    }
    await form
      .getByLabel("Название", { exact: false })
      .fill(`Personal ${kind}`);
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "+ Создать новую запись" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible();
    const current = await snapshot();
    expect(current.catalogEntries).toEqual(before.catalogEntries);
    expect(current.characters[0].entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind,
          name: `Personal ${kind}`,
          sourceCatalogEntryId: null,
        }),
      ]),
    );
  }
});
