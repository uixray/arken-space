import {sql} from "drizzle-orm";
import {z} from "zod";
import {withCloudSyncGrant} from "./cloud-sync-staging.js";
import {readCloudSyncApplicationInTransaction} from "./cloud-sync-apply.js";
type Database=Parameters<typeof withCloudSyncGrant>[0];
/** Same scoped bearer may read only receipts it submitted; no payloads/SQL. */
export async function readCloudApplicationWithGrant(db:Database,originId:string,token:string,receiptId:string){
 z.string().uuid().parse(receiptId);
 return withCloudSyncGrant(db,originId,token,async(tx,auth,userId)=>{
  const [receipt]=await tx.execute<{batch_hash:string;last_sequence:string}>(sql`SELECT batch_hash,last_sequence::text FROM cloud_sync_receipts WHERE id=${receiptId} AND origin_id=${originId} FOR SHARE`);
  if(!receipt)throw Error("CLOUD_SYNC_FORBIDDEN");
  const applied=await readCloudSyncApplicationInTransaction(tx,auth.campaignId,userId,{originId,receiptId});
  return applied??{status:"STORED_ONLY" as const,originId,receiptId,batchHash:receipt.batch_hash,lastSequence:receipt.last_sequence};
 },{statementTimeoutMs:2000,readReceipts:true});
}
