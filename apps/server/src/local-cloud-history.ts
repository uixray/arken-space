import {sql} from "drizzle-orm";
import {z} from "zod";
import {cloudAppliedReceiptSchema,localCloudHistorySchema,type LocalAuthority} from "@arken/contracts";
import type {withLocalOwner} from "./local-session-authority.js";
type Database=Parameters<typeof withLocalOwner>[0];type Tx=Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Internal metadata reader; caller holds this local instance's current owner
 * and exact authority-scope boundary. History never authorizes new delivery. */
export async function readLocalCloudHistory(tx:Tx,scope:LocalAuthority,after?:string,selected?:{originId:string;target:string}){
 if(after)z.string().uuid().parse(after);
 const rows=await tx.execute<{id:string;cloud_origin_id:string;target_origin:string;applied_sequence:string;stored_sequence:string|null;receipt_id:string;batch_hash:string;last_sequence:string;proof:unknown}>(sql`SELECT s.id,s.cloud_origin_id,s.target_origin,s.applied_sequence::text,s.stored_sequence::text,b.receipt_id,b.batch_hash,b.last_sequence::text,CASE WHEN octet_length(b.applied_receipt::text)<=65536 THEN b.applied_receipt ELSE NULL END AS proof FROM local_cloud_streams s JOIN local_cloud_stored_batches b ON b.stream_id=s.id AND b.last_sequence=s.applied_sequence WHERE s.campaign_id=${scope.campaignId} AND s.origin_host_id=${scope.hostId} AND s.session_id=${scope.sessionId} AND s.epoch=${scope.epoch} AND b.applied_receipt IS NOT NULL ${after?sql`AND s.id>${after}::uuid`:sql``} ${selected?sql`AND s.cloud_origin_id=${selected.originId} AND s.target_origin=${selected.target}`:sql``} ORDER BY s.id LIMIT 21`);
 const page=rows.slice(0,20),ids=new Set<string>();
 const entries=page.map(row=>{
  const proof=cloudAppliedReceiptSchema.parse(row.proof);
  if(ids.has(row.id)||proof.originId!==row.cloud_origin_id||proof.receiptId!==row.receipt_id||proof.batchHash!==row.batch_hash||proof.lastSequence!==row.last_sequence||proof.lastSequence!==row.applied_sequence||!row.stored_sequence||BigInt(proof.lastSequence)>BigInt(row.stored_sequence))throw Error("LOCAL_CLOUD_HISTORY_INTEGRITY_INVALID");
  ids.add(row.id);return {streamId:row.id,originId:row.cloud_origin_id,target:row.target_origin,appliedThrough:proof.lastSequence};
 });
 return localCloudHistorySchema.parse({entries,next:rows.length>20?entries.at(-1)!.streamId:null});
}
