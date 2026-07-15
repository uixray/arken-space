import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import { env } from "../apps/server/src/env.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignPlayer: crypto.randomUUID(),
  character: crypto.randomUUID(),
  scene: crypto.randomUUID(),
  definition: crypto.randomUUID(),
  token: crypto.randomUUID(),
  foreignAsset: crypto.randomUUID(),
};
const secrets = { gm: "g".repeat(40), player: "p".repeat(40) };
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

beforeEach(async () => {
  database = new PGlite();
  for (const file of (
    await readdir(new URL("../packages/db/drizzle/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (
        await readFile(
          new URL(`../packages/db/drizzle/${file}`, import.meta.url),
          "utf8",
        )
      ).replaceAll("--> statement-breakpoint", ""),
    );
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "A", activeSceneId: ids.scene },
    { id: ids.foreignCampaign, name: "B" },
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
      id: ids.foreignPlayer,
      campaignId: ids.foreignCampaign,
      role: "PLAYER",
      displayName: "Foreign",
    },
  ]);
  await db.insert(schema.sessions).values([
    {
      membershipId: ids.gm,
      tokenHash: hashToken(secrets.gm),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      membershipId: ids.player,
      tokenHash: hashToken(secrets.player),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  await db.insert(schema.characters).values({
    id: ids.character,
    campaignId: ids.campaign,
    ownerMembershipId: ids.player,
    name: "Hero",
  });
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
    id: ids.foreignAsset,
    campaignId: ids.foreignCampaign,
    uploadedByMembershipId: ids.foreignPlayer,
    kind: "TOKEN",
    name: "Foreign",
    storageKey: crypto.randomUUID(),
    mimeType: "image/webp",
    sizeBytes: 1,
  });
  await db.insert(schema.tokenDefinitions).values({
    id: ids.definition,
    campaignId: ids.campaign,
    characterId: ids.character,
    name: "Hero",
  });
  await db
    .insert(schema.tokenControllers)
    .values({ tokenDefinitionId: ids.definition, membershipId: ids.player });
  await db.insert(schema.tokens).values({
    id: ids.token,
    definitionId: ids.definition,
    sceneId: ids.scene,
    name: "Hero",
    x: 0,
    y: 0,
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

describe("Pool B HTTP boundaries", () => {
  it("replaces controllers with GM auth, CAS, replay and reconnect revision", async () => {
    const playerDenied = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [],
      },
    });
    expect(playerDenied.statusCode).toBe(403);
    const duplicateIds = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [ids.player, ids.player],
      },
    });
    expect(duplicateIds.statusCode).toBe(400);
    const foreign = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [ids.foreignPlayer],
      },
    });
    expect(foreign.statusCode).toBe(400);
    const actionId = crypto.randomUUID();
    const accepted = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0, controllerMembershipIds: [] },
    });
    expect(accepted.json()).toMatchObject({
      ok: true,
      revision: 1,
      controllerMembershipIds: [],
    });
    const replay = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0, controllerMembershipIds: [] },
    });
    expect(replay.json()).toMatchObject({ duplicate: true });
    const conflict = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [ids.player],
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ revision: 1 });
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(snapshot.json().tokens[0]).toMatchObject({
      definitionRevision: 1,
      controllerMembershipIds: [],
    });
  });

  it("enforces catalog permissions, receipts, assignment snapshots and role filtering", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        kind: "SKILL",
        name: "No",
        description: "",
        data: {},
      },
    });
    expect(denied.statusCode).toBe(403);
    const createAction = crypto.randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: createAction,
        kind: "ABILITY",
        name: "Wave",
        description: "old",
        data: { power: 1 },
      },
    });
    expect(created.statusCode).toBe(201);
    const template = created.json();
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: createAction,
        kind: "ABILITY",
        name: "Ignored",
        description: "",
        data: {},
      },
    });
    expect(duplicate.json()).toMatchObject({ duplicate: true });
    const updateAction = crypto.randomUUID();
    const updatedTemplate = await app.inject({
      method: "PATCH",
      url: `/api/catalog/${template.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: updateAction,
        name: "Wave v2",
        description: "new",
        data: { power: 2 },
      },
    });
    expect(updatedTemplate.json()).toMatchObject({
      name: "Wave v2",
      revision: 1,
      data: { power: 2 },
    });
    const updateReplay = await app.inject({
      method: "PATCH",
      url: `/api/catalog/${template.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: updateAction, name: "Must not apply" },
    });
    expect(updateReplay.json()).toMatchObject({ duplicate: true });
    const assigned = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), catalogEntryId: template.id },
    });
    expect(assigned.statusCode).toBe(201);
    const entry = assigned.json();
    const playerEdit = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/catalog/${entry.id}`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), name: "Hack" },
    });
    expect(playerEdit.statusCode).toBe(403);
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/catalog/${entry.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        name: "Custom",
        description: "changed",
        data: { power: 9 },
      },
    });
    expect(edited.json()).toMatchObject({
      name: "Custom",
      data: { power: 9 },
      sourceCatalogEntryId: template.id,
    });
    const playerSnapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(playerSnapshot.json()).toMatchObject({
      catalogEntries: [],
      characters: [{ entries: [expect.objectContaining({ name: "Custom" })] }],
    });
    const events = await database.query<{ count: number }>(
      `select count(*)::int count from game_events where campaign_id='${ids.campaign}'`,
    );
    expect(events.rows[0]!.count).toBe(4);
  });

  it("rejects a foreign-campaign token asset without creating a receipt", async () => {
    const actionId = crypto.randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/api/tokens",
      headers: headers(secrets.gm),
      payload: {
        actionId,
        sceneId: ids.scene,
        assetId: ids.foreignAsset,
        name: "Bad",
        x: 0,
        y: 0,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "ASSET_NOT_FOUND" });
    const receipt = await database.query<{ count: number }>(
      `select count(*)::int count from game_events where action_id='${actionId}'`,
    );
    expect(receipt.rows[0]!.count).toBe(0);
  });
});
