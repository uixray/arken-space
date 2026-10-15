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
import { findAction } from "./action-lookup.js";
import { invalidateRedoBranch } from "./canvas-history.js";
import { drawingDto, isHiddenStamp, isStampDrawing } from "./drawing-kinds.js";
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
    broadcast,
  }: {
    canvasTx: (campaignId: string) => CanvasDatabase;
    broadcast: (campaignId: string) => Promise<void>;
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
    const { actionId, ...input } = body;
    const drawingInput =
      input.kind === "STAMP"
        ? {
            sceneId: input.sceneId,
            authorMembershipId: auth.membershipId,
            points: [] as number[],
            color: "#ffffff",
            strokeWidth: 3,
            x: input.x,
            y: input.y,
            kind: "STAMP",
            stampAssetKey: input.assetKey,
            stampPackId: input.packId,
            stampSize: input.size,
            stampRotation: input.rotation,
            stampLayer: input.layer,
          }
        : input.kind === "TEXTURE"
          ? {
              sceneId: input.sceneId,
              authorMembershipId: auth.membershipId,
              points: input.points,
              color: "#ffffff",
              strokeWidth: input.brushWidth,
              x: input.x,
              y: input.y,
              kind: "TEXTURE",
              stampAssetKey: input.assetKey,
              stampPackId: input.packId,
              stampSize: input.size,
              stampRotation: 0,
              stampLayer: input.layer,
            }
          : {
              ...input,
              authorMembershipId: auth.membershipId,
              kind: "FREEHAND" as const,
            };
    const saved = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, scene.id);
      const [drawing] = await tx
        .insert(drawings)
        .values(drawingInput)
        .returning();
      if (!drawing) throw new Error("DRAWING_CREATE_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "drawing.created",
          entityType: "drawing",
          entityId: drawing.id,
          entityRevision: 0,
          payload: drawing,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: scene.id,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "DRAWING_CREATE",
        targetType: "DRAWING",
        targetId: drawing.id,
        scope: isHiddenStamp(drawing) ? "GM" : "PUBLIC",
        before: null,
        after: drawing,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { drawing, event };
    });
    await broadcast(auth.campaignId);
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
    const {
      actionId,
      revision: _revision,
      size,
      rotation,
      layer,
      ...changes
    } = body;
    const changesToSave = isStampDrawing(row.drawing)
      ? {
          ...changes,
          ...(size === undefined ? {} : { stampSize: size }),
          ...(rotation === undefined ? {} : { stampRotation: rotation }),
          ...(layer === undefined ? {} : { stampLayer: layer }),
        }
      : changes;
    const saved = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [updated] = await tx
        .update(drawings)
        .set({
          ...changesToSave,
          revision: row.drawing.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(drawings.id, id), eq(drawings.revision, row.drawing.revision)),
        )
        .returning();
      if (!updated) return null;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "drawing.updated",
          entityType: "drawing",
          entityId: id,
          entityRevision: updated.revision,
          payload: updated,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: updated.sceneId,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "DRAWING_UPDATE",
        targetType: "DRAWING",
        targetId: id,
        scope:
          isHiddenStamp(row.drawing) || isHiddenStamp(updated)
            ? "GM"
            : "PUBLIC",
        before: row.drawing,
        after: updated,
        beforeRevision: row.drawing.revision,
        afterRevision: updated.revision,
        currentRevision: updated.revision,
      });
      return { updated, event };
    });
    if (!saved) return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    await broadcast(auth.campaignId);
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
    const saved = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const copyValues = isStampDrawing(row.drawing)
        ? {
            sceneId: row.drawing.sceneId,
            authorMembershipId: auth.membershipId,
            points: row.drawing.points,
            color: row.drawing.color,
            strokeWidth: row.drawing.strokeWidth,
            x: row.drawing.x + 16,
            y: row.drawing.y + 16,
            kind: row.drawing.kind,
            stampAssetKey: row.drawing.stampAssetKey,
            stampPackId: row.drawing.stampPackId,
            stampSize: row.drawing.stampSize,
            stampRotation: row.drawing.stampRotation,
            stampLayer: row.drawing.stampLayer,
          }
        : {
            sceneId: row.drawing.sceneId,
            authorMembershipId: auth.membershipId,
            points: row.drawing.points,
            color: row.drawing.color,
            strokeWidth: row.drawing.strokeWidth,
            x: row.drawing.x + 16,
            y: row.drawing.y + 16,
            kind: "FREEHAND" as const,
          };
      const [copy] = await tx.insert(drawings).values(copyValues).returning();
      if (!copy) throw new Error("DRAWING_COPY_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "drawing.copied",
          entityType: "drawing",
          entityId: copy.id,
          entityRevision: 0,
          payload: { copy, sourceDrawingId: id },
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: copy.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "DRAWING_CREATE",
        targetType: "DRAWING",
        targetId: copy.id,
        scope: isHiddenStamp(copy) ? "GM" : "PUBLIC",
        before: null,
        after: copy,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { copy, event };
    });
    await broadcast(auth.campaignId);
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
    await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [deleted] = await tx
        .delete(drawings)
        .where(
          and(eq(drawings.id, id), eq(drawings.revision, row.drawing.revision)),
        )
        .returning();
      if (!deleted) throw new Error("DRAWING_CONFLICT");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "drawing.deleted",
        entityType: "drawing",
        entityId: id,
        entityRevision: row.drawing.revision,
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: row.drawing.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "DRAWING_DELETE",
        targetType: "DRAWING",
        targetId: id,
        scope: isHiddenStamp(row.drawing) ? "GM" : "PUBLIC",
        before: row.drawing,
        after: null,
        beforeRevision: row.drawing.revision,
        currentRevision: row.drawing.revision,
      });
    });
    await broadcast(auth.campaignId);
    return reply.code(204).send();
  });
}
