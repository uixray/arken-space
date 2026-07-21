import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { env } from "../apps/server/src/env.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import { ensureSeed } from "../apps/server/src/seed.js";

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let disconnectedRooms: string[];

async function createApp() {
  app = Fastify();
  await app.register(cookie);
  registerRoutes(
    app,
    db as never,
    {
      in(room: string) {
        return {
          fetchSockets: async () => [],
          disconnectSockets: () => disconnectedRooms.push(room),
        };
      },
      to: () => ({ emit() {} }),
    } as never,
  );
  await app.ready();
}

beforeEach(async () => {
  database = new PGlite();
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  db = drizzle(database, { schema });
  disconnectedRooms = [];
  await ensureSeed(db as never);
  await createApp();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

describe("GM access rotation", () => {
  it("rotates the DB credential, revokes every GM session, and persists over restart", async () => {
    const [campaign] = await db.select().from(schema.campaigns).limit(1);
    const [gm] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.role, "GM"))
      .limit(1);
    expect(campaign).toBeDefined();
    expect(gm).toBeDefined();
    if (!campaign || !gm) throw new Error("seed failed");

    const playerId = crypto.randomUUID();
    const secondGmId = crypto.randomUUID();
    const playerSession = "p".repeat(40);
    const oldGmSession = "o".repeat(40);
    const secondGmSession = "s".repeat(40);
    const newToken = "n".repeat(40);
    await db.insert(schema.memberships).values([
      {
        id: playerId,
        campaignId: campaign.id,
        role: "PLAYER",
        displayName: "Player",
      },
      {
        id: secondGmId,
        campaignId: campaign.id,
        role: "GM",
        displayName: "Second GM",
      },
    ]);
    await db.insert(schema.sessions).values([
      {
        membershipId: playerId,
        tokenHash: hashToken(playerSession),
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        membershipId: gm.id,
        tokenHash: hashToken(oldGmSession),
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        membershipId: secondGmId,
        tokenHash: hashToken(secondGmSession),
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/gm",
      payload: { token: env.GM_ACCESS_TOKEN },
    });
    expect(oldLogin.statusCode, oldLogin.body).toBe(200);

    const playerForbidden = await app.inject({
      method: "POST",
      url: "/api/gm-access/rotate",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${playerSession}` },
      payload: { actionId: crypto.randomUUID(), token: newToken },
    });
    expect(playerForbidden.statusCode, playerForbidden.body).toBe(403);
    expect(playerForbidden.json()).toEqual({ error: "GM_REQUIRED" });

    const rotated = await app.inject({
      method: "POST",
      url: "/api/gm-access/rotate",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${oldGmSession}` },
      payload: { actionId: crypto.randomUUID(), token: newToken },
    });
    expect(rotated.statusCode, rotated.body).toBe(200);
    expect(rotated.json()).toEqual({ ok: true });

    for (const session of [oldGmSession, secondGmSession]) {
      const rejected = await app.inject({
        method: "GET",
        url: "/api/bootstrap",
        headers: { cookie: `${env.SESSION_COOKIE_NAME}=${session}` },
      });
      expect(rejected.statusCode).toBe(401);
    }
    expect(disconnectedRooms).toEqual(
      expect.arrayContaining([`member:${gm.id}`, `member:${secondGmId}`]),
    );

    const oldTokenRejected = await app.inject({
      method: "POST",
      url: "/api/auth/gm",
      payload: { token: env.GM_ACCESS_TOKEN },
    });
    expect(oldTokenRejected.statusCode).toBe(403);
    const newTokenAccepted = await app.inject({
      method: "POST",
      url: "/api/auth/gm",
      payload: { token: newToken },
    });
    expect(newTokenAccepted.statusCode, newTokenAccepted.body).toBe(200);

    await app.close();
    await ensureSeed(db as never);
    await createApp();

    const oldAfterRestart = await app.inject({
      method: "POST",
      url: "/api/auth/gm",
      payload: { token: env.GM_ACCESS_TOKEN },
    });
    expect(oldAfterRestart.statusCode).toBe(403);
    const newAfterRestart = await app.inject({
      method: "POST",
      url: "/api/auth/gm",
      payload: { token: newToken },
    });
    expect(newAfterRestart.statusCode, newAfterRestart.body).toBe(200);
  });
});

describe("starter token placement", () => {
  it("reuses the starter placement for repeated setup actions", async () => {
    const [campaign] = await db.select().from(schema.campaigns).limit(1);
    const [gm] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.role, "GM"))
      .limit(1);
    if (!campaign || !gm || !campaign.activeSceneId)
      throw new Error("seed failed");

    const sessionToken = "g".repeat(40);
    const [character] = await db
      .insert(schema.characters)
      .values({ campaignId: campaign.id, name: "Ed" })
      .returning();
    if (!character) throw new Error("character create failed");
    await db.insert(schema.sessions).values({
      membershipId: gm.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const headers = { cookie: `${env.SESSION_COOKIE_NAME}=${sessionToken}` };
    const payload = {
      sceneId: campaign.activeSceneId,
      characterId: character.id,
      name: character.name,
      x: 128,
      y: 128,
      width: 64,
      height: 64,
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/tokens",
      headers,
      payload: { ...payload, actionId: crypto.randomUUID() },
    });
    expect(first.statusCode, first.body).toBe(201);
    const repeatedSetup = await app.inject({
      method: "POST",
      url: "/api/tokens",
      headers,
      payload: { ...payload, actionId: crypto.randomUUID() },
    });
    expect(repeatedSetup.statusCode, repeatedSetup.body).toBe(200);
    expect(repeatedSetup.json().id).toBe(first.json().id);

    const repeatedPlacement = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${first.json().definitionId}/placements`,
      headers,
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: campaign.activeSceneId,
        x: payload.x,
        y: payload.y,
      },
    });
    expect(repeatedPlacement.statusCode, repeatedPlacement.body).toBe(200);
    expect(repeatedPlacement.json().id).toBe(first.json().id);

    const placed = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.characterId, character.id));
    expect(placed).toHaveLength(1);
  });
});
