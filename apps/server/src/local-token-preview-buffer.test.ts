import {describe,it,expect} from "vitest";
import {LocalTokenPreviewBuffer} from "./local-token-preview-buffer.js";
const movement={actionId:crypto.randomUUID(),tokenId:crypto.randomUUID(),revision:0,x:1,y:2,z:0,levelId:null};
describe("bounded transient token hints",()=>{
  it("isolates campaigns and copies movement at publish time",()=>{
    const buffer=new LocalTokenPreviewBuffer();buffer.publish("a",movement);const after=buffer.read("a",0).cursor;buffer.publish("b",{...movement,x:200});buffer.publish("a",{...movement,x:3});
    const batch=buffer.read("a",after);expect(batch.reset).toBe(false);expect(batch.entries.map(e=>e.movement.x)).toEqual([3]);expect(buffer.read("missing",0).entries).toEqual([]);
  });
  it("expires hints instead of replaying old movement",()=>{
    let now=0;const buffer=new LocalTokenPreviewBuffer(()=>now);buffer.publish("a",movement);const cursor=buffer.read("a",0).cursor;buffer.publish("a",movement);now=3001;
    expect(buffer.read("a",cursor)).toMatchObject({reset:true,entries:[]});
  });
  it("bounds per-campaign history and signals missed samples",()=>{
    const buffer=new LocalTokenPreviewBuffer();buffer.publish("a",movement);const old=buffer.read("a",0).cursor;
    for(let i=0;i<150;i++)buffer.publish("a",{...movement,x:i});expect(buffer.read("a",0).entries).toHaveLength(128);expect(buffer.read("a",old)).toMatchObject({reset:true,entries:[]});
  });
  it("bounds campaigns and detects a stale cursor after eviction",()=>{
    const buffer=new LocalTokenPreviewBuffer();buffer.publish("a",movement);const old=buffer.read("a",0).cursor;
    for(let i=0;i<256;i++)buffer.publish(`c${i}`,movement);expect(buffer.read("a",old).reset).toBe(true);
    buffer.publish("a",movement);expect(buffer.read("a",old).reset).toBe(true);
  });
});
