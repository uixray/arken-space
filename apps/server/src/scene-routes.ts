import {commitSceneActivation,commitSceneMetadata,commitSceneCreate,SessionStateError} from "./session-state-command.js";
import {commitFogCreate} from "./fog-create-command.js";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";
import { and, eq, inArray, sql as importedSql } from "drizzle-orm";
import {
  campaigns,
  scenes,
  assets,
  gameEvents,
  actionJournal,
  fogReveals,
  tokens,
  drawings,
} from "@arken/db";
import { z } from "zod";
import {
  activateSceneSchema,
  createSceneSchema,
  updateSceneMetadataSchema,
  createFogRevealSchema,
  isometricSceneGeometrySchema,
  validateIsometricMove,
  isometricFloorId,
  map3dSpecSchema,
  map3dMovementGeometry,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";
import { findAction } from "./action-lookup.js";
import { canonicalizeFogGeometry, FogGeometryError } from "./fog-geometry.js";
import { campaignRoom } from "./rooms.js";
import { canvasSceneVisibleTo } from "./drawing-events.js";
import { canvasLayerLevel } from "./isometric-layers.js";
import { invalidateRedoBranch } from "./canvas-history.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
type CanvasDatabase = ReturnType<
  typeof import("./campaign-pause-guard.js").campaignCanvasDatabase
>;

export {fitFrameToWorld} from "./scene-frame.js";

function sceneDto(
  scene: typeof scenes.$inferSelect,
  activeSceneId: string | null,
) {
  return {
    id: scene.id,
    name: scene.name,
    titleLabel: scene.titleLabel,
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
  app.put("/api/scenes/:id/isometric", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      actionId: z.string().uuid(), revision: z.number().int().nonnegative(),
      geometry: isometricSceneGeometrySchema,
      threeD: map3dSpecSchema.optional(),
      projection: z.enum(["ISOMETRIC", "THREE_D"]).optional(),
      mapAssetId: z.string().uuid().optional(),
    }).strict().parse(request.body);
    const result = await canvasTx(auth.campaignId).transaction(async tx => {
      const [current] = await tx.select().from(scenes)
        .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId))).limit(1).for("update");
      if (!current) return "NOT_FOUND" as const;
      const [duplicate] = await tx.select({ sequence: gameEvents.sequence }).from(gameEvents)
        .where(and(eq(gameEvents.campaignId, auth.campaignId), eq(gameEvents.actionId, body.actionId))).limit(1);
      if (duplicate) return "DUPLICATE" as const;
      if (body.revision !== current.revision) return "CONFLICT" as const;
      if (body.threeD) {
        if (body.projection === "ISOMETRIC") return "INVALID_3D" as const;
        if (!body.threeD.reviewed || body.geometry.metersPerCell < .1 || body.geometry.metersPerCell > 100)
          return "REVIEW_REQUIRED" as const;
        try { body.geometry = isometricSceneGeometrySchema.parse(map3dMovementGeometry(body.geometry, body.threeD)); }
        catch { return "INVALID_3D" as const; }
        const sourceIds = [...new Set([...(body.threeD.sources?.map(s=>s.assetId) ?? []),...(body.mapAssetId?[body.mapAssetId]:[])])];
        if (sourceIds.length) {
          const owned = await tx.select({id:assets.id}).from(assets).where(and(eq(assets.campaignId,auth.campaignId),eq(assets.kind,"MAP"),inArray(assets.id,sourceIds))).for("share");
          if (owned.length !== sourceIds.length) return "INVALID_3D" as const;
        }
      } else if (body.projection === "THREE_D" || current.projection === "THREE_D") return "INVALID_3D" as const;
      if (body.geometry.floors.some(f => {
        const x = current.grid.offsetX + f.bounds.x * current.grid.size, y = current.grid.offsetY + f.bounds.y * current.grid.size;
        return x < -32768 || y < -32768 || x + f.bounds.width * current.grid.size > 32768 || y + f.bounds.height * current.grid.size > 32768;
      })) return "LAYER_BOUNDS" as const;
      if (current.grid.isometric && current.grid.isometric.floors[0]!.id !== body.geometry.floors[0]!.id)
        return "PLACEMENT_BLOCKED" as const;
      const layerRows = [
        ...await tx.select({ levelId: fogReveals.levelId }).from(fogReveals).where(eq(fogReveals.sceneId, id)),
        ...await tx.select({ levelId: drawings.levelId }).from(drawings).where(eq(drawings.sceneId, id)),
      ];
      if (layerRows.some(row => !body.geometry.floors.some(f => f.id === isometricFloorId(body.geometry, row.levelId))))
        return "PLACEMENT_BLOCKED" as const;
      if (!["ISOMETRIC","THREE_D"].includes(current.projection) || !current.grid.isometric) {
        // Never reinterpret existing pixel art/fog/placements as a new floor.
        const occupied = await tx.execute(importedSql`select 1 from tokens where scene_id = ${id} union all select 1 from drawings where scene_id = ${id} union all select 1 from fog_reveals where scene_id = ${id} limit 1`);
        if (occupied.length) return "NOT_EMPTY" as const;
      }
      const placements = await tx.select().from(tokens).where(eq(tokens.sceneId, id));
      for (const token of placements) {
        const point = {
          x: (token.x + token.width / 2 - current.grid.offsetX) / current.grid.size,
          y: (token.y + token.height - current.grid.offsetY) / current.grid.size,
          floorId: isometricFloorId(body.geometry, token.levelId),
        };
        if (token.z !== 0 || !validateIsometricMove(body.geometry, point, point).allowed)
          return "PLACEMENT_BLOCKED" as const;
      }
      const source = body.threeD?.sources?.find(s=>s.assetId===body.mapAssetId);
      const [next] = await tx.update(scenes).set({ projection: body.projection ?? (body.threeD ? "THREE_D" : "ISOMETRIC"),
        ...(body.threeD ? {width:Math.max(current.width,...body.geometry.floors.map(f=>Math.ceil(current.grid.offsetX+(f.bounds.x+f.bounds.width)*current.grid.size))),height:Math.max(current.height,...body.geometry.floors.map(f=>Math.ceil(current.grid.offsetY+(f.bounds.y+f.bounds.height)*current.grid.size)))} : {}),
        ...(body.mapAssetId ? { mapAssetId:body.mapAssetId } : {}),
        ...(source ? { backgroundX:0,backgroundY:0,backgroundWidth:source.width/source.pixelsPerCell*current.grid.size,backgroundHeight:source.height/source.pixelsPerCell*current.grid.size } : {}),
        grid: { ...current.grid, ...(body.threeD?{threeD:body.threeD}:{}), isometric: body.geometry, metersPerCell: body.geometry.metersPerCell },
        revision: current.revision + 1, updatedAt: new Date(),
      }).where(eq(scenes.id, id)).returning();
      if (!next) throw new Error("SCENE_UPDATE_FAILED");
      await invalidateRedoBranch(tx, auth, id);
      // An old SCENE_CANVAS snapshot must never remove/replace the new policy
      // while leaving projection=ISOMETRIC (or silently resurrect old walls).
      await tx.update(actionJournal).set({ status: "INVALIDATED", updatedAt: new Date(),
        transitionSequence: importedSql`nextval(pg_get_serial_sequence('action_journal', 'transition_sequence'))`,
      }).where(and(eq(actionJournal.campaignId, auth.campaignId), eq(actionJournal.sceneId, id),
        eq(actionJournal.type, "SCENE_CANVAS"), inArray(actionJournal.status, ["APPLIED", "UNDONE"])));
      await tx.insert(gameEvents).values({ campaignId: auth.campaignId,
        actionId: body.actionId, membershipId: auth.membershipId, type: "scene.isometric",
        entityType: "scene", entityId: id, entityRevision: next.revision,
        payload: { sceneId: id },
      });
      return "SAVED" as const;
    });
    if (result === "NOT_FOUND") return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (result === "CONFLICT") return reply.code(409).send({ error: "SCENE_CONFLICT", message: "Сцена изменена. Обновите черновик перед сохранением." });
    if (result === "NOT_EMPTY") return reply.code(409).send({ error: "ISOMETRIC_REQUIRES_EMPTY_SCENE", message: "Для включения изометрии выберите сцену без токенов, рисунков и тумана." });
    if (result === "PLACEMENT_BLOCKED") return reply.code(409).send({ error: "ISOMETRIC_TOKEN_WOULD_BE_BLOCKED", message: "Разметка запирает токен или удаляет ярус с данными. Освободите его перед сохранением; основной ярус сохраняется." });
    if (result === "LAYER_BOUNDS") return reply.code(422).send({ error: "ISOMETRIC_LAYER_BOUNDS", message: "Логические границы яруса должны оставаться в диапазоне от −32768 до 32768 пикселей." });
    if (result === "REVIEW_REQUIRED") return reply.code(422).send({ error:"3D_REVIEW_REQUIRED",message:"Подтвердите планировку и задайте масштаб от 0,1 до 100 метров в клетке." });
    if (result === "INVALID_3D") return reply.code(422).send({ error:"INVALID_3D_PLAN",message:"Проверьте полное покрытие ярусов, проходимость лестниц и источники карты." });
    await broadcast(auth.campaignId);
    return { ok: true, duplicate: result === "DUPLICATE" };
  });
  app.post("/api/scenes", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createSceneSchema.parse(request.body);
    if (body.grid.isometric || body.grid.threeD) return reply.code(422).send({ error: "USE_ISOMETRIC_SETTINGS" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const replay = duplicate.entityId
        ? await findSceneDto(db, auth.campaignId, duplicate.entityId)
        : null;
      if (replay) return reply.code(200).send(replay);
      return reply.code(409).send({ error: "ACTION_REPLAY_UNAVAILABLE" });
    }
    let scene;
    try{const result=await db.transaction(tx=>commitSceneCreate(tx,auth,body));
      if(result.duplicate){const replay=result.duplicate.entityId?await findSceneDto(db,auth.campaignId,result.duplicate.entityId):null;if(replay)return reply.code(200).send(replay);return reply.code(409).send({error:"ACTION_REPLAY_UNAVAILABLE"});}
      scene=result.created;
    }catch(error){if(error instanceof SessionStateError)return reply.code(error.statusCode).send(error.details);throw error;}
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
    let scene;
    try {
      const result=await canvasTx(auth.campaignId).transaction(tx=>commitSceneMetadata(tx,auth,id,body));
      if(result.duplicate){const replay=await findSceneDto(db,auth.campaignId,id);if(replay)return reply.code(200).send(replay);return reply.code(409).send({error:"ACTION_REPLAY_UNAVAILABLE"});}
      scene=result.updated;
    } catch(error){if(error instanceof SessionStateError)return reply.code(error.statusCode).send(error.details);throw error;}
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
    const body=activateSceneSchema.parse(request.body);
    if(await findAction(db,auth.campaignId,body.actionId))return {ok:true,duplicate:true};
    try{const result=await canvasTx(auth.campaignId).transaction(tx=>commitSceneActivation(tx,auth,body));if(result.duplicate)return {ok:true,duplicate:true};}
    catch(error){if(error instanceof SessionStateError)return reply.code(error.statusCode).send(error.details);throw error;}
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
    let result;
    try{result=await canvasTx(auth.campaignId).transaction(tx=>commitFogCreate(tx,auth,body));}
    catch(error){if(error instanceof FogGeometryError)return reply.code(422).send({error:error.code});throw error;}
    const { reveal, event } = result;
    const actionId=body.actionId;
    const [deliveryScene] = await db.select({ grid: scenes.grid }).from(scenes)
      .where(and(eq(scenes.id, scene.id), eq(scenes.campaignId, auth.campaignId))).limit(1);
    if (!deliveryScene || deliveryScene.grid.isometric) {
      await broadcast(auth.campaignId);
      return reply.code(201).send(reveal);
    }
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
