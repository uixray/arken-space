import {fitFrameToWorld} from "./scene-frame.js";
import {and,eq,isNull,sql} from "drizzle-orm";
import {z} from "zod";
import {activateSceneSchema,renameCommandSchema,updateSceneMetadataSchema,createSceneSchema} from "@arken/contracts";
import {campaigns,memberships,scenes,gameEvents,assets} from "@arken/db";
import type {AuthContext} from "./auth.js";
import {findAction} from "./action-lookup.js";
type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];type Tx=Parameters<Parameters<Database["transaction"]>[0]>[0];
export class SessionStateError extends Error{constructor(readonly statusCode:403|404|409|422,readonly details:Record<string,unknown>){super(String(details.error));}}
function fail(status:403|404|409|422,error:string,extra:Record<string,unknown>={}):never{throw new SessionStateError(status,{error,...extra});}
async function currentActor(tx:Tx,auth:AuthContext){const [actor]=await tx.select({id:memberships.id,role:memberships.role}).from(memberships).where(and(eq(memberships.id,auth.membershipId),eq(memberships.campaignId,auth.campaignId),isNull(memberships.accessRevokedAt))).for("share");if(!actor)fail(403,"MEMBERSHIP_FORBIDDEN");return actor;}
export const membershipNameCommandSchema=renameCommandSchema.extend({name:z.string().trim().min(1).max(40)});
/** Same transactional owner/revision/domain semantics for HTTP and typed replay. */
export async function commitMembershipName(tx:Tx,auth:AuthContext,id:string,input:unknown,options:{at?:Date}={}){
 z.string().uuid().parse(id);const body=membershipNameCommandSchema.parse(input);
 await tx.execute(sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`);
 const actor=await currentActor(tx,auth);if(actor.role!=="GM"&&id!==actor.id)fail(403,"MEMBERSHIP_FORBIDDEN");
 if(await findAction(tx as unknown as Database,auth.campaignId,body.actionId))return {duplicate:true as const};
 const [current]=await tx.select().from(memberships).where(and(eq(memberships.id,id),eq(memberships.campaignId,auth.campaignId))).for("update");
 if(!current)fail(404,"MEMBERSHIP_NOT_FOUND");if(current.revision!==body.revision)fail(409,"MEMBERSHIP_CONFLICT",{revision:current.revision});
 const [updated]=await tx.update(memberships).set({displayName:body.name,revision:body.revision+1}).where(and(eq(memberships.id,id),eq(memberships.campaignId,auth.campaignId),eq(memberships.revision,body.revision))).returning();
 if(!updated)fail(409,"MEMBERSHIP_CONFLICT");
 const [event]=await tx.insert(gameEvents).values({campaignId:auth.campaignId,actionId:body.actionId,membershipId:auth.membershipId,type:"membership.renamed",entityType:"membership",entityId:updated.id,entityRevision:updated.revision,payload:{membershipId:updated.id,displayName:updated.displayName},createdAt:options.at??new Date()}).returning();
 if(!event)throw Error("SESSION_STATE_EVENT_FAILED");return {updated,event};
}
export async function commitSceneActivation(tx:Tx,auth:AuthContext,input:unknown,options:{at?:Date}={}){
 const body=activateSceneSchema.parse(input);if(auth.role!=="GM")fail(403,"GM_REQUIRED");
 const [state]=await tx.select({paused:campaigns.paused}).from(campaigns).where(eq(campaigns.id,auth.campaignId)).for("update");
 if(!state)fail(404,"CAMPAIGN_NOT_FOUND");
 if((await currentActor(tx,auth)).role!=="GM")fail(403,"GM_REQUIRED");
 if(await findAction(tx as unknown as Database,auth.campaignId,body.actionId))return {duplicate:true as const};
 if(state.paused)fail(409,"CAMPAIGN_PAUSED");
 const [scene]=await tx.select({id:scenes.id}).from(scenes).where(and(eq(scenes.id,body.sceneId),eq(scenes.campaignId,auth.campaignId))).for("share");if(!scene)fail(404,"SCENE_NOT_FOUND");
 const at=options.at??new Date();const [campaign]=await tx.update(campaigns).set({activeSceneId:scene.id,updatedAt:at}).where(eq(campaigns.id,auth.campaignId)).returning({id:campaigns.id});if(!campaign)fail(404,"CAMPAIGN_NOT_FOUND");
 const [event]=await tx.insert(gameEvents).values({campaignId:auth.campaignId,actionId:body.actionId,membershipId:auth.membershipId,type:"scene.activated",entityType:"scene",entityId:scene.id,payload:{sceneId:scene.id},createdAt:at}).returning();if(!event)throw Error("SESSION_STATE_EVENT_FAILED");return {sceneId:scene.id,event};
}

/** Metadata changes retain their exact command intent, not just the scene ID. */
export async function commitSceneMetadata(tx:Tx,auth:AuthContext,id:string,input:unknown,options:{at?:Date}={}){
 z.string().uuid().parse(id);const body=updateSceneMetadataSchema.parse(input);
 const [state]=await tx.select({paused:campaigns.paused}).from(campaigns).where(eq(campaigns.id,auth.campaignId)).for("update");
 if(!state)fail(404,"CAMPAIGN_NOT_FOUND");if((await currentActor(tx,auth)).role!=="GM")fail(403,"GM_REQUIRED");
 if(await findAction(tx as unknown as Database,auth.campaignId,body.actionId))return {duplicate:true as const};
 if(state.paused)fail(409,"CAMPAIGN_PAUSED");
 const [current]=await tx.select().from(scenes).where(and(eq(scenes.id,id),eq(scenes.campaignId,auth.campaignId))).for("update");
 if(!current)fail(404,"SCENE_NOT_FOUND");if(current.revision!==body.revision)fail(409,"SCENE_CONFLICT");
 if(current.projection==="THREE_D"&&body.mapAssetId!==undefined&&body.mapAssetId!==current.mapAssetId)fail(422,"USE_3D_SETTINGS");
 if(body.mapAssetId){const [asset]=await tx.select({kind:assets.kind}).from(assets).where(and(eq(assets.id,body.mapAssetId),eq(assets.campaignId,auth.campaignId))).for("share");if(!asset)fail(404,"ASSET_NOT_FOUND");if(asset.kind!=="MAP")fail(422,"MAP_ASSET_REQUIRED");}
 const {actionId,revision,...updates}=body,at=options.at??new Date();
 const [updated]=await tx.update(scenes).set({...updates,revision:revision+1,updatedAt:at}).where(and(eq(scenes.id,current.id),eq(scenes.campaignId,auth.campaignId),eq(scenes.revision,revision))).returning();if(!updated)fail(409,"SCENE_CONFLICT");
 const [event]=await tx.insert(gameEvents).values({campaignId:auth.campaignId,actionId,membershipId:auth.membershipId,type:"scene.updated",entityType:"scene",entityId:updated.id,entityRevision:updated.revision,payload:{sceneId:updated.id,...updates,...(body.mapAssetId!==undefined?{mapAssetId:updated.mapAssetId}:{})},createdAt:at}).returning();if(!event)throw Error("SESSION_STATE_EVENT_FAILED");return {updated,event};
}

/** Scene preparation stays available while the table is paused. */
export async function commitSceneCreate(tx:Tx,auth:AuthContext,input:unknown,options:{id?:string;at?:Date}={}){
 const body=createSceneSchema.parse(input);if(body.grid.isometric||body.grid.threeD)fail(422,"USE_ISOMETRIC_SETTINGS");
 const [campaign]=await tx.select({id:campaigns.id}).from(campaigns).where(eq(campaigns.id,auth.campaignId)).for("update");if(!campaign)fail(404,"CAMPAIGN_NOT_FOUND");
 if((await currentActor(tx,auth)).role!=="GM")fail(403,"GM_REQUIRED");const duplicate=await findAction(tx as unknown as Database,auth.campaignId,body.actionId);if(duplicate)return {duplicate};
 const id=options.id===undefined?undefined:z.string().uuid().parse(options.id),at=options.at??new Date();let mapAsset=null;
 if(body.mapAssetId){const [asset]=await tx.select({id:assets.id,kind:assets.kind,width:assets.width,height:assets.height}).from(assets).where(and(eq(assets.id,body.mapAssetId),eq(assets.campaignId,auth.campaignId))).for("share");if(!asset)fail(404,"ASSET_NOT_FOUND");if(asset.kind!=="MAP")fail(422,"MAP_ASSET_REQUIRED");mapAsset=asset;}
 const frame=body.backgroundFrame??fitFrameToWorld(mapAsset?.width,mapAsset?.height,body.width,body.height),{actionId,backgroundFrame,...sceneInput}=body;
 const [created]=await tx.insert(scenes).values({...sceneInput,id,campaignId:auth.campaignId,mapAssetId:mapAsset?.id??null,titleLabel:body.titleLabel??null,backgroundX:frame.x,backgroundY:frame.y,backgroundWidth:frame.width,backgroundHeight:frame.height,createdAt:at,updatedAt:at}).onConflictDoNothing().returning();if(!created)fail(409,"SCENE_ID_CONFLICT");
 const command={...sceneInput,mapAssetId:created.mapAssetId,titleLabel:created.titleLabel,...(backgroundFrame?{backgroundFrame}:{} )};
 const [event]=await tx.insert(gameEvents).values({campaignId:auth.campaignId,actionId,membershipId:auth.membershipId,type:"scene.created",entityType:"scene",entityId:created.id,entityRevision:created.revision,payload:{sceneId:created.id,command,backgroundFrame:frame},createdAt:at}).returning();if(!event)throw Error("SESSION_STATE_EVENT_FAILED");return {created,event};
}
