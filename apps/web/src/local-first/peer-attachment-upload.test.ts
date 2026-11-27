import {describe,it,expect,vi} from "vitest";
import {uploadPeerAttachment} from "./peer-attachment-upload";
import type {LocalPeerResponse} from "@arken/contracts";
const metadata={contentId:"10000000-0000-4000-8000-000000000001",fileName:"a.png",mimeType:"image/webp",sizeBytes:5,width:1,height:1,createdAt:new Date().toISOString()};
describe("peer attachment upload",()=>{
 it("sends bounded sequential chunks and returns only a final acknowledged attachment",async()=>{
  const file=new File([new Uint8Array(33000).fill(7)],"a.png");let total=0;const commands:unknown[]=[];
  const result=await uploadPeerAttachment(file,async command=>{commands.push(command);expect(Buffer.from(command.base64,"base64").length).toBeLessThanOrEqual(16384);expect(command.offset).toBe(total);total+=Buffer.from(command.base64,"base64").length;return {upload:{uploadId:command.uploadId,nextOffset:total,...(total===file.size?{attachment:metadata}:{})}} as LocalPeerResponse;},()=>false);
  expect(commands).toHaveLength(3);expect(result).toEqual(metadata);
 });
 it("stops after disposal and rejects invalid acknowledgements without retry",async()=>{
  const file=new File([new Uint8Array(20000)],"a.png");let closed=false;
  const request=vi.fn(async command=>{closed=true;return {upload:{uploadId:command.uploadId,nextOffset:16384}} as LocalPeerResponse;});
  await expect(uploadPeerAttachment(file,request,()=>closed)).rejects.toThrow("PEER_CLOSED");expect(request).toHaveBeenCalledTimes(1);
  const wrong=vi.fn(async()=>({upload:{uploadId:crypto.randomUUID(),nextOffset:10}} as LocalPeerResponse));
  await expect(uploadPeerAttachment(file,wrong,()=>false)).rejects.toThrow("UPLOAD_ACK_MISMATCH");expect(wrong).toHaveBeenCalledTimes(1);
 });
});
