import {sql} from "drizzle-orm";
import {z} from "zod";
import {cloudSyncStatusCursorSchema,cloudSyncSourceStatusSchema} from "@arken/contracts";
import {withHostedCampaignOwner} from "./campaign-writer-authority.js";
import type {AuthContext} from "./auth.js";
type Database=Parameters<typeof withHostedCampaignOwner>[0];
/** Bounded owner metadata, never envelopes/private payloads or bearer secrets. */
export async function readCloudSyncSourceStatus(db:Database,auth:AuthContext,userId:string,originId:string,input:unknown={}){
 z.string().uuid().parse(originId);const query=z.object({after:cloudSyncStatusCursorSchema.optional()}).strict().parse(input);
 return withHostedCampaignOwner(db,auth,userId,async tx=>{
  const [source]=await tx.execute<{closed_at:Date|null;transfer_manifest_sha256:string|null;received_sequence:string|null;applied_sequence:string|null}>(sql`SELECT closed_at,transfer_manifest_sha256,received_sequence::text,applied_sequence::text FROM cloud_sync_origins WHERE id=${originId} AND campaign_id=${auth.campaignId} AND owner_user_id=${userId} FOR SHARE`);
  if(!source)throw Error("CLOUD_SYNC_FORBIDDEN");
  const [authority]=await tx.execute<{writer:"HOSTED"|"LOCAL";revision:string;origin_id:string|null}>(sql`SELECT writer,revision::text,origin_id FROM campaign_writer_authorities WHERE campaign_id=${auth.campaignId}`);
  const after=query.after;
  const rows=await tx.execute<{id:string;batch_hash:string;last_sequence:string;applied:boolean}>(sql`SELECT r.id,r.batch_hash,r.last_sequence::text, a.receipt_id IS NOT NULL AS applied FROM cloud_sync_receipts r LEFT JOIN cloud_sync_applications a ON a.receipt_id=r.id AND a.origin_id=r.origin_id WHERE r.origin_id=${originId} ${after?sql`AND (r.last_sequence,r.id)>(${after.lastSequence}::bigint,${after.receiptId}::uuid)`:sql``} ORDER BY r.last_sequence,r.id LIMIT 21`);
  const page=rows.slice(0,20),last=page.at(-1);
  return cloudSyncSourceStatusSchema.parse({originId,writer:{mode:authority?.writer??"HOSTED",revision:authority?.revision??"0",isSelectedSource:authority?.writer==="LOCAL"&&authority.origin_id===originId},source:{closed:source.closed_at!==null,archiveRecognized:source.transfer_manifest_sha256!==null,receivedThrough:source.received_sequence,appliedThrough:source.applied_sequence},receipts:page.map(row=>({receiptId:row.id,batchHash:row.batch_hash,lastSequence:row.last_sequence,state:row.applied?"APPLIED":"STORED_ONLY"})),next:rows.length>20&&last?{lastSequence:last.last_sequence,receiptId:last.id}:null});
 },{statementTimeoutMs:2000});
}
