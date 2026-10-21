import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerMemberRulerColorRoutes } from "./member-ruler-color-routes.js";
import { buildSnapshot } from "./snapshot.js";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";

/** UIX-509: GM-assigned ruler colours, their privacy and their validation. */
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
  foreign: "f".repeat(40),
};
const headers = (token: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${token}`,
});
let database: PGlite;
let app: ReturnType<typeof Fastify>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const setColor = (token: string, memberId: string, rulerColor: unknown) =>
  app.inject({
    method: "PATCH",
    url: `/api/members/${memberId}/ruler-color`,
    headers: headers(token),
    payload: { rulerColor },
  });

beforeAll(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "A" },
    { id: ids.otherCampaign, name: "B" },
  ]);
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
    },
    {
      id: ids.other,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Other",
    },
    {
      id: ids.foreign,
      campaignId: ids.otherCampaign,
      role: "GM",
      displayName: "Foreign GM",
    },
  ]);
  for (const [membershipId, token] of Object.entries({
    [ids.gm]: secret.gm,
    [ids.player]: secret.player,
    [ids.foreign]: secret.foreign,
  }))
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
    });
  app = Fastify();
  await app.register(cookie);
  registerMemberRulerColorRoutes(app, db as never);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await database.close();
});

const stored = async (memberId: string) =>
  (
    await db
      .select({ rulerColor: schema.memberships.rulerColor })
      .from(schema.memberships)
      .where(eq(schema.memberships.id, memberId))
  )[0]!.rulerColor;

it("lets the GM assign, repeat and clear a member's colour, including their own", async () => {
  const assigned = await setColor(secret.gm, ids.player, "green");
  expect(assigned.statusCode).toBe(200);
  expect(assigned.json()).toEqual({ id: ids.player, rulerColor: "green" });
  expect((await setColor(secret.gm, ids.player, "green")).statusCode).toBe(200);
  expect((await setColor(secret.gm, ids.gm, "black")).statusCode).toBe(200);
  expect(await stored(ids.gm)).toBe("black");
  const cleared = await setColor(secret.gm, ids.other, null);
  expect(cleared.json()).toEqual({ id: ids.other, rulerColor: null });
});

it("rejects players, other campaigns and colours outside the palette", async () => {
  expect((await setColor(secret.player, ids.player, "blue")).statusCode).toBe(
    403,
  );
  expect(await stored(ids.player)).toBe("green");
  expect((await setColor(secret.foreign, ids.player, "blue")).statusCode).toBe(
    404,
  );
  expect(await stored(ids.player)).toBe("green");
  for (const value of ["#ff0000", "red", "", 3])
    expect((await setColor(secret.gm, ids.player, value)).statusCode).toBe(400);
  expect((await setColor(secret.gm, "not-a-uuid", "blue")).statusCode).toBe(
    400,
  );
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/members/${ids.player}/ruler-color`,
        payload: { rulerColor: "blue" },
      })
    ).statusCode,
  ).toBe(401);
});

it("keeps the database CHECK as the last line of defence", async () => {
  await expect(
    db
      .update(schema.memberships)
      .set({ rulerColor: "pink" })
      .where(eq(schema.memberships.id, ids.other)),
  ).rejects.toThrow();
});

it("shows a player only their own colour and the GM everyone's", async () => {
  const gm = await buildSnapshot(db as never, {
    membershipId: ids.gm,
    campaignId: ids.campaign,
    role: "GM",
    displayName: "GM",
  });
  expect(gm.me.rulerColor).toBe("black");
  expect(
    Object.fromEntries(gm.members.map((m) => [m.id, m.rulerColor])),
  ).toEqual({ [ids.gm]: "black", [ids.player]: "green", [ids.other]: null });

  const player = await buildSnapshot(db as never, {
    membershipId: ids.player,
    campaignId: ids.campaign,
    role: "PLAYER",
    displayName: "Player",
  });
  expect(player.me.rulerColor).toBe("green");
  expect(player.members.map((m) => m.id)).toEqual([ids.player]);
  expect(player.members[0]!.rulerColor).toBeUndefined();
});
