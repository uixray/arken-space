import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {env} from "./env.js";
import {deliverPreparedCloudBatch,queryPreparedCloudApplication} from "./local-cloud-sync-client.js";
import {createLocalEventEnvelope,localEventBatchHash,verifyLocalEventBatch} from "./local-event-envelope.js";
const id="11111111-1111-4111-8111-111111111111",origin={hostId:id,campaignId:id,sessionId:id,epoch:1};let saved:{mode:typeof env.DEPLOYMENT_MODE;target:string;host:string};
const batch={version:1,hostId:id,campaignId:id,events:[createLocalEventEnvelope(origin,{sequence:"1",campaign_id:id,action_id:id,membership_id:id,type:"SYNTHETIC",entity_type:"campaign",entity_id:null,entity_revision:null,payload:null,created_at:"2026-11-27"})],after:null,lastSequence:"1",hasMore:false,delivery:"NOT_CONFIGURED"};
const input={originId:id,origin,token:"a".repeat(43),batch};
const receipt=()=>({originId:id,batchHash:localEventBatchHash(verifyLocalEventBatch(batch,origin,null)),receiptId:id,lastSequence:"1",status:"STORED_ONLY"});
beforeEach(()=>{saved={mode:env.DEPLOYMENT_MODE,target:env.LOCAL_CLOUD_SYNC_ORIGIN,host:env.LOCAL_INSTANCE_ID};env.DEPLOYMENT_MODE="LOCAL_HOST";env.LOCAL_CLOUD_SYNC_ORIGIN="https://sync.example.invalid";env.LOCAL_INSTANCE_ID=id;});
afterEach(()=>{env.DEPLOYMENT_MODE=saved.mode;env.LOCAL_CLOUD_SYNC_ORIGIN=saved.target;env.LOCAL_INSTANCE_ID=saved.host;});
it("uses only the configured HTTPS origin, bounds one attempt and validates the receipt",async()=>{
 const fetcher=vi.fn(async()=>Response.json(receipt()));expect(await deliverPreparedCloudBatch(input,fetcher as typeof fetch)).toEqual(receipt());expect(fetcher).toHaveBeenCalledOnce();
 const [url,options]=fetcher.mock.calls[0] as unknown as [URL,RequestInit];expect(url.href).toBe(`https://sync.example.invalid/api/cloud-sync/sources/${id}/batches`);expect(options).toMatchObject({redirect:"error",credentials:"omit",cache:"no-store"});expect(options.signal).toBeTruthy();
});
it("rejects wrong receipts, oversized or executable responses without exposing content",async()=>{
 for(const response of [Response.json({...receipt(),originId:crypto.randomUUID()}),Response.json({...receipt(),batchHash:"0".repeat(64)}),Response.json({...receipt(),status:"APPLIED"}),new Response("x".repeat(65537),{headers:{"content-type":"application/json"}}),new Response("<script>private</script>",{headers:{"content-type":"text/html"}})])await expect(deliverPreparedCloudBatch(input,vi.fn(async()=>response) as typeof fetch)).rejects.toThrow("RECEIPT_INVALID");
});
it("does not export to arbitrary paths or HTTP and does not retry failed delivery",async()=>{
 const fetcher=vi.fn(async()=>{throw Error("private remote failure");});
 await expect(deliverPreparedCloudBatch(input,fetcher as typeof fetch)).rejects.toThrow("UNAVAILABLE");expect(fetcher).toHaveBeenCalledOnce();fetcher.mockClear();
 for(const target of ["http://sync.example.invalid","https://user:secret@sync.example.invalid","https://sync.example.invalid/path","https://sync.example.invalid?target=other"]){env.LOCAL_CLOUD_SYNC_ORIGIN=target;await expect(deliverPreparedCloudBatch(input,fetcher as typeof fetch)).rejects.toThrow("TARGET_INVALID");}expect(fetcher).not.toHaveBeenCalled();
 env.LOCAL_CLOUD_SYNC_ORIGIN="https://sync.example.invalid";await expect(deliverPreparedCloudBatch({...input,origin:{...origin,sessionId:crypto.randomUUID()}},fetcher as typeof fetch)).rejects.toThrow("ORIGIN_MISMATCH");expect(fetcher).not.toHaveBeenCalled();
});

it("reads applied proof without mistaking storage for application and binds every action",async()=>{
 const applied={...receipt(),status:"APPLIED",writerRevision:"9007199254740993",mappings:[{sourceSequence:"1",cloudSequence:"9007199254740995",actionId:id}]};
 const request={...input,receiptId:id},fetcher=vi.fn(async()=>Response.json(applied));
 expect(await queryPreparedCloudApplication(request,fetcher as typeof fetch)).toEqual(applied);
 const [url,options]=fetcher.mock.calls[0] as unknown as [URL,RequestInit];expect(url.pathname).toBe(`/api/cloud-sync/sources/${id}/receipts/${id}/application`);expect(options).toMatchObject({body:"{}",redirect:"error",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer"});expect(url.href).not.toContain(input.token);
 expect((await queryPreparedCloudApplication(request,vi.fn(async()=>Response.json(receipt())) as typeof fetch)).status).toBe("STORED_ONLY");
 for(const changed of [{...applied,receiptId:crypto.randomUUID()},{...applied,batchHash:"0".repeat(64)},{...applied,mappings:[{...applied.mappings[0],actionId:crypto.randomUUID()}]},{...applied,mappings:[{...applied.mappings[0],sourceSequence:"2"}]},{...applied,mappings:[]}])await expect(queryPreparedCloudApplication(request,vi.fn(async()=>Response.json(changed)) as typeof fetch)).rejects.toThrow("RECEIPT_INVALID");
});
it("bounds application reads and does not follow redirects or echo remote failures",async()=>{
 const request={...input,receiptId:id};
 for(const response of [new Response("x".repeat(65537),{headers:{"content-type":"application/json"}}),new Response("PRIVATE",{headers:{"content-type":"text/html"}}),new Response("PRIVATE",{status:403})])await expect(queryPreparedCloudApplication(request,vi.fn(async()=>response) as typeof fetch)).rejects.toThrow(/^LOCAL_CLOUD_SYNC_(RECEIPT_INVALID|GRANT_REJECTED)$/);
 const fail=vi.fn(async()=>{throw Error("PRIVATE");});await expect(queryPreparedCloudApplication(request,fail as typeof fetch)).rejects.toThrow("UNAVAILABLE");expect(fail).toHaveBeenCalledOnce();
});
