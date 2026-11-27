import {sql} from "drizzle-orm";
import {z} from "zod";
import {isDeepStrictEqual} from "node:util";
import {localAuthoritySchema,cloudAppliedReceiptSchema,type LocalAuthority} from "@arken/contracts";
import {env} from "./env.js";
import type {AuthContext} from "./auth.js";
import {withLocalOwner,withLocalOwnerCloudAuthority} from "./local-session-authority.js";
import {createLocalEventEnvelope,verifyLocalEventBatch,localEventBatchHash,localEventSequenceSchema} from "./local-event-envelope.js";
type Database=Parameters<typeof withLocalOwner>[0];type Tx=Parameters<Parameters<Database["transaction"]>[0]>[0];
type Stream={id:string;origin_host_id:string;campaign_id:string;session_id:string;epoch:number;cloud_origin_id:string;applied_sequence:string|null;stored_sequence:string|null};
type Stored={receipt_id:string;batch_hash:string;last_sequence:string;batch_metadata:unknown;applied_receipt:unknown};
function target(){if(!env.LOCAL_CLOUD_SYNC_ORIGIN)throw Error("LOCAL_CLOUD_SYNC_NOT_CONFIGURED");const u=new URL(env.LOCAL_CLOUD_SYNC_ORIGIN);if(u.protocol!=="https:"||u.username||u.password||u.pathname!=="/"||u.search||u.hash)throw Error("LOCAL_CLOUD_SYNC_TARGET_INVALID");return u.origin;}
const scope=(s:Stream)=>localAuthoritySchema.parse({hostId:s.origin_host_id,campaignId:s.campaign_id,sessionId:s.session_id,epoch:s.epoch});
async function reconstruct(tx:Tx,s:Stream,r:Stored){
 const [previous]=await tx.execute<{sequence:string|null}>(sql`SELECT max(last_sequence)::text AS sequence FROM local_cloud_stored_batches WHERE stream_id=${s.id} AND last_sequence<${r.last_sequence}::bigint`);
 const after=previous?.sequence??null,metadata=r.batch_metadata===null?null:z.object({after:localEventSequenceSchema.nullable(),hasMore:z.boolean()}).strict().parse(r.batch_metadata);
 if(metadata&&metadata.after!==after)throw Error("LOCAL_CLOUD_APPLICATION_INTEGRITY_INVALID");
 const rows=await tx.execute<{event:unknown;valid:boolean}>(sql`SELECT CASE WHEN octet_length(event::text)<=262144 THEN event||jsonb_build_object('sequence',event_sequence::text) ELSE NULL END AS event,(event->>'sequence'=event_sequence::text AND event->>'campaign_id'=campaign_id::text AND event->>'action_id'=action_id::text) AS valid FROM local_event_outbox WHERE campaign_id=${s.campaign_id} AND origin_host_id=${s.origin_host_id} AND authority_session_id=${s.session_id} AND authority_epoch=${s.epoch} AND event_sequence>${after??"0"}::bigint AND event_sequence<=${r.last_sequence}::bigint ORDER BY event_sequence LIMIT 65`);
 if(!rows.length||rows.length>64||rows.some(row=>!row.valid||!row.event))throw Error("LOCAL_CLOUD_APPLICATION_INTEGRITY_INVALID");
 const origin=scope(s),events=rows.map(row=>createLocalEventEnvelope(origin,row.event));
 // Legacy metadata may be recovered only by an exact SHA preimage match, not
 // by assigning an assumed hasMore flag or inventing old event provenance.
 for(const hasMore of metadata?[metadata.hasMore]:[false,true]){
  const batch=verifyLocalEventBatch({version:1,hostId:s.origin_host_id,campaignId:s.campaign_id,events,after,lastSequence:r.last_sequence,hasMore,delivery:"NOT_CONFIGURED"},origin,after);
  if(localEventBatchHash(batch)===r.batch_hash){if(!metadata)await tx.execute(sql`UPDATE local_cloud_stored_batches SET batch_metadata=${JSON.stringify({after,hasMore})}::jsonb WHERE stream_id=${s.id} AND receipt_id=${r.receipt_id} AND batch_metadata IS NULL`);return {batch,after};}
 }
 throw Error("LOCAL_CLOUD_APPLICATION_INTEGRITY_INVALID");
}
async function next(tx:Tx,s:Stream){const [row]=await tx.execute<Stored>(sql`SELECT receipt_id,batch_hash,last_sequence::text,batch_metadata,applied_receipt FROM local_cloud_stored_batches WHERE stream_id=${s.id} AND last_sequence>${s.applied_sequence??"0"}::bigint ORDER BY last_sequence,receipt_id LIMIT 1 FOR UPDATE`);return row;}
export async function prepareLocalApplicationCheck(db:Database,auth:AuthContext,inputScope:LocalAuthority,originId:string){
 z.string().uuid().parse(originId);const endpoint=target();
 return withLocalOwnerCloudAuthority(db,auth,inputScope,async(current,tx)=>{
  const [s]=await tx.execute<Stream>(sql`SELECT id,origin_host_id,campaign_id,session_id,epoch,cloud_origin_id,applied_sequence::text,stored_sequence::text FROM local_cloud_streams WHERE target_origin=${endpoint} AND cloud_origin_id=${originId} AND campaign_id=${current.campaignId} AND origin_host_id=${current.hostId} AND session_id=${current.sessionId} AND epoch=${current.epoch} FOR UPDATE`);
  if(!s)return {check:null,appliedThrough:null};const row=await next(tx,s);if(!row)return {check:null,appliedThrough:s.applied_sequence};
  if(row.applied_receipt!==null)throw Error("LOCAL_CLOUD_APPLICATION_INTEGRITY_INVALID");
  const {batch,after}=await reconstruct(tx,s,row);if(after!==s.applied_sequence)throw Error("LOCAL_CLOUD_APPLICATION_ORDER_CONFLICT");
  return {check:{streamId:s.id,receiptId:row.receipt_id,batch},appliedThrough:s.applied_sequence};
 },{statementTimeoutMs:2000});
}
/** Server-internal: caller supplies the verified HTTPS result, never UI JSON.
 * Reconstruct and bind again after network, then commit proof+cursor atomically. */
export async function confirmLocalAppliedBatch(db:Database,auth:AuthContext,streamId:string,input:unknown){
 z.string().uuid().parse(streamId);const receipt=cloudAppliedReceiptSchema.parse(input),endpoint=target();
 return withLocalOwner(db,auth,async tx=>{
  const [s]=await tx.execute<Stream>(sql`SELECT id,origin_host_id,campaign_id,session_id,epoch,cloud_origin_id,applied_sequence::text,stored_sequence::text FROM local_cloud_streams WHERE id=${streamId} AND campaign_id=${auth.campaignId} AND origin_host_id=${env.LOCAL_INSTANCE_ID} AND target_origin=${endpoint} FOR UPDATE`);
  if(!s||s.cloud_origin_id!==receipt.originId)throw Error("LOCAL_CLOUD_APPLICATION_SCOPE_MISMATCH");
  const [row]=await tx.execute<Stored>(sql`SELECT receipt_id,batch_hash,last_sequence::text,batch_metadata,applied_receipt FROM local_cloud_stored_batches WHERE stream_id=${s.id} AND receipt_id=${receipt.receiptId} FOR UPDATE`);
  if(!row||row.batch_hash!==receipt.batchHash||row.last_sequence!==receipt.lastSequence||!s.stored_sequence||BigInt(receipt.lastSequence)>BigInt(s.stored_sequence))throw Error("LOCAL_CLOUD_APPLICATION_SCOPE_MISMATCH");
  const {batch,after}=await reconstruct(tx,s,row);
  if(receipt.mappings.length!==batch.events.length||receipt.mappings.some((m,i)=>m.sourceSequence!==batch.events[i]!.event.sequence||m.actionId!==batch.events[i]!.event.action_id))throw Error("LOCAL_CLOUD_APPLICATION_MAPPING_CONFLICT");
  if(row.applied_receipt!==null){if(!isDeepStrictEqual(cloudAppliedReceiptSchema.parse(row.applied_receipt),receipt)||!s.applied_sequence||BigInt(s.applied_sequence)<BigInt(receipt.lastSequence))throw Error("LOCAL_CLOUD_APPLICATION_INTEGRITY_INVALID");return {state:"APPLIED" as const,appliedEvents:batch.events.length,appliedThrough:s.applied_sequence};}
  if((await next(tx,s))?.receipt_id!==receipt.receiptId||after!==s.applied_sequence)throw Error("LOCAL_CLOUD_APPLICATION_ORDER_CONFLICT");
  await tx.execute(sql`UPDATE local_cloud_stored_batches SET applied_receipt=${JSON.stringify(receipt)}::jsonb WHERE stream_id=${s.id} AND receipt_id=${receipt.receiptId}`);
  await tx.execute(sql`UPDATE local_cloud_streams SET applied_sequence=${receipt.lastSequence}::bigint WHERE id=${s.id}`);
  return {state:"APPLIED" as const,appliedEvents:batch.events.length,appliedThrough:receipt.lastSequence};
 },{statementTimeoutMs:2000});
}
