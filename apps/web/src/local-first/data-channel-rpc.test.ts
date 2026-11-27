import { afterEach,describe,expect,it,vi } from "vitest";
import { bindDataChannelRpc } from "./data-channel-rpc";

class Channel extends EventTarget {
  ordered=true;maxRetransmits=null;maxPacketLifeTime=null;readyState="open";
  bufferedAmount=0;bufferedAmountLowThreshold=0;other?:Channel;frames:string[]=[];
  send(data:string){if(this.readyState!=="open")throw Error("closed");this.frames.push(data);queueMicrotask(()=>{if(this.other?.readyState==="open")this.other.dispatchEvent(new MessageEvent("message",{data}));});}
  close(){if(this.readyState==="closed")return;this.readyState="closed";this.dispatchEvent(new Event("close"));this.other?.close();}
}
const live:Array<{close:()=>void}>=[];
afterEach(()=>{live.splice(0).forEach(x=>x.close());vi.useRealTimers();});
function pair(handle:(v:unknown,signal:AbortSignal)=>Promise<unknown>){
  const a=new Channel(),b=new Channel();a.other=b;b.other=a;
  const host=bindDataChannelRpc(b as unknown as RTCDataChannel,{role:"HOST",handle});
  const client=bindDataChannelRpc(a as unknown as RTCDataChannel,{role:"CLIENT"});live.push(host,client);
  return {a,b,host,client};
}
describe("bounded peer RPC",()=>{
  it("round-trips Unicode and chunked responses without changing payload",async()=>{
    const value="Сцена 🏰 ".repeat(12000),{client,b}=pair(async()=>({value}));
    expect(await client.request({kind:"snapshot"})).toEqual({value});
    expect(b.frames.length).toBeGreaterThan(2);
    expect(b.frames.every(f=>new TextEncoder().encode(f).length<16000)).toBe(true);
  });
  it("allows sequential requests and isolates one uncertain in-flight request",async()=>{
    let resolve!:(v:unknown)=>void;
    const {client}=pair(async()=>new Promise(r=>{resolve=r;}));
    const first=client.request({actionId:"same"});
    await expect(client.request({actionId:"other"})).rejects.toThrow("PENDING");
    await vi.waitFor(()=>expect(resolve).toBeTypeOf("function"));resolve({ok:1});
    expect(await first).toEqual({ok:1});
  });
  it("redacts handler errors rather than forwarding credentials or SQL",async()=>{
    const {client,b}=pair(async()=>{throw Error("SQL secret-bearer");});
    await expect(client.request({})).rejects.toThrow("PEER_REQUEST_REJECTED");
    expect(b.frames.join("")).not.toContain("secret-bearer");
  });
  it("closes on malformed, out-of-order or oversized frames",async()=>{
    for(const invalid of ["{}","x".repeat(16001),JSON.stringify({v:1,id:crypto.randomUUID(),kind:"RESPONSE",bytes:4,index:1,parts:1,data:"e30="})]){
      const {client,a}=pair(async()=>new Promise(()=>{}));
      const result=client.request({});
      a.dispatchEvent(new MessageEvent("message",{data:invalid}));
      await expect(result).rejects.toThrow("UNCERTAIN");expect(a.readyState).toBe("closed");
    }
  });
  it("rejects over-limit requests before sending and rejects unreliable channels",async()=>{
    const {client,a}=pair(async()=>({}));
    await expect(client.request({body:"x".repeat(40000)})).rejects.toThrow("UNCERTAIN");
    expect(a.frames).toEqual([]);
    const unreliable=new Channel();unreliable.ordered=false;
    expect(()=>bindDataChannelRpc(unreliable as unknown as RTCDataChannel,{role:"CLIENT"})).toThrow("RELIABLE");
  });
  it("times out without silently resending a possibly committed command",async()=>{
    vi.useFakeTimers();let calls=0;
    const {client,a}=pair(async()=>{calls++;return new Promise(()=>{});});
    const result=client.request({actionId:"one"},100);
    const assertion=expect(result).rejects.toThrow("UNCERTAIN");
    await vi.advanceTimersByTimeAsync(101);await assertion;
    expect(calls).toBe(1);expect(a.frames.length).toBe(1);
  });
});
