import {createHash} from "node:crypto";
import {z} from "zod";
const uuid=z.string().uuid();
export const localEventSequenceSchema=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value=>BigInt(value)<=9223372036854775807n);
const eventSchema=z.object({sequence:localEventSequenceSchema,campaign_id:uuid,action_id:uuid,membership_id:uuid,type:z.string().min(1).max(256),entity_type:z.string().min(1).max(256),entity_id:uuid.nullable(),entity_revision:z.number().int().nonnegative().nullable(),payload:z.unknown(),created_at:z.string().min(1).max(64)}).strict();
const originSchema=z.object({hostId:uuid,campaignId:uuid,sessionId:uuid,epoch:z.number().int().positive().max(2147483647)}).strict();
function canonical(value:unknown,depth=0,budget={nodes:0}):string{
 if(depth>32||++budget.nodes>100000)throw Error("LOCAL_EVENT_COMPLEXITY_LIMIT");
 if(value===null)return "null";
 if(typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
 if(typeof value==="number"&&Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)))return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(item=>canonical(item,depth+1,budget)).join(",")+"]";
 if(value&&typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype)
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical((value as Record<string,unknown>)[key],depth+1,budget)).join(",")+"}";
 throw Error("LOCAL_EVENT_JSON_INVALID");
}
/** Integrity identity only, not a signature, cloud receipt or authorization. */
export function createLocalEventEnvelope(originInput:unknown,eventInput:unknown){
 const origin=originSchema.parse(originInput),event=eventSchema.parse(eventInput);
 if(event.campaign_id!==origin.campaignId)throw Error("LOCAL_EVENT_SCOPE_MISMATCH");
 const bytes=canonical({version:1,origin,event});
 if(Buffer.byteLength(bytes)>256*1024)throw Error("LOCAL_EVENT_TOO_LARGE");
 return {version:1 as const,origin,event:JSON.parse(canonical(event)) as z.infer<typeof eventSchema>,sha256:createHash("sha256").update("arken-local-event-v1\0").update(bytes).digest("hex")};
}

const envelopeSchema=z.object({version:z.literal(1),origin:originSchema,event:eventSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** Expected origin must come from a server-owned registration, not this request. */
export function verifyLocalEventEnvelope(input:unknown,expectedOrigin:unknown){
 const parsed=envelopeSchema.parse(input),expected=originSchema.parse(expectedOrigin);
 for(const field of ["hostId","campaignId","sessionId","epoch"] as const)
  if(parsed.origin[field]!==expected[field])throw Error("LOCAL_EVENT_ORIGIN_MISMATCH");
 const verified=createLocalEventEnvelope(parsed.origin,parsed.event);
 if(verified.sha256!==parsed.sha256)throw Error("LOCAL_EVENT_HASH_MISMATCH");
 return verified;
}
/** Pure intake validation only. A matching cursor is not proof of committed state. */
export function verifyLocalEventBatch(input:unknown,expectedOrigin:unknown,storedAfter:string|null){
 const batch=z.object({version:z.literal(1),hostId:uuid,campaignId:uuid,events:z.array(envelopeSchema).min(1).max(64),after:localEventSequenceSchema.nullable(),lastSequence:localEventSequenceSchema,hasMore:z.boolean(),delivery:z.literal("NOT_CONFIGURED")}).strict().parse(input);
 const origin=originSchema.parse(expectedOrigin);
 if(batch.hostId!==origin.hostId||batch.campaignId!==origin.campaignId)throw Error("LOCAL_EVENT_ORIGIN_MISMATCH");
 if(batch.after!==storedAfter)throw Error("LOCAL_EVENT_CHECKPOINT_CONFLICT");
 if(Buffer.byteLength(JSON.stringify(batch))>1024*1024)throw Error("LOCAL_EVENT_BATCH_TOO_LARGE");
 let previous=storedAfter===null?0n:BigInt(localEventSequenceSchema.parse(storedAfter));
 const actions=new Set<string>(),events=batch.events.map(envelope=>{
  const verified=verifyLocalEventEnvelope(envelope,origin),sequence=BigInt(verified.event.sequence);
  if(sequence<=previous||actions.has(verified.event.action_id))throw Error("LOCAL_EVENT_ORDER_INVALID");
  previous=sequence;actions.add(verified.event.action_id);return verified;
 });
 if(batch.lastSequence!==events.at(-1)!.event.sequence)throw Error("LOCAL_EVENT_CHECKPOINT_CONFLICT");
 return {...batch,events};
}

export function localEventBatchHash(batch:ReturnType<typeof verifyLocalEventBatch>){return createHash("sha256").update("arken-local-batch-v1\0").update(canonical(batch)).digest("hex");}
