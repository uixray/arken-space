import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,readdir,unlink,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,relative,isAbsolute} from "node:path";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createCampaignTransferMediaStage,pinCampaignTransferMedia} from "./campaign-transfer-media.js";
const controlled=vi.hoisted(()=>({uuid:undefined as string|undefined}));
vi.mock("node:crypto",async original=>{const actual=await original<typeof import("node:crypto")>();return {...actual,randomUUID:()=>controlled.uuid??actual.randomUUID()};});
let root:string,source:string,staging:string;
const data=Buffer.from("Synthetic authorized media bytes"),sha256=createHash("sha256").update(data).digest("hex"),reference={storageKey:"synthetic.webp",mimeType:"image/webp",sizeBytes:data.length,sha256};
beforeEach(async()=>{controlled.uuid=undefined;root=await mkdtemp(join(tmpdir(),"arken-transfer-media-"));source=join(root,"source");staging=join(root,"staging");await mkdir(source);await mkdir(staging);await writeFile(join(source,reference.storageKey),data);});
afterEach(async()=>{const base=resolve(tmpdir()),target=resolve(root),part=relative(base,target);if(!part||part.startsWith("..")||isAbsolute(part)||!target.includes("arken-transfer-media-"))throw Error("TEST_CLEANUP_SCOPE_INVALID");await rm(target,{recursive:true,force:true});});
it("publishes exact content-addressed bytes and deduplicates without changing source",async()=>{
 const stage=await createCampaignTransferMediaStage(staging),entry=await stage.copy(await pinCampaignTransferMedia(source,reference));expect(entry).toEqual({sha256,bytes:data.length,mimeType:"image/webp"});expect(await readFile(join(stage.root,"media",sha256))).toEqual(data);expect(await readFile(join(source,reference.storageKey))).toEqual(data);
 expect(await stage.copy(await pinCampaignTransferMedia(source,reference))).toEqual(entry);expect(stage.entries()).toEqual([entry]);expect(await readdir(join(stage.root,"media"))).toEqual([sha256]);
});
it("pins a file before source deletion and closes the capability after copying",async()=>{
 const pin=await pinCampaignTransferMedia(source,reference),stage=await createCampaignTransferMediaStage(staging);await unlink(join(source,reference.storageKey));expect(await stage.copy(pin)).toMatchObject({sha256});expect(await readFile(join(stage.root,"media",sha256))).toEqual(data);await expect(stage.copy(pin)).rejects.toThrow("PIN_INVALID");
});
it("rejects traversal, Windows device names, wrong sizes and changed content",async()=>{
 for(const storageKey of ["../secret","C:/secret","file:secret","dir\\secret","CON.webp","NUL","a/../b","synthetic.webp."])await expect(pinCampaignTransferMedia(source,{...reference,storageKey})).rejects.toThrow();
 await expect(pinCampaignTransferMedia(source,{...reference,sizeBytes:data.length+1})).rejects.toThrow("SIZE_OR_IDENTITY");const pin=await pinCampaignTransferMedia(source,reference),stage=await createCampaignTransferMediaStage(staging);await writeFile(join(source,reference.storageKey),Buffer.alloc(data.length+1));await expect(stage.copy(pin)).rejects.toThrow("CHANGED");expect(await readdir(join(stage.root,"media"))).toEqual([]);
});
it("does not publish mismatched hashes, exceeded quotas or conflicting metadata",async()=>{
 const stage=await createCampaignTransferMediaStage(staging,{maxBytes:data.length,maxFiles:1});await expect(stage.copy(await pinCampaignTransferMedia(source,{...reference,sha256:"0".repeat(64)}))).rejects.toThrow("HASH_MISMATCH");expect(stage.entries()).toEqual([]);await stage.copy(await pinCampaignTransferMedia(source,reference));
 await expect(stage.copy(await pinCampaignTransferMedia(source,{...reference,mimeType:"application/octet-stream"}))).rejects.toThrow("METADATA_CONFLICT");const other=Buffer.from("Other synthetic bytes");await writeFile(join(source,"other.webp"),other);await expect(stage.copy(await pinCampaignTransferMedia(source,{storageKey:"other.webp",mimeType:"image/webp",sizeBytes:other.length}))).rejects.toThrow("QUOTA");expect(await readdir(join(stage.root,"media"))).toEqual([sha256]);
});
it("never overwrites a pre-existing digest path",async()=>{
 const stage=await createCampaignTransferMediaStage(staging);await writeFile(join(stage.root,"media",sha256),"FOREIGN_EXISTING_FILE");await expect(stage.copy(await pinCampaignTransferMedia(source,reference))).rejects.toThrow();expect(await readFile(join(stage.root,"media",sha256),"utf8")).toBe("FOREIGN_EXISTING_FILE");expect(stage.entries()).toEqual([]);
});
it("rejects directory links and overlapping source/staging roots",async()=>{
 const outside=join(root,"outside");await mkdir(outside);await writeFile(join(outside,"escape.webp"),data);await symlink(outside,join(source,"alias"),"junction");await expect(pinCampaignTransferMedia(source,{...reference,storageKey:"alias/escape.webp"})).rejects.toThrow("PATH_INVALID");
 const stage=await createCampaignTransferMediaStage(source);await expect(stage.copy(await pinCampaignTransferMedia(source,reference))).rejects.toThrow("STAGE_INVALID");
});

it("detects tampering of an already staged digest before deduplicating",async()=>{
 const stage=await createCampaignTransferMediaStage(staging);await stage.copy(await pinCampaignTransferMedia(source,reference));await writeFile(join(stage.root,"media",sha256),Buffer.alloc(data.length));await expect(stage.copy(await pinCampaignTransferMedia(source,reference))).rejects.toThrow("STAGED_INTEGRITY_INVALID");
});

it("streams several bounded chunks without truncation or double-writing",async()=>{
 const bytes=Buffer.alloc(200123);for(let index=0;index<bytes.length;index++)bytes[index]=index%251;await writeFile(join(source,"large.bin"),bytes);const expected=createHash("sha256").update(bytes).digest("hex"),stage=await createCampaignTransferMediaStage(staging);expect(await stage.copy(await pinCampaignTransferMedia(source,{storageKey:"large.bin",mimeType:"application/octet-stream",sizeBytes:bytes.length,sha256:expected}))).toMatchObject({sha256:expected,bytes:bytes.length});expect(await readFile(join(stage.root,"media",expected))).toEqual(bytes);
});

it("does not remove a temporary path it failed to create exclusively",async()=>{
 const stage=await createCampaignTransferMediaStage(staging);controlled.uuid="11111111-1111-4111-8111-111111111111";const foreign=join(stage.root,"media","part-"+controlled.uuid);await writeFile(foreign,"FOREIGN_TEMP_FILE");await expect(stage.copy(await pinCampaignTransferMedia(source,reference))).rejects.toThrow();expect(await readFile(foreign,"utf8")).toBe("FOREIGN_TEMP_FILE");expect(stage.entries()).toEqual([]);
});
