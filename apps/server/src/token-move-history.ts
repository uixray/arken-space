import {resizeTokenSchema,tokenAppearanceSchema,updateTokenConditionsSchema} from "@arken/contracts";
import {actionJournal,campaigns,gameEvents,scenes,tokens} from "@arken/db";
import {and,desc,eq,sql} from "drizzle-orm";import {z} from "zod";
import type {AuthContext} from "./auth.js";import {assertLegacyCanvasLayerAccess} from "./isometric-layers.js";import {playerCanReplayTokens} from "./canvas-history-authority.js";
type Transaction=import("./campaign-pause-guard.js").CampaignCanvasTransaction;
const uuid=z.string().uuid(),commandSchema=z.object({direction:z.enum(["undo","redo"]),sceneId:uuid,journalActionId:uuid,actionId:uuid}).strict();
const position=z.object({x:z.number().finite(),y:z.number().finite(),z:z.number().finite().optional(),levelId:uuid.nullable().optional()}).strict();
/** Same durable token-state history command for HTTP and typed reconciliation.
 * Journal action UUID is stable; never route a foreign database's sequence. */
export async function commitTokenMoveHistory(tx:Transaction,auth:AuthContext,input:unknown,afterAuthorityLock?:()=>Promise<void>){
 const body=commandSchema.parse(input),status=body.direction==="undo"?"APPLIED":"UNDONE";
 await assertLegacyCanvasLayerAccess(tx,auth.campaignId,body.sceneId,auth.role);
 const [campaign]=await tx.select({activeSceneId:campaigns.activeSceneId,paused:campaigns.paused}).from(campaigns).where(eq(campaigns.id,auth.campaignId)).limit(1);
 if(!campaign||campaign.paused)return null;if(auth.role!=="GM"&&campaign.activeSceneId!==body.sceneId)return "inactive" as const;
 const scene=await tx.select({id:scenes.id}).from(scenes).where(and(eq(scenes.id,body.sceneId),eq(scenes.campaignId,auth.campaignId))).for("update");if(scene.length!==1)return null;
 const [command]=await tx.select().from(actionJournal).where(and(eq(actionJournal.campaignId,auth.campaignId),eq(actionJournal.sceneId,body.sceneId),eq(actionJournal.status,status),auth.role==="GM"?undefined:and(eq(actionJournal.actorMembershipId,auth.membershipId),eq(actionJournal.scope,"PUBLIC")))).orderBy(desc(actionJournal.transitionSequence)).limit(1).for("update");
 if(!command||command.actionId!==body.journalActionId||!["TOKEN_MOVE","TOKEN_RESIZE","TOKEN_APPEARANCE","TOKEN_CONDITIONS"].includes(command.type)||command.targetType!=="TOKEN"||command.currentRevision===null)return null;
 if(auth.role!=="GM"&&!(await playerCanReplayTokens(tx,command,auth.campaignId,auth.membershipId)))return "forbidden" as const;
 if(auth.role!=="GM")await afterAuthorityLock?.();
 const snapshot=body.direction==="undo"?command.before:command.after;
 const values=command.type==="TOKEN_MOVE"?position.parse(snapshot):command.type==="TOKEN_RESIZE"?resizeTokenSchema.omit({actionId:true,revision:true}).strict().parse(snapshot):command.type==="TOKEN_APPEARANCE"?tokenAppearanceSchema.omit({actionId:true,revision:true}).strict().parse(snapshot):updateTokenConditionsSchema.omit({actionId:true,revision:true}).strict().parse(snapshot);
 const [updated]=await tx.update(tokens).set({...values,revision:command.currentRevision+1,updatedAt:new Date()}).where(and(eq(tokens.id,command.targetId),eq(tokens.sceneId,body.sceneId),eq(tokens.revision,command.currentRevision))).returning();if(!updated)return null;
 const [journal]=await tx.update(actionJournal).set({status:body.direction==="undo"?"UNDONE":"APPLIED",currentRevision:updated.revision,transitionSequence:sql`nextval(pg_get_serial_sequence('action_journal','transition_sequence'))`,updatedAt:new Date()}).where(and(eq(actionJournal.campaignId,auth.campaignId),eq(actionJournal.actionId,body.journalActionId),eq(actionJournal.status,status))).returning();if(!journal)throw Error("HISTORY_JOURNAL_CONFLICT");
 const [exact]=await tx.select({sequence:sql<string>`sequence::text`}).from(actionJournal).where(and(eq(actionJournal.campaignId,auth.campaignId),eq(actionJournal.actionId,body.journalActionId)));if(!exact)throw Error("HISTORY_JOURNAL_CONFLICT");
 const [event]=await tx.insert(gameEvents).values({campaignId:auth.campaignId,actionId:body.actionId,membershipId:auth.membershipId,type:`canvas.${body.direction}`,entityType:"token",entityId:command.targetId,entityRevision:updated.revision,payload:{journalSequence:exact.sequence,journalActionId:body.journalActionId}}).returning();if(!event)throw Error("EVENT_RECORD_FAILED");return {journal,event};
}
