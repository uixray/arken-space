import {commitDrawingUpdate,commitDrawingCopy,commitDrawingDelete} from "./drawing-state-command.js";
import {commitDrawingCreate} from "./drawing-create-command.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  createDrawingSchema,
  drawingCommandSchema,
  updateDrawingSchema,
} from "@arken/contracts";
import { actionJournal, assets, drawings, gameEvents, scenes } from "@arken/db";
import { requireAuth } from "./auth.js";
import { canvasLayerLevel } from "./isometric-layers.js";
import { findAction } from "./action-lookup.js";
import { invalidateRedoBranch } from "./canvas-history.js";
import { drawingDto, isHiddenStamp, isStampDrawing } from "./drawing-kinds.js";
import type { DrawingChange } from "./drawing-events.js";
import {
  CAMPAIGN_IMAGE_STAMP_PACK_ID,
  stampCatalog,
  textureCatalog,
} from "./terrain-stamp-routes.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type CanvasDatabase = ReturnType<
  typeof import("./campaign-pause-guard.js").campaignCanvasDatabase
>;

/** Drawing replays are scoped to the exact actor, operation and target. */
async function drawingActionReplay(
  db: Database,
  auth: { campaignId: string; membershipId: string },
  actionId: string,
  type: "DRAWING_CREATE" | "DRAWING_UPDATE" | "DRAWING_DELETE",
  targetId: string | null,
  sceneId?: string,
): Promise<"duplicate" | "conflict" | null> {
  const [action] = await db
    .select()
    .from(actionJournal)
    .where(
      and(
        eq(actionJournal.campaignId, auth.campaignId),
        eq(actionJournal.actionId, actionId),
      ),
    )
    .limit(1);
  if (!action) return null;
  const matches =
    action.actorMembershipId === auth.membershipId &&
    action.type === type &&
    action.targetType === "DRAWING" &&
    (targetId === null || action.targetId === targetId) &&
    (sceneId === undefined || action.sceneId === sceneId);
  return matches ? "duplicate" : "conflict";
}

/**
 * Freehand drawings, terrain stamps and texture strokes (UIX-706): create,
 * update, copy and delete. Every write goes through `canvasTx` — the shared
 * campaign pause/lock guard — and is journaled for undo/redo.
 */
export function registerDrawingRoutes(
  app: FastifyInstance,
  db: Database,
  {
    canvasTx,
    publish,
  }: {
    canvasTx: (campaignId: string) => CanvasDatabase;
    /** UIX-412: sends the change to the campaign (see drawing-events.ts). */
    publish: (campaignId: string, change: DrawingChange) => Promise<void>;
  },
) {
  app.post("/api/drawings", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createDrawingSchema.parse(request.body);
    if (
      (body.kind === "STAMP" || body.kind === "TEXTURE") &&
      auth.role !== "GM"
    )
      return reply.code(403).send({ error: "STAMP_FORBIDDEN" });
    // UIX-706: a stamp or texture source is either a catalog entry or an
    // IMAGE asset of this campaign; anything else is refused before any write.
    if (body.kind === "STAMP" || body.kind === "TEXTURE") {
      if (body.packId === CAMPAIGN_IMAGE_STAMP_PACK_ID) {
        const [image] = await db
          .select({ id: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.id, body.assetKey),
              eq(assets.campaignId, auth.campaignId),
              eq(assets.kind, "IMAGE"),
            ),
          )
          .limit(1);
        if (!image)
          return reply.code(404).send({ error: "STAMP_IMAGE_NOT_FOUND" });
      } else if (
        !(body.kind === "STAMP" ? stampCatalog() : textureCatalog()).has(
          body.assetKey,
        )
      )
        return reply.code(400).send({ error: "STAMP_TEMPLATE_UNKNOWN" });
    }
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const replay = await drawingActionReplay(
      db,
      auth,
      body.actionId,
      "DRAWING_CREATE",
      null,
      scene.id,
    );
    if (replay === "duplicate")
      return reply.code(200).send({ duplicate: true });
    if (
      replay === "conflict" ||
      (await findAction(db, auth.campaignId, body.actionId))
    )
      return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    const actionId=body.actionId;
    const saved=await canvasTx(auth.campaignId).transaction(tx=>commitDrawingCreate(tx,auth,body));
    await publish(auth.campaignId, {
      before: null,
      after: saved.drawing,
      sequence: Number(saved.event.sequence),
      actionId,
      emittedAt: saved.event.createdAt.toISOString(),
    });
    return reply.code(201).send(drawingDto(saved.drawing));
  });

  app.patch("/api/drawings/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = updateDrawingSchema.parse(request.body);
    const [row] = await db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(and(eq(drawings.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    if (isStampDrawing(row.drawing)) {
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "STAMP_FORBIDDEN" });
      if (body.color !== undefined || body.strokeWidth !== undefined)
        return reply.code(422).send({ error: "STAMP_FIELD_FORBIDDEN" });
    } else if (
      body.size !== undefined ||
      body.rotation !== undefined ||
      body.layer !== undefined
    ) {
      return reply.code(422).send({ error: "DRAWING_KIND_MISMATCH" });
    }
    if (
      !isStampDrawing(row.drawing) &&
      auth.role !== "GM" &&
      row.drawing.authorMembershipId !== auth.membershipId
    )
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    const replay = await drawingActionReplay(
      db,
      auth,
      body.actionId,
      "DRAWING_UPDATE",
      id,
    );
    if (replay === "duplicate")
      return reply.code(200).send({ duplicate: true });
    if (
      replay === "conflict" ||
      (await findAction(db, auth.campaignId, body.actionId))
    )
      return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    if (row.drawing.revision !== body.revision)
      return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    const actionId=body.actionId;
    const saved = await canvasTx(auth.campaignId).transaction(tx=>commitDrawingUpdate(tx,auth,id,body));
    if (!saved) return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    await publish(auth.campaignId, {
      before: row.drawing,
      after: saved.updated,
      sequence: Number(saved.event.sequence),
      actionId,
      emittedAt: saved.event.createdAt.toISOString(),
    });
    return drawingDto(saved.updated);
  });

  app.post("/api/drawings/:id/copy", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = drawingCommandSchema.parse(request.body);
    const [row] = await db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(and(eq(drawings.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    if (isStampDrawing(row.drawing) && auth.role !== "GM")
      return reply.code(403).send({ error: "STAMP_FORBIDDEN" });
    if (
      !isStampDrawing(row.drawing) &&
      auth.role !== "GM" &&
      row.drawing.authorMembershipId !== auth.membershipId
    )
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    const priorCopy = await findAction(db, auth.campaignId, body.actionId);
    if (priorCopy) {
      const payload = priorCopy.payload as { sourceDrawingId?: unknown } | null;
      if (
        priorCopy.membershipId === auth.membershipId &&
        priorCopy.type === "drawing.copied" &&
        priorCopy.entityType === "drawing" &&
        payload?.sourceDrawingId === id
      )
        return reply.code(200).send({ duplicate: true });
      return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    }
    if (row.drawing.revision !== body.revision)
      return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    const saved = await canvasTx(auth.campaignId).transaction(tx=>commitDrawingCopy(tx,auth,id,body));
    if(!saved)return reply.code(409).send({error:"DRAWING_CONFLICT"});
    await publish(auth.campaignId, {
      before: null,
      after: saved.copy,
      sequence: Number(saved.event.sequence),
      actionId: body.actionId,
      emittedAt: saved.event.createdAt.toISOString(),
    });
    return reply.code(201).send(drawingDto(saved.copy));
  });

  app.delete("/api/drawings/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = drawingCommandSchema.parse(request.body);
    const [row] = await db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(and(eq(drawings.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) {
      const [priorDelete] = await db
        .select()
        .from(actionJournal)
        .where(
          and(
            eq(actionJournal.campaignId, auth.campaignId),
            eq(actionJournal.actionId, body.actionId),
            eq(actionJournal.type, "DRAWING_DELETE"),
            eq(actionJournal.targetType, "DRAWING"),
            eq(actionJournal.targetId, id),
            eq(actionJournal.actorMembershipId, auth.membershipId),
          ),
        )
        .limit(1);
      if (priorDelete) return reply.code(200).send({ duplicate: true });
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    }
    if (isStampDrawing(row.drawing) && auth.role !== "GM")
      return reply.code(403).send({ error: "STAMP_FORBIDDEN" });
    if (
      !isStampDrawing(row.drawing) &&
      auth.role !== "GM" &&
      row.drawing.authorMembershipId !== auth.membershipId
    )
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    const replay = await drawingActionReplay(
      db,
      auth,
      body.actionId,
      "DRAWING_DELETE",
      id,
    );
    if (replay === "duplicate")
      return reply.code(200).send({ duplicate: true });
    if (
      replay === "conflict" ||
      (await findAction(db, auth.campaignId, body.actionId))
    )
      return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    if (row.drawing.revision !== body.revision)
      return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    const event = await canvasTx(auth.campaignId).transaction(tx=>commitDrawingDelete(tx,auth,id,body));
    if(!event)return reply.code(409).send({error:"DRAWING_CONFLICT"});
    await publish(auth.campaignId, {
      before: row.drawing,
      after: null,
      sequence: Number(event.sequence),
      actionId: body.actionId,
      emittedAt: event.createdAt.toISOString(),
    });
    return reply.code(204).send();
  });
}
