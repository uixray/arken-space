import {describe,it,expect,vi} from "vitest";
import {createPacedRpc} from "./paced-rpc";
describe("bounded peer request pacing",()=>{
  it("keeps media/preview/command requests below the host window limit",async()=>{
    const starts:number[]=[],rpc={request:vi.fn(async()=>{starts.push(performance.now());return true;})};
    const send=createPacedRpc(rpc as any,new AbortController().signal);
    for(let i=0;i<23;i++)await send({kind:i%2?"ASSET_CHUNK":"PREVIEW_POLL"});
    expect(starts).toHaveLength(23);
    for(const start of starts)expect(starts.filter(time=>time>=start&&time<start+1000).length).toBeLessThanOrEqual(18);
  });
  it("aborts a delayed request before sending any extra bytes",async()=>{
    const controller=new AbortController(),rpc={request:vi.fn(async()=>true)},send=createPacedRpc(rpc as any,controller.signal);
    await send({});const pending=send({});controller.abort(Error("closed"));await expect(pending).rejects.toThrow("closed");expect(rpc.request).toHaveBeenCalledOnce();
  });
  it("rejects overlapping callers without building an unbounded queue",async()=>{
    let resolve!:(value:boolean)=>void;const rpc={request:vi.fn(()=>new Promise<boolean>(done=>{resolve=done;}))},send=createPacedRpc(rpc as any,new AbortController().signal);
    const first=send({});await expect(send({})).rejects.toThrow("PENDING");resolve(true);await first;expect(rpc.request).toHaveBeenCalledOnce();
  });
});
