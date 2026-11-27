import {describe,it,expect} from "vitest";
import {createHash,randomUUID} from "node:crypto";
import {LocalChatUploadBuffer} from "./local-chat-upload.js";
const command=(bytes:Buffer)=>({kind:"CHAT_UPLOAD_CHUNK" as const,uploadId:randomUUID(),fileName:"test.png",total:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),offset:0,base64:bytes.toString("base64")});
describe("bounded peer image assembly",()=>{
 it("accepts ordered data and exact partial retries without duplicate bytes",()=>{
  const bytes=Buffer.alloc(20000,3),c=command(bytes),b=new LocalChatUploadBuffer();
  const first={...c,base64:bytes.subarray(0,16384).toString("base64")};
  expect(b.accept("peer",first)).toEqual({nextOffset:16384});expect(b.accept("peer",first)).toEqual({nextOffset:16384});
  expect(()=>b.accept("peer",{...first,base64:Buffer.alloc(16384,4).toString("base64")})).toThrow("UPLOAD_CONFLICT");
  expect(()=>b.accept("peer",{...first,offset:16385,base64:"AA=="})).toThrow("UPLOAD_OFFSET_INVALID");
  const final=b.accept("peer",{...c,offset:16384,base64:bytes.subarray(16384).toString("base64")});expect(final.bytes).toEqual(bytes);
 });
 it("bounds total memory, active reservations and expires dormant uploads",()=>{
  let now=0;const b=new LocalChatUploadBuffer(()=>now,12),bytes=Buffer.alloc(8,1),c=command(bytes),partial={...c,base64:bytes.subarray(0,4).toString("base64")};
  b.accept("a",partial);expect(b.accept("a",{...partial,uploadId:randomUUID()})).toEqual({nextOffset:4});
  expect(()=>b.accept("b",partial)).toThrow("UPLOAD_MEMORY_LIMIT");now=120001;b.sweep();expect(b.accept("b",partial)).toEqual({nextOffset:4});
  expect(()=>b.accept("a",{...c,offset:4,base64:bytes.subarray(4).toString("base64")})).toThrow("UPLOAD_RESTART_REQUIRED");
 });
 it("separates scopes, rejects hash mismatch and releases failed data",()=>{
  const b=new LocalChatUploadBuffer(()=>0,20),c=command(Buffer.alloc(8,2));
  expect(()=>b.accept("a",{...c,sha256:"0".repeat(64)})).toThrow("UPLOAD_HASH_MISMATCH");
  expect(b.accept("a",c).bytes).toEqual(Buffer.alloc(8,2));
  expect(()=>b.accept("b",{...c,base64:"AB=="})).toThrow("UPLOAD_CHUNK_INVALID");
 });
});
