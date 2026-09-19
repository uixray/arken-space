import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerPlayerThemeRoutes } from "./player-theme-routes.js";
import { buildSnapshot, withoutPersonalTheme } from "./snapshot.js";

const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  otherCampaign: id(),
  gm: id(),
  player: id(),
  other: id(),
  foreign: id(),
};
const secret = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  relogin: "r".repeat(40),
  other: "o".repeat(40),
  foreign: "f".repeat(40),
};
const headers = (token: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${token}`,
});
let database: PGlite;
let app: ReturnType<typeof Fastify>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "A" },
    { id: ids.otherCampaign, name: "B" },
  ]);
  await db.insert(schema.memberships).values([
    {
      id: ids.gm,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "GM",
      defaultThemeId: "forest",
    },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
      defaultThemeId: "ice",
    },
    {
      id: ids.other,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Other",
      defaultThemeId: "gold",
    },
    {
      id: ids.foreign,
      campaignId: ids.otherCampaign,
      role: "PLAYER",
      displayName: "Foreign",
      defaultThemeId: "fire",
    },
  ]);
  for (const [membershipId, token] of Object.entries({
    [ids.gm]: secret.gm,
    [ids.player]: secret.player,
    [ids.other]: secret.other,
    [ids.foreign]: secret.foreign,
  }))
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
    });
  await db.insert(schema.sessions).values({
    membershipId: ids.player,
    tokenHash: hashToken(secret.relogin),
    expiresAt: new Date(Date.now() + 60_000),
  });
  app = Fastify();
  await app.register(cookie);
  registerPlayerThemeRoutes(app, db as never);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await database.close();
});

it("persists only self selection/reset across a new authenticated session and returns private projection", async () => {
  const saved = await app.inject({
    method: "PATCH",
    url: "/api/me/theme",
    headers: headers(secret.player),
    payload: { selectedThemeId: "classic-v1", expectedRevision: 0 },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({
    scopeKey: ids.player,
    selectedThemeId: "classic-v1",
    defaultThemeId: "ice",
    revision: 1,
  });
  const reload = await app.inject({
    method: "GET",
    url: "/api/me/theme",
    headers: headers(secret.relogin),
  });
  expect(reload.json()).toMatchObject({
    selectedThemeId: "classic-v1",
    revision: 1,
  });
  const reset = await app.inject({
    method: "PATCH",
    url: "/api/me/theme",
    headers: headers(secret.player),
    payload: { selectedThemeId: null, expectedRevision: 1 },
  });
  expect(reset.json()).toMatchObject({
    selectedThemeId: null,
    defaultThemeId: "ice",
    revision: 2,
  });
  const foreign = await app.inject({
    method: "GET",
    url: "/api/me/theme",
    headers: headers(secret.foreign),
  });
  expect(foreign.json()).toMatchObject({
    scopeKey: ids.foreign,
    selectedThemeId: null,
    defaultThemeId: "fire",
  });
  expect(
    (await app.inject({ method: "GET", url: "/api/me/theme" })).statusCode,
  ).toBe(401);
});

it("rejects extra target ids, invalid ids and stale CAS without exposing another member preference", async () => {
  const extra = await app.inject({
    method: "PATCH",
    url: "/api/me/theme",
    headers: headers(secret.player),
    payload: {
      selectedThemeId: "forest",
      expectedRevision: 2,
      membershipId: ids.other,
    },
  });
  expect(extra.statusCode).toBe(400);
  const invalid = await app.inject({
    method: "PATCH",
    url: "/api/me/theme",
    headers: headers(secret.player),
    payload: { selectedThemeId: "removed", expectedRevision: 2 },
  });
  expect(invalid.statusCode).toBe(400);
  const stale = await app.inject({
    method: "PATCH",
    url: "/api/me/theme",
    headers: headers(secret.player),
    payload: { selectedThemeId: "forest", expectedRevision: 0 },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().personalTheme.scopeKey).toBe(ids.player);
  expect(JSON.stringify(stale.json())).not.toContain(ids.other);
});

it("limits default assignment to same-campaign GM and never changes the selected override", async () => {
  await app.inject({
    method: "PATCH",
    url: "/api/me/theme",
    headers: headers(secret.other),
    payload: { selectedThemeId: "silver", expectedRevision: 0 },
  });
  const beforeDefaultAssignment = await buildSnapshot(db as never, {
    membershipId: ids.gm,
    campaignId: ids.campaign,
    role: "GM",
    displayName: "GM",
  });
  expect(
    beforeDefaultAssignment.members.find((member) => member.id === ids.other),
  ).toMatchObject({ defaultThemeRevision: 0 });
  expect(
    beforeDefaultAssignment.members.find((member) => member.id === ids.other),
  ).not.toHaveProperty("themeRevision");
  const nonGm = await app.inject({
    method: "PATCH",
    url: `/api/members/${ids.other}/theme-default`,
    headers: headers(secret.player),
    payload: { defaultThemeId: "classic-v1", expectedRevision: 0 },
  });
  expect(nonGm.statusCode).toBe(403);
  const foreign = await app.inject({
    method: "PATCH",
    url: `/api/members/${ids.foreign}/theme-default`,
    headers: headers(secret.gm),
    payload: { defaultThemeId: "classic-v1", expectedRevision: 0 },
  });
  expect(foreign.statusCode).toBe(404);
  const assigned = await app.inject({
    method: "PATCH",
    url: `/api/members/${ids.other}/theme-default`,
    headers: headers(secret.gm),
    payload: { defaultThemeId: "classic-v1", expectedRevision: 0 },
  });
  expect(assigned.statusCode).toBe(200);
  expect(assigned.json()).toMatchObject({ id: ids.other, revision: 1 });
  const staleDefault = await app.inject({
    method: "PATCH",
    url: `/api/members/${ids.other}/theme-default`,
    headers: headers(secret.gm),
    payload: { defaultThemeId: "forest", expectedRevision: 0 },
  });
  expect(staleDefault.statusCode).toBe(409);
  expect(staleDefault.json()).toMatchObject({
    error: "THEME_DEFAULT_CONFLICT",
    membership: { id: ids.other, defaultThemeId: "classic-v1", revision: 1 },
  });
  expect(JSON.stringify(staleDefault.json())).not.toContain("silver");
  const other = await app.inject({
    method: "GET",
    url: "/api/me/theme",
    headers: headers(secret.other),
  });
  expect(other.json()).toMatchObject({
    selectedThemeId: "silver",
    defaultThemeId: "classic-v1",
  });
});

it("projects private preference only for me while GM gets only campaign default assignments", async () => {
  const gm = await buildSnapshot(db as never, {
    membershipId: ids.gm,
    campaignId: ids.campaign,
    role: "GM",
    displayName: "GM",
  });
  const player = await buildSnapshot(db as never, {
    membershipId: ids.player,
    campaignId: ids.campaign,
    role: "PLAYER",
    displayName: "Player",
  });
  expect(gm.personalTheme?.scopeKey).toBe(ids.gm);
  expect(gm.members.find((member) => member.id === ids.other)).toMatchObject({
    defaultThemeId: "classic-v1",
  });
  expect(JSON.stringify(gm.members)).not.toContain("silver");
  expect(player.personalTheme?.scopeKey).toBe(ids.player);
  expect(player.members).toHaveLength(1);
  expect(player.members[0]).not.toHaveProperty("defaultThemeId");
  expect(withoutPersonalTheme(player)).not.toHaveProperty("personalTheme");
});
