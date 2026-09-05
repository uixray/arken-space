import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, desc, eq } from "drizzle-orm";
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
  foreignCharacter: crypto.randomUUID(),
  character: crypto.randomUUID(),
  scene: crypto.randomUUID(),
  definition: crypto.randomUUID(),
  token: crypto.randomUUID(),
  foreignAsset: crypto.randomUUID(),
  mapAsset: crypto.randomUUID(),
  tokenAsset: crypto.randomUUID(),
  foreignMapAsset: crypto.randomUUID(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  foreignPlayer: "f".repeat(40),
};
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
    {
      membershipId: ids.foreignPlayer,
      tokenHash: hashToken(secrets.foreignPlayer),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  await db.insert(schema.characters).values({
    id: ids.character,
    campaignId: ids.campaign,
    ownerMembershipId: ids.player,
    name: "Hero",
    stats: {
      strength: 2,
      agility: 3,
      endurance: 0,
      vitality: 0,
      knowledge: 0,
      intelligence: 0,
      willpower: 0,
      charisma: 0,
    },
  });
  await db.insert(schema.characters).values({
    id: ids.foreignCharacter,
    campaignId: ids.foreignCampaign,
    ownerMembershipId: ids.foreignPlayer,
    name: "Foreign Hero",
    stats: {
      strength: 0,
      agility: 0,
      endurance: 0,
      vitality: 0,
      knowledge: 0,
      intelligence: 0,
      willpower: 0,
      charisma: 0,
    },
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
  await db.insert(schema.assets).values([
    {
      id: ids.mapAsset,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "MAP",
      name: "Map asset",
      storageKey: crypto.randomUUID(),
      mimeType: "image/webp",
      sizeBytes: 1,
      width: 1600,
      height: 900,
    },
    {
      id: ids.tokenAsset,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "TOKEN",
      name: "Token asset",
      storageKey: crypto.randomUUID(),
      mimeType: "image/webp",
      sizeBytes: 1,
    },
    {
      id: ids.foreignMapAsset,
      campaignId: ids.foreignCampaign,
      uploadedByMembershipId: ids.foreignPlayer,
      kind: "MAP",
      name: "Foreign map",
      storageKey: crypto.randomUUID(),
      mimeType: "image/webp",
      sizeBytes: 1,
    },
  ]);
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
  it("renames a campaign with GM-only CAS and idempotent replay", async () => {
    const denied = await app.inject({
      method: "PATCH",
      url: "/api/campaign",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        name: "Forbidden",
      },
    });
    expect(denied.statusCode).toBe(403);

    const actionId = crypto.randomUUID();
    const renamed = await app.inject({
      method: "PATCH",
      url: "/api/campaign",
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0, name: "  New campaign  " },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ name: "New campaign", revision: 1 });

    const replay = await app.inject({
      method: "PATCH",
      url: "/api/campaign",
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0, name: "New campaign" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ name: "New campaign", revision: 1 });

    const stale = await app.inject({
      method: "PATCH",
      url: "/api/campaign",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        name: "Stale rename",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: "CAMPAIGN_CONFLICT", revision: 1 });

    const bootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(bootstrap.json().campaign).toMatchObject({
      name: "New campaign",
      revision: 1,
    });

    const events = await db
      .select()
      .from(schema.gameEvents)
      .where(
        and(
          eq(schema.gameEvents.campaignId, ids.campaign),
          eq(schema.gameEvents.actionId, actionId),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "campaign.renamed",
      entityRevision: 1,
    });
  });

  it("creates and updates scene metadata with MAP validation, CAS and useful replay responses", async () => {
    const playerDenied = await app.inject({
      method: "POST",
      url: "/api/scenes",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), name: "Forbidden" },
    });
    expect(playerDenied.statusCode).toBe(403);

    for (const mapAssetId of [ids.tokenAsset, ids.foreignMapAsset]) {
      const rejected = await app.inject({
        method: "POST",
        url: "/api/scenes",
        headers: headers(secrets.gm),
        payload: {
          actionId: crypto.randomUUID(),
          name: "Invalid map",
          mapAssetId,
        },
      });
      expect(rejected.statusCode).toBe(
        mapAssetId === ids.tokenAsset ? 422 : 404,
      );
    }

    const createActionId = crypto.randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/api/scenes",
      headers: headers(secrets.gm),
      payload: {
        actionId: createActionId,
        name: "Forest",
        mapAssetId: ids.mapAsset,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: "Forest",
      mapAssetId: ids.mapAsset,
      revision: 0,
      active: false,
      backgroundFrame: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    const createdSceneId = created.json().id as string;

    const createReplay = await app.inject({
      method: "POST",
      url: "/api/scenes",
      headers: headers(secrets.gm),
      payload: {
        actionId: createActionId,
        name: "Ignored replay payload",
      },
    });
    expect(createReplay.statusCode).toBe(200);
    expect(createReplay.json()).toMatchObject({
      id: createdSceneId,
      name: "Forest",
      mapAssetId: ids.mapAsset,
      revision: 0,
    });

    const missingRevision = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${createdSceneId}`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), name: "No CAS" },
    });
    expect(missingRevision.statusCode).toBe(400);

    const canvasFieldRejected = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${createdSceneId}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        width: 4096,
      },
    });
    expect(canvasFieldRejected.statusCode).toBe(400);

    const nonMapUpdate = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${createdSceneId}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        mapAssetId: ids.tokenAsset,
      },
    });
    expect(nonMapUpdate.statusCode).toBe(422);

    const foreignMapUpdate = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${createdSceneId}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        mapAssetId: ids.foreignMapAsset,
      },
    });
    expect(foreignMapUpdate.statusCode).toBe(404);

    const updateActionId = crypto.randomUUID();
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${createdSceneId}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: updateActionId,
        revision: 0,
        name: "Deep forest",
        mapAssetId: null,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id: createdSceneId,
      name: "Deep forest",
      mapAssetId: null,
      revision: 1,
      backgroundFrame: { x: 0, y: 0, width: 1920, height: 1080 },
    });

    const updateReplay = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${createdSceneId}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: updateActionId,
        revision: 0,
        name: "Ignored replay update",
      },
    });
    expect(updateReplay.statusCode).toBe(200);
    expect(updateReplay.json()).toMatchObject({
      id: createdSceneId,
      name: "Deep forest",
      revision: 1,
    });

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${createdSceneId}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        name: "Stale",
      },
    });
    expect(stale.statusCode).toBe(409);

    const playerUpdateDenied = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${createdSceneId}`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 1,
        name: "Forbidden",
      },
    });
    expect(playerUpdateDenied.statusCode).toBe(403);
  });

  it("creates reusable token definitions with dimensions and controller permissions", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/token-definitions",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        name: "Denied",
        defaultWidth: 80,
        defaultHeight: 96,
      },
    });
    expect(denied.statusCode).toBe(403);

    const actionId = crypto.randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/api/token-definitions",
      headers: headers(secrets.gm),
      payload: {
        actionId,
        name: "Scout",
        characterId: ids.character,
        defaultWidth: 80,
        defaultHeight: 96,
        controllerMembershipIds: [ids.player],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: "Scout",
      characterId: ids.character,
      defaultWidth: 80,
      defaultHeight: 96,
      controllerMembershipIds: [ids.player],
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/token-definitions",
      headers: headers(secrets.gm),
      payload: { actionId, name: "Changed" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(created.json().id);
  });

  it("cascades a definition image only to its placed tokens", async () => {
    const otherDefinitionId = crypto.randomUUID();
    const otherTokenId = crypto.randomUUID();
    await db.insert(schema.tokenDefinitions).values({
      id: otherDefinitionId,
      campaignId: ids.campaign,
      name: "Other",
    });
    await db.insert(schema.tokens).values({
      id: otherTokenId,
      definitionId: otherDefinitionId,
      sceneId: ids.scene,
      name: "Other",
      x: 64,
      y: 64,
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/token-definitions/${ids.definition}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        defaultAssetId: ids.tokenAsset,
      },
    });

    expect(response.statusCode).toBe(200);
    const [definition] = await db
      .select()
      .from(schema.tokenDefinitions)
      .where(eq(schema.tokenDefinitions.id, ids.definition));
    const placed = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.definitionId, ids.definition));
    const [otherToken] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, otherTokenId));
    expect(definition?.defaultAssetId).toBe(ids.tokenAsset);
    expect(placed).toEqual([
      expect.objectContaining({ id: ids.token, assetId: ids.tokenAsset }),
    ]);
    expect(otherToken?.assetId).toBeNull();
  });

  it("filters the palette, exposes own unassigned image assets and places definitions idempotently", async () => {
    const ownToken = crypto.randomUUID();
    const ownPortrait = crypto.randomUUID();
    const ownAudio = crypto.randomUUID();
    await db.insert(schema.assets).values([
      {
        id: ownToken,
        campaignId: ids.campaign,
        uploadedByMembershipId: ids.player,
        kind: "TOKEN",
        name: "Own token",
        storageKey: crypto.randomUUID(),
        mimeType: "image/webp",
        sizeBytes: 1,
      },
      {
        id: ownPortrait,
        campaignId: ids.campaign,
        uploadedByMembershipId: ids.player,
        kind: "PORTRAIT",
        name: "Own portrait",
        storageKey: crypto.randomUUID(),
        mimeType: "image/webp",
        sizeBytes: 1,
      },
      {
        id: ownAudio,
        campaignId: ids.campaign,
        uploadedByMembershipId: ids.player,
        kind: "AUDIO",
        name: "Hidden audio",
        storageKey: crypto.randomUUID(),
        mimeType: "audio/ogg",
        sizeBytes: 1,
      },
    ]);
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(snapshot.json().tokenDefinitions).toEqual([
      expect.objectContaining({ id: ids.definition }),
    ]);
    expect(
      snapshot.json().assets.map((asset: { id: string }) => asset.id),
    ).toEqual(expect.arrayContaining([ownToken, ownPortrait]));
    expect(snapshot.json().assets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ownAudio })]),
    );

    const actionId = crypto.randomUUID();
    const placed = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${ids.definition}/placements`,
      headers: headers(secrets.player),
      payload: { actionId, x: 93, y: 93 },
    });
    expect(placed.statusCode).toBe(201);
    expect(placed.json()).toMatchObject({
      definitionId: ids.definition,
      layer: "PLAYER",
      x: 64,
      y: 64,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${ids.definition}/placements`,
      headers: headers(secrets.player),
      payload: { actionId, x: 512, y: 512 },
    });
    expect(replay.json().id).toBe(placed.json().id);
  });

  it("UIX-621 preserves client placement UUIDs and refuses cross-campaign collisions without overwrite", async () => {
    const foreignScene = crypto.randomUUID();
    const foreignDefinition = crypto.randomUUID();
    const foreignToken = crypto.randomUUID();
    await db.insert(schema.scenes).values({
      id: foreignScene,
      campaignId: ids.foreignCampaign,
      name: "Foreign scene",
      grid: {
        enabled: true,
        size: 64,
        offsetX: 0,
        offsetY: 0,
        color: "#ffffff",
        opacity: 0.2,
      },
    });
    await db.insert(schema.tokenDefinitions).values({
      id: foreignDefinition,
      campaignId: ids.foreignCampaign,
      name: "Foreign definition",
    });
    await db.insert(schema.tokens).values({
      id: foreignToken,
      definitionId: foreignDefinition,
      sceneId: foreignScene,
      name: "Do not overwrite",
      x: 17,
      y: 29,
    });
    for (const url of [
      "/api/tokens",
      `/api/token-definitions/${ids.definition}/placements`,
    ]) {
      const placementId = crypto.randomUUID();
      const payload = {
        actionId: crypto.randomUUID(),
        placementId,
        sceneId: ids.scene,
        name: "Correlated token",
        x: 768,
        y: 768,
      };
      const created = await app.inject({
        method: "POST",
        url,
        headers: headers(secrets.gm),
        payload,
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().id).toBe(placementId);
      const collision = await app.inject({
        method: "POST",
        url,
        headers: headers(secrets.gm),
        payload: {
          ...payload,
          actionId: crypto.randomUUID(),
          placementId: foreignToken,
        },
      });
      expect(collision.statusCode).toBe(409);
      expect(collision.json()).toMatchObject({
        error: "PLACEMENT_ID_CONFLICT",
      });
      const [unchanged] = await db
        .select()
        .from(schema.tokens)
        .where(eq(schema.tokens.id, foreignToken));
      expect(unchanged).toMatchObject({
        definitionId: foreignDefinition,
        sceneId: foreignScene,
        name: "Do not overwrite",
        x: 17,
        y: 29,
      });
      const invalid = await app.inject({
        method: "POST",
        url,
        headers: headers(secrets.gm),
        payload: {
          ...payload,
          actionId: crypto.randomUUID(),
          placementId: "not-a-uuid",
        },
      });
      // This route fixture deliberately omits the production Zod error mapper.
      expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it("keeps destructive definition deletion distinct and records non-undoable cascade semantics", async () => {
    const denied = await app.inject({
      method: "DELETE",
      url: `/api/token-definitions/${ids.definition}`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), revision: 0 },
    });
    expect(denied.statusCode).toBe(403);
    const drawing = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        points: [1, 1, 10, 10],
        color: "#00ff00",
      },
    });
    expect(drawing.statusCode).toBe(201);
    const layer = await app.inject({
      method: "PATCH",
      url: `/api/tokens/${ids.token}/layer`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        layer: "GM",
      },
    });
    expect(layer.statusCode).toBe(200);
    await db.insert(schema.actionJournal).values({
      campaignId: ids.campaign,
      sceneId: ids.scene,
      actorMembershipId: ids.gm,
      actionId: crypto.randomUUID(),
      scope: "GM",
      type: "TOKEN_MOVE",
      targetType: "TOKEN",
      targetId: ids.token,
      before: { x: 0, y: 0, z: 0, levelId: null },
      after: { x: 64, y: 64, z: 0, levelId: null },
      beforeRevision: 1,
      afterRevision: 2,
      currentRevision: 2,
    });
    const tokenDelete = await app.inject({
      method: "DELETE",
      url: `/api/tokens/${ids.token}`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), revision: 1 },
    });
    expect(tokenDelete.statusCode).toBe(200);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/token-definitions/${ids.definition}`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), revision: 0 },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await db.select().from(schema.tokens)).toHaveLength(0);
    const tokenHistory = await db
      .select()
      .from(schema.actionJournal)
      .where(eq(schema.actionJournal.targetId, ids.token));
    expect(tokenHistory).toHaveLength(3);
    expect(tokenHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "TOKEN_LAYER", status: "INVALIDATED" }),
        expect.objectContaining({ type: "TOKEN_MOVE", status: "INVALIDATED" }),
        expect.objectContaining({
          type: "TOKEN_DELETE",
          status: "INVALIDATED",
        }),
      ]),
    );
    const undo = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json()).toMatchObject({ status: "UNDONE" });
    const drawingHistory = await db
      .select()
      .from(schema.actionJournal)
      .where(eq(schema.actionJournal.targetId, drawing.json().id));
    expect(drawingHistory).toEqual([
      expect.objectContaining({ type: "DRAWING_CREATE", status: "UNDONE" }),
    ]);
    const events = await db.select().from(schema.gameEvents);
    expect(
      events.find((event) => event.type === "token_definition.deleted"),
    ).toMatchObject({
      type: "token_definition.deleted",
      payload: expect.objectContaining({
        placementsRemoved: 0,
        sceneIds: [],
        undoable: false,
      }),
    });
  });

  it("keeps token definition sizing GM-only", async () => {
    const denied = await app.inject({
      method: "PATCH",
      url: `/api/token-definitions/${ids.definition}`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        defaultWidth: 128,
        defaultHeight: 128,
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: "TOKEN_SIZE_FORBIDDEN" });
    const [definition] = await db
      .select()
      .from(schema.tokenDefinitions)
      .where(eq(schema.tokenDefinitions.id, ids.definition));
    expect(definition).toMatchObject({ defaultWidth: 64, defaultHeight: 64 });
  });

  it("audits locked cascade counts and scenes and replays definition deletion idempotently", async () => {
    const actionId = crypto.randomUUID();
    await db.insert(schema.actionJournal).values({
      campaignId: ids.campaign,
      sceneId: ids.scene,
      actorMembershipId: ids.gm,
      actionId: crypto.randomUUID(),
      type: "TOKEN_MOVE",
      targetType: "TOKEN",
      targetId: ids.token,
      before: { x: 0, y: 0 },
      after: { x: 64, y: 64 },
      beforeRevision: 0,
      afterRevision: 1,
      currentRevision: 1,
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/token-definitions/${ids.definition}`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0 },
    });
    expect(deleted.statusCode).toBe(204);
    const [event] = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, actionId));
    expect(event).toMatchObject({
      payload: expect.objectContaining({
        placementsRemoved: 1,
        sceneIds: [ids.scene],
      }),
    });
    const [moveHistory] = await db
      .select()
      .from(schema.actionJournal)
      .where(eq(schema.actionJournal.targetId, ids.token));
    expect(moveHistory).toMatchObject({
      type: "TOKEN_MOVE",
      status: "INVALIDATED",
    });
    const replay = await app.inject({
      method: "DELETE",
      url: `/api/token-definitions/${ids.definition}`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ duplicate: true });
  });

  it("serializes placement against destructive definition deletion", async () => {
    const deleteAction = crypto.randomUUID();
    const [placement, deletion] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/token-definitions/${ids.definition}/placements`,
        headers: headers(secrets.player),
        payload: { actionId: crypto.randomUUID() },
      }),
      app.inject({
        method: "DELETE",
        url: `/api/token-definitions/${ids.definition}`,
        headers: headers(secrets.gm),
        payload: { actionId: deleteAction, revision: 0 },
      }),
    ]);
    expect(deletion.statusCode).toBe(204);
    expect([201, 404, 409]).toContain(placement.statusCode);
    expect(await db.select().from(schema.tokenDefinitions)).toHaveLength(0);
    expect(await db.select().from(schema.tokens)).toHaveLength(0);
    const [event] = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, deleteAction));
    expect(event?.payload).toEqual(
      expect.objectContaining({
        placementsRemoved: placement.statusCode === 201 ? 2 : 1,
        sceneIds: [ids.scene],
      }),
    );
  });

  it("renames membership, character and scene with role checks and revision CAS", async () => {
    const [memberBefore] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, ids.player));
    expect(memberBefore).toBeDefined();
    const memberRename = await app.inject({
      method: "PATCH",
      url: `/api/memberships/${ids.player}/name`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: memberBefore!.revision,
        name: "Ranger",
      },
    });
    expect(memberRename.json()).toMatchObject({
      displayName: "Ranger",
      revision: memberBefore!.revision + 1,
    });
    const staleMember = await app.inject({
      method: "PATCH",
      url: `/api/memberships/${ids.player}/name`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), revision: 0, name: "Stale" },
    });
    expect(staleMember.statusCode).toBe(409);

    const characterRename = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        name: "Elris",
      },
    });
    expect(characterRename.json()).toMatchObject({
      name: "Elris",
      revision: 1,
    });

    const playerSceneDenied = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${ids.scene}`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        name: "Forbidden",
      },
    });
    expect(playerSceneDenied.statusCode).toBe(403);
    const sceneRename = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${ids.scene}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        name: "Moonlit ruins",
      },
    });
    expect(sceneRename.json()).toMatchObject({
      name: "Moonlit ruins",
      revision: 1,
    });
  });

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

  it("persists owner characteristic patches without replacing other stats", async () => {
    const strength = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        stats: { strength: 4 },
      },
    });
    expect(strength.statusCode).toBe(200);
    expect(strength.json().stats).toMatchObject({ strength: 4 });

    const agility = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        stats: { agility: 3 },
      },
    });
    expect(agility.statusCode).toBe(200);
    expect(agility.json().stats).toMatchObject({ strength: 4, agility: 3 });

    const foreign = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.foreignCharacter}`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        stats: { strength: 99 },
      },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("keeps inventory patches owner-scoped, revision-safe, and private in snapshots", async () => {
    const otherPlayerId = crypto.randomUUID();
    const otherCharacterId = crypto.randomUUID();
    const otherSecret = "o".repeat(40);
    await db.insert(schema.memberships).values({
      id: otherPlayerId,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Other player",
    });
    await db.insert(schema.sessions).values({
      membershipId: otherPlayerId,
      tokenHash: hashToken(otherSecret),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(schema.characters).values({
      id: otherCharacterId,
      campaignId: ids.campaign,
      ownerMembershipId: otherPlayerId,
      name: "Other hero",
      inventory: ["Private other inventory"],
    });

    const ownerSave = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        inventory: ["Rope", "Torch"],
      },
    });
    expect(ownerSave.statusCode, ownerSave.body).toBe(200);
    expect(ownerSave.json()).toMatchObject({
      inventory: ["Rope", "Torch"],
      revision: 1,
    });

    const staleOwnerSave = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        inventory: ["Stale item"],
      },
    });
    expect(staleOwnerSave.statusCode).toBe(409);
    expect(staleOwnerSave.json()).toEqual({ error: "CHARACTER_CONFLICT" });

    const otherPlayerSave = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}`,
      headers: headers(otherSecret),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 1,
        inventory: ["Stolen item"],
      },
    });
    expect(otherPlayerSave.statusCode).toBe(403);
    expect(otherPlayerSave.json()).toEqual({ error: "CHARACTER_FORBIDDEN" });

    const gmSave = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 1,
        inventory: ["GM-issued lantern"],
      },
    });
    expect(gmSave.statusCode, gmSave.body).toBe(200);
    expect(gmSave.json()).toMatchObject({
      inventory: ["GM-issued lantern"],
      revision: 2,
    });

    const ownerSnapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(ownerSnapshot.statusCode).toBe(200);
    expect(ownerSnapshot.json().characters).toEqual([
      expect.objectContaining({
        id: ids.character,
        inventory: ["GM-issued lantern"],
        revision: 2,
      }),
    ]);
    expect(ownerSnapshot.body).not.toContain("Private other inventory");

    const gmSnapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(gmSnapshot.statusCode).toBe(200);
    expect(gmSnapshot.json().characters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids.character,
          inventory: ["GM-issued lantern"],
        }),
        expect.objectContaining({
          id: otherCharacterId,
          inventory: ["Private other inventory"],
        }),
      ]),
    );
  });

  it("normalizes legacy spirit formulas to willpower", async () => {
    const roll = await app.inject({
      method: "POST",
      url: "/api/dice",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        formula: "1d20 + spirit",
        label: "Legacy resilience",
        visibility: "PUBLIC",
        characterId: ids.character,
      },
    });
    expect(roll.statusCode).toBe(201);
    expect(roll.json()).toMatchObject({
      characterId: ids.character,
      kind: "DICE",
      dice: expect.objectContaining({ label: "Legacy resilience" }),
    });
  });

  it("resolves requested d20 advantage and disadvantage on the server", async () => {
    const advantage = await app.inject({
      method: "POST",
      url: "/api/dice",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        formula: "1d20 + agility",
        rollMode: "ADVANTAGE",
        visibility: "PUBLIC",
        characterId: ids.character,
      },
    });
    expect(advantage.statusCode).toBe(201);
    const advantagePayload = advantage.json();
    expect(advantagePayload.dice).toMatchObject({
      rollMode: "ADVANTAGE",
      poolTotals: [expect.any(Number), expect.any(Number)],
      selectedPool: expect.any(Number),
      terms: [expect.objectContaining({ notation: "1d20" })],
    });
    expect([0, 1]).toContain(advantagePayload.dice.selectedPool);
    expect(advantagePayload.body).toContain("преимущество");
    expect(advantagePayload.dice.terms[0].rolls).toHaveLength(1);

    const disadvantage = await app.inject({
      method: "POST",
      url: "/api/dice",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        formula: "1d20 + agility",
        rollMode: "DISADVANTAGE",
        visibility: "GM_ONLY",
        characterId: ids.character,
      },
    });
    expect(disadvantage.statusCode).toBe(201);
    expect(disadvantage.json().dice).toMatchObject({
      rollMode: "DISADVANTAGE",
      poolTotals: [expect.any(Number), expect.any(Number)],
      selectedPool: expect.any(Number),
      terms: [expect.objectContaining({ notation: "1d20" })],
    });
    expect([0, 1]).toContain(disadvantage.json().dice.selectedPool);
    expect(disadvantage.json().body).toContain("помеха");

    const gmNormal = await app.inject({
      method: "POST",
      url: "/api/dice",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        formula: "1d20 + agility",
        rollMode: "NORMAL",
        visibility: "PUBLIC",
        characterId: ids.character,
      },
    });
    expect(gmNormal.statusCode).toBe(201);
    const messages = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.campaignId, ids.campaign));
    expect(messages.map((message) => message.id)).toEqual(
      expect.arrayContaining([
        advantage.json().id,
        disadvantage.json().id,
        gmNormal.json().id,
      ]),
    );
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
    // UIX-391 relies on the server rejecting a second assignment of the same
    // catalog entry rather than silently creating a duplicate: the in-sheet
    // picker filters already-assigned entries out of its list, but that is a
    // convenience, not the guarantee. A fresh actionId is used deliberately
    // so this exercises the duplicate-assignment guard itself and not the
    // generic idempotent-replay path.
    const duplicateAssignment = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), catalogEntryId: template.id },
    });
    expect(duplicateAssignment.statusCode).toBe(409);
    expect(duplicateAssignment.json()).toMatchObject({
      error: "CATALOG_ALREADY_ASSIGNED",
    });
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
        kind: "SKILL",
        name: "Custom",
        description: "changed",
        data: { power: 9 },
      },
    });
    expect(edited.json()).toMatchObject({
      name: "Custom",
      kind: "SKILL",
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

  it("deletes catalog templates and character snapshots with isolated scopes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        kind: "SKILL",
        name: "Stealth",
        description: "Template description",
        data: { bonus: 2 },
      },
    });
    expect(created.statusCode).toBe(201);
    const template = created.json();
    const assigned = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        catalogEntryId: template.id,
      },
    });
    expect(assigned.statusCode).toBe(201);
    const entry = assigned.json();

    const playerTemplateDelete = await app.inject({
      method: "DELETE",
      url: `/api/catalog/${template.id}`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), revision: template.revision },
    });
    expect(playerTemplateDelete.statusCode).toBe(403);
    const staleTemplateDelete = await app.inject({
      method: "DELETE",
      url: `/api/catalog/${template.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: template.revision + 1,
      },
    });
    expect(staleTemplateDelete.statusCode).toBe(409);

    const deleteActionId = crypto.randomUUID();
    const deletedTemplate = await app.inject({
      method: "DELETE",
      url: `/api/catalog/${template.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: deleteActionId, revision: template.revision },
    });
    expect(deletedTemplate.statusCode).toBe(200);
    const deleteReplay = await app.inject({
      method: "DELETE",
      url: `/api/catalog/${template.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: deleteActionId, revision: template.revision },
    });
    expect(deleteReplay.json()).toMatchObject({ ok: true, duplicate: true });

    const afterTemplateDelete = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(afterTemplateDelete.json().catalogEntries).toHaveLength(0);
    expect(afterTemplateDelete.json().characters[0].entries).toContainEqual(
      expect.objectContaining({
        id: entry.id,
        name: "Stealth",
        description: "Template description",
        sourceCatalogEntryId: null,
      }),
    );

    const playerEntryDelete = await app.inject({
      method: "DELETE",
      url: `/api/characters/${ids.character}/catalog/${entry.id}`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), revision: entry.revision },
    });
    expect(playerEntryDelete.statusCode).toBe(403);
    const staleEntryDelete = await app.inject({
      method: "DELETE",
      url: `/api/characters/${ids.character}/catalog/${entry.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), revision: entry.revision + 1 },
    });
    expect(staleEntryDelete.statusCode).toBe(409);
    const deletedEntry = await app.inject({
      method: "DELETE",
      url: `/api/characters/${ids.character}/catalog/${entry.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), revision: entry.revision },
    });
    expect(deletedEntry.statusCode).toBe(200);
    const afterEntryDelete = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(afterEntryDelete.json().characters[0].entries).toHaveLength(0);
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

  it("executes authorized ordered entry rolls and audits/decrements uses atomically", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        kind: "ABILITY",
        name: "Stun",
        description: "Lowers initiative",
        data: {
          notes: "GM note",
          values: { magic: 4 },
          uses: { current: 1, max: 1, recharge: "DAY" },
          rollActions: [
            {
              id: "hit",
              kind: "HIT",
              label: "Hit",
              dice: "1d20",
              order: 0,
              advantage: true,
              consumeUse: false,
              modifiers: [{ type: "CHARACTERISTIC", key: "agility" }],
            },
            {
              id: "damage",
              kind: "DAMAGE",
              label: "Damage",
              dice: "1d8",
              order: 1,
              advantage: false,
              consumeUse: true,
              modifiers: [{ type: "ENTRY_VALUE", key: "magic" }],
            },
          ],
        },
      },
    });
    expect(create.statusCode).toBe(201);
    const template = create.json();
    const assigned = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), catalogEntryId: template.id },
    });
    const entry = assigned.json();
    const roll = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        // Omit the client override: stored legacy action.advantage must still apply.
        rollActionId: "hit",
        visibility: "PUBLIC",
      },
    });
    expect(roll.statusCode).toBe(201);
    expect(roll.json()).toMatchObject({
      formula: "1d20 + modifier_0",
      skillCard: {
        version: 1,
        execution: "EXECUTED",
        entry: { id: entry.id, name: "Stun", kind: "ABILITY" },
        actor: { membershipId: ids.player, characterId: ids.character },
        action: { id: "hit", kind: "HIT" },
        uses: { before: 1, after: 1, max: 1, recharge: "DAY" },
      },
    });
    expect(roll.json()).toMatchObject({
      rollMode: "ADVANTAGE",
      poolTotals: [expect.any(Number), expect.any(Number)],
      selectedPool: expect.any(Number),
    });
    expect([0, 1]).toContain(roll.json().selectedPool);
    expect(roll.json().terms[0].rolls).toHaveLength(1);
    const playerGmOnly = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        rollActionId: "hit",
        visibility: "GM_ONLY",
      },
    });
    expect(playerGmOnly.statusCode).toBe(403);
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(snapshot.json().characters[0].entries[0].data.uses.current).toBe(1);
    expect(snapshot.json().messages.at(-1)).toMatchObject({
      kind: "DICE",
      body: expect.stringContaining("Lowers initiative"),
      skillCard: expect.objectContaining({ version: 1, execution: "EXECUTED" }),
    });
    const damageActionId = crypto.randomUUID();
    const damageRequest = () =>
      app.inject({
        method: "POST",
        url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
        headers: headers(secrets.player),
        payload: {
          actionId: damageActionId,
          rollActionId: "damage",
          rollMode: "DISADVANTAGE",
          visibility: "PUBLIC",
        },
      });
    const [damage, concurrentDamage] = await Promise.all([
      damageRequest(),
      damageRequest(),
    ]);
    expect([damage.statusCode, concurrentDamage.statusCode].sort()).toEqual([
      200, 201,
    ]);
    expect([damage.json(), concurrentDamage.json()]).toContainEqual({
      duplicate: true,
    });
    const appliedDamage = [damage.json(), concurrentDamage.json()].find(
      (payload) => payload.duplicate !== true,
    );
    expect(appliedDamage).toMatchObject({
      formula: "1d8 + modifier_0",
      rollMode: "DISADVANTAGE",
      poolTotals: [expect.any(Number), expect.any(Number)],
      selectedPool: expect.any(Number),
      terms: [expect.objectContaining({ notation: "1d8" })],
    });
    expect([0, 1]).toContain(appliedDamage.selectedPool);
    const afterDamage = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(afterDamage.json().characters[0].entries[0].data.uses.current).toBe(
      0,
    );
    expect(afterDamage.json().messages.slice(-2)).toEqual([
      expect.objectContaining({ kind: "DICE", visibility: "PUBLIC" }),
      expect.objectContaining({
        kind: "DICE",
        visibility: "PUBLIC",
        skillCard: expect.objectContaining({
          uses: { before: 1, after: 0, max: 1, recharge: "DAY" },
        }),
      }),
    ]);
    const shared = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        mode: "SHARE",
        entryRevision: 1,
        visibility: "PUBLIC",
      },
    });
    expect(shared.statusCode).toBe(201);
    expect(shared.json()).toMatchObject({
      skillCard: {
        execution: "SHARED",
        action: null,
        result: null,
        uses: { before: 0, after: 0 },
      },
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: damageActionId,
        rollActionId: "damage",
        visibility: "PUBLIC",
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ duplicate: true });
    const exhausted = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        rollActionId: "damage",
        visibility: "PUBLIC",
      },
    });
    expect(exhausted.statusCode).toBe(409);
  });

  it("spends an entry resource atomically and never double-spends a replay", async () => {
    await db
      .update(schema.characters)
      .set({
        resources: { physicalPower: { current: 3, maximum: 3 } },
      })
      .where(eq(schema.characters.id, ids.character));
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        kind: "SKILL",
        name: "Heavy strike",
        description: "Costs physical power",
        data: {
          rollActions: [
            {
              id: "strike",
              kind: "HIT",
              label: "Strike",
              dice: "1d20",
              modifiers: [],
              order: 0,
              advantage: false,
              consumeUse: false,
              cost: { type: "physical", amount: 2 },
            },
          ],
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const assigned = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        catalogEntryId: created.json().id,
      },
    });
    expect(assigned.statusCode).toBe(201);
    const entryId = assigned.json().id as string;
    const actionId = crypto.randomUUID();
    const execute = () =>
      app.inject({
        method: "POST",
        url: `/api/characters/${ids.character}/catalog/${entryId}/roll`,
        headers: headers(secrets.player),
        payload: {
          actionId,
          rollActionId: "strike",
          visibility: "PUBLIC",
        },
      });
    const first = await execute();
    expect(first.statusCode).toBe(201);
    const replay = await execute();
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ duplicate: true });

    const [afterSuccess] = await db
      .select({ resources: schema.characters.resources })
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    expect(afterSuccess!.resources).toMatchObject({
      physicalPower: { current: 1, maximum: 3 },
    });
    const successEvents = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, actionId));
    expect(successEvents).toHaveLength(1);
    expect(successEvents[0]!.payload).toMatchObject({
      resourceCost: { type: "physical", amount: 2, before: 3, after: 1 },
    });

    const insufficientActionId = crypto.randomUUID();
    const insufficient = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entryId}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: insufficientActionId,
        rollActionId: "strike",
        visibility: "PUBLIC",
      },
    });
    expect(insufficient.statusCode).toBe(409);
    expect(insufficient.json()).toMatchObject({
      error: "INSUFFICIENT_CHARACTER_RESOURCE",
      resource: "physical",
      required: 2,
      available: 1,
    });
    const [afterFailure] = await db
      .select({ resources: schema.characters.resources })
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    expect(afterFailure!.resources).toEqual(afterSuccess!.resources);
    const failureEvents = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, insufficientActionId));
    expect(failureEvents).toHaveLength(0);
  });

  it("returns one canonical DTO to concurrent counter action replays", async () => {
    const actionId = crypto.randomUUID();
    const request = () =>
      app.inject({
        method: "PATCH",
        url: `/api/characters/${ids.character}/counters`,
        headers: headers(secrets.player),
        payload: {
          actionId,
          revision: 0,
          wallet: { gold: 3, silver: 2, copper: 1, sp: 4 },
        },
      });

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    for (const response of responses)
      expect(response.json()).toMatchObject({
        id: ids.character,
        revision: 1,
        wallet: { gold: 3, silver: 2, copper: 1, sp: 4 },
        entries: expect.any(Array),
      });

    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(snapshot.json().characters[0]).toMatchObject({
      revision: 1,
      wallet: { gold: 3, silver: 2, copper: 1, sp: 4 },
    });
    expect(
      snapshot
        .json()
        .messages.filter(
          (message: { kind: string; characterId: string | null }) =>
            message.kind === "SYSTEM" && message.characterId === ids.character,
        ),
    ).toHaveLength(1);
  });

  it("uses default and renamed resource labels with a key fallback", async () => {
    await db
      .update(schema.characters)
      .set({
        resources: {
          legacyCharge: { current: 2, maximum: 3 },
          physicalPower: { current: 7, maximum: 10 },
        },
      })
      .where(eq(schema.characters.id, ids.character));
    const latestAuditBody = async () => {
      const [audit] = await db
        .select({ body: schema.chatMessages.body })
        .from(schema.chatMessages)
        .where(
          and(
            eq(schema.chatMessages.characterId, ids.character),
            eq(schema.chatMessages.kind, "SYSTEM"),
          ),
        )
        .orderBy(desc(schema.chatMessages.sequence))
        .limit(1);
      return audit?.body;
    };

    const defaultLabel = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        resources: {
          legacyCharge: { current: 2, maximum: 3 },
          physicalPower: { current: 6, maximum: 10 },
        },
      },
    });
    expect(defaultLabel.statusCode).toBe(200);
    expect(await latestAuditBody()).toBe(
      "Hero — ресурсы: Выносливость: 7/10 → 6/10",
    );

    await db
      .update(schema.campaigns)
      .set({
        statLayout: [
          {
            id: "combat",
            label: "Боевые характеристики",
            rows: [
              {
                key: "physicalPower",
                label: "Запас сил",
                source: "RESOURCE",
              },
            ],
          },
        ],
      })
      .where(eq(schema.campaigns.id, ids.campaign));
    const renamedLabelAndFallback = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 1,
        resources: {
          physicalPower: { current: 5, maximum: 10 },
        },
      },
    });
    expect(renamedLabelAndFallback.statusCode).toBe(200);
    expect(await latestAuditBody()).toBe(
      "Hero — ресурсы: legacyCharge: удалён, Запас сил: 6/10 → 5/10",
    );
  });

  it("applies short and long rests to every recoverable resource", async () => {
    // UIX-425: отдых восстанавливает на величину регена из карточки, поэтому
    // у персонажа теперь есть строки регена. Без них восстанавливать нечего, и
    // маршрут отвечает отказом «нечего менять».
    await database.exec(
      `update characters set resources = '{"physicalPower":{"current":1,"maximum":10,"recoverable":true},"magicPower":{"current":2,"maximum":8,"recoverable":true},"charges":{"current":1,"maximum":4,"recoverable":false}}'::jsonb, stats = stats || '{"enduranceRegen":4,"manaRegen":3}'::jsonb where id = '${ids.character}'`,
    );
    const [beforeRest] = await db
      .select({ resources: schema.characters.resources })
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    expect(beforeRest?.resources).toMatchObject({
      physicalPower: { current: 1, maximum: 10 },
      magicPower: { current: 2, maximum: 8 },
    });
    const shortRest = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        rest: "SHORT",
      },
    });
    expect(shortRest.statusCode, JSON.stringify(shortRest.json())).toBe(200);
    // Половина регена вниз: 4/2 = 2 и 3/2 = 1. Прежнее правило давало четверть
    // максимума с округлением вверх, то есть 3 и 2.
    expect(shortRest.json()).toMatchObject({
      revision: 1,
      resources: {
        physicalPower: { current: 3, maximum: 10 },
        magicPower: { current: 3, maximum: 8 },
        charges: { current: 1, maximum: 4, recoverable: false },
      },
    });

    const longRest = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 1,
        rest: "LONG",
      },
    });
    expect(longRest.statusCode).toBe(200);
    // Полный реген, а не до максимума: 3 + 4 и 3 + 3.
    expect(longRest.json()).toMatchObject({
      revision: 2,
      resources: {
        physicalPower: { current: 7, maximum: 10 },
        magicPower: { current: 6, maximum: 8 },
        charges: { current: 1, maximum: 4, recoverable: false },
      },
    });
    const [audit] = await db
      .select({ payload: schema.gameEvents.payload })
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.entityId, ids.character))
      .orderBy(desc(schema.gameEvents.createdAt))
      .limit(1);
    expect(audit?.payload).toMatchObject({ rest: "LONG" });
  });

  it("applies a campaign-wide long rest atomically", async () => {
    // UIX-425: отдых восстанавливает на величину регена из карточки, поэтому
    // у персонажа теперь есть строки регена. Без них восстанавливать нечего, и
    // маршрут отвечает отказом «нечего менять».
    await database.exec(
      `update characters set resources = '{"physicalPower":{"current":1,"maximum":10,"recoverable":true},"magicPower":{"current":2,"maximum":8,"recoverable":true},"charges":{"current":1,"maximum":4,"recoverable":false}}'::jsonb, stats = stats || '{"enduranceRegen":4,"manaRegen":3}'::jsonb where id = '${ids.character}'`,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "LONG_REST",
        revision: 0,
      },
    });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    expect(response.json()).toMatchObject({ day: 2, revision: 1 });
    const [rested] = await db
      .select({
        resources: schema.characters.resources,
        revision: schema.characters.revision,
      })
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    // Общий отдых партии идёт по тому же правилу: 1 + 4 и 2 + 3.
    expect(rested).toMatchObject({
      revision: 1,
      resources: {
        physicalPower: { current: 5, maximum: 10 },
        magicPower: { current: 5, maximum: 8 },
        charges: { current: 1, maximum: 4, recoverable: false },
      },
    });
    const events = await db
      .select({ payload: schema.gameEvents.payload })
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.entityId, ids.campaign));
    expect(events.at(-1)?.payload).toMatchObject({
      command: "LONG_REST",
      day: 2,
      restoredCharacters: 1,
    });
  });

  it("resets the campaign clock once and rebases recharge anchors without granting uses", async () => {
    await db
      .update(schema.campaigns)
      .set({ day: 12, battleActive: false, battleCounter: 4, revision: 0 })
      .where(eq(schema.campaigns.id, ids.campaign));
    const entries = await db
      .insert(schema.characterCatalogEntries)
      .values([
        {
          characterId: ids.character,
          kind: "ABILITY",
          name: "Daily reset anchor",
          data: {
            uses: {
              current: 0,
              max: 1,
              recharge: "DAY",
              lastRechargeDay: 12,
            },
          },
        },
        {
          characterId: ids.character,
          kind: "ABILITY",
          name: "Weekly reset anchor",
          data: {
            uses: {
              current: 0,
              max: 1,
              recharge: "WEEK",
              lastRechargeDay: 10,
            },
          },
        },
        {
          characterId: ids.character,
          kind: "ABILITY",
          name: "Battle reset anchor",
          data: {
            uses: {
              current: 0,
              max: 2,
              recharge: "BATTLE",
              lastBattleCounter: 4,
            },
          },
        },
      ])
      .returning();

    const playerAttempt = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        command: "RESET_CLOCK",
        revision: 0,
      },
    });
    expect(playerAttempt.statusCode).toBe(403);

    const staleAttempt = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "RESET_CLOCK",
        revision: 99,
      },
    });
    expect(staleAttempt.statusCode).toBe(409);
    expect(staleAttempt.json()).toEqual({
      error: "CAMPAIGN_CONFLICT",
      revision: 0,
    });

    await db
      .update(schema.campaigns)
      .set({ battleActive: true })
      .where(eq(schema.campaigns.id, ids.campaign));
    const activeBattleAttempt = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "RESET_CLOCK",
        revision: 0,
      },
    });
    expect(activeBattleAttempt.statusCode).toBe(409);
    expect(activeBattleAttempt.json()).toEqual({ error: "BATTLE_ACTIVE" });
    await db
      .update(schema.campaigns)
      .set({ battleActive: false })
      .where(eq(schema.campaigns.id, ids.campaign));
    const [legacyActiveEncounter] = await db
      .insert(schema.encounters)
      .values({
        campaignId: ids.campaign,
        mode: "SCENE_REGION",
        sourceSceneId: ids.scene,
        targetSceneId: ids.scene,
        focusRegion: { x: 0, y: 0, width: 10, height: 10 },
        sourceSceneRevision: 0,
        initiatorMembershipId: ids.gm,
      })
      .returning({ id: schema.encounters.id });
    const activeEncounterAttempt = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "RESET_CLOCK",
        revision: 0,
      },
    });
    expect(activeEncounterAttempt.statusCode).toBe(409);
    expect(activeEncounterAttempt.json()).toEqual({ error: "BATTLE_ACTIVE" });
    for (const command of ["START_BATTLE", "END_BATTLE"] as const) {
      const legacyAttempt = await app.inject({
        method: "POST",
        url: "/api/campaign/clock",
        headers: headers(secrets.gm),
        payload: {
          actionId: crypto.randomUUID(),
          command,
          revision: 0,
        },
      });
      expect(legacyAttempt.statusCode).toBe(409);
      expect(legacyAttempt.json()).toEqual({ error: "ENCOUNTER_ACTIVE" });
    }
    const [clockAfterLegacyAttempts] = await db
      .select({
        battleActive: schema.campaigns.battleActive,
        battleCounter: schema.campaigns.battleCounter,
        revision: schema.campaigns.revision,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, ids.campaign));
    expect(clockAfterLegacyAttempts).toEqual({
      battleActive: false,
      battleCounter: 4,
      revision: 0,
    });
    await db
      .delete(schema.encounters)
      .where(eq(schema.encounters.id, legacyActiveEncounter!.id));

    const actionId = crypto.randomUUID();
    const payload = { actionId, command: "RESET_CLOCK", revision: 0 };
    const reset = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload,
    });
    expect(reset.statusCode, JSON.stringify(reset.json())).toBe(200);
    expect(reset.json()).toMatchObject({
      day: 1,
      battleActive: false,
      battleCounter: 0,
      revision: 1,
    });

    const resetEntries = await db
      .select({
        id: schema.characterCatalogEntries.id,
        data: schema.characterCatalogEntries.data,
        revision: schema.characterCatalogEntries.revision,
      })
      .from(schema.characterCatalogEntries);
    const resetById = new Map(resetEntries.map((entry) => [entry.id, entry]));
    expect(resetById.get(entries[0]!.id)).toMatchObject({
      revision: 1,
      data: { uses: { current: 0, lastRechargeDay: 1 } },
    });
    expect(resetById.get(entries[1]!.id)).toMatchObject({
      revision: 1,
      data: { uses: { current: 0, lastRechargeDay: 1 } },
    });
    expect(resetById.get(entries[2]!.id)).toMatchObject({
      revision: 1,
      data: { uses: { current: 0, lastBattleCounter: 0 } },
    });

    const systemMessages = await db
      .select({
        body: schema.chatMessages.body,
        visibility: schema.chatMessages.visibility,
      })
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.campaignId, ids.campaign),
          eq(schema.chatMessages.kind, "SYSTEM"),
        ),
      );
    expect(systemMessages).toEqual([
      {
        body: "Время кампании сброшено: день 1, боёв 0.",
        visibility: "PUBLIC",
      },
    ]);
    const events = await db
      .select({ payload: schema.gameEvents.payload })
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, actionId));
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      command: "RESET_CLOCK",
      previousDay: 12,
      previousBattleCounter: 4,
      day: 1,
      battleCounter: 0,
      recharged: 0,
      rebasedEntries: 3,
      restoredCharacters: 0,
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ duplicate: true });
    expect(
      await db
        .select({ actionId: schema.gameEvents.actionId })
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, actionId)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: schema.chatMessages.id })
        .from(schema.chatMessages)
        .where(eq(schema.chatMessages.kind, "SYSTEM")),
    ).toHaveLength(1);

    const alreadyReset = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "RESET_CLOCK",
        revision: 1,
      },
    });
    expect(alreadyReset.statusCode).toBe(400);
    expect(alreadyReset.json()).toEqual({ error: "CLOCK_ALREADY_RESET" });

    await db
      .update(schema.characterCatalogEntries)
      .set({
        data: {
          uses: {
            current: 0,
            max: 1,
            recharge: "WEEK",
            lastRechargeDay: 9,
          },
        },
        revision: 2,
      })
      .where(eq(schema.characterCatalogEntries.id, entries[1]!.id));
    const repairedBaseline = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "RESET_CLOCK",
        revision: 1,
      },
    });
    expect(repairedBaseline.statusCode).toBe(200);
    expect(repairedBaseline.json()).toMatchObject({
      day: 1,
      battleCounter: 0,
      revision: 2,
    });
    const [repairedWeekly] = await db
      .select({
        data: schema.characterCatalogEntries.data,
        revision: schema.characterCatalogEntries.revision,
      })
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, entries[1]!.id));
    expect(repairedWeekly).toMatchObject({
      revision: 3,
      data: { uses: { current: 0, lastRechargeDay: 1 } },
    });

    const cleanBaseline = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "RESET_CLOCK",
        revision: 2,
      },
    });
    expect(cleanBaseline.statusCode).toBe(400);
    expect(cleanBaseline.json()).toEqual({ error: "CLOCK_ALREADY_RESET" });

    await db
      .update(schema.campaigns)
      .set({
        initiative: [
          {
            id: crypto.randomUUID(),
            tokenId: null,
            name: "Старая строка",
            initiative: 14,
            pinned: false,
          },
        ],
      })
      .where(eq(schema.campaigns.id, ids.campaign));
    const clearedInitiative = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "RESET_CLOCK",
        revision: 2,
      },
    });
    expect(clearedInitiative.statusCode).toBe(200);
    expect(clearedInitiative.json()).toMatchObject({
      initiative: [],
      revision: 3,
    });
  });

  it("updates clock, cooldowns, resources and wallet with public system audit", async () => {
    await database.exec(
      `update characters set wallet = '{"gold":0,"silver":0,"copper":0}'::jsonb where id = '${ids.character}'`,
    );
    const legacyWalletSnapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(legacyWalletSnapshot.json().characters[0].wallet).toEqual({
      gold: 0,
      silver: 0,
      copper: 0,
      sp: 0,
    });
    await db.insert(schema.characterCatalogEntries).values([
      {
        characterId: ids.character,
        kind: "ABILITY",
        name: "Weekly",
        data: {
          uses: { current: 0, max: 1, recharge: "WEEK", lastRechargeDay: 1 },
        },
      },
      {
        characterId: ids.character,
        kind: "ABILITY",
        name: "Battle",
        data: { uses: { current: 0, max: 2, recharge: "BATTLE" } },
      },
    ]);
    await database.exec(
      `update campaigns set day = 7 where id = '${ids.campaign}'`,
    );
    const countersActionId = crypto.randomUUID();
    const counters = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: countersActionId,
        revision: 0,
        wallet: { gold: 1, silver: 2, copper: 3, sp: 4 },
        resources: { mana: { current: 5, maximum: 8 } },
      },
    });
    expect(counters.statusCode).toBe(200);
    expect(counters.json()).toMatchObject({
      wallet: { gold: 1, silver: 2, copper: 3, sp: 4 },
      resources: { mana: { current: 5, maximum: 8 } },
      revision: 1,
    });
    const countersSnapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(
      countersSnapshot
        .json()
        .messages.find(
          (message: { kind: string; body: string }) =>
            message.kind === "SYSTEM" && message.body.includes("кошелёк:"),
        )?.body,
    ).toContain("кошелёк: золото 0 → 1, серебро 0 → 2, медь 0 → 3, СП 0 → 4");
    expect(
      countersSnapshot
        .json()
        .messages.find(
          (message: { kind: string; body: string }) =>
            message.kind === "SYSTEM" && message.body.includes("кошелёк:"),
        )?.body,
    ).not.toContain('{"gold"');
    const counterAudit = countersSnapshot
      .json()
      .messages.find(
        (message: { kind: string; body: string }) =>
          message.kind === "SYSTEM" && message.body.includes("кошелёк:"),
      )?.body as string;
    expect(counterAudit).toContain("ресурсы: mana: добавлен 5/8");
    expect(counterAudit).not.toContain("Мастер: Мастер:");
    expect(counterAudit).not.toContain('{"mana"');
    const noOpCounters = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 1,
        wallet: { gold: 1, silver: 2, copper: 3, sp: 4 },
        resources: { mana: { current: 5, maximum: 8 } },
      },
    });
    expect(noOpCounters.statusCode).toBe(400);
    expect(noOpCounters.json()).toEqual({ error: "NO_COUNTER_CHANGES" });
    const afterNoOp = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(afterNoOp.json().characters[0].revision).toBe(1);
    expect(afterNoOp.json().messages).toHaveLength(
      countersSnapshot.json().messages.length,
    );
    const countersReplay = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: countersActionId,
        revision: 0,
        wallet: { gold: 9, silver: 9, copper: 9, sp: 9 },
      },
    });
    expect(countersReplay.json()).toMatchObject({
      id: ids.character,
      wallet: { gold: 1, silver: 2, copper: 3, sp: 4 },
      revision: 1,
      entries: expect.any(Array),
    });
    const advanceActionId = crypto.randomUUID();
    const advance = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: advanceActionId,
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(advance.json()).toMatchObject({ day: 8, revision: 1 });
    const advanceReplay = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: advanceActionId,
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(advanceReplay.json()).toEqual({ duplicate: true });
    const start = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "START_BATTLE",
        revision: 1,
      },
    });
    expect(start.json()).toMatchObject({
      battleActive: true,
      battleCounter: 1,
      revision: 2,
    });
    const end = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "END_BATTLE",
        revision: 2,
      },
    });
    expect(end.json()).toMatchObject({
      battleActive: false,
      battleCounter: 1,
      revision: 3,
    });
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(snapshot.json()).toMatchObject({
      campaign: { day: 8, battleActive: false, battleCounter: 1, revision: 3 },
      characters: [
        {
          wallet: { gold: 1, silver: 2, copper: 3, sp: 4 },
          resources: { mana: { current: 5, maximum: 8 } },
        },
      ],
    });
    expect(
      snapshot
        .json()
        .characters[0].entries.map(
          (entry: { data: { uses?: { current: number } } }) =>
            entry.data.uses?.current,
        ),
    ).toEqual([1, 2]);
    const systemBodies = snapshot
      .json()
      .messages.filter((message: { kind: string }) => message.kind === "SYSTEM")
      .map((message: { body: string }) => message.body);
    expect(systemBodies).toHaveLength(4);
    expect(systemBodies.slice(-3)).toEqual([
      "День кампании: 8. Перезаряжено: 1.",
      "Бой #1 начат.",
      "Бой #1 завершён. Перезаряжено: 1.",
    ]);
  });

  it("records one audit and event for one aggregated wallet mutation", async () => {
    await database.exec(
      `update characters set wallet = '{"gold":0,"silver":0,"copper":0,"sp":0}'::jsonb where id = '${ids.character}'`,
    );
    const actionId = crypto.randomUUID();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId,
        revision: 0,
        wallet: { gold: 0, silver: 0, copper: 0, sp: 25 },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      revision: 1,
      wallet: { gold: 0, silver: 0, copper: 0, sp: 25 },
    });

    const messages = await db
      .select({
        body: schema.chatMessages.body,
        systemData: schema.chatMessages.systemData,
      })
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.campaignId, ids.campaign),
          eq(schema.chatMessages.characterId, ids.character),
          eq(schema.chatMessages.kind, "SYSTEM"),
        ),
      );
    const walletAudits = messages.filter(
      (message) =>
        (message.systemData as { type?: string } | null)?.type ===
        "WALLET_AUDIT",
    );
    expect(walletAudits).toHaveLength(1);
    expect(walletAudits[0]).toMatchObject({
      body: expect.stringContaining("СП 0 → 25"),
      systemData: {
        type: "WALLET_AUDIT",
        before: { gold: 0, silver: 0, copper: 0, sp: 0 },
        after: { gold: 0, silver: 0, copper: 0, sp: 25 },
        operationCount: 1,
      },
    });

    const events = await db
      .select({
        actionId: schema.gameEvents.actionId,
        entityRevision: schema.gameEvents.entityRevision,
        payload: schema.gameEvents.payload,
      })
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, actionId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actionId,
      entityRevision: 1,
      payload: {
        wallet: { gold: 0, silver: 0, copper: 0, sp: 25 },
      },
    });
  });

  it("coalesces a rapid wallet burst without dropping authoritative events", async () => {
    await database.exec(
      `update characters set wallet = '{"gold":0,"silver":0,"copper":0,"sp":0}'::jsonb where id = '${ids.character}'`,
    );
    const actionIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];

    for (const [index, actionId] of actionIds.entries()) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/characters/${ids.character}/counters`,
        headers: headers(secrets.player),
        payload: {
          actionId,
          revision: index,
          wallet: { gold: index + 1, silver: 0, copper: 0, sp: 0 },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        revision: index + 1,
        wallet: { gold: index + 1, silver: 0, copper: 0, sp: 0 },
      });
    }

    const auditMessages = await db
      .select({
        body: schema.chatMessages.body,
        systemData: schema.chatMessages.systemData,
      })
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.campaignId, ids.campaign),
          eq(schema.chatMessages.characterId, ids.character),
          eq(schema.chatMessages.kind, "SYSTEM"),
        ),
      );
    expect(auditMessages).toHaveLength(1);
    expect(auditMessages[0]?.systemData).toMatchObject({
      type: "WALLET_AUDIT",
      before: { gold: 0, silver: 0, copper: 0, sp: 0 },
      after: { gold: 3, silver: 0, copper: 0, sp: 0 },
      operationCount: 3,
    });

    const events = await db
      .select({
        actionId: schema.gameEvents.actionId,
        entityRevision: schema.gameEvents.entityRevision,
      })
      .from(schema.gameEvents)
      .where(
        and(
          eq(schema.gameEvents.campaignId, ids.campaign),
          eq(schema.gameEvents.entityId, ids.character),
          eq(schema.gameEvents.type, "character.counters"),
        ),
      )
      .orderBy(schema.gameEvents.sequence);
    expect(events).toEqual(
      actionIds.map((actionId, index) => ({
        actionId,
        entityRevision: index + 1,
      })),
    );

    const replay = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: actionIds[2],
        revision: 2,
        wallet: { gold: 99, silver: 0, copper: 0, sp: 0 },
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ wallet: { gold: 3 }, revision: 3 });
    expect(
      await db
        .select({ actionId: schema.gameEvents.actionId })
        .from(schema.gameEvents)
        .where(
          and(
            eq(schema.gameEvents.campaignId, ids.campaign),
            eq(schema.gameEvents.entityId, ids.character),
            eq(schema.gameEvents.type, "character.counters"),
          ),
        ),
    ).toHaveLength(3);
  });

  it("rejects foreign ownership, player clock access, malformed use models and stale revisions", async () => {
    const [foreignEntry] = await db
      .insert(schema.characterCatalogEntries)
      .values({
        characterId: ids.foreignCharacter,
        kind: "ABILITY",
        name: "Foreign ability",
        data: {
          uses: { current: 1, max: 1, recharge: "DAY" },
          rollActions: [
            {
              id: "use",
              kind: "CUSTOM",
              label: "Use",
              dice: "1d20",
              modifiers: [],
              order: 0,
              consumeUse: true,
            },
          ],
        },
      })
      .returning();
    const foreignHeaders = headers(secrets.foreignPlayer);
    const roll = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.foreignCharacter}/catalog/${foreignEntry!.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        rollActionId: "use",
        visibility: "PUBLIC",
      },
    });
    expect(roll.statusCode).toBe(403);
    const recharge = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.foreignCharacter}/catalog/${foreignEntry!.id}/recharge`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), revision: 0 },
    });
    expect(recharge.statusCode).toBe(403);
    const counters = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.foreignCharacter}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        wallet: { gold: 1, silver: 0, copper: 0, sp: 0 },
      },
    });
    expect(counters.statusCode).toBe(403);
    const clock = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: foreignHeaders,
      payload: {
        actionId: crypto.randomUUID(),
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(clock.statusCode).toBe(403);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        kind: "ABILITY",
        name: "Malformed",
        data: {
          uses: { current: 2, max: 1, recharge: "DAY" },
          rollActions: [
            {
              id: "bad",
              kind: "CUSTOM",
              label: "Bad",
              dice: "1d20",
              order: 0,
              consumeUse: true,
              modifiers: [{ type: "FORMULA", formula: "magic+1" }],
            },
          ],
        },
      },
    });
    expect(malformed.statusCode).toBe(400);
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 99,
        wallet: { gold: 1, silver: 0, copper: 0, sp: 0 },
      },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("anchors manual recharge to the current interval", async () => {
    await database.exec(
      `update campaigns set day=8,battle_counter=3 where id='${ids.campaign}'`,
    );
    const [weekly, battle, daily] = await db
      .insert(schema.characterCatalogEntries)
      .values([
        {
          characterId: ids.character,
          kind: "ABILITY",
          name: "Weekly anchor",
          data: {
            uses: {
              current: 0,
              max: 1,
              recharge: "WEEK",
              lastRechargeDay: 1,
            },
          },
        },
        {
          characterId: ids.character,
          kind: "ABILITY",
          name: "Battle anchor",
          data: { uses: { current: 0, max: 1, recharge: "BATTLE" } },
        },
        {
          characterId: ids.character,
          kind: "ABILITY",
          name: "Daily anchor",
          data: { uses: { current: 0, max: 1, recharge: "DAY" } },
        },
      ])
      .returning();
    const actionId = crypto.randomUUID();
    const recharge = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${weekly!.id}/recharge`,
      headers: headers(secrets.player),
      payload: { actionId, revision: 0 },
    });
    expect(recharge.statusCode).toBe(200);
    expect(recharge.json().data.uses).toMatchObject({
      current: 1,
      lastRechargeDay: 8,
    });
    for (const entry of [battle!, daily!]) {
      const anchored = await app.inject({
        method: "POST",
        url: `/api/characters/${ids.character}/catalog/${entry.id}/recharge`,
        headers: headers(secrets.player),
        payload: { actionId: crypto.randomUUID(), revision: 0 },
      });
      expect(anchored.statusCode).toBe(200);
      expect(anchored.json().data.uses).toMatchObject(
        entry.id === battle!.id
          ? { lastBattleCounter: 3 }
          : { lastRechargeDay: 8 },
      );
    }
    const replay = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${weekly!.id}/recharge`,
      headers: headers(secrets.player),
      payload: { actionId, revision: 0 },
    });
    expect(replay.json()).toEqual({ duplicate: true });
    await database.exec(
      `update character_catalog_entries set data=jsonb_set(data,'{uses,current}','0') where id='${weekly!.id}'`,
    );
    const advance = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(advance.statusCode).toBe(200);
    const [notDue] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, weekly!.id));
    expect((notDue!.data as { uses: { current: number } }).uses.current).toBe(
      0,
    );
    for (let revision = 1; revision <= 6; revision++) {
      const next = await app.inject({
        method: "POST",
        url: "/api/campaign/clock",
        headers: headers(secrets.gm),
        payload: {
          actionId: crypto.randomUUID(),
          command: "ADVANCE_DAY",
          revision,
        },
      });
      expect(next.statusCode).toBe(200);
    }
    const [due] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, weekly!.id));
    expect((due!.data as { uses: { current: number } }).uses.current).toBe(1);
  });

  it("rolls back the complete clock mutation when a due entry CAS fails", async () => {
    await db.insert(schema.characterCatalogEntries).values({
      characterId: ids.character,
      kind: "ABILITY",
      name: "Blocked recharge",
      data: { uses: { current: 0, max: 1, recharge: "DAY" } },
    });
    await database.exec(`
      create function reject_entry_update() returns trigger language plpgsql as $$ begin return null; end $$;
      create trigger reject_entry_update before update on character_catalog_entries for each row execute function reject_entry_update();
    `);
    const response = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(response.statusCode).toBe(409);
    const state = await database.query<{
      day: number;
      revision: number;
      messages: number;
      events: number;
    }>(
      `select day,revision,(select count(*) from chat_messages) messages,(select count(*) from game_events) events from campaigns where id='${ids.campaign}'`,
    );
    expect(state.rows[0]).toMatchObject({
      day: 1,
      revision: 0,
      messages: 0,
      events: 0,
    });
  });

  it("rejects a Canvas write while paused without creating drawing history", async () => {
    await db
      .update(schema.campaigns)
      .set({ paused: true })
      .where(eq(schema.campaigns.id, ids.campaign));

    const rejected = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        points: [0, 0, 16, 16],
        color: "#ff0000",
      },
    });

    expect(rejected.statusCode, rejected.body).toBe(409);
    expect(rejected.json()).toMatchObject({ code: "CAMPAIGN_PAUSED" });
    const counts = await database.query<{
      drawings: number;
      events: number;
      journal: number;
    }>(`
      select
        (select count(*) from drawings) drawings,
        (select count(*) from game_events) events,
        (select count(*) from action_journal) journal
    `);
    expect(counts.rows[0]).toEqual({ drawings: 0, events: 0, journal: 0 });

    for (const [secret, actor] of [
      [secrets.player, "player"],
      [secrets.gm, "gm"],
    ] as const) {
      const chat = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: headers(secret),
        payload: {
          actionId: crypto.randomUUID(),
          body: `pause chat control: ${actor}`,
        },
      });
      expect(chat.statusCode, chat.body).toBe(201);
      const dice = await app.inject({
        method: "POST",
        url: "/api/dice",
        headers: headers(secret),
        payload: {
          actionId: crypto.randomUUID(),
          formula: "1d20",
          visibility: "PUBLIC",
          characterId: ids.character,
        },
      });
      expect(dice.statusCode, dice.body).toBe(201);
    }

    await db
      .update(schema.campaigns)
      .set({ paused: false })
      .where(eq(schema.campaigns.id, ids.campaign));
    const allowed = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        points: [0, 0, 16, 16],
        color: "#ff0000",
      },
    });
    expect(allowed.statusCode, allowed.body).toBe(201);
  });

  it("persists ordered fog, drawing history, layers and scene canvas with authoritative permissions", async () => {
    const drawingAction = crypto.randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.player),
      payload: {
        actionId: drawingAction,
        sceneId: ids.scene,
        points: [0, 0, 16, 16],
        color: "#ff0000",
      },
    });
    expect(created.statusCode).toBe(201);
    const drawing = created.json();
    const replay = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.player),
      payload: {
        actionId: drawingAction,
        sceneId: ids.scene,
        points: [2, 2, 20, 20],
        color: "#00ff00",
      },
    });
    expect(replay.json()).toEqual({ duplicate: true });
    const foreignEdit = await app.inject({
      method: "PATCH",
      url: `/api/drawings/${drawing.id}`,
      headers: headers(secrets.foreignPlayer),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        color: "#00ff00",
      },
    });
    expect(foreignEdit.statusCode).toBe(403);
    const undo = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json()).toMatchObject({ status: "UNDONE" });
    const empty = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(empty.json().drawings).toEqual([]);
    const redo = await app.inject({
      method: "POST",
      url: "/api/canvas/redo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(redo.statusCode).toBe(200);
    expect(redo.json()).toMatchObject({ status: "APPLIED" });
    const undoAgain = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(undoAgain.statusCode).toBe(200);
    const branch = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        points: [1, 1, 8, 8],
        color: "#0000ff",
      },
    });
    expect(branch.statusCode).toBe(201);
    const invalidatedRedo = await app.inject({
      method: "POST",
      url: "/api/canvas/redo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(invalidatedRedo.statusCode).toBe(404);
    const reveal = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        operation: "REVEAL",
      },
    });
    const cover = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        x: 20,
        y: 20,
        width: 20,
        height: 20,
        operation: "COVER",
      },
    });
    expect(reveal.statusCode).toBe(201);
    expect(cover.statusCode).toBe(201);
    const layer = await app.inject({
      method: "PATCH",
      url: `/api/tokens/${ids.token}/layer`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        layer: "GM",
      },
    });
    expect(layer.statusCode).toBe(200);
    const playerLayer = await app.inject({
      method: "PATCH",
      url: `/api/tokens/${ids.token}/layer`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 1,
        layer: "PLAYER",
      },
    });
    expect(playerLayer.statusCode).toBe(403);
    const sceneConfig = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${ids.scene}/canvas`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        mapScale: 2,
        world: { width: 2560, height: 1440 },
        backgroundFrame: { x: 120, y: 80, width: 2048, height: 1024 },
        grid: {
          enabled: true,
          size: 32,
          offsetX: 4,
          offsetY: 8,
          color: "#ffffff",
          opacity: 0.5,
        },
      },
    });
    expect(sceneConfig.statusCode).toBe(200);
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(snapshot.json().tokens).toEqual([]);
    expect(snapshot.json().fogReveals).toMatchObject([
      { operation: "REVEAL" },
      { operation: "COVER" },
    ]);
    expect(snapshot.json().scenes[0]).toMatchObject({
      mapScale: 2,
      width: 2560,
      height: 1440,
      backgroundFrame: { x: 120, y: 80, width: 2048, height: 1024 },
      revision: 1,
      grid: { size: 32, offsetX: 4, offsetY: 8 },
    });
    expect(
      (
        await db
          .select()
          .from(schema.tokens)
          .where(eq(schema.tokens.id, ids.token))
      )[0],
    ).toMatchObject({ x: 4, y: 8, width: 32, height: 32, revision: 2 });
    expect(
      (
        await db
          .select()
          .from(schema.tokenDefinitions)
          .where(eq(schema.tokenDefinitions.id, ids.definition))
      )[0],
    ).toMatchObject({ defaultWidth: 64, defaultHeight: 64, revision: 0 });
    expect(
      (
        await db
          .select()
          .from(schema.actionJournal)
          .where(eq(schema.actionJournal.targetId, ids.token))
      )[0],
    ).toMatchObject({ type: "TOKEN_LAYER", status: "INVALIDATED" });
    const undoScene = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(undoScene.statusCode).toBe(200);
    const afterUndo = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(afterUndo.json().scenes[0]).toMatchObject({
      width: 1920,
      height: 1080,
      backgroundFrame: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    expect(
      (
        await db
          .select()
          .from(schema.tokens)
          .where(eq(schema.tokens.id, ids.token))
      )[0],
    ).toMatchObject({ x: 0, y: 0, width: 64, height: 64, revision: 3 });
    expect(
      (
        await db
          .select()
          .from(schema.tokenDefinitions)
          .where(eq(schema.tokenDefinitions.id, ids.definition))
      )[0],
    ).toMatchObject({ defaultWidth: 64, defaultHeight: 64, revision: 0 });
    const redoScene = await app.inject({
      method: "POST",
      url: "/api/canvas/redo",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(redoScene.statusCode).toBe(200);
    const afterRedo = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(afterRedo.json().scenes[0]).toMatchObject({
      width: 2560,
      height: 1440,
      backgroundFrame: { x: 120, y: 80, width: 2048, height: 1024 },
    });
    expect(
      (
        await db
          .select()
          .from(schema.tokens)
          .where(eq(schema.tokens.id, ids.token))
      )[0],
    ).toMatchObject({ x: 4, y: 8, width: 32, height: 32, revision: 4 });
    expect(
      (
        await db
          .select()
          .from(schema.tokenDefinitions)
          .where(eq(schema.tokenDefinitions.id, ids.definition))
      )[0],
    ).toMatchObject({ defaultWidth: 64, defaultHeight: 64, revision: 0 });
  });

  it("rescales only scene instances when a token definition is shared across scenes and history", async () => {
    const otherSceneId = crypto.randomUUID();
    const otherTokenId = crypto.randomUUID();
    await db.insert(schema.scenes).values({
      id: otherSceneId,
      campaignId: ids.campaign,
      name: "Other map",
      grid: {
        enabled: true,
        size: 64,
        offsetX: 0,
        offsetY: 0,
        color: "#ffffff",
        opacity: 0.2,
      },
    });
    await db.insert(schema.tokens).values({
      id: otherTokenId,
      definitionId: ids.definition,
      sceneId: otherSceneId,
      name: "Shared hero",
      x: 64,
      y: 64,
      width: 64,
      height: 64,
    });

    const rescaled = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${ids.scene}/canvas`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        grid: {
          enabled: true,
          size: 32,
          offsetX: 4,
          offsetY: 8,
          color: "#ffffff",
          opacity: 0.2,
        },
      },
    });
    expect(rescaled.statusCode).toBe(200);
    const readTokens = async () =>
      db
        .select()
        .from(schema.tokens)
        .where(eq(schema.tokens.definitionId, ids.definition));
    let byId = new Map((await readTokens()).map((token) => [token.id, token]));
    expect(byId.get(ids.token)).toMatchObject({
      x: 4,
      y: 8,
      width: 32,
      height: 32,
      revision: 1,
    });
    expect(byId.get(otherTokenId)).toMatchObject({
      x: 64,
      y: 64,
      width: 64,
      height: 64,
      revision: 0,
    });
    expect(
      (
        await db
          .select()
          .from(schema.tokenDefinitions)
          .where(eq(schema.tokenDefinitions.id, ids.definition))
      )[0],
    ).toMatchObject({ defaultWidth: 64, defaultHeight: 64, revision: 0 });

    const undo = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(undo.statusCode).toBe(200);
    byId = new Map((await readTokens()).map((token) => [token.id, token]));
    expect(byId.get(ids.token)).toMatchObject({
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      revision: 2,
    });
    expect(byId.get(otherTokenId)).toMatchObject({ revision: 0 });

    const redo = await app.inject({
      method: "POST",
      url: "/api/canvas/redo",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(redo.statusCode).toBe(200);
    byId = new Map((await readTokens()).map((token) => [token.id, token]));
    expect(byId.get(ids.token)).toMatchObject({
      x: 4,
      y: 8,
      width: 32,
      height: 32,
      revision: 3,
    });
    expect(byId.get(otherTokenId)).toMatchObject({ revision: 0 });
    expect(
      (
        await db
          .select()
          .from(schema.tokenDefinitions)
          .where(eq(schema.tokenDefinitions.id, ids.definition))
      )[0],
    ).toMatchObject({ defaultWidth: 64, defaultHeight: 64, revision: 0 });
  });

  it("leaves redo history and geometry untouched when the scene CAS is stale", async () => {
    const redoActionId = crypto.randomUUID();
    await db.insert(schema.actionJournal).values({
      campaignId: ids.campaign,
      sceneId: ids.scene,
      actorMembershipId: ids.gm,
      actionId: redoActionId,
      type: "TOKEN_MOVE",
      targetType: "TOKEN",
      targetId: ids.token,
      before: { x: 0, y: 0 },
      after: { x: 64, y: 64 },
      currentRevision: 0,
      status: "UNDONE",
    });
    const failedActionId = crypto.randomUUID();
    const failed = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${ids.scene}/canvas`,
      headers: headers(secrets.gm),
      payload: {
        actionId: failedActionId,
        revision: 1,
        grid: {
          enabled: true,
          size: 32,
          offsetX: 0,
          offsetY: 0,
          color: "#ffffff",
          opacity: 0.2,
        },
      },
    });
    expect(failed.statusCode).toBe(409);
    expect(failed.json()).toEqual({ error: "SCENE_CONFLICT" });
    expect(
      (
        await db
          .select()
          .from(schema.actionJournal)
          .where(eq(schema.actionJournal.actionId, redoActionId))
      )[0],
    ).toMatchObject({ status: "UNDONE" });
    expect(
      (
        await db
          .select()
          .from(schema.scenes)
          .where(eq(schema.scenes.id, ids.scene))
      )[0],
    ).toMatchObject({ revision: 0, grid: { size: 64 } });
    expect(
      (
        await db
          .select()
          .from(schema.tokens)
          .where(eq(schema.tokens.id, ids.token))
      )[0],
    ).toMatchObject({ x: 0, y: 0, width: 64, height: 64, revision: 0 });
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, failedActionId)),
    ).toEqual([]);
  });

  it("rejects grid rescale at both token size boundaries instead of clamping", async () => {
    await db
      .update(schema.tokens)
      .set({ width: 16, height: 16 })
      .where(eq(schema.tokens.id, ids.token));
    const lower = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${ids.scene}/canvas`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        grid: {
          enabled: true,
          size: 16,
          offsetX: 0,
          offsetY: 0,
          color: "#ffffff",
          opacity: 0.2,
        },
      },
    });
    expect(lower.statusCode).toBe(422);
    expect(lower.json()).toMatchObject({
      error: "SCENE_GRID_TOKEN_BOUNDS",
      policy: "REJECT",
      min: 16,
      max: 1024,
      tokenId: ids.token,
      width: 4,
      height: 4,
    });

    await db
      .update(schema.tokens)
      .set({ width: 1024, height: 1024 })
      .where(eq(schema.tokens.id, ids.token));
    const upper = await app.inject({
      method: "PATCH",
      url: `/api/scenes/${ids.scene}/canvas`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        grid: {
          enabled: true,
          size: 256,
          offsetX: 0,
          offsetY: 0,
          color: "#ffffff",
          opacity: 0.2,
        },
      },
    });
    expect(upper.statusCode).toBe(422);
    expect(upper.json()).toMatchObject({
      error: "SCENE_GRID_TOKEN_BOUNDS",
      policy: "REJECT",
      min: 16,
      max: 1024,
      tokenId: ids.token,
      width: 4096,
      height: 4096,
    });
    expect(
      (
        await db
          .select()
          .from(schema.scenes)
          .where(eq(schema.scenes.id, ids.scene))
      )[0],
    ).toMatchObject({ revision: 0, grid: { size: 64 } });
    expect(
      (
        await db
          .select()
          .from(schema.tokens)
          .where(eq(schema.tokens.id, ids.token))
      )[0],
    ).toMatchObject({ width: 1024, height: 1024, revision: 0 });
  });

  it("serializes concurrent reusable-token placement with grid rescale", async () => {
    const definitionId = crypto.randomUUID();
    await db.insert(schema.tokenDefinitions).values({
      id: definitionId,
      campaignId: ids.campaign,
      name: "Concurrent token",
      defaultWidth: 64,
      defaultHeight: 64,
    });
    const placeActionId = crypto.randomUUID();
    const rescaleActionId = crypto.randomUUID();
    const [placement, rescale] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/token-definitions/${definitionId}/placements`,
        headers: headers(secrets.gm),
        payload: {
          actionId: placeActionId,
          sceneId: ids.scene,
          x: 80,
          y: 80,
        },
      }),
      app.inject({
        method: "PATCH",
        url: `/api/scenes/${ids.scene}/canvas`,
        headers: headers(secrets.gm),
        payload: {
          actionId: rescaleActionId,
          revision: 0,
          grid: {
            enabled: true,
            size: 32,
            offsetX: 0,
            offsetY: 0,
            color: "#ffffff",
            opacity: 0.2,
          },
        },
      }),
    ]);
    expect(placement.statusCode).toBe(201);
    expect(rescale.statusCode).toBe(200);
    const placedId = placement.json().id as string;
    const [placed] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, placedId));
    const [placementEvent] = await db
      .select({ sequence: schema.gameEvents.sequence })
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, placeActionId));
    const [rescaleEvent] = await db
      .select({ sequence: schema.gameEvents.sequence })
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, rescaleActionId));
    expect(placementEvent).toBeDefined();
    expect(rescaleEvent).toBeDefined();
    if (placementEvent!.sequence < rescaleEvent!.sequence) {
      expect(placed).toMatchObject({
        x: 32,
        y: 32,
        width: 32,
        height: 32,
        revision: 1,
      });
    } else {
      expect(placed).toMatchObject({
        x: 96,
        y: 96,
        width: 64,
        height: 64,
        revision: 0,
      });
    }
  });

  it("replays two player undos in durable transition LIFO order across snapshot recovery", async () => {
    const idsCreated: string[] = [];
    for (const color of ["#111111", "#222222"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/drawings",
        headers: headers(secrets.player),
        payload: {
          actionId: crypto.randomUUID(),
          sceneId: ids.scene,
          points: [0, 0, 10, 10],
          color,
        },
      });
      idsCreated.push(response.json().id);
    }
    for (let index = 0; index < 2; index++) {
      const undo = await app.inject({
        method: "POST",
        url: "/api/canvas/undo",
        headers: headers(secrets.player),
        payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
      });
      expect(undo.statusCode).toBe(200);
    }
    await app.close();
    app = Fastify();
    await app.register(cookie);
    registerRoutes(
      app,
      db as never,
      {
        in: () => ({ fetchSockets: async () => [] }),
        to: () => ({ emit() {} }),
      } as never,
    );
    await app.ready();
    const recoveredEmpty = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(recoveredEmpty.json().drawings).toEqual([]);
    const advertisedHistory = await app.inject({
      method: "GET",
      url: `/api/canvas/history?sceneId=${ids.scene}`,
      headers: headers(secrets.player),
    });
    expect(advertisedHistory.statusCode).toBe(200);
    const advertisedRedo = advertisedHistory
      .json<
        Array<{
          sequence: number;
          status: string;
          nextDirection: "undo" | "redo" | null;
        }>
      >()
      .find((entry) => entry.nextDirection === "redo");
    expect(advertisedRedo).toBeDefined();
    const firstRedo = await app.inject({
      method: "POST",
      url: "/api/canvas/redo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(firstRedo.statusCode).toBe(200);
    expect(firstRedo.json().sequence).toBe(advertisedRedo?.sequence);
    const recoveredFirst = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(
      recoveredFirst.json().drawings.map((item: { id: string }) => item.id),
    ).toEqual([idsCreated[0]]);
    const secondRedo = await app.inject({
      method: "POST",
      url: "/api/canvas/redo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(secondRedo.statusCode).toBe(200);
    const recoveredAll = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(
      recoveredAll.json().drawings.map((item: { id: string }) => item.id),
    ).toEqual(idsCreated);
    const advertisedUndoHistory = await app.inject({
      method: "GET",
      url: `/api/canvas/history?sceneId=${ids.scene}`,
      headers: headers(secrets.player),
    });
    const advertisedUndo = advertisedUndoHistory
      .json<Array<{ sequence: number; nextDirection: string | null }>>()
      .find((entry) => entry.nextDirection === "undo");
    expect(advertisedUndo).toBeDefined();
    const exactUndo = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(exactUndo.statusCode).toBe(200);
    expect(exactUndo.json().sequence).toBe(advertisedUndo?.sequence);
    const restoreUndo = await app.inject({
      method: "POST",
      url: "/api/canvas/redo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(restoreUndo.statusCode).toBe(200);
    for (const x of [0, 20]) {
      const fog = await app.inject({
        method: "POST",
        url: "/api/fog-reveals",
        headers: headers(secrets.gm),
        payload: {
          actionId: crypto.randomUUID(),
          sceneId: ids.scene,
          x,
          y: 0,
          width: 20,
          height: 20,
          operation: "REVEAL",
        },
      });
      expect(fog.statusCode).toBe(201);
    }
    for (let index = 0; index < 2; index++) {
      const undo = await app.inject({
        method: "POST",
        url: "/api/canvas/undo",
        headers: headers(secrets.gm),
        payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
      });
      expect(undo.statusCode).toBe(200);
    }
    for (let count = 1; count <= 2; count++) {
      const redo = await app.inject({
        method: "POST",
        url: "/api/canvas/redo",
        headers: headers(secrets.gm),
        payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
      });
      expect(redo.statusCode).toBe(200);
      const recovered = await app.inject({
        method: "GET",
        url: "/api/bootstrap",
        headers: headers(secrets.gm),
      });
      expect(recovered.json().fogReveals).toHaveLength(count);
    }
  });

  it("uses GM-global redo invalidation and retires physical legacy fog deletion", async () => {
    const drawing = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        points: [0, 0, 10, 10],
        color: "#abcdef",
      },
    });
    expect(drawing.statusCode).toBe(201);
    const gmUndo = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(gmUndo.statusCode).toBe(200);
    const fog = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        operation: "REVEAL",
      },
    });
    expect(fog.statusCode).toBe(201);
    const redo = await app.inject({
      method: "POST",
      url: "/api/canvas/redo",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(redo.statusCode).toBe(404);
    const legacy = await app.inject({
      method: "DELETE",
      url: "/api/fog-reveals/latest",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(legacy.statusCode).toBe(410);
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(snapshot.json().fogReveals).toHaveLength(1);
  });

  it("places definitions on GM inactive scenes while players remain bound to the active campaign scene", async () => {
    const inactiveSceneId = crypto.randomUUID();
    const foreignSceneId = crypto.randomUUID();
    const grid = {
      enabled: false,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#ffffff",
      opacity: 0.2,
    };
    await db.insert(schema.scenes).values([
      { id: inactiveSceneId, campaignId: ids.campaign, name: "Inactive", grid },
      {
        id: foreignSceneId,
        campaignId: ids.foreignCampaign,
        name: "Foreign",
        grid,
      },
    ]);
    await db
      .update(schema.tokenDefinitions)
      .set({ defaultWidth: 96, defaultHeight: 72 })
      .where(eq(schema.tokenDefinitions.id, ids.definition));

    const actionId = crypto.randomUUID();
    const placed = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${ids.definition}/placements`,
      headers: headers(secrets.gm),
      payload: { actionId, sceneId: inactiveSceneId, x: 128, y: 192 },
    });
    expect(placed.statusCode).toBe(201);
    expect(placed.json()).toMatchObject({
      sceneId: inactiveSceneId,
      width: 96,
      height: 72,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${ids.definition}/placements`,
      headers: headers(secrets.gm),
      payload: { actionId, sceneId: ids.scene, x: 0, y: 0 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(placed.json().id);

    const playerInactive = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${ids.definition}/placements`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: inactiveSceneId,
      },
    });
    expect(playerInactive.statusCode).toBe(403);
    const foreign = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${ids.definition}/placements`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: foreignSceneId },
    });
    expect(foreign.statusCode).toBe(404);

    const gmSnapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(
      gmSnapshot
        .json()
        .tokens.find((token: { id: string }) => token.id === placed.json().id),
    ).toMatchObject({ width: 96, height: 72 });
  });

  it("clamps fog to the scene world and rejects a fully outside reveal", async () => {
    const clamped = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        x: -20,
        y: 1070,
        width: 50,
        height: 50,
      },
    });
    expect(clamped.statusCode).toBe(201);
    expect(clamped.json()).toMatchObject({
      x: 0,
      y: 1070,
      width: 30,
      height: 10,
    });
    const outside = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        x: 2000,
        y: 0,
        width: 20,
        height: 20,
      },
    });
    expect(outside.statusCode).toBe(422);
    expect(outside.json()).toMatchObject({ error: "FOG_OUTSIDE_SCENE" });
  });

  it("creates BRUSH and POLYGON fog reveals with GM gating and idempotent replay (UIX-313)", async () => {
    const brushActionId = crypto.randomUUID();
    const brushPayload = {
      actionId: brushActionId,
      sceneId: ids.scene,
      operation: "REVEAL" as const,
      geometry: {
        type: "BRUSH" as const,
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 100 },
          { x: 140, y: 140 },
        ],
        radius: 12,
      },
    };
    const playerBrush = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.player),
      payload: brushPayload,
    });
    expect(playerBrush.statusCode).toBe(403);
    const brush = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: brushPayload,
    });
    expect(brush.statusCode).toBe(201);
    expect(brush.json()).toMatchObject({
      shape: "BRUSH",
      geometry: { type: "BRUSH", radius: 12 },
    });
    const brushReplay = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: brushPayload,
    });
    expect(brushReplay.statusCode).toBe(200);
    expect(brushReplay.json()).toMatchObject({ duplicate: true });

    const polygonActionId = crypto.randomUUID();
    const polygonPayload = {
      actionId: polygonActionId,
      sceneId: ids.scene,
      operation: "COVER" as const,
      geometry: {
        type: "POLYGON" as const,
        points: [
          { x: 200, y: 200 },
          { x: 260, y: 200 },
          { x: 230, y: 260 },
        ],
      },
    };
    const playerPolygon = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.player),
      payload: polygonPayload,
    });
    expect(playerPolygon.statusCode).toBe(403);
    const polygon = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: polygonPayload,
    });
    expect(polygon.statusCode).toBe(201);
    expect(polygon.json()).toMatchObject({
      shape: "POLYGON",
      operation: "COVER",
      geometry: { type: "POLYGON" },
    });
    const polygonReplay = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: polygonPayload,
    });
    expect(polygonReplay.statusCode).toBe(200);
    expect(polygonReplay.json()).toMatchObject({ duplicate: true });

    const degeneratePolygon = await app.inject({
      method: "POST",
      url: "/api/fog-reveals",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        operation: "REVEAL",
        geometry: {
          type: "POLYGON",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
          ],
        },
      },
    });
    expect(degeneratePolygon.statusCode).toBe(422);

    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    const shapes = snapshot
      .json()
      .fogReveals.map(
        (reveal: { geometry?: { type?: string } }) => reveal.geometry?.type,
      );
    expect(shapes).toEqual(expect.arrayContaining(["BRUSH", "POLYGON"]));
  });

  it("does not let a player delete their controlled token from an inactive scene", async () => {
    const inactiveSceneId = crypto.randomUUID();
    const inactiveTokenId = crypto.randomUUID();
    await db.insert(schema.scenes).values({
      id: inactiveSceneId,
      campaignId: ids.campaign,
      name: "GM preparation",
      grid: {
        enabled: true,
        size: 64,
        offsetX: 0,
        offsetY: 0,
        color: "#ffffff",
        opacity: 0.2,
      },
    });
    await db.insert(schema.tokens).values({
      id: inactiveTokenId,
      definitionId: ids.definition,
      sceneId: inactiveSceneId,
      name: "Hero in preparation",
      x: 0,
      y: 0,
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/tokens/${inactiveTokenId}`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), revision: 0 },
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toEqual({ error: "TOKEN_FORBIDDEN" });
    const [token] = await db
      .select({ id: schema.tokens.id })
      .from(schema.tokens)
      .where(eq(schema.tokens.id, inactiveTokenId));
    expect(token).toEqual({ id: inactiveTokenId });
  });

  it("allows only a GM to resize a placement with CAS and restores its size through undo", async () => {
    const playerDenied = await app.inject({
      method: "PATCH",
      url: `/api/tokens/${ids.token}/size`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        width: 96,
        height: 80,
      },
    });
    expect(playerDenied.statusCode).toBe(403);
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/tokens/${ids.token}/size`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 1,
        width: 96,
        height: 80,
      },
    });
    expect(stale.statusCode).toBe(409);
    const resized = await app.inject({
      method: "PATCH",
      url: `/api/tokens/${ids.token}/size`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        width: 96,
        height: 80,
      },
    });
    expect(resized.statusCode).toBe(200);
    expect(resized.json()).toMatchObject({
      width: 96,
      height: 96,
      revision: 1,
    });
    const undo = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(undo.statusCode).toBe(200);
    const [restored] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.token));
    expect(restored).toMatchObject({ width: 64, height: 64, revision: 2 });
  });

  it("persists token appearance with CAS and restores it through canvas history", async () => {
    const changed = await app.inject({
      method: "PATCH",
      url: `/api/tokens/${ids.token}/appearance`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        baseColor: "#285e9f",
        frameColor: "#f0c75e",
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      baseColor: "#285e9f",
      frameColor: "#f0c75e",
      revision: 1,
    });
    const undo = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(undo.statusCode).toBe(200);
    const [restored] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.token));
    expect(restored).toMatchObject({
      baseColor: "#b5623e",
      frameColor: null,
      revision: 2,
    });
  });

  it("moves mixed canvas targets atomically with permission, CAS, replay and compound history", async () => {
    const ownedDrawing = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        points: [0, 0, 10, 10],
        color: "#abcdef",
        x: 5,
        y: 7,
      },
    });
    const gmDrawing = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        points: [0, 0, 20, 20],
        color: "#123456",
      },
    });
    const denied = await app.inject({
      method: "POST",
      url: "/api/canvas/bulk",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        operation: "MOVE",
        deltaX: 10,
        deltaY: 20,
        targets: [
          { targetType: "TOKEN", targetId: ids.token, revision: 0 },
          { targetType: "DRAWING", targetId: gmDrawing.json().id, revision: 0 },
        ],
      },
    });
    expect(denied.statusCode).toBe(403);
    const stale = await app.inject({
      method: "POST",
      url: "/api/canvas/bulk",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        operation: "MOVE",
        deltaX: 10,
        deltaY: 20,
        targets: [
          { targetType: "TOKEN", targetId: ids.token, revision: 0 },
          {
            targetType: "DRAWING",
            targetId: ownedDrawing.json().id,
            revision: 9,
          },
        ],
      },
    });
    expect(stale.statusCode).toBe(409);
    let [unchangedToken] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.token));
    let [unchangedDrawing] = await db
      .select()
      .from(schema.drawings)
      .where(eq(schema.drawings.id, ownedDrawing.json().id));
    expect(unchangedToken).toMatchObject({ x: 0, y: 0, revision: 0 });
    expect(unchangedDrawing).toMatchObject({ x: 5, y: 7, revision: 0 });

    const actionId = crypto.randomUUID();
    const payload = {
      actionId,
      sceneId: ids.scene,
      operation: "MOVE",
      deltaX: 10,
      deltaY: 20,
      targets: [
        { targetType: "TOKEN", targetId: ids.token, revision: 0 },
        {
          targetType: "DRAWING",
          targetId: ownedDrawing.json().id,
          revision: 0,
        },
      ],
    };
    const moved = await app.inject({
      method: "POST",
      url: "/api/canvas/bulk",
      headers: headers(secrets.player),
      payload,
    });
    expect(moved.statusCode).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: "/api/canvas/bulk",
      headers: headers(secrets.player),
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ duplicate: true });
    [unchangedToken] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.token));
    [unchangedDrawing] = await db
      .select()
      .from(schema.drawings)
      .where(eq(schema.drawings.id, ownedDrawing.json().id));
    expect(unchangedToken).toMatchObject({ x: 10, y: 20, revision: 1 });
    expect(unchangedDrawing).toMatchObject({ x: 15, y: 27, revision: 1 });
    const undo = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(undo.statusCode).toBe(200);
    const redo = await app.inject({
      method: "POST",
      url: "/api/canvas/redo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(redo.statusCode).toBe(200);
    const [redoneToken] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.token));
    const [redoneDrawing] = await db
      .select()
      .from(schema.drawings)
      .where(eq(schema.drawings.id, ownedDrawing.json().id));
    expect(redoneToken).toMatchObject({ x: 10, y: 20, revision: 3 });
    expect(redoneDrawing).toMatchObject({ x: 15, y: 27, revision: 3 });
    const journals = await db
      .select()
      .from(schema.actionJournal)
      .where(eq(schema.actionJournal.actionId, actionId));
    expect(journals).toHaveLength(1);
    expect(journals[0]).toMatchObject({
      targetType: "CANVAS_BULK",
      status: "APPLIED",
    });
  });

  it("UIX-470 restores a directly deleted drawing through canvas undo", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        points: [4, 8, 24, 32],
        color: "#4ac7d9",
        x: 12,
        y: 18,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const drawing = created.json();

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/drawings/${drawing.id}`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), revision: drawing.revision },
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    const [missing] = await db
      .select()
      .from(schema.drawings)
      .where(eq(schema.drawings.id, drawing.id));
    expect(missing).toBeUndefined();

    const undo = await app.inject({
      method: "POST",
      url: "/api/canvas/undo",
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
    });
    expect(undo.statusCode, undo.body).toBe(200);
    expect(undo.json()).toMatchObject({ status: "UNDONE" });

    const [restored] = await db
      .select()
      .from(schema.drawings)
      .where(eq(schema.drawings.id, drawing.id));
    expect(restored).toMatchObject({
      id: drawing.id,
      sceneId: ids.scene,
      authorMembershipId: ids.player,
      points: [4, 8, 24, 32],
      color: "#4ac7d9",
      x: 12,
      y: 18,
      revision: 1,
    });
  });

  it("scopes chat character attribution to the authenticated campaign and player", async () => {
    const otherPlayerId = crypto.randomUUID();
    const otherCharacterId = crypto.randomUUID();
    await db.insert(schema.memberships).values({
      id: otherPlayerId,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Other player",
    });
    await db.insert(schema.characters).values({
      id: otherCharacterId,
      campaignId: ids.campaign,
      ownerMembershipId: otherPlayerId,
      name: "Other hero",
    });

    const ownCharacter = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        body: "Own character message",
        characterId: ids.character,
      },
    });
    expect(ownCharacter.statusCode, ownCharacter.body).toBe(201);
    expect(ownCharacter.json()).toMatchObject({
      membershipId: ids.player,
      characterId: ids.character,
      visibility: "PUBLIC",
    });

    const otherPlayerCharacter = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        body: "Impersonated character message",
        characterId: otherCharacterId,
      },
    });
    expect(otherPlayerCharacter.statusCode, otherPlayerCharacter.body).toBe(
      403,
    );
    expect(otherPlayerCharacter.json()).toEqual({
      error: "CHARACTER_FORBIDDEN",
    });

    const crossCampaignCharacter = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        body: "Cross-campaign character message",
        characterId: ids.foreignCharacter,
      },
    });
    expect(crossCampaignCharacter.statusCode, crossCampaignCharacter.body).toBe(
      403,
    );
    expect(crossCampaignCharacter.json()).toEqual({
      error: "CHARACTER_FORBIDDEN",
    });

    const gmCharacter = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        body: "GM character message",
        characterId: ids.character,
        visibility: "GM_ONLY",
      },
    });
    expect(gmCharacter.statusCode, gmCharacter.body).toBe(201);
    expect(gmCharacter.json()).toMatchObject({
      membershipId: ids.gm,
      characterId: ids.character,
      visibility: "GM_ONLY",
    });
  });

  it("deletes mixed canvas targets with repeatable monotonic compound history and CAS conflicts", async () => {
    const drawingResponse = await app.inject({
      method: "POST",
      url: "/api/drawings",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        points: [1, 2, 30, 40],
        color: "#fedcba",
        x: 9,
        y: 11,
      },
    });
    expect(drawingResponse.statusCode).toBe(201);
    const drawingId = drawingResponse.json().id as string;
    const [originalToken] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.token));
    const [originalDrawing] = await db
      .select()
      .from(schema.drawings)
      .where(eq(schema.drawings.id, drawingId));

    const deleted = await app.inject({
      method: "POST",
      url: "/api/canvas/bulk",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        operation: "DELETE",
        targets: [
          { targetType: "TOKEN", targetId: ids.token, revision: 0 },
          { targetType: "DRAWING", targetId: drawingId, revision: 0 },
        ],
      },
    });
    expect(deleted.statusCode).toBe(200);
    expect(
      await db
        .select()
        .from(schema.tokens)
        .where(eq(schema.tokens.id, ids.token)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.drawings)
        .where(eq(schema.drawings.id, drawingId)),
    ).toHaveLength(0);

    const history = async (direction: "undo" | "redo") =>
      app.inject({
        method: "POST",
        url: `/api/canvas/${direction}`,
        headers: headers(secrets.player),
        payload: { actionId: crypto.randomUUID(), sceneId: ids.scene },
      });
    const assertRestored = async (revision: number) => {
      const [token] = await db
        .select()
        .from(schema.tokens)
        .where(eq(schema.tokens.id, ids.token));
      const [drawing] = await db
        .select()
        .from(schema.drawings)
        .where(eq(schema.drawings.id, drawingId));
      expect(token).toMatchObject({
        id: originalToken.id,
        name: originalToken.name,
        width: originalToken.width,
        height: originalToken.height,
        revision,
      });
      expect(token.updatedAt).toBeInstanceOf(Date);
      expect(drawing).toMatchObject({
        id: originalDrawing.id,
        points: originalDrawing.points,
        color: originalDrawing.color,
        x: originalDrawing.x,
        y: originalDrawing.y,
        revision,
      });
      expect(drawing.createdAt).toBeInstanceOf(Date);
      expect(drawing.updatedAt).toBeInstanceOf(Date);
    };

    expect((await history("undo")).statusCode).toBe(200);
    await assertRestored(1);
    expect((await history("redo")).statusCode).toBe(200);
    expect(
      await db
        .select()
        .from(schema.tokens)
        .where(eq(schema.tokens.id, ids.token)),
    ).toHaveLength(0);
    expect((await history("undo")).statusCode).toBe(200);
    await assertRestored(2);
    expect((await history("redo")).statusCode).toBe(200);
    expect((await history("undo")).statusCode).toBe(200);
    await assertRestored(3);

    await db
      .update(schema.tokens)
      .set({ name: "Concurrent edit", revision: 4, updatedAt: new Date() })
      .where(
        and(eq(schema.tokens.id, ids.token), eq(schema.tokens.revision, 3)),
      );
    const conflictedRedo = await history("redo");
    expect(conflictedRedo.statusCode).toBe(409);
    expect(conflictedRedo.json()).toMatchObject({
      error: "HISTORY_CONFLICT_RESYNC",
    });
    const [conflictedToken] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.token));
    const [untouchedDrawing] = await db
      .select()
      .from(schema.drawings)
      .where(eq(schema.drawings.id, drawingId));
    expect(conflictedToken).toMatchObject({
      name: "Concurrent edit",
      revision: 4,
    });
    expect(untouchedDrawing).toMatchObject({ revision: 3 });
  });
  it("lets a GM assign and revoke additional character controllers", async () => {
    const additionalPlayerId = crypto.randomUUID();
    const additionalSecret = "a".repeat(40);
    await db.insert(schema.memberships).values({
      id: additionalPlayerId,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Additional player",
    });
    await db.insert(schema.sessions).values({
      membershipId: additionalPlayerId,
      tokenHash: hashToken(additionalSecret),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const invalidForeign = await app.inject({
      method: "PUT",
      url: `/api/characters/${ids.character}/controllers`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [ids.foreignPlayer],
      },
    });
    expect(invalidForeign.statusCode, invalidForeign.body).toBe(400);
    expect(invalidForeign.json()).toEqual({ error: "INVALID_CONTROLLER" });

    const assigned = await app.inject({
      method: "PUT",
      url: `/api/characters/${ids.character}/controllers`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [additionalPlayerId],
      },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(assigned.json()).toMatchObject({ revision: 1 });
    expect(new Set(assigned.json().controllerMembershipIds)).toEqual(
      new Set([ids.player, additionalPlayerId]),
    );

    const assignedSnapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(additionalSecret),
    });
    expect(assignedSnapshot.statusCode).toBe(200);
    expect(assignedSnapshot.json().characters).toEqual([
      expect.objectContaining({
        id: ids.character,
        controllerMembershipIds: [additionalPlayerId],
      }),
    ]);

    const assignedPatch = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}`,
      headers: headers(additionalSecret),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 1,
        notes: "Shared note",
      },
    });
    expect(assignedPatch.statusCode, assignedPatch.body).toBe(200);
    expect(assignedPatch.json()).toMatchObject({
      notes: "Shared note",
      revision: 2,
    });

    const revoked = await app.inject({
      method: "PUT",
      url: `/api/characters/${ids.character}/controllers`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 2,
        controllerMembershipIds: [],
      },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(revoked.json()).toMatchObject({
      controllerMembershipIds: [ids.player],
      revision: 3,
    });

    const revokedSnapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(additionalSecret),
    });
    expect(revokedSnapshot.statusCode).toBe(200);
    expect(revokedSnapshot.json().characters).toEqual([]);

    const revokedPatch = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}`,
      headers: headers(additionalSecret),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 3,
        notes: "Forbidden note",
      },
    });
    expect(revokedPatch.statusCode).toBe(403);
    expect(revokedPatch.json()).toEqual({ error: "CHARACTER_FORBIDDEN" });
  });
});

/**
 * UIX-471 — состояния фигуры: отравлен, без сознания, обездвижен, распластан.
 *
 * Проверяется то, чего не видно в юнит-тесте набора: кто вправе их менять и что
 * скрытая фигура не выдаёт себя даже отказом.
 */
describe("состояния токена", () => {
  const setConditions = (
    secret: string,
    conditions: string[],
    revision = 0,
    tokenId = ids.token,
  ) =>
    app.inject({
      method: "PATCH",
      url: `/api/tokens/${tokenId}/conditions`,
      headers: headers(secret),
      payload: { actionId: crypto.randomUUID(), revision, conditions },
    });

  const storedConditions = async (tokenId = ids.token) => {
    const [row] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, tokenId));
    return row!.conditions;
  };

  it("мастер выставляет несколько состояний сразу", async () => {
    const response = await setConditions(secrets.gm, ["PRONE", "POISONED"]);
    expect(response.statusCode).toBe(200);
    // Порядок нормализован по объявлению, а не по тому, как их назвали.
    expect(await storedConditions()).toEqual(["POISONED", "PRONE"]);
  });

  it("игрок правит состояния своей фигуры", async () => {
    // Состояния меняются каждый ход: гонять их через мастера значило бы
    // повторить историю с бросками инициативы, где посредник был узким местом.
    const response = await setConditions(secrets.player, ["RESTRAINED"]);
    expect(response.statusCode).toBe(200);
    expect(await storedConditions()).toEqual(["RESTRAINED"]);
  });

  it("не пускает игрока из чужой кампании", async () => {
    const response = await setConditions(secrets.foreignPlayer, ["POISONED"]);
    expect(response.statusCode).toBe(404);
    expect(await storedConditions()).toEqual([]);
  });

  it("не пускает игрока своей кампании к неподконтрольной фигуре", async () => {
    // Отдельно от проверки выше: там отказ приходит от изоляции кампаний, и
    // на нём проверка контроля над фигурой не проверяется вовсе — это и
    // показала диверсия, снявшая её без единого падения.
    const bystander = crypto.randomUUID();
    const bystanderSecret = "b".repeat(40);
    await db.insert(schema.memberships).values({
      id: bystander,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Сосед",
    });
    await db.insert(schema.sessions).values({
      membershipId: bystander,
      tokenHash: hashToken(bystanderSecret),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await setConditions(bystanderSecret, ["POISONED"]);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "TOKEN_FORBIDDEN" });
    expect(await storedConditions()).toEqual([]);
  });

  it("скрытая фигура не выдаёт себя игроку", async () => {
    // Тот же запрет, что в UIX-449: отказ «нет такой» вместо «не твоя», иначе
    // по коду ответа читается наличие фигуры за туманом.
    await db
      .update(schema.tokens)
      .set({ visible: false })
      .where(eq(schema.tokens.id, ids.token));
    const response = await setConditions(secrets.player, ["POISONED"]);
    expect(response.statusCode).toBe(404);
    expect(await storedConditions()).toEqual([]);
  });

  it("отвергает неизвестное состояние", async () => {
    const response = await setConditions(secrets.gm, ["CURSED"]);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await storedConditions()).toEqual([]);
  });

  it("разводит одновременные правки конфликтом", async () => {
    expect((await setConditions(secrets.gm, ["POISONED"], 0)).statusCode).toBe(
      200,
    );
    const stale = await setConditions(secrets.gm, ["PRONE"], 0);
    expect(stale.statusCode).toBe(409);
    expect(await storedConditions()).toEqual(["POISONED"]);
  });

  it("состояния живут у размещённой фигуры, а не у определения", async () => {
    // Один персонаж может стоять на двух сценах и быть отравлен только на одной.
    const secondToken = crypto.randomUUID();
    await db.insert(schema.tokens).values({
      id: secondToken,
      definitionId: ids.definition,
      sceneId: ids.scene,
      name: "Hero",
      x: 300,
      y: 300,
    });
    await setConditions(secrets.gm, ["POISONED"]);
    expect(await storedConditions()).toEqual(["POISONED"]);
    expect(await storedConditions(secondToken)).toEqual([]);
  });
});
