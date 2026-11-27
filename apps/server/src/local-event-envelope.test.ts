import {expect,it} from "vitest";
import {verifyLocalEventBatch,verifyLocalEventEnvelope,createLocalEventEnvelope} from "./local-event-envelope.js";
const id="11111111-1111-4111-8111-111111111111",origin={hostId:id,campaignId:id,sessionId:id,epoch:1};
const event={sequence:"9007199254740993",campaign_id:id,action_id:id,membership_id:id,type:"SYNTHETIC",entity_type:"campaign",entity_id:null,entity_revision:null,payload:{b:2,a:1},created_at:"2026-11-27T00:00:00Z"};
it("preserves bigint sequence strings and hashes independently of object insertion order",()=>{
 const a=createLocalEventEnvelope(origin,event),b=createLocalEventEnvelope(origin,{...event,payload:{a:1,b:2}});expect(a.sha256).toBe(b.sha256);expect(a.event.sequence).toBe("9007199254740993");
 expect(createLocalEventEnvelope({...origin,epoch:2},event).sha256).not.toBe(a.sha256);
 expect(createLocalEventEnvelope(origin,{...event,payload:{a:2,b:2}}).sha256).not.toBe(a.sha256);
});
it("rejects foreign scopes, unsafe values, oversized payloads and extra fields",()=>{
 expect(()=>createLocalEventEnvelope({...origin,campaignId:crypto.randomUUID()},event)).toThrow("SCOPE_MISMATCH");
 for(const value of [NaN,Infinity,9007199254740992,undefined])expect(()=>createLocalEventEnvelope(origin,{...event,payload:value})).toThrow();
 expect(()=>createLocalEventEnvelope(origin,{...event,payload:"x".repeat(262144)})).toThrow("TOO_LARGE");
 expect(()=>createLocalEventEnvelope(origin,{...event,unknown:"private"})).toThrow();
 expect(()=>createLocalEventEnvelope(origin,{...event,sequence:"9223372036854775808"})).toThrow();
});

it("verifies the supplied hash against a separately registered origin",()=>{
 const envelope=createLocalEventEnvelope(origin,event);expect(verifyLocalEventEnvelope(envelope,origin)).toEqual(envelope);
 expect(()=>verifyLocalEventEnvelope({...envelope,event:{...envelope.event,payload:{a:9}}},origin)).toThrow("HASH_MISMATCH");
 expect(()=>verifyLocalEventEnvelope(envelope,{...origin,hostId:crypto.randomUUID()})).toThrow("ORIGIN_MISMATCH");
 expect(()=>verifyLocalEventEnvelope(envelope,{...origin,epoch:2})).toThrow("ORIGIN_MISMATCH");
});
it("validates expected checkpoint, increasing order and exact last sequence without demanding gapless global IDs",()=>{
 const first=createLocalEventEnvelope(origin,{...event,sequence:"4"}),second=createLocalEventEnvelope(origin,{...event,sequence:"9",action_id:crypto.randomUUID()});
 const batch={version:1,hostId:id,campaignId:id,events:[first,second],after:null,lastSequence:"9",hasMore:false,delivery:"NOT_CONFIGURED"};
 expect(verifyLocalEventBatch(batch,origin,null).events).toHaveLength(2);
 expect(()=>verifyLocalEventBatch(batch,origin,"2")).toThrow("CHECKPOINT_CONFLICT");
 expect(()=>verifyLocalEventBatch({...batch,events:[second,first]},origin,null)).toThrow("ORDER_INVALID");
 expect(()=>verifyLocalEventBatch({...batch,lastSequence:"10"},origin,null)).toThrow("CHECKPOINT_CONFLICT");
 expect(()=>verifyLocalEventBatch({...batch,events:[first,createLocalEventEnvelope({...origin,epoch:2},{...event,sequence:"9",action_id:crypto.randomUUID()})]},origin,null)).toThrow("ORIGIN_MISMATCH");
});

it("rejects a batch larger than the bounded wire budget",()=>{
 const events=Array.from({length:5},(_,i)=>createLocalEventEnvelope(origin,{...event,sequence:String(i+1),action_id:crypto.randomUUID(),payload:"x".repeat(210000)}));
 expect(()=>verifyLocalEventBatch({version:1,hostId:id,campaignId:id,events,after:null,lastSequence:"5",hasMore:false,delivery:"NOT_CONFIGURED"},origin,null)).toThrow("BATCH_TOO_LARGE");
});
