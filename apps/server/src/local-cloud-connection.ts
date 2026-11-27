import {readLocalCloudHistory} from "./local-cloud-history.js";
import {prepareLocalApplicationCheck,confirmLocalAppliedBatch} from "./local-cloud-applied-batch.js";
import {queryPreparedCloudApplication} from "./local-cloud-sync-client.js";
import {localCloudGrantSchema,localCloudScopeCursorSchema} from "@arken/contracts";
import {sql} from "drizzle-orm";
import {freezeLocalCloudBatch,confirmLocalCloudStoredBatch} from "./local-cloud-frozen-batch.js";
import {deliverPreparedCloudBatch} from "./local-cloud-sync-client.js";
import {env} from "./env.js";
import {withLocalOwner,withLocalOwnerCloudAuthority} from "./local-session-authority.js";
import {createLocalCloudGrantStore} from "./local-cloud-grant-store.js";
import type {AuthContext} from "./auth.js";
type Database=Parameters<typeof withLocalOwnerCloudAuthority>[0];
export function createLocalCloudConnection(store:ReturnType<typeof createLocalCloudGrantStore>=createLocalCloudGrantStore(),supportsStorage=()=>process.platform==="win32",deliver:typeof deliverPreparedCloudBatch=deliverPreparedCloudBatch,queryApplication:typeof queryPreparedCloudApplication=queryPreparedCloudApplication){
 const summary=(state:"UNAVAILABLE"|"DISCONNECTED"|"READY"|"RECONNECT_REQUIRED",expiresAt:string|null=null)=>({state,target:env.LOCAL_CLOUD_SYNC_ORIGIN?new URL(env.LOCAL_CLOUD_SYNC_ORIGIN).origin:null,expiresAt});
 const available=()=>supportsStorage()&&Boolean(env.LOCAL_CLOUD_SYNC_ORIGIN);
 return {
  scopes(db:Database,auth:AuthContext,input?:unknown){const after=input===undefined?undefined:localCloudScopeCursorSchema.parse(input);return withLocalOwner(db,auth,async tx=>{
   const filter=after?sql`AND (authority_epoch,authority_session_id)<(${after.epoch},${after.sessionId}::uuid)`:sql``;
   const rows=await tx.execute<{authority_epoch:number;authority_session_id:string;pending:number;limited:boolean}>(sql`SELECT authority_epoch,authority_session_id,least(count(*),100000)::int AS pending,count(*)>100000 AS limited FROM local_event_outbox WHERE campaign_id=${auth.campaignId} AND origin_host_id=${env.LOCAL_INSTANCE_ID} ${filter} GROUP BY authority_epoch,authority_session_id ORDER BY authority_epoch DESC,authority_session_id DESC LIMIT 21`);
   const page=rows.slice(0,20),last=page.at(-1);return {scopes:page.map(row=>({authority:{campaignId:auth.campaignId,hostId:env.LOCAL_INSTANCE_ID,sessionId:row.authority_session_id,epoch:row.authority_epoch},pendingEvents:row.pending,limited:row.limited})),next:rows.length>20&&last?{epoch:last.authority_epoch,sessionId:last.authority_session_id}:null};
  });},
  async check(db:Database,auth:AuthContext,inputScope?:unknown){
   const current=await withLocalOwnerCloudAuthority(db,auth,inputScope,async scope=>scope, {statementTimeoutMs:2000});
   if(!available())throw Error("LOCAL_CLOUD_STORE_UNAVAILABLE");
   const grant=await store.load(current);if(!grant)throw Error("LOCAL_CLOUD_KEY_REQUIRED");
   const prepared=await prepareLocalApplicationCheck(db,auth,current,grant.originId);
   if(!prepared.check)return {state:"EMPTY" as const,appliedEvents:0,appliedThrough:prepared.appliedThrough};
   const receipt=await queryApplication({originId:grant.originId,origin:grant.origin,token:grant.token,receiptId:prepared.check.receiptId,batch:prepared.check.batch});
   if(receipt.status!=="APPLIED")return {state:"WAITING" as const,appliedEvents:0,appliedThrough:prepared.appliedThrough};
   return confirmLocalAppliedBatch(db,auth,prepared.check.streamId,receipt);
  },
  async send(db:Database,auth:AuthContext,inputScope?:unknown){
   const current=await withLocalOwnerCloudAuthority(db,auth,inputScope,async(scope,tx)=>{const events=await tx.execute(sql`SELECT 1 FROM local_event_outbox WHERE campaign_id=${scope.campaignId} AND origin_host_id=${scope.hostId} AND authority_session_id=${scope.sessionId} AND authority_epoch=${scope.epoch} LIMIT 1`);return {scope,hasEvents:events.length>0};});
   if(!available())throw Error("LOCAL_CLOUD_STORE_UNAVAILABLE");
   if(!current.hasEvents)return {state:"EMPTY" as const,sentEvents:0,storedThrough:null};
   // OS decrypt and the network occur outside campaign locks. Freeze and receipt
   // commit each revalidate current owner permissions in their own transaction.
   const grant=await store.load(current.scope);if(!grant)throw Error("LOCAL_CLOUD_KEY_REQUIRED");
   if(grant.scope!=="STAGING_ONLY")throw Error("LOCAL_CLOUD_READ_ONLY_GRANT");
   const frozen=await freezeLocalCloudBatch(db,auth,current.scope,grant.originId);
   if(!frozen.batch)return {state:"EMPTY" as const,sentEvents:0,storedThrough:frozen.storedThrough};
   const receipt=await deliver({originId:grant.originId,origin:grant.origin,token:grant.token,batch:frozen.batch});
   const result=await confirmLocalCloudStoredBatch(db,auth,frozen.streamId,receipt);
   return {state:"STORED_ONLY" as const,sentEvents:frozen.batch.events.length,storedThrough:result.lastSequence};
  },
  history(db:Database,auth:AuthContext,inputScope?:unknown,after?:string){return withLocalOwnerCloudAuthority(db,auth,inputScope,(scope,tx)=>readLocalCloudHistory(tx,scope,after),{statementTimeoutMs:2000});},
  async status(db:Database,auth:AuthContext,inputScope?:unknown){
   const current=await withLocalOwnerCloudAuthority(db,auth,inputScope,async scope=>scope,{statementTimeoutMs:2000});
   let state:"UNAVAILABLE"|"DISCONNECTED"|"READY"|"RECONNECT_REQUIRED"=available()?"DISCONNECTED":"UNAVAILABLE";
   let grant:Awaited<ReturnType<typeof store.load>>=null;
   // OS decryption must not hold a campaign row lock. Recheck owner afterwards.
   if(available())try{grant=await store.load(current);state=grant?"READY":"DISCONNECTED";}catch{state="RECONNECT_REQUIRED";}
   return withLocalOwnerCloudAuthority(db,auth,current,async(scope,tx)=>{
    const history=await readLocalCloudHistory(tx,scope),base={...summary(state,grant?.expiresAt??null),...(history.entries.length?{history}:{})};
    if(!grant)return base;
    const endpoint=new URL(env.LOCAL_CLOUD_SYNC_ORIGIN).origin;
    const [stream]=await tx.execute<{stored_sequence:string|null}>(sql`SELECT stored_sequence::text FROM local_cloud_streams WHERE campaign_id=${scope.campaignId} AND origin_host_id=${scope.hostId} AND session_id=${scope.sessionId} AND epoch=${scope.epoch} AND target_origin=${endpoint} AND cloud_origin_id=${grant.originId}`);
    const selected=await readLocalCloudHistory(tx,scope,undefined,{originId:grant.originId,target:endpoint});
    return {...base,storedThrough:stream?.stored_sequence??null,...(grant.scope==="READ_RECEIPTS_ONLY"?{canSend:false}:{}),...(selected.entries[0]?{appliedThrough:selected.entries[0].appliedThrough}:{})};
   },{statementTimeoutMs:2000});
  },
  save(db:Database,auth:AuthContext,grant:unknown,inputScope?:unknown){return withLocalOwnerCloudAuthority(db,auth,inputScope,async scope=>{if(!available())throw Error("LOCAL_CLOUD_STORE_UNAVAILABLE");const parsed=localCloudGrantSchema.parse(grant),saved=await store.save(scope,parsed);return {...summary("READY",saved.expiresAt),...(parsed.scope==="READ_RECEIPTS_ONLY"?{canSend:false}:{})};});},
  forget(db:Database,auth:AuthContext,inputScope?:unknown){return withLocalOwnerCloudAuthority(db,auth,inputScope,async scope=>{await store.forget(scope);return summary(available()?"DISCONNECTED":"UNAVAILABLE");});},
 };
}
