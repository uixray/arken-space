import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";
import { and, eq } from "drizzle-orm";
import {
  campaigns,
  scenes,
  assets,
  gameEvents,
  actionJournal,
  fogReveals,
} from "@arken/db";
import { z } from "zod";
import {
  activateSceneSchema,
  createSceneSchema,
  updateSceneMetadataSchema,
  createFogRevealSchema,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";
import { findAction } from "./action-lookup.js";
import { canonicalizeFogGeometry, FogGeometryError } from "./fog-geometry.js";
import { campaignRoom } from "./rooms.js";
import { canvasSceneVisibleTo } from "./drawing-events.js";
import { invalidateRedoBranch } from "./canvas-history.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
type CanvasDatabase = ReturnType<
  typeof import("./campaign-pause-guard.js").campaignCanvasDatabase
>;

export function fitFrameToWorld(
  assetWidth: number | null | undefined,
  assetHeight: number | null | undefined,
  worldWidth: number,
  worldHeight: number,
) {
  if (!assetWidth || !assetHeight)
    return { x: 0, y: 0, width: worldWidth, height: worldHeight };
  const scale = Math.min(worldWidth / assetWidth, worldHeight / assetHeight);
  const width = assetWidth * scale;
  const height = assetHeight * scale;
  return {
    x: (worldWidth - width) / 2,
    y: (worldHeight - height) / 2,
    width,
    height,
  };
}

function sceneDto(
  scene: typeof scenes.$inferSelect,
  activeSceneId: string | null,
) {
  return {
    id: scene.id,
    name: scene.name,
    projection: scene.projection,
    mapAssetId: scene.mapAssetId,
    width: scene.width,
    height: scene.height,
    backgroundFrame: {
      x: scene.backgroundX,
      y: scene.backgroundY,
      width: scene.backgroundWidth,
      height: scene.backgroundHeight,
    },
    grid: scene.grid,
    mapScale: scene.mapScale,
    revision: scene.revision,
    active: activeSceneId === scene.id,
  };
}

async function findSceneDto(db: Database, campaignId: string, sceneId: string) {
  const [row] = await db
    .select({ scene: scenes, activeSceneId: campaigns.activeSceneId })
    .from(scenes)
    .innerJoin(campaigns, eq(campaigns.id, scenes.campaignId))
    .where(and(eq(scenes.id, sceneId), eq(scenes.campaignId, campaignId)))
    .limit(1);
  return row ? sceneDto(row.scene, row.activeSceneId) : null;
}

/**
 * Scenes (create, edit, activate) and fog reveals. Moved out of routes.ts
 * unchanged (legacy cleanup after the 15.10 audit); every canvas write still
 * goes through canvasTx.
 */
export function registerSceneRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
  {
    canvasTx,
    broadcast,
  }: {
    canvasTx: (campaignId: string) => CanvasDatabase;
    broadcast: (campaignId: string) => Promise<void>;
  },
) {
  app.post("/api/scenes", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createSceneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const replay = duplicate.entityId
        ? await findSceneDto(db, auth.campaignId, duplicate.entityId)
        : null;
      if (replay) return reply.code(200).send(replay);
      return reply.code(409).send({ error: "ACTION_REPLAY_UNAVAILABLE" });
    }
    const mapAsset = body.mapAssetId
      ? (
          await db
            .select({
              id: assets.id,
              kind: assets.kind,
              width: assets.width,
              height: assets.height,
            })
            .from(assets)
            .where(
              and(
                eq(assets.id, body.mapAssetId),
                eq(assets.campaignId, auth.campaignId),
              ),
            )
            .limit(1)
        )[0]
      : null;
    if (body.mapAssetId && !mapAsset)
      return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    if (mapAsset && mapAsset.kind !== "MAP")
      return reply.code(422).send({ error: "MAP_ASSET_REQUIRED" });
    const initialBackground =
      body.backgroundFrame ??
      fitFrameToWorld(
        mapAsset?.width,
        mapAsset?.height,
        body.width,
        body.height,
      );
    const { actionId, backgroundFrame: _backgroundFrame, ...sceneInput } = body;
    const scene = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(scenes)
        .values({
          campaignId: auth.campaignId,
          ...sceneInput,
          mapAssetId: body.mapAssetId ?? null,
          backgroundX: initialBackground.x,
          backgroundY: initialBackground.y,
          backgroundWidth: initialBackground.width,
          backgroundHeight: initialBackground.height,
        })
        .returning();
      if (!created) throw new Error("SCENE_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "scene.created",
        entityType: "scene",
        entityId: created.id,
        payload: { sceneId: created.id },
      });
      return created;
    });
    await broadcast(auth.campaignId);
    return reply.code(201).send(sceneDto(scene, null));
  });

  app.patch("/api/scenes/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsedBody = updateSceneMetadataSchema.safeParse(request.body);
    if (!parsedBody.success)
      return reply.code(400).send({
        error: "INVALID_SCENE_METADATA",
        issues: parsedBody.error.issues,
      });
    const body = parsedBody.data;
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const replay = duplicate.entityId
        ? await findSceneDto(db, auth.campaignId, duplicate.entityId)
        : null;
      if (replay) return reply.code(200).send(replay);
      return reply.code(409).send({ error: "ACTION_REPLAY_UNAVAILABLE" });
    }
    const [current] = await db
      .select()
      .from(scenes)
      .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (body.revision !== current.revision)
      return reply.code(409).send({ error: "SCENE_CONFLICT" });
    const { actionId, revision: _revision, ...sceneUpdates } = body;
    if (body.mapAssetId) {
      const [mapAsset] = await db
        .select({ kind: assets.kind })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.mapAssetId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!mapAsset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      if (mapAsset.kind !== "MAP")
        return reply.code(422).send({ error: "MAP_ASSET_REQUIRED" });
    }
    const scene = await canvasTx(auth.campaignId).transaction(async (tx) => {
      const [updated] = await tx
        .update(scenes)
        .set({
          ...sceneUpdates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(scenes.id, id), eq(scenes.revision, current.revision)))
        .returning();
      if (!updated) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "scene.updated",
        entityType: "scene",
        entityId: updated.id,
        payload: { sceneId: updated.id },
      });
      return updated;
    });
    if (!scene) return reply.code(409).send({ error: "SCENE_CONFLICT" });
    await broadcast(auth.campaignId);
    const [campaign] = await db
      .select({ activeSceneId: campaigns.activeSceneId })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    return sceneDto(scene, campaign?.activeSceneId ?? null);
  });

  app.post("/api/scenes/activate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = activateSceneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return { ok: true, duplicate: true };
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    await canvasTx(auth.campaignId).transaction(async (tx) => {
      await tx
        .update(campaigns)
        .set({ activeSceneId: scene.id, updatedAt: new Date() })
        .where(eq(campaigns.id, auth.campaignId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "scene.activated",
        entityType: "scene",
        entityId: scene.id,
        payload: { sceneId: scene.id },
      });
    });
    await broadcast(auth.campaignId);
    return { ok: true };
  });

  app.post("/api/fog-reveals", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createFogRevealSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const legacy = !body.geometry;
    const requestedGeometry = body.geometry ?? {
      type: "RECT" as const,
      x: body.x!,
      y: body.y!,
      width: body.width!,
      height: body.height!,
    };
    let canonical;
    try {
      canonical = canonicalizeFogGeometry(requestedGeometry, scene, legacy);
    } catch (error) {
      if (error instanceof FogGeometryError)
        return reply.code(422).send({ error: error.code });
      throw error;
    }
    const { actionId } = body;
    const revealInput = {
      sceneId: scene.id,
      operation: body.operation,
      shape: canonical.geometry.type,
      geometry: canonical.geometry,
      bbox: canonical.bbox,
      x: canonical.bbox.x,
      y: canonical.bbox.y,
      width: canonical.bbox.width,
      height: canonical.bbox.height,
    };
    const result = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, scene.id);
      const [reveal] = await tx
        .insert(fogReveals)
        .values(revealInput)
        .returning();
      if (!reveal) throw new Error("FOG_CREATE_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "fog.created",
          entityType: "fog",
          entityId: reveal.id,
          payload: reveal,
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: scene.id,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "FOG_CREATE",
        targetType: "FOG",
        targetId: reveal.id,
        before: null,
        after: reveal,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { reveal, event };
    });
    const { reveal, event } = result;
    if (reveal) {
      /**
       * UIX-408: событие уходит только тем, у кого эта сцена в снапшоте.
       *
       * Раньше оно летело всей кампании, а лишнее отсеивалось на клиенте при
       * отрисовке. После сужения выборки это перестало быть безобидным:
       * клиент пришивает пришедший туман к `snapshot.fogReveals` без проверки
       * сцены, и накопленное пережило бы любое число рассылок — инвариант «в
       * снапшоте туман только видимых сцен» ломался бы прямо на проводе.
       */
      const envelope = {
        sequence: Number(event.sequence),
        actionId,
        emittedAt: event.createdAt.toISOString(),
        data: reveal,
      };
      const [current] = await db
        .select({ activeSceneId: campaigns.activeSceneId })
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      for (const socket of await io
        .in(campaignRoom(auth.campaignId))
        .fetchSockets())
        if (
          current &&
          canvasSceneVisibleTo(socket.data, current, reveal.sceneId)
        )
          socket.emit("fog:created", envelope);
    }
    return reply.code(201).send(reveal);
  });

  app.delete("/api/fog-reveals/latest", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    return reply.code(410).send({
      error: "LEGACY_FOG_UNDO_REMOVED",
      replacement: "/api/canvas/undo",
    });
  });
}
