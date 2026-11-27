import {sceneCreateEventSchema} from "./scene-create-event.js";
import {commitMembershipName,commitSceneActivation,commitSceneMetadata,commitSceneCreate,membershipNameCommandSchema} from "./session-state-command.js";
import {cloudAppliedReceiptSchema} from "@arken/contracts";
import {commitDrawingUpdate,commitDrawingCopy,commitDrawingDelete} from "./drawing-state-command.js";
import {commitCanvasObjectHistory} from "./canvas-object-history.js";
import {isDeepStrictEqual} from "node:util";
import {commitDrawingCreate} from "./drawing-create-command.js";
import {commitFogCreate} from "./fog-create-command.js";
import {transferCanvasSnapshots} from "./campaign-transfer-journal.js";
import {commitTokenState} from "./token-state-command.js";
import {commitTokenMoveHistory} from "./token-move-history.js";
import {commitTokenMove,editableToken} from "./realtime.js";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {updateSceneMetadataSchema,renameCampaignSchema,moveTokenSchema,resizeTokenSchema,tokenAppearanceSchema,updateTokenConditionsSchema} from "@arken/contracts";
import type {AuthContext} from "./auth.js";
import {withHostedCampaignOwner,withReservedCloudWriter} from "./campaign-writer-authority.js";
import {verifyLocalEventBatch,localEventBatchHash} from "./local-event-envelope.js";
type Database=Parameters<typeof withReservedCloudWriter>[0];
const sequence=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(s=>BigInt(s)<=9223372036854775807n),uuid=z.string().uuid();
const mappingsSchema=z.array(z.object({sourceSequence:sequence,cloudSequence:sequence,actionId:uuid}).strict()).min(1).max(64);
/** First typed domain applier. Unsupported events fail the entire transaction;
 * historical payloads are never treated as arbitrary SQL/row replacements. */
export async function applyCloudSyncReceipt(db:Database,auth:AuthContext,userId:string,input:unknown){
 const command=z.object({campaignId:uuid,revision:sequence,originId:uuid,receiptId:uuid}).strict().parse(input);
 const permit={campaignId:command.campaignId,revision:command.revision,originId:command.originId};
 return withReservedCloudWriter(db,auth,userId,permit,async tx=>{
  await tx.execute(sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`);
  const [origin]=await tx.execute<{host_id:string;session_id:string;epoch:number;baseline_sequence:string;applied_sequence:string|null;applied_cloud_sequence:string|null;closed_at:Date|null}>(sql`SELECT host_id,session_id,epoch,baseline_sequence::text,applied_sequence::text,applied_cloud_sequence::text,closed_at FROM cloud_sync_origins WHERE id=${command.originId} AND campaign_id=${auth.campaignId} AND owner_user_id=${userId} FOR UPDATE`);
  if(!origin||origin.closed_at)throw Error("CLOUD_SYNC_APPLY_ORIGIN_CONFLICT");
  const [receipt]=await tx.execute<{batch_hash:string;last_sequence:string;batch_metadata:unknown}>(sql`SELECT batch_hash,last_sequence::text,batch_metadata FROM cloud_sync_receipts WHERE id=${command.receiptId} AND origin_id=${command.originId} FOR SHARE`);
  if(!receipt)throw Error("CLOUD_SYNC_APPLY_RECEIPT_CONFLICT");
  const [previous]=await tx.execute<{writer_revision:string;mappings:unknown}>(sql`SELECT writer_revision::text,mappings FROM cloud_sync_applications WHERE receipt_id=${command.receiptId} AND origin_id=${command.originId}`);
  const reply=(mappings:z.infer<typeof mappingsSchema>)=>({status:"APPLIED" as const,originId:command.originId,receiptId:command.receiptId,batchHash:receipt.batch_hash,lastSequence:receipt.last_sequence,writerRevision:command.revision,mappings});
  if(previous){if(previous.writer_revision!==command.revision)throw Error("CLOUD_SYNC_APPLY_AUTHORITY_CONFLICT");return reply(mappingsSchema.parse(previous.mappings));}
  if(!receipt.batch_metadata)throw Error("CLOUD_SYNC_APPLY_REDELIVERY_REQUIRED");
  const metadata=z.object({after:sequence.nullable(),hasMore:z.boolean()}).strict().parse(receipt.batch_metadata);
  const stored=await tx.execute<{envelope:unknown}>(sql`SELECT envelope FROM cloud_sync_inbox WHERE origin_id=${command.originId} AND receipt_id=${command.receiptId} ORDER BY sequence`);
  const batch=verifyLocalEventBatch({version:1,hostId:origin.host_id,campaignId:auth.campaignId,events:stored.map(r=>r.envelope),after:metadata.after,lastSequence:receipt.last_sequence,hasMore:metadata.hasMore,delivery:"NOT_CONFIGURED"},{hostId:origin.host_id,campaignId:auth.campaignId,sessionId:origin.session_id,epoch:origin.epoch},origin.applied_sequence);
  if(batch.events.some(e=>BigInt(e.event.sequence)<=BigInt(origin.baseline_sequence)))throw Error("CLOUD_SYNC_APPLY_SOURCE_HISTORY_CONFLICT");
  if(localEventBatchHash(batch)!==receipt.batch_hash)throw Error("CLOUD_SYNC_APPLY_INTEGRITY_CONFLICT");
  let cloudSequence=origin.applied_cloud_sequence??origin.baseline_sequence;
  const [cloud]=await tx.execute<{sequence:string}>(sql`SELECT coalesce(max(sequence),0)::text AS sequence FROM game_events WHERE campaign_id=${auth.campaignId}`);
  if(cloud?.sequence!==cloudSequence)throw Error("CLOUD_SYNC_APPLY_BASELINE_CONFLICT");
  const commands=batch.events.map(({event})=>{
   const createdAt=z.string().datetime({offset:true}).parse(event.created_at);
   if(!["scene.created","scene.updated","membership.renamed","scene.activated","campaign.renamed","TOKEN_MOVED","TOKEN_RESIZED","TOKEN_APPEARANCE_UPDATED","TOKEN_CONDITIONS_UPDATED","drawing.created","drawing.updated","drawing.copied","drawing.deleted","fog.created","canvas.undo","canvas.redo"].includes(event.type))throw Error("CLOUD_SYNC_APPLY_DOMAIN_UNSUPPORTED");
   if(event.type==="scene.created"){
    const payload=sceneCreateEventSchema.parse(event.payload);if(!isDeepStrictEqual(payload,event.payload))throw Error("CLOUD_SYNC_APPLY_PAYLOAD_CONFLICT");
    if(event.entity_type!=="scene"||event.entity_id!==payload.sceneId||event.entity_revision!==0)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    return {kind:"SCENE_CREATE" as const,event,payload,createdAt};
   }
   if(event.type==="scene.updated"){
    const payload=z.object({sceneId:uuid,name:z.string().optional(),mapAssetId:uuid.nullable().optional()}).strict().parse(event.payload);
    if(event.entity_type!=="scene"||event.entity_id!==payload.sceneId||event.entity_revision===null||event.entity_revision<1)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    const {sceneId,...updates}=payload,command=updateSceneMetadataSchema.parse({...updates,actionId:event.action_id,revision:event.entity_revision-1});
    if(command.name!==payload.name||(payload.mapAssetId&&payload.mapAssetId!==payload.mapAssetId.toLowerCase()))throw Error("CLOUD_SYNC_APPLY_PAYLOAD_CONFLICT");
    return {kind:"SCENE_METADATA" as const,event,targetId:sceneId,command,createdAt};
   }
   if(event.type==="scene.activated"){
    const payload=z.object({sceneId:uuid}).strict().parse(event.payload);if(event.entity_type!=="scene"||event.entity_id!==payload.sceneId||event.entity_revision!==null)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    return {kind:"SCENE_ACTIVATE" as const,event,command:{sceneId:payload.sceneId,actionId:event.action_id},createdAt};
   }
   if(event.type==="membership.renamed"){
    const payload=z.object({membershipId:uuid,displayName:z.string()}).strict().parse(event.payload);if(event.entity_type!=="membership"||event.entity_id!==payload.membershipId||event.entity_revision===null||event.entity_revision<1)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    const command=membershipNameCommandSchema.parse({actionId:event.action_id,revision:event.entity_revision-1,name:payload.displayName});if(command.name!==payload.displayName)throw Error("CLOUD_SYNC_APPLY_PAYLOAD_CONFLICT");
    return {kind:"MEMBERSHIP_NAME" as const,event,targetId:payload.membershipId,command,createdAt};
   }
   if(event.type==="drawing.created"||event.type==="fog.created"){
    const drawing=event.type==="drawing.created",payload=(drawing?transferCanvasSnapshots.drawing:transferCanvasSnapshots.fog).parse(event.payload);
    if(event.entity_type!==(drawing?"drawing":"fog")||event.entity_id!==payload.id||payload.revision!==0||(drawing?event.entity_revision!==0:event.entity_revision!==null&&event.entity_revision!==0))throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    if(drawing&&payload.authorMembershipId!==event.membership_id)throw Error("CLOUD_SYNC_APPLY_ACTOR_CONFLICT");
    return {kind:"CANVAS_CREATE" as const,event,payload,drawing,createdAt};
   }
   if(["drawing.updated","drawing.copied","drawing.deleted"].includes(event.type)){
    if(event.entity_type!=="drawing"||!event.entity_id||event.entity_revision===null||event.entity_revision<0)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    if(event.type==="drawing.deleted"){z.null().parse(event.payload);return {kind:"DRAWING_MUTATION" as const,event,operation:"DELETE" as const,createdAt};}
    const copy=event.type==="drawing.copied",wrapped=copy?z.object({copy:z.unknown(),sourceDrawingId:uuid}).strict().parse(event.payload):null,payload=transferCanvasSnapshots.drawing.parse(copy?wrapped!.copy:event.payload);
    if(payload.id!==event.entity_id||payload.revision!==event.entity_revision||(copy&&(payload.revision!==0||payload.authorMembershipId!==event.membership_id))||(!copy&&event.entity_revision<1))throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    return {kind:"DRAWING_MUTATION" as const,event,operation:copy?"COPY" as const:"UPDATE" as const,payload,sourceDrawingId:wrapped?.sourceDrawingId,createdAt};
   }
   if((event.type==="canvas.undo"||event.type==="canvas.redo")&&["drawing","fog"].includes(event.entity_type)){
    if(!event.entity_id||event.entity_revision===null||event.entity_revision<0)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    const payload=z.object({journalSequence:z.union([sequence,z.number().int().positive().refine(Number.isSafeInteger)]),journalActionId:uuid}).strict().parse(event.payload);return {kind:"CANVAS_HISTORY" as const,event,direction:event.type==="canvas.undo"?"undo" as const:"redo" as const,journalActionId:payload.journalActionId,createdAt};
   }
   if(event.entity_revision===null||event.entity_revision<1)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
   if(event.type==="campaign.renamed"){
    if(event.entity_type!=="campaign"||event.entity_id!==auth.campaignId)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    const payload=z.object({name:z.string()}).strict().parse(event.payload),rename=renameCampaignSchema.parse({actionId:event.action_id,revision:event.entity_revision-1,name:payload.name});
    if(rename.name!==payload.name)throw Error("CLOUD_SYNC_APPLY_PAYLOAD_CONFLICT");
    return {kind:"RENAME" as const,event,rename,createdAt};
   }
   if(event.type==="TOKEN_MOVED"){
    if(event.entity_type!=="TOKEN"||!event.entity_id)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    const payload=z.object({x:z.number().finite(),y:z.number().finite(),z:z.number().finite(),levelId:uuid.nullable()}).strict().parse(event.payload);
    return {kind:"TOKEN_MOVE" as const,event,move:moveTokenSchema.parse({...payload,tokenId:event.entity_id,revision:event.entity_revision-1,actionId:event.action_id}),createdAt};
   }
   if(["TOKEN_RESIZED","TOKEN_APPEARANCE_UPDATED","TOKEN_CONDITIONS_UPDATED"].includes(event.type)){
    if(event.entity_type!=="TOKEN"||!event.entity_id)throw Error("CLOUD_SYNC_APPLY_ENTITY_CONFLICT");
    const base={actionId:event.action_id,revision:event.entity_revision-1,tokenId:event.entity_id};
    if(event.type==="TOKEN_RESIZED"){const payload=resizeTokenSchema.omit({actionId:true,revision:true}).strict().parse(event.payload);return {kind:"TOKEN_STATE" as const,event,state:{kind:"RESIZE" as const,...base,...payload},createdAt};}
    if(event.type==="TOKEN_APPEARANCE_UPDATED"){const payload=tokenAppearanceSchema.omit({actionId:true,revision:true}).strict().parse(event.payload);return {kind:"TOKEN_STATE" as const,event,state:{kind:"APPEARANCE" as const,...base,...payload},createdAt};}
    const payload=updateTokenConditionsSchema.omit({actionId:true,revision:true}).strict().parse(event.payload);if(JSON.stringify(payload.conditions)!==JSON.stringify((event.payload as {conditions:unknown}).conditions))throw Error("CLOUD_SYNC_APPLY_PAYLOAD_CONFLICT");return {kind:"TOKEN_STATE" as const,event,state:{kind:"CONDITIONS" as const,...base,...payload},createdAt};
   }
   if(event.type==="canvas.undo"||event.type==="canvas.redo"){
    if(event.entity_type!=="token"||!event.entity_id)throw Error("CLOUD_SYNC_APPLY_HISTORY_DOMAIN_UNSUPPORTED");
    const payload=z.object({journalSequence:z.union([sequence,z.number().int().positive().refine(Number.isSafeInteger)]),journalActionId:uuid}).strict().parse(event.payload);
    return {kind:"TOKEN_HISTORY" as const,event,direction:event.type==="canvas.undo"?"undo" as const:"redo" as const,journalActionId:payload.journalActionId,createdAt};
   }
   throw Error("CLOUD_SYNC_APPLY_DOMAIN_UNSUPPORTED");
  });
  const mappings:z.infer<typeof mappingsSchema>=[];
  for(const domain of commands){
   const {event,createdAt}=domain;
   const [actor]=await tx.execute<{id:string;role:"GM"|"PLAYER";display_name:string}>(sql`SELECT id,role,display_name FROM memberships WHERE id=${event.membership_id} AND campaign_id=${auth.campaignId} AND access_revoked_at IS NULL FOR SHARE`);if(!actor)throw Error("CLOUD_SYNC_APPLY_ACTOR_CONFLICT");
   let appliedSequence:string;
   if(domain.kind==="SCENE_CREATE"){
    const result=await commitSceneCreate(tx,{campaignId:auth.campaignId,membershipId:actor.id,role:actor.role,displayName:actor.display_name},{...domain.payload.command,actionId:event.action_id},{id:domain.payload.sceneId,at:new Date(createdAt)});
    if(result.duplicate)throw Error("CLOUD_SYNC_APPLY_ACTION_CONFLICT");if(!isDeepStrictEqual(result.event.payload,domain.payload))throw Error("CLOUD_SYNC_APPLY_SCENE_STATE_CONFLICT");
    await tx.execute(sql`UPDATE scenes SET created_at=${createdAt}::timestamptz,updated_at=${createdAt}::timestamptz WHERE id=${domain.payload.sceneId} AND campaign_id=${auth.campaignId}`);
    const [inserted]=await tx.execute<{sequence:string}>(sql`UPDATE game_events SET created_at=${createdAt}::timestamptz WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} RETURNING sequence::text`);if(!inserted)throw Error("CLOUD_SYNC_APPLY_EVENT_CONFLICT");appliedSequence=inserted.sequence;
   }else if(domain.kind==="SCENE_METADATA"||domain.kind==="MEMBERSHIP_NAME"||domain.kind==="SCENE_ACTIVATE"){
    const actorAuth={campaignId:auth.campaignId,membershipId:actor.id,role:actor.role,displayName:actor.display_name};
    const result=domain.kind==="SCENE_METADATA"?await commitSceneMetadata(tx,actorAuth,domain.targetId,domain.command,{at:new Date(createdAt)}):domain.kind==="MEMBERSHIP_NAME"?await commitMembershipName(tx,actorAuth,domain.targetId,domain.command,{at:new Date(createdAt)}):await commitSceneActivation(tx,actorAuth,domain.command,{at:new Date(createdAt)});
    if(result.duplicate)throw Error("CLOUD_SYNC_APPLY_ACTION_CONFLICT");
    const [inserted]=await tx.execute<{sequence:string}>(sql`UPDATE game_events SET created_at=${createdAt}::timestamptz WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} RETURNING sequence::text`);if(!inserted)throw Error("CLOUD_SYNC_APPLY_EVENT_CONFLICT");appliedSequence=inserted.sequence;
    if(domain.kind==="SCENE_METADATA")await tx.execute(sql`UPDATE scenes SET updated_at=${createdAt}::timestamptz WHERE id=${domain.targetId} AND campaign_id=${auth.campaignId}`);
    if(domain.kind==="SCENE_ACTIVATE")await tx.execute(sql`UPDATE campaigns SET updated_at=${createdAt}::timestamptz WHERE id=${auth.campaignId}`);
   }else if(domain.kind==="RENAME"){

    if(actor.role!=="GM")throw Error("CLOUD_SYNC_APPLY_ACTOR_CONFLICT");
    const updated=await tx.execute(sql`UPDATE campaigns SET name=${domain.rename.name},revision=${event.entity_revision},updated_at=${createdAt}::timestamptz WHERE id=${auth.campaignId} AND revision=${domain.rename.revision} RETURNING id`);if(updated.length!==1)throw Error("CLOUD_SYNC_APPLY_REVISION_CONFLICT");
    const [inserted]=await tx.execute<{sequence:string}>(sql`INSERT INTO game_events(campaign_id,action_id,membership_id,type,entity_type,entity_id,entity_revision,payload,created_at) VALUES(${auth.campaignId},${event.action_id},${event.membership_id},${event.type},'campaign',${auth.campaignId},${event.entity_revision},${JSON.stringify(event.payload)}::jsonb,${createdAt}::timestamptz) RETURNING sequence::text`);
    if(!inserted)throw Error("CLOUD_SYNC_APPLY_EVENT_CONFLICT");appliedSequence=inserted.sequence;
   }else if(domain.kind==="TOKEN_MOVE"){
    const actorAuth={campaignId:auth.campaignId,membershipId:actor.id,role:actor.role,displayName:actor.display_name};
    const [campaign]=await tx.execute<{paused:boolean}>(sql`SELECT paused FROM campaigns WHERE id=${auth.campaignId}`);if(!campaign||campaign.paused)throw Error("CLOUD_SYNC_APPLY_CAMPAIGN_PAUSED_CONFLICT");
    const current=await editableToken(tx,actorAuth,domain.move.tokenId);if(!current)throw Error("CLOUD_SYNC_APPLY_TOKEN_FORBIDDEN_CONFLICT");
    if(current.revision!==domain.move.revision)throw Error("CLOUD_SYNC_APPLY_REVISION_CONFLICT");
    const result=await commitTokenMove(tx,actorAuth,current,domain.move);
    if(result&&"movementBlocked" in result)throw Error("CLOUD_SYNC_APPLY_MOVEMENT_CONFLICT");
    if(!result)throw Error("CLOUD_SYNC_APPLY_REVISION_CONFLICT");
    // The shared core returns a legacy numeric event DTO. Read the committed
    // sequence as SQL text instead of rounding it through that DTO.
    const [inserted]=await tx.execute<{sequence:string}>(sql`UPDATE game_events SET created_at=${createdAt}::timestamptz WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} RETURNING sequence::text`);
    if(!inserted)throw Error("CLOUD_SYNC_APPLY_EVENT_CONFLICT");appliedSequence=inserted.sequence;
   }else if(domain.kind==="TOKEN_STATE"){
    const [campaign]=await tx.execute<{paused:boolean}>(sql`SELECT paused FROM campaigns WHERE id=${auth.campaignId}`);if(!campaign||campaign.paused)throw Error("CLOUD_SYNC_APPLY_CAMPAIGN_PAUSED_CONFLICT");
    const result=await commitTokenState(tx,{campaignId:auth.campaignId,membershipId:actor.id,role:actor.role,displayName:actor.display_name},domain.state,{replayFinalSize:true});if(result==="forbidden")throw Error("CLOUD_SYNC_APPLY_TOKEN_FORBIDDEN_CONFLICT");if(!result)throw Error("CLOUD_SYNC_APPLY_REVISION_CONFLICT");
    const [inserted]=await tx.execute<{sequence:string}>(sql`UPDATE game_events SET created_at=${createdAt}::timestamptz WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} RETURNING sequence::text`);if(!inserted)throw Error("CLOUD_SYNC_APPLY_EVENT_CONFLICT");appliedSequence=inserted.sequence;
   }else if(domain.kind==="CANVAS_CREATE"){
    const [campaign]=await tx.execute<{paused:boolean}>(sql`SELECT paused FROM campaigns WHERE id=${auth.campaignId}`);if(!campaign||campaign.paused)throw Error("CLOUD_SYNC_APPLY_CAMPAIGN_PAUSED_CONFLICT");
    const p=domain.payload,actorAuth={campaignId:auth.campaignId,membershipId:actor.id,role:actor.role,displayName:actor.display_name};let actual:unknown;
    if(domain.drawing){
     const common={actionId:event.action_id,sceneId:p.sceneId,levelId:p.levelId,x:p.x,y:p.y};
     const input=p.kind==="STAMP"?{...common,kind:p.kind,assetKey:p.stampAssetKey,packId:p.stampPackId,size:p.stampSize,rotation:p.stampRotation,layer:p.stampLayer}:p.kind==="TEXTURE"?{...common,kind:p.kind,points:p.points,brushWidth:p.strokeWidth,assetKey:p.stampAssetKey,packId:p.stampPackId,size:p.stampSize,layer:p.stampLayer}:{...common,kind:"FREEHAND",points:p.points,color:p.color,strokeWidth:p.strokeWidth};
     actual=(await commitDrawingCreate(tx,actorAuth,input,{id:uuid.parse(p.id),createdAt:new Date(z.string().datetime().parse(p.createdAt)),updatedAt:new Date(z.string().datetime().parse(p.updatedAt))})).drawing;
    }else actual=(await commitFogCreate(tx,actorAuth,{actionId:event.action_id,sceneId:p.sceneId,levelId:p.levelId,operation:p.operation,geometry:p.geometry},{id:uuid.parse(p.id),createdAt:new Date(z.string().datetime().parse(p.createdAt))})).reveal;
    const storedRow=JSON.parse(JSON.stringify(actual)),expectedRow={...p};if(!domain.drawing){delete storedRow.sequence;delete expectedRow.sequence;}
    if(!isDeepStrictEqual(storedRow,expectedRow))throw Error("CLOUD_SYNC_APPLY_CANVAS_STATE_CONFLICT");
    const [inserted]=await tx.execute<{sequence:string}>(sql`UPDATE game_events SET created_at=${createdAt}::timestamptz WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} RETURNING sequence::text`);if(!inserted)throw Error("CLOUD_SYNC_APPLY_EVENT_CONFLICT");appliedSequence=inserted.sequence;
   }else if(domain.kind==="DRAWING_MUTATION"){
    const [campaign]=await tx.execute<{paused:boolean}>(sql`SELECT paused FROM campaigns WHERE id=${auth.campaignId}`);if(!campaign||campaign.paused)throw Error("CLOUD_SYNC_APPLY_CAMPAIGN_PAUSED_CONFLICT");const actorAuth={campaignId:auth.campaignId,membershipId:actor.id,role:actor.role,displayName:actor.display_name};
    if(domain.operation==="DELETE"){const result=await commitDrawingDelete(tx,actorAuth,event.entity_id!,{actionId:event.action_id,revision:event.entity_revision});if(!result)throw Error("CLOUD_SYNC_APPLY_REVISION_CONFLICT");}
    else{
     const p=domain.payload;let actual:unknown;
     if(domain.operation==="COPY"){
      const [source]=await tx.execute<{revision:number}>(sql`SELECT d.revision FROM drawings d JOIN scenes s ON s.id=d.scene_id WHERE d.id=${domain.sourceDrawingId!} AND s.campaign_id=${auth.campaignId}`);if(!source)throw Error("CLOUD_SYNC_APPLY_DRAWING_REFERENCE_CONFLICT");const result=await commitDrawingCopy(tx,actorAuth,domain.sourceDrawingId!,{actionId:event.action_id,revision:source.revision},{id:uuid.parse(p.id),createdAt:new Date(z.string().datetime().parse(p.createdAt)),updatedAt:new Date(z.string().datetime().parse(p.updatedAt))});if(!result)throw Error("CLOUD_SYNC_APPLY_REVISION_CONFLICT");actual=result.copy;
     }else{
      const values=p.kind==="STAMP"||p.kind==="TEXTURE"?{x:p.x,y:p.y,size:p.stampSize,rotation:p.stampRotation,layer:p.stampLayer}:{x:p.x,y:p.y,color:p.color,strokeWidth:p.strokeWidth};const result=await commitDrawingUpdate(tx,actorAuth,event.entity_id!,{actionId:event.action_id,revision:event.entity_revision!-1,...values},{updatedAt:new Date(z.string().datetime().parse(p.updatedAt))});if(!result)throw Error("CLOUD_SYNC_APPLY_REVISION_CONFLICT");actual=result.updated;
     }
     if(!isDeepStrictEqual(JSON.parse(JSON.stringify(actual)),p))throw Error("CLOUD_SYNC_APPLY_CANVAS_STATE_CONFLICT");
    }
    const [inserted]=await tx.execute<{sequence:string}>(sql`UPDATE game_events SET created_at=${createdAt}::timestamptz WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} RETURNING sequence::text`);if(!inserted)throw Error("CLOUD_SYNC_APPLY_EVENT_CONFLICT");appliedSequence=inserted.sequence;
   }else if(domain.kind==="CANVAS_HISTORY"){
    const [target]=await tx.execute<{scene_id:string;target_id:string;target_type:string}>(sql`SELECT scene_id,target_id,target_type FROM action_journal WHERE campaign_id=${auth.campaignId} AND action_id=${domain.journalActionId}`);if(!target||target.target_id!==event.entity_id||target.target_type.toLowerCase()!==event.entity_type)throw Error("CLOUD_SYNC_APPLY_HISTORY_REFERENCE_CONFLICT");const result=await commitCanvasObjectHistory(tx,{campaignId:auth.campaignId,membershipId:actor.id,role:actor.role,displayName:actor.display_name},{direction:domain.direction,sceneId:target.scene_id,journalActionId:domain.journalActionId,actionId:event.action_id},{replayAt:new Date(createdAt)});if(!result||typeof result==="string")throw Error("CLOUD_SYNC_APPLY_HISTORY_CONFLICT");if(result.event.entityRevision!==event.entity_revision)throw Error("CLOUD_SYNC_APPLY_REVISION_CONFLICT");
    const [inserted]=await tx.execute<{sequence:string}>(sql`UPDATE game_events SET created_at=${createdAt}::timestamptz WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} RETURNING sequence::text`);if(!inserted)throw Error("CLOUD_SYNC_APPLY_EVENT_CONFLICT");appliedSequence=inserted.sequence;
   }else{
    const [target]=await tx.execute<{scene_id:string;target_id:string;current_revision:number|null}>(sql`SELECT scene_id,target_id,current_revision FROM action_journal WHERE campaign_id=${auth.campaignId} AND action_id=${domain.journalActionId} AND type IN ('TOKEN_MOVE','TOKEN_RESIZE','TOKEN_APPEARANCE','TOKEN_CONDITIONS') AND target_type='TOKEN'`);
    if(!target||target.target_id!==event.entity_id||target.current_revision!==event.entity_revision!-1)throw Error("CLOUD_SYNC_APPLY_HISTORY_REFERENCE_CONFLICT");
    const result=await commitTokenMoveHistory(tx,{campaignId:auth.campaignId,membershipId:actor.id,role:actor.role,displayName:actor.display_name},{direction:domain.direction,sceneId:target.scene_id,journalActionId:domain.journalActionId,actionId:event.action_id});
    if(!result||typeof result==="string")throw Error("CLOUD_SYNC_APPLY_HISTORY_CONFLICT");
    if(result.event.entityRevision!==event.entity_revision)throw Error("CLOUD_SYNC_APPLY_REVISION_CONFLICT");
    const [inserted]=await tx.execute<{sequence:string}>(sql`UPDATE game_events SET created_at=${createdAt}::timestamptz WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} RETURNING sequence::text`);
    if(!inserted)throw Error("CLOUD_SYNC_APPLY_EVENT_CONFLICT");appliedSequence=inserted.sequence;
   }
   if(BigInt(appliedSequence)<=BigInt(cloudSequence))throw Error("CLOUD_SYNC_APPLY_SEQUENCE_CONFLICT");cloudSequence=appliedSequence;
   mappings.push({sourceSequence:event.sequence,cloudSequence,actionId:event.action_id});
  }
  await tx.execute(sql`INSERT INTO cloud_sync_applications(receipt_id,origin_id,writer_revision,mappings) VALUES(${command.receiptId},${command.originId},${command.revision}::bigint,${JSON.stringify(mappings)}::jsonb)`);
  await tx.execute(sql`UPDATE cloud_sync_origins SET applied_sequence=${batch.lastSequence}::bigint,applied_cloud_sequence=${cloudSequence}::bigint WHERE id=${command.originId}`);
  return reply(mappings);
 });
}

export async function readCloudSyncApplication(db:Database,auth:AuthContext,userId:string,input:unknown){
 const command=z.object({originId:uuid,receiptId:uuid}).strict().parse(input);
 return withHostedCampaignOwner(db,auth,userId,tx=>readCloudSyncApplicationInTransaction(tx,auth.campaignId,userId,command));
}
/** Trusted caller already holds current owner/grant fence. */
export async function readCloudSyncApplicationInTransaction(tx:Parameters<Parameters<Database["transaction"]>[0]>[0],campaignId:string,userId:string,command:{originId:string;receiptId:string}){
 const [row]=await tx.execute<{batch_hash:string;last_sequence:string;writer_revision:string;mappings:unknown}>(sql`SELECT r.batch_hash,r.last_sequence::text,a.writer_revision::text,a.mappings FROM cloud_sync_applications a JOIN cloud_sync_receipts r ON r.id=a.receipt_id AND r.origin_id=a.origin_id JOIN cloud_sync_origins o ON o.id=a.origin_id WHERE a.receipt_id=${command.receiptId} AND a.origin_id=${command.originId} AND o.campaign_id=${campaignId} AND o.owner_user_id=${userId}`);
 return row?cloudAppliedReceiptSchema.parse({status:"APPLIED",...command,batchHash:row.batch_hash,lastSequence:row.last_sequence,writerRevision:row.writer_revision,mappings:row.mappings}):null;
}
