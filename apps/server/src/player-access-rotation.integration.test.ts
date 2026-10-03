import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerRoutes } from "./routes.js";

const id = () => crypto.randomUUID();
const campaignId = id();
const gmId = id();
const playerId = id();
const grantId = id();
const gmSecret = "g".repeat(40);
const playerSecret = "p".repeat(40);
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

let database: PGlite;
let app: ReturnType<typeof Fastify>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values({ id: campaignId, name: "Race" });
  await db.insert(schema.memberships).values([
    { id: gmId, campaignId, role: "GM", displayName: "GM" },
    { id: playerId, campaignId, role: "PLAYER", displayName: "Player" },
  ]);
  for (const [membershipId, secret] of [
    [gmId, gmSecret],
    [playerId, playerSecret],
  ] as const) {
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  await db.insert(schema.playerAccessGrants).values({
    id: grantId,
    campaignId,
    membershipId: playerId,
    label: "Player",
    tokenHash: hashToken("access-token"),
  });
  app = Fastify();
  await app.register(cookie);
  const io = {
    in: () => ({ fetchSockets: async () => [], disconnectSockets() {} }),
    to: () => ({ emit() {} }),
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

describe("player access rotation revision", () => {
  it("rejects a stale revision after the winning rotation has committed", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/api/player-access/${grantId}/rotate`,
      headers: headers(gmSecret),
      payload: { actionId: id(), revision: 0 },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().grant.revision).toBe(1);

    const stale = await app.inject({
      method: "POST",
      url: `/api/player-access/${grantId}/rotate`,
      headers: headers(gmSecret),
      payload: { actionId: id(), revision: 0 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: "PLAYER_ACCESS_CONFLICT" });

    const [grant] = await db.select().from(schema.playerAccessGrants);
    expect(grant).toBeDefined();
    if (!grant) throw new Error("grant missing after rotation");
    expect(grant.revision).toBe(1);
    expect(
      (await db.select().from(schema.gameEvents)).map((event) => event.type),
    ).toEqual(["player_access.rotated"]);
    expect(await db.select().from(schema.sessions)).toHaveLength(1);
  });
});
