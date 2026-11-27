import {sql} from "drizzle-orm";
import {z} from "zod";
import type {AuthContext} from "./auth.js";
import {env} from "./env.js";
import {withLocalOwner,withLocalOwnerOutboxAuthority} from "./local-session-authority.js";
import {prepareLocalEventBatchForAuthority} from "./local-event-outbox.js";
import {verifyLocalEventBatch,localEventBatchHash} from "./local-event-envelope.js";
import {cloudStagedReceiptSchema} from "./local-cloud-sync-client.js";
import type {LocalAuthority} from "@arken/contracts";
type Database=Parameters<typeof withLocalOwner>[0];
type Stream={id:string;origin_host_id:string;campaign_id:string;session_id:string;epoch:number;cloud_origin_id:string;stored_sequence:string|null;frozen_batch:unknown;frozen_hash:string|null};
const target=()=>{if(!env.LOCAL_CLOUD_SYNC_ORIGIN)throw Error("LOCAL_CLOUD_SYNC_NOT_CONFIGURED");const u=new URL(env.LOCAL_CLOUD_SYNC_ORIGIN);if(u.protocol!=="https:"||u.username||u.password||u.pathname!=="/"||u.search||u.hash)throw Error("LOCAL_CLOUD_SYNC_TARGET_INVALID");return u.origin;};
const authority=(row:Stream):LocalAuthority=>({hostId:row.origin_host_id,campaignId:row.campaign_id,sessionId:row.session_id,epoch:row.epoch});
function verifiedFrozen(row:Stream){const batch=verifyLocalEventBatch(row.frozen_batch,authority(row),row.stored_sequence);if(localEventBatchHash(batch)!==row.frozen_hash)throw Error("LOCAL_CLOUD_FROZEN_INTEGRITY_INVALID");return batch;}
/** Internal only: registration comes from the OS-protected grant, not UI body.
 * The database commit completes before any caller starts the network request. */
export async function freezeLocalCloudBatch(db:Database,auth:AuthContext,scope:LocalAuthority,cloudOriginId:string){
 z.string().uuid().parse(cloudOriginId);const endpoint=target();
 return withLocalOwnerOutboxAuthority(db,auth,scope,async(current,tx)=>{
  await tx.execute(sql`INSERT INTO local_cloud_streams(target_origin,cloud_origin_id,origin_host_id,campaign_id,session_id,epoch)
   VALUES(${endpoint},${cloudOriginId},${current.hostId},${current.campaignId},${current.sessionId},${current.epoch}) ON CONFLICT(target_origin,cloud_origin_id) DO NOTHING`);
  const [row]=await tx.execute<Stream>(sql`SELECT id,origin_host_id,campaign_id,session_id,epoch,cloud_origin_id,stored_sequence::text,frozen_batch,frozen_hash FROM local_cloud_streams WHERE target_origin=${endpoint} AND cloud_origin_id=${cloudOriginId} FOR UPDATE`);
  if(!row||(["hostId","campaignId","sessionId","epoch"] as const).some(key=>authority(row)[key]!==current[key]))throw Error("LOCAL_CLOUD_STREAM_SCOPE_MISMATCH");
  if(row.frozen_hash)return {streamId:row.id,batchHash:row.frozen_hash,batch:verifiedFrozen(row)};
  const draft=await prepareLocalEventBatchForAuthority(tx,current,{...(row.stored_sequence?{after:row.stored_sequence}:{}),limit:32});
  if(!draft.events.length)return {streamId:row.id,batchHash:null,batch:null,storedThrough:row.stored_sequence};
  const batch=verifyLocalEventBatch(draft,current,row.stored_sequence),hash=localEventBatchHash(batch);
  await tx.execute(sql`UPDATE local_cloud_streams SET frozen_batch=${JSON.stringify(batch)}::jsonb,frozen_hash=${hash} WHERE id=${row.id}`);
  return {streamId:row.id,batchHash:hash,batch};
 });
}
/** Only a receipt returned by the verified server-side HTTPS client belongs here.
 * STORED_ONLY advances staging progress, never removes local game events. */
export async function confirmLocalCloudStoredBatch(db:Database,auth:AuthContext,streamId:string,input:unknown){
 z.string().uuid().parse(streamId);const receipt=cloudStagedReceiptSchema.parse(input),endpoint=target();
 return withLocalOwner(db,auth,async tx=>{
  const [row]=await tx.execute<Stream>(sql`SELECT id,origin_host_id,campaign_id,session_id,epoch,cloud_origin_id,stored_sequence::text,frozen_batch,frozen_hash FROM local_cloud_streams WHERE id=${streamId} AND campaign_id=${auth.campaignId} AND origin_host_id=${env.LOCAL_INSTANCE_ID} AND target_origin=${endpoint} FOR UPDATE`);
  if(!row||receipt.originId!==row.cloud_origin_id)throw Error("LOCAL_CLOUD_RECEIPT_SCOPE_MISMATCH");
  const [previous]=await tx.execute<{receipt_id:string;last_sequence:string}>(sql`SELECT receipt_id,last_sequence::text FROM local_cloud_stored_batches WHERE stream_id=${row.id} AND batch_hash=${receipt.batchHash}`);
  if(previous){if(previous.receipt_id!==receipt.receiptId||previous.last_sequence!==receipt.lastSequence)throw Error("LOCAL_CLOUD_RECEIPT_CONFLICT");return {status:"STORED_ONLY" as const,lastSequence:previous.last_sequence};}
  if(!row.frozen_hash||receipt.batchHash!==row.frozen_hash)throw Error("LOCAL_CLOUD_RECEIPT_CONFLICT");
  const batch=verifiedFrozen(row);if(receipt.lastSequence!==batch.lastSequence)throw Error("LOCAL_CLOUD_RECEIPT_CONFLICT");
  await tx.execute(sql`INSERT INTO local_cloud_stored_batches(stream_id,batch_hash,receipt_id,last_sequence,batch_metadata) VALUES(${row.id},${receipt.batchHash},${receipt.receiptId},${receipt.lastSequence}::bigint,${JSON.stringify({after:batch.after,hasMore:batch.hasMore})}::jsonb)`);
  await tx.execute(sql`UPDATE local_cloud_streams SET stored_sequence=${receipt.lastSequence}::bigint,frozen_batch=NULL,frozen_hash=NULL WHERE id=${row.id}`);
  return {status:"STORED_ONLY" as const,lastSequence:receipt.lastSequence};
 });
}
