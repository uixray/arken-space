import {describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
import type {LocalPeerResponse} from "@arken/contracts";
import {readPeerMedia} from "./peer-media";
const assetId=crypto.randomUUID();
function source(bytes:Buffer,mutate?:(chunk:any)=>void){return vi.fn(async(command:any)=>{const part=bytes.subarray(command.offset,command.offset+131072);const chunk={assetId,offset:command.offset,total:bytes.length,version:"a".repeat(64),mimeType:"image/webp",base64:part.toString("base64"),sha256:createHash("sha256").update(part).digest("hex")};mutate?.(chunk);return {assetChunk:chunk}as LocalPeerResponse;});}
describe("verified peer media assembly",()=>{
  it("assembles multiple bounded chunks and pins the host version",async()=>{
    const bytes=Buffer.alloc(300000,37),request=source(bytes),blob=await readPeerMedia(request,assetId);
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(bytes);expect(blob.type).toBe("image/webp");expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1]![0]).toMatchObject({offset:131072,version:"a".repeat(64)});
  });
  it.each(["identity","offset","integrity","length","total","mime"])("rejects invalid %s",async(kind)=>{
    const request=source(Buffer.alloc(200),chunk=>{if(kind==="identity")chunk.assetId=crypto.randomUUID();if(kind==="offset")chunk.offset=1;if(kind==="integrity")chunk.sha256="0".repeat(64);if(kind==="length")chunk.base64="YQ==";if(kind==="total")chunk.total=101*1024*1024;if(kind==="mime")chunk.mimeType="text/html";});
    await expect(readPeerMedia(request,assetId)).rejects.toThrow();expect(request).toHaveBeenCalledOnce();
  });
  it("rejects a version change during download",async()=>{
    const request=source(Buffer.alloc(150000),chunk=>{if(chunk.offset)chunk.version="b".repeat(64);});
    await expect(readPeerMedia(request,assetId)).rejects.toThrow("SCOPE_CHANGED");
  });
  it("uses the participant-authorized command for chat files",async()=>{
    const request=source(Buffer.from("private"));await readPeerMedia(request,assetId,undefined,undefined,"CHAT_ATTACHMENT");
    expect(request).toHaveBeenCalledWith({kind:"CHAT_ATTACHMENT_CHUNK",contentId:assetId,offset:0});
  });
  it("stops before another request when aborted",async()=>{
    const controller=new AbortController(),request=source(Buffer.alloc(200));controller.abort();
    await expect(readPeerMedia(request,assetId,undefined,controller.signal)).rejects.toThrow();expect(request).not.toHaveBeenCalled();
  });
});

it("uses the separate authorized story media command on every chunk",async()=>{
 const request=source(Buffer.alloc(150000,4));await readPeerMedia(request,assetId,undefined,undefined,"STORY_MEDIA");
 expect(request.mock.calls[0]![0]).toEqual({kind:"STORY_MEDIA_CHUNK",contentId:assetId,offset:0});
 expect(request.mock.calls[1]![0]).toMatchObject({kind:"STORY_MEDIA_CHUNK",contentId:assetId,offset:131072,version:"a".repeat(64)});
});
