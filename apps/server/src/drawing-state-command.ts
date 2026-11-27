import {and,eq} from "drizzle-orm";import {z} from "zod";import {drawingCommandSchema,updateDrawingSchema} from "@arken/contracts";import {actionJournal,drawings,gameEvents,scenes} from "@arken/db";import type {AuthContext} from "./auth.js";import {canvasLayerLevel} from "./isometric-layers.js";import {invalidateRedoBranch} from "./canvas-history.js";import {isHiddenStamp,isStampDrawing} from "./drawing-kinds.js";
type Transaction=import("./campaign-pause-guard.js").CampaignCanvasTransaction;
async function authorizedDrawing(tx:Transaction,auth:AuthContext,id:string){const [row]=await tx.select({drawing:drawings}).from(drawings).innerJoin(scenes,eq(drawings.sceneId,scenes.id)).where(and(eq(drawings.id,id),eq(scenes.campaignId,auth.campaignId))).limit(1);if(!row)throw Error("DRAWING_FORBIDDEN");if(isStampDrawing(row.drawing)){if(auth.role!=="GM")throw Error("STAMP_FORBIDDEN");}else if(auth.role!=="GM"&&row.drawing.authorMembershipId!==auth.membershipId)throw Error("DRAWING_FORBIDDEN");return row;}
export async function commitDrawingUpdate(tx:Transaction,auth:AuthContext,id:string,input:unknown,options?:{id?:string;createdAt?:Date;updatedAt?:Date}){
 const body=updateDrawingSchema.parse(input),row=await authorizedDrawing(tx,auth,id);
 if(isStampDrawing(row.drawing)){if(body.color!==undefined||body.strokeWidth!==undefined)throw Error("STAMP_FIELD_FORBIDDEN");}else if(body.size!==undefined||body.rotation!==undefined||body.layer!==undefined)throw Error("DRAWING_KIND_MISMATCH");
 if(row.drawing.revision!==body.revision)return null;
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

      await canvasLayerLevel(tx, auth.campaignId, row.drawing.sceneId, row.drawing.levelId, auth.role);
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [updated] = await tx
        .update(drawings)
        .set({
          ...changesToSave,
          revision: row.drawing.revision + 1,
          updatedAt: options?.updatedAt??new Date(),
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
      if (!event) throw new Error("EVENT_RECORD_FAILED");
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
}

export async function commitDrawingCopy(tx:Transaction,auth:AuthContext,id:string,input:unknown,options?:{id?:string;createdAt?:Date;updatedAt?:Date}){
 const body=drawingCommandSchema.parse(input),row=await authorizedDrawing(tx,auth,id);
 if(row.drawing.revision!==body.revision)return null;

      const levelId = await canvasLayerLevel(tx, auth.campaignId, row.drawing.sceneId, row.drawing.levelId, auth.role);
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
      const [copy] = await tx.insert(drawings).values({ ...copyValues, levelId,...(options?.id?{id:z.string().uuid().parse(options.id)}:{}),...(options?.createdAt?{createdAt:options.createdAt}:{}),...(options?.updatedAt?{updatedAt:options.updatedAt}:{}) }).returning();
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
      if (!event) throw new Error("EVENT_RECORD_FAILED");
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
}

export async function commitDrawingDelete(tx:Transaction,auth:AuthContext,id:string,input:unknown,options?:{id?:string;createdAt?:Date;updatedAt?:Date}){
 const body=drawingCommandSchema.parse(input),row=await authorizedDrawing(tx,auth,id);
 if(row.drawing.revision!==body.revision)return null;

      await canvasLayerLevel(tx, auth.campaignId, row.drawing.sceneId, row.drawing.levelId, auth.role);
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [deleted] = await tx
        .delete(drawings)
        .where(
          and(eq(drawings.id, id), eq(drawings.revision, row.drawing.revision)),
        )
        .returning();
      if (!deleted) throw new Error("DRAWING_CONFLICT");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "drawing.deleted",
          entityType: "drawing",
          entityId: id,
          entityRevision: row.drawing.revision,
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
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
      return event;
}
