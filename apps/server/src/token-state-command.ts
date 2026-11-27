import {actionJournal,gameEvents,scenes,tokens} from "@arken/db";import {and,eq} from "drizzle-orm";import {z} from "zod";
import {resizeTokenSchema,tokenAppearanceSchema,updateTokenConditionsSchema} from "@arken/contracts";import type {AuthContext} from "./auth.js";import {invalidateRedoBranch} from "./canvas-history.js";import {canvasLayerLevel} from "./isometric-layers.js";import {currentTokenController} from "./token-controller-authority.js";
type Transaction=import("./campaign-pause-guard.js").CampaignCanvasTransaction;
const command=z.discriminatedUnion("kind",[resizeTokenSchema.extend({kind:z.literal("RESIZE"),tokenId:z.string().uuid()}).strict(),tokenAppearanceSchema.extend({kind:z.literal("APPEARANCE"),tokenId:z.string().uuid()}).strict(),updateTokenConditionsSchema.extend({kind:z.literal("CONDITIONS"),tokenId:z.string().uuid()}).strict()]);
export function proportionalTokenSize(current:{width:number;height:number},requested:{width:number;height:number}){
 const ws=requested.width/current.width,hs=requested.height/current.height,scale=Math.abs(ws-1)>=Math.abs(hs-1)?ws:hs,bounded=Math.min(Math.min(1024/current.width,1024/current.height),Math.max(Math.max(16/current.width,16/current.height),scale));return {width:Math.round(current.width*bounded),height:Math.round(current.height*bounded)};
}
/** The event carries the rounded result, not original drag deltas. Validate
 * that some legal uniform scale produces BOTH exact output pixels. */
function replaySize(current:{width:number;height:number},result:{width:number;height:number}){
 if(!Number.isInteger(result.width)||!Number.isInteger(result.height))throw Error("TOKEN_SIZE_REPLAY_CONFLICT");
 const lo=Math.max(16/current.width,16/current.height,(result.width-.5)/current.width,(result.height-.5)/current.height),hi=Math.min(1024/current.width,1024/current.height,(result.width+.5)/current.width,(result.height+.5)/current.height),scale=(lo+hi)/2;
 if(lo>hi||Math.round(current.width*scale)!==result.width||Math.round(current.height*scale)!==result.height)throw Error("TOKEN_SIZE_REPLAY_CONFLICT");return {width:result.width,height:result.height};
}
/** Caller holds campaign write/pause fence. Both HTTP and reconciliation use it. */
export async function commitTokenState(tx:Transaction,auth:AuthContext,input:unknown,options?:{replayFinalSize?:boolean}){
 const body=command.parse(input);if(body.kind!=="CONDITIONS"&&auth.role!=="GM")return "forbidden" as const;
 const [row]=await tx.select({token:tokens}).from(tokens).innerJoin(scenes,eq(scenes.id,tokens.sceneId)).where(and(eq(tokens.id,body.tokenId),eq(scenes.campaignId,auth.campaignId))).limit(1);if(!row)return null;const current=row.token;
 if(body.kind==="CONDITIONS"){
  await canvasLayerLevel(tx,auth.campaignId,current.sceneId,current.levelId,auth.role);
  if(auth.role!=="GM"&&(!current.visible||current.layer==="GM"||!(await currentTokenController(tx,auth.campaignId,current.definitionId,auth.membershipId))))return "forbidden" as const;
 }
 if(current.revision!==body.revision)return null;
 const values=body.kind==="RESIZE"?(options?.replayFinalSize?replaySize(current,body):proportionalTokenSize(current,body)):body.kind==="APPEARANCE"?{baseColor:body.baseColor,frameColor:body.frameColor}:{conditions:body.conditions};
 const before=body.kind==="RESIZE"?{width:current.width,height:current.height}:body.kind==="APPEARANCE"?{baseColor:current.baseColor,frameColor:current.frameColor}:{conditions:current.conditions};
 await invalidateRedoBranch(tx,auth,current.sceneId);const [saved]=await tx.update(tokens).set({...values,revision:current.revision+1,updatedAt:new Date()}).where(and(eq(tokens.id,current.id),eq(tokens.revision,body.revision))).returning();if(!saved)return null;
 const type=body.kind==="RESIZE"?"TOKEN_RESIZED":body.kind==="APPEARANCE"?"TOKEN_APPEARANCE_UPDATED":"TOKEN_CONDITIONS_UPDATED";
 const [event]=await tx.insert(gameEvents).values({campaignId:auth.campaignId,actionId:body.actionId,membershipId:auth.membershipId,type,entityType:"TOKEN",entityId:current.id,entityRevision:saved.revision,payload:values}).returning();if(!event)throw Error("EVENT_RECORD_FAILED");
 await tx.insert(actionJournal).values({campaignId:auth.campaignId,sceneId:current.sceneId,actorMembershipId:auth.membershipId,actionId:body.actionId,scope:current.layer==="GM"?"GM":"PUBLIC",type:body.kind==="RESIZE"?"TOKEN_RESIZE":body.kind==="APPEARANCE"?"TOKEN_APPEARANCE":"TOKEN_CONDITIONS",targetType:"TOKEN",targetId:current.id,before,after:values,beforeRevision:current.revision,afterRevision:saved.revision,currentRevision:saved.revision});return {saved,event};
}
