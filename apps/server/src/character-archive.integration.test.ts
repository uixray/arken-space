import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { registerRoutes } from "./routes.js";
import { hashToken } from "./security.js";
import { env } from "./env.js";

/**
 * UIX-393: HTTP-level coverage for character archive/restore — the GM-only,
 * revision/CAS, idempotent lifecycle transition, and the dependent-reference
 * detach policy documented on `POST /api/characters/:id/archive` in
 * `routes.ts`. Mirrors the harness in `character-media.integration.test.ts`
 * and `tests/pool-b-http.test.ts` (full `registerRoutes` app over a fresh
 * PGlite database, migrated from `packages/db/drizzle`).
 */

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  foreignCampaign: id(),
  gm: id(),
  owner: id(),
  player: id(),
  foreignGm: id(),
  character: id(),
  foreignCharacter: id(),
  scene: id(),
  tokenAsset: id(),
  definition: id(),
  token: id(),
};
const secrets = {
  gm: "g".repeat(40),
  owner: "o".repeat(40),
  player: "p".repeat(40),
  foreignGm: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

beforeEach(async () => {
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
    { id: ids.campaign, name: "Campaign", activeSceneId: ids.scene },
    { id: ids.foreignCampaign, name: "Foreign" },
  ]);
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    {
      id: ids.owner,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Owner",
    },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Other",
    },
    {
      id: ids.foreignGm,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Foreign GM",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.owner, secrets.owner],
    [ids.player, secrets.player],
    [ids.foreignGm, secrets.foreignGm],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  await db.insert(schema.characters).values([
    {
      id: ids.character,
      campaignId: ids.campaign,
      ownerMembershipId: ids.owner,
      name: "Hero",
    },
    {
      id: ids.foreignCharacter,
      campaignId: ids.foreignCampaign,
      name: "Foreign hero",
    },
  ]);
  await db.insert(schema.scenes).values({
    id: ids.scene,
    campaignId: ids.campaign,
    name: "Map",
    grid: {
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#ffffff",
      opacity: 0.2,
    },
  });
  await db.insert(schema.assets).values({
    id: ids.tokenAsset,
    campaignId: ids.campaign,
    uploadedByMembershipId: ids.gm,
    kind: "TOKEN",
    name: "Token asset",
    storageKey: id(),
    mimeType: "image/webp",
    sizeBytes: 1,
  });
  await db.insert(schema.tokenDefinitions).values({
    id: ids.definition,
    campaignId: ids.campaign,
    characterId: ids.character,
    name: "Hero token",
  });
  await db.insert(schema.tokens).values({
    id: ids.token,
    definitionId: ids.definition,
    sceneId: ids.scene,
    characterId: ids.character,
    name: "Hero",
    x: 0,
    y: 0,
  });
  await db
    .insert(schema.characterControllers)
    .values({ characterId: ids.character, membershipId: ids.player });
  await db.insert(schema.invites).values({
    campaignId: ids.campaign,
    characterId: ids.character,
    label: "Join as Hero",
    tokenHash: hashToken("invite-secret"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  await db.insert(schema.characterMedia).values({
    campaignId: ids.campaign,
    characterId: ids.character,
    assetId: ids.tokenAsset,
    category: "CHARACTER_ART",
    uploadedByMembershipId: ids.gm,
  });
  await db.insert(schema.characterCatalogEntries).values({
    characterId: ids.character,
    kind: "SKILL",
    name: "Stealth",
  });
  // A DB trigger (packages/db/drizzle/0017_chat_threads.sql) auto-creates
  // ROLLS/STORY/TABLE threads whenever a campaign row is inserted — reuse
  // the auto-created TABLE thread rather than inserting a duplicate.
  const threadRows = await db
    .select()
    .from(schema.chatThreads)
    .where(eq(schema.chatThreads.campaignId, ids.campaign));
  const tableThread = threadRows.find((row) => row.stream === "TABLE");
  if (!tableThread) throw new Error("TABLE thread not auto-created");
  await db.insert(schema.chatMessages).values({
    campaignId: ids.campaign,
    membershipId: ids.owner,
    characterId: ids.character,
    threadId: tableThread.id,
    body: "Historical roleplay line",
  });

  app = Fastify();
  await app.register(cookie);
  const io = {
    in: () => ({ fetchSockets: async () => [] }),
    to: () => ({ emit() {} }),
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await database.close();
});

async function archive(
  secret: string,
  characterId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: `/api/characters/${characterId}/archive`,
    headers: headers(secret),
    payload: { actionId: id(), revision: 0, ...overrides },
  });
}
async function restore(
  secret: string,
  characterId: string,
  revision: number,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: `/api/characters/${characterId}/restore`,
    headers: headers(secret),
    payload: { actionId: id(), revision, ...overrides },
  });
}

describe("character archive HTTP", () => {
  it("lets the GM archive an ACTIVE character", async () => {
    const res = await archive(secrets.gm, ids.character);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: ids.character,
      lifecycle: "ARCHIVED",
      revision: 1,
    });
    expect(res.json().archivedAt).not.toBeNull();
    expect(res.json().archivedByMembershipId).toBe(ids.gm);
  });

  it("removes the archived character from the gameplay snapshot", async () => {
    await archive(secrets.gm, ids.character);
    const snapshot = (
      await app.inject({
        method: "GET",
        url: "/api/bootstrap",
        headers: headers(secrets.gm),
      })
    ).json();
    expect(
      snapshot.characters.some((c: { id: string }) => c.id === ids.character),
    ).toBe(false);
  });

  it("forbids a PLAYER from archiving, including the character's own owner", async () => {
    const asOther = await archive(secrets.player, ids.character);
    expect(asOther.statusCode).toBe(403);
    const asOwner = await archive(secrets.owner, ids.character);
    expect(asOwner.statusCode).toBe(403);
  });

  it("404s for a character in another campaign instead of leaking existence", async () => {
    const res = await archive(secrets.gm, ids.foreignCharacter);
    expect(res.statusCode).toBe(404);
    // The foreign campaign's own GM can't reach it through this campaign's
    // session either way, but confirm the reverse direction 404s too.
    const reverse = await archive(secrets.foreignGm, ids.character);
    expect(reverse.statusCode).toBe(404);
  });

  it("409s on a stale revision and does not mutate the row", async () => {
    const res = await archive(secrets.gm, ids.character, { revision: 5 });
    expect(res.statusCode).toBe(409);
    const [row] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    expect(row?.lifecycle).toBe("ACTIVE");
  });

  it("is idempotent on a duplicate actionId", async () => {
    const actionId = id();
    const first = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/archive`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0 },
    });
    expect(first.statusCode).toBe(200);
    const retry = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/archive`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0 },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });
  });

  it("404s archiving an already-ARCHIVED character (not eligible)", async () => {
    const first = await archive(secrets.gm, ids.character);
    expect(first.statusCode).toBe(200);
    const second = await archive(secrets.gm, ids.character, { revision: 1 });
    expect(second.statusCode).toBe(404);
  });

  it("detaches live references but keeps historical ones intact (AC dependent-reference handling)", async () => {
    const res = await archive(secrets.gm, ids.character);
    expect(res.statusCode).toBe(200);

    const [definition] = await db
      .select()
      .from(schema.tokenDefinitions)
      .where(eq(schema.tokenDefinitions.id, ids.definition));
    expect(definition?.characterId).toBeNull();

    const [token] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.token));
    expect(token?.characterId).toBeNull();

    const controllers = await db
      .select()
      .from(schema.characterControllers)
      .where(eq(schema.characterControllers.characterId, ids.character));
    expect(controllers).toHaveLength(0);

    const invites = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.characterId, ids.character));
    expect(invites).toHaveLength(1);
    expect(invites[0]?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(invites[0]?.claimedAt).toBeNull();

    // Historical / sheet-content references survive untouched.
    const media = await db
      .select()
      .from(schema.characterMedia)
      .where(eq(schema.characterMedia.characterId, ids.character));
    expect(media).toHaveLength(1);

    const entries = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.characterId, ids.character));
    expect(entries).toHaveLength(1);

    const messages = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.characterId, ids.character));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toBe("Historical roleplay line");

    const [character] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    expect(character?.ownerMembershipId).toBe(ids.owner);
  });
});

describe("character restore HTTP", () => {
  it("lets the GM restore an ARCHIVED character back to ACTIVE", async () => {
    await archive(secrets.gm, ids.character);
    const res = await restore(secrets.gm, ids.character, 1);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: ids.character,
      lifecycle: "ACTIVE",
      revision: 2,
    });
    expect(res.json().archivedAt).toBeNull();
    expect(res.json().archivedByMembershipId).toBeNull();
  });

  it("reappears in the gameplay snapshot after restore, without reinstating detached links", async () => {
    await archive(secrets.gm, ids.character);
    await restore(secrets.gm, ids.character, 1);
    const snapshot = (
      await app.inject({
        method: "GET",
        url: "/api/bootstrap",
        headers: headers(secrets.gm),
      })
    ).json();
    expect(
      snapshot.characters.some((c: { id: string }) => c.id === ids.character),
    ).toBe(true);

    const [definition] = await db
      .select()
      .from(schema.tokenDefinitions)
      .where(eq(schema.tokenDefinitions.id, ids.definition));
    expect(definition?.characterId).toBeNull();
    const controllers = await db
      .select()
      .from(schema.characterControllers)
      .where(eq(schema.characterControllers.characterId, ids.character));
    expect(controllers).toHaveLength(0);
  });

  it("forbids a PLAYER from restoring", async () => {
    await archive(secrets.gm, ids.character);
    const res = await restore(secrets.owner, ids.character, 1);
    expect(res.statusCode).toBe(403);
  });

  it("404s restoring a character that is not archived", async () => {
    const res = await restore(secrets.gm, ids.character, 0);
    expect(res.statusCode).toBe(404);
  });

  it("404s across campaigns", async () => {
    const res = await restore(secrets.gm, ids.foreignCharacter, 0);
    expect(res.statusCode).toBe(404);
  });

  it("409s on a stale revision", async () => {
    await archive(secrets.gm, ids.character);
    const res = await restore(secrets.gm, ids.character, 0);
    expect(res.statusCode).toBe(409);
  });

  it("is idempotent on a duplicate actionId", async () => {
    await archive(secrets.gm, ids.character);
    const actionId = id();
    const first = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/restore`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 1 },
    });
    expect(first.statusCode).toBe(200);
    const retry = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/restore`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 1 },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });
  });
});

describe("GET /api/characters/archived", () => {
  it("is GM-only and lists only this campaign's archived characters", async () => {
    await archive(secrets.gm, ids.character);
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/characters/archived",
      headers: headers(secrets.owner),
    });
    expect(forbidden.statusCode).toBe(403);

    const list = await app.inject({
      method: "GET",
      url: "/api/characters/archived",
      headers: headers(secrets.gm),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: ids.character, lifecycle: "ARCHIVED" });

    const foreignList = await app.inject({
      method: "GET",
      url: "/api/characters/archived",
      headers: headers(secrets.foreignGm),
    });
    expect(foreignList.json()).toEqual([]);
  });
});
