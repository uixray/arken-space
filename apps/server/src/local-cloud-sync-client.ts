import {cloudAppliedReceiptSchema} from "@arken/contracts";
import {z} from "zod";
import {env} from "./env.js";
import {verifyLocalEventBatch,localEventBatchHash,localEventSequenceSchema} from "./local-event-envelope.js";
export const cloudStagedReceiptSchema=z.object({originId:z.string().uuid(),batchHash:z.string().regex(/^[a-f0-9]{64}$/),receiptId:z.string().uuid(),lastSequence:localEventSequenceSchema,status:z.literal("STORED_ONLY")}).strict();
/** One bounded attempt to the operator-configured origin. Never dequeues local
 * events: STORED_ONLY is not applied game state. Credentials remain memory-only. */
export async function deliverPreparedCloudBatch(input:{originId:string;token:string;origin:{hostId:string;campaignId:string;sessionId:string;epoch:number};batch:unknown},fetcher:typeof fetch=fetch){
 if(env.DEPLOYMENT_MODE!=="LOCAL_HOST"||!env.LOCAL_CLOUD_SYNC_ORIGIN)throw Error("LOCAL_CLOUD_SYNC_NOT_CONFIGURED");
 const base=new URL(env.LOCAL_CLOUD_SYNC_ORIGIN);
 if(base.protocol!=="https:"||base.username||base.password||base.pathname!=="/"||base.search||base.hash)throw Error("LOCAL_CLOUD_SYNC_TARGET_INVALID");
 const originId=z.string().uuid().parse(input.originId);if(!/^[A-Za-z0-9_-]{43}$/.test(input.token))throw Error("LOCAL_CLOUD_SYNC_GRANT_INVALID");
 if(input.origin.hostId!==env.LOCAL_INSTANCE_ID)throw Error("LOCAL_CLOUD_SYNC_ORIGIN_MISMATCH");
 const claimed=z.object({after:z.string().nullable()}).passthrough().parse(input.batch);
 const batch=verifyLocalEventBatch(input.batch,input.origin,claimed.after),hash=localEventBatchHash(batch);
 const signal=AbortSignal.timeout(10000),url=new URL(`/api/cloud-sync/sources/${originId}/batches`,base.origin);
 let response:Response;
 try{response=await fetcher(url,{method:"POST",headers:{authorization:`Bearer ${input.token}`,"content-type":"application/json"},body:JSON.stringify({batch}),redirect:"error",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer",signal});}
 catch{throw Error("LOCAL_CLOUD_SYNC_UNAVAILABLE");}
 if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw Error(response.status===401||response.status===403?"LOCAL_CLOUD_SYNC_GRANT_REJECTED":response.status===409?"LOCAL_CLOUD_SYNC_CONFLICT":"LOCAL_CLOUD_SYNC_UNAVAILABLE");}
 if(!/^application\/json(?:;|$)/i.test(response.headers.get("content-type")??"")||!response.body){await response.body?.cancel().catch(()=>undefined);throw Error("LOCAL_CLOUD_SYNC_RECEIPT_INVALID");}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>65536)throw Error("RECEIPT_TOO_LARGE");chunks.push(value);}}
 catch{await reader.cancel().catch(()=>undefined);throw Error("LOCAL_CLOUD_SYNC_RECEIPT_INVALID");}finally{reader.releaseLock();}
 try{const bytes=Buffer.concat(chunks),receipt=cloudStagedReceiptSchema.parse(JSON.parse(bytes.toString("utf8")));
  if(receipt.originId!==originId||receipt.batchHash!==hash||receipt.lastSequence!==batch.lastSequence)throw Error("RECEIPT_SCOPE_MISMATCH");return receipt;
 }catch{throw Error("LOCAL_CLOUD_SYNC_RECEIPT_INVALID");}
}

/** Read one existing receipt. APPLIED is accepted only for the exact locally
 * retained batch and its complete ordered action mapping; never dequeues. */
export async function queryPreparedCloudApplication(input:{originId:string;receiptId:string;token:string;origin:{hostId:string;campaignId:string;sessionId:string;epoch:number};batch:unknown},fetcher:typeof fetch=fetch){
 if(env.DEPLOYMENT_MODE!=="LOCAL_HOST"||!env.LOCAL_CLOUD_SYNC_ORIGIN)throw Error("LOCAL_CLOUD_SYNC_NOT_CONFIGURED");
 const base=new URL(env.LOCAL_CLOUD_SYNC_ORIGIN);
 if(base.protocol!=="https:"||base.username||base.password||base.pathname!=="/"||base.search||base.hash)throw Error("LOCAL_CLOUD_SYNC_TARGET_INVALID");
 const originId=z.string().uuid().parse(input.originId),receiptId=z.string().uuid().parse(input.receiptId);
 if(!/^[A-Za-z0-9_-]{43}$/.test(input.token))throw Error("LOCAL_CLOUD_SYNC_GRANT_INVALID");
 if(input.origin.hostId!==env.LOCAL_INSTANCE_ID)throw Error("LOCAL_CLOUD_SYNC_ORIGIN_MISMATCH");
 const claimed=z.object({after:z.string().nullable()}).passthrough().parse(input.batch),batch=verifyLocalEventBatch(input.batch,input.origin,claimed.after),hash=localEventBatchHash(batch);
 const signal=AbortSignal.timeout(10000),url=new URL(`/api/cloud-sync/sources/${originId}/receipts/${receiptId}/application`,base.origin);
 let response:Response;
 try{response=await fetcher(url,{method:"POST",headers:{authorization:`Bearer ${input.token}`,"content-type":"application/json"},body:"{}",redirect:"error",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer",signal});}
 catch{throw Error("LOCAL_CLOUD_SYNC_UNAVAILABLE");}
 if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw Error(response.status===401||response.status===403?"LOCAL_CLOUD_SYNC_GRANT_REJECTED":"LOCAL_CLOUD_SYNC_UNAVAILABLE");}
 if(!/^application\/json(?:;|$)/i.test(response.headers.get("content-type")??"")||!response.body){await response.body?.cancel().catch(()=>undefined);throw Error("LOCAL_CLOUD_SYNC_RECEIPT_INVALID");}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>65536)throw Error("RECEIPT_TOO_LARGE");chunks.push(value);}}
 catch{await reader.cancel().catch(()=>undefined);throw Error("LOCAL_CLOUD_SYNC_RECEIPT_INVALID");}finally{reader.releaseLock();}
 try{
  const receipt=z.union([cloudStagedReceiptSchema,cloudAppliedReceiptSchema]).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if(receipt.originId!==originId||receipt.receiptId!==receiptId||receipt.batchHash!==hash||receipt.lastSequence!==batch.lastSequence)throw Error("APPLICATION_SCOPE_MISMATCH");
  if(receipt.status==="APPLIED"&&(receipt.mappings.length!==batch.events.length||receipt.mappings.some((mapping,index)=>mapping.sourceSequence!==batch.events[index]!.event.sequence||mapping.actionId!==batch.events[index]!.event.action_id)))throw Error("APPLICATION_MAPPING_MISMATCH");
  return receipt;
 }catch{throw Error("LOCAL_CLOUD_SYNC_RECEIPT_INVALID");}
}
