import {actionJournal,campaigns,drawings,fogReveals,gameEvents,scenes} from "@arken/db";import {and,desc,eq,sql} from "drizzle-orm";import {z} from "zod";import type {AuthContext} from "./auth.js";import {assertLegacyCanvasLayerAccess} from "./isometric-layers.js";import {historyContainsStamp} from "./canvas-history-authority.js";
type Transaction=import("./campaign-pause-guard.js").CampaignCanvasTransaction;
const uuid=z.string().uuid(),inputSchema=z.object({direction:z.enum(["undo","redo"]),sceneId:uuid,journalActionId:uuid,actionId:uuid}).strict();
/** Shared DRAWING/FOG restore; UUID identifies history across sequence spaces. */
export async function commitCanvasObjectHistory(tx:Transaction,auth:AuthContext,input:unknown,options?:{replayAt?:Date}){
 const appliedAt=options?.replayAt??new Date();
 const body=inputSchema.parse(input),direction=body.direction,desiredStatus=direction==="undo"?"APPLIED":"UNDONE";await assertLegacyCanvasLayerAccess(tx,auth.campaignId,body.sceneId,auth.role);
 const [campaign]=await tx.select({activeSceneId:campaigns.activeSceneId,paused:campaigns.paused}).from(campaigns).where(eq(campaigns.id,auth.campaignId)).limit(1);if(!campaign||campaign.paused)return null;if(auth.role!=="GM"&&campaign.activeSceneId!==body.sceneId)return "inactive" as const;
 await tx.select({id:scenes.id}).from(scenes).where(and(eq(scenes.id,body.sceneId),eq(scenes.campaignId,auth.campaignId))).for("update");
 const [command]=await tx.select().from(actionJournal).where(and(eq(actionJournal.campaignId,auth.campaignId),eq(actionJournal.sceneId,body.sceneId),eq(actionJournal.status,desiredStatus),auth.role==="GM"?undefined:and(eq(actionJournal.actorMembershipId,auth.membershipId),eq(actionJournal.scope,"PUBLIC")))).orderBy(desc(actionJournal.transitionSequence)).limit(1).for("update");
 if(!command||command.actionId!==body.journalActionId||!["DRAWING_CREATE","DRAWING_UPDATE","DRAWING_DELETE","FOG_CREATE"].includes(command.type))return null;if(auth.role!=="GM"&&(command.targetType==="FOG"||historyContainsStamp(command)))return "forbidden" as const;
 const snapshot=direction==="undo"?command.before:command.after;let targetRevision=command.currentRevision;
 if(command.targetType==="DRAWING"){

            if (snapshot === null) {
              const [deleted] = await tx
                .delete(drawings)
                .where(
                  and(
                    eq(drawings.id, command.targetId),
                    targetRevision === null
                      ? undefined
                      : eq(drawings.revision, targetRevision),
                  ),
                )
                .returning();
              if (!deleted) return null;
            } else {
              const drawing = snapshot as typeof drawings.$inferSelect;
              const [existing] = await tx
                .select()
                .from(drawings)
                .where(eq(drawings.id, command.targetId))
                .limit(1);
              if (existing) {
                if (
                  targetRevision === null ||
                  existing.revision !== targetRevision
                )
                  return null;
                const [updated] = await tx
                  .update(drawings)
                  .set({
                    points: drawing.points,
                    color: drawing.color,
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
                    levelId: drawing.levelId ?? null,
                    revision: existing.revision + 1,
                    updatedAt: appliedAt,
                  })
                  .where(
                    and(
                      eq(drawings.id, command.targetId),
                      eq(drawings.revision, existing.revision),
                    ),
                  )
                  .returning();
                if (!updated) return null;
                targetRevision = updated.revision;
              } else {
                const nextRevision = (targetRevision ?? drawing.revision) + 1;
                const [restored] = await tx
                  .insert(drawings)
                  .values({
                    id: command.targetId,
                    sceneId: drawing.sceneId,
                    authorMembershipId: drawing.authorMembershipId,
                    points: drawing.points,
                    color: drawing.color,
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
                    levelId: drawing.levelId ?? null,
                    revision: nextRevision,
                    createdAt:appliedAt,updatedAt:appliedAt,
                  })
                  .returning();
                if (!restored) return null;
                targetRevision = restored.revision;
              }
            }

 }else if(command.targetType==="FOG"){

            if (snapshot === null) {
              const [deleted] = await tx
                .delete(fogReveals)
                .where(eq(fogReveals.id, command.targetId))
                .returning();
              if (!deleted) return null;
            } else {
              const fog = snapshot as typeof fogReveals.$inferSelect;
              const [restored] = await tx
                .insert(fogReveals)
                .values({
                  id: command.targetId,
                  sceneId: fog.sceneId,
                  x: fog.x,
                  y: fog.y,
                  width: fog.width,
                  height: fog.height,
                  operation: fog.operation,
                  shape: fog.shape,
                  levelId: fog.levelId ?? null,
                  geometry: fog.geometry,
                  bbox: fog.bbox,
                  sequence: fog.sequence,
                  createdAt:appliedAt,
                  revision: (targetRevision ?? fog.revision) + 1,
                })
                .returning();
              if (!restored) return null;
              targetRevision = restored.revision;
            }
 }else return null;
 const [journal]=await tx.update(actionJournal).set({status:direction==="undo"?"UNDONE":"APPLIED",currentRevision:targetRevision,transitionSequence:sql`nextval(pg_get_serial_sequence('action_journal','transition_sequence'))`,updatedAt:appliedAt}).where(and(eq(actionJournal.campaignId,auth.campaignId),eq(actionJournal.actionId,body.journalActionId),eq(actionJournal.status,desiredStatus))).returning();if(!journal)throw Error("HISTORY_JOURNAL_CONFLICT");
 const [exact]=await tx.select({sequence:sql<string>`sequence::text`}).from(actionJournal).where(and(eq(actionJournal.campaignId,auth.campaignId),eq(actionJournal.actionId,body.journalActionId)));if(!exact)throw Error("HISTORY_JOURNAL_CONFLICT");
 const [event]=await tx.insert(gameEvents).values({campaignId:auth.campaignId,actionId:body.actionId,membershipId:auth.membershipId,type:`canvas.${direction}`,entityType:command.targetType.toLowerCase(),entityId:command.targetId,entityRevision:targetRevision,createdAt:appliedAt,payload:{journalSequence:exact.sequence,journalActionId:body.journalActionId}}).returning();if(!event)throw Error("EVENT_RECORD_FAILED");return {journal,event};
}
