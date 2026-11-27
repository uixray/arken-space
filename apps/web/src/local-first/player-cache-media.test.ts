import {describe,it,expect} from "vitest";
import {playerSnapshot} from "../test-support/game-snapshot-fixtures";
import {encodePlayerCacheBundle,decodePlayerCacheBundle} from "./player-cache-media";
const url=`/api/assets/${crypto.randomUUID()}/content?v=current`;
function snapshot(){return playerSnapshot({assets:[{id:crypto.randomUUID(),kind:"IMAGE",name:"Synthetic",mimeType:"image/png",sizeBytes:3,width:1,height:1,durationSeconds:null,url,createdAt:""}],worldMaps:{maps:[],locations:[],partyPosition:null}});}
describe("atomic authorized cache media bundle",()=>{
 it("roundtrips binary bytes and includes only current snapshot references",async()=>{
  const source=snapshot(),bytes=new Uint8Array([0,255,128,13,10]),blob=new Blob([bytes],{type:"image/png"});
  const encoded=await encodePlayerCacheBundle(source,new Map([[url,blob],["/api/assets/removed/content",blob]]));
  expect(encoded.media).toHaveLength(1);const restored=decodePlayerCacheBundle(encoded);expect(restored.snapshot).toEqual(source);
  expect(new Uint8Array(await restored.media.get(url)!.arrayBuffer())).toEqual(bytes);expect(restored.media.get(url)?.type).toBe("image/png");
 });
 it("rejects executable media and enforces the aggregate byte budget",async()=>{
  await expect(encodePlayerCacheBundle(snapshot(),new Map([[url,new Blob(["<script>"],{type:"text/html"})]]))).rejects.toThrow("MEDIA_INVALID");
  await expect(encodePlayerCacheBundle(snapshot(),new Map([[url,new Blob([new Uint8Array(32*1024*1024+1)],{type:"image/png"})]]))).rejects.toThrow("MEDIA_TOO_LARGE");
 });
 it("rejects foreign and duplicate media when decoding",async()=>{
  const encoded=await encodePlayerCacheBundle(snapshot(),new Map([[url,new Blob(["abc"],{type:"image/png"})]]));
  expect(()=>decodePlayerCacheBundle({...encoded,media:[...encoded.media,...encoded.media]})).toThrow("SCOPE_MISMATCH");
  expect(()=>decodePlayerCacheBundle({...encoded,media:encoded.media.map(item=>({...item,url:"/foreign"}))})).toThrow("SCOPE_MISMATCH");
 });
 it("reads legacy snapshots without inventing media",()=>{
  const source=snapshot(),restored=decodePlayerCacheBundle(source);expect(restored.snapshot).toBe(source);expect(restored.media.size).toBe(0);
 });
});
