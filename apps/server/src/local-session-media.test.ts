import {Readable} from "node:stream";
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {GameSnapshot} from "@arken/contracts";
import {readLocalStoryMediaChunk,readLocalAssetChunk,LOCAL_MEDIA_CHUNK_BYTES} from "./local-session-media.js";
const mocks=vi.hoisted(()=>({resolve:vi.fn(),story:vi.fn(),open:vi.fn()}));
vi.mock("./asset-routes.js",()=>({resolveReadableAsset:mocks.resolve}));
vi.mock("./story-media-content.js",()=>({resolveReadableStoryMedia:mocks.story}));
vi.mock("./storage.js",()=>({openStoredFile:mocks.open}));
const db={} as Parameters<typeof readLocalAssetChunk>[0];
const auth={campaignId:crypto.randomUUID(),membershipId:crypto.randomUUID(),role:"PLAYER" as const,displayName:"Synthetic"};
const snapshot={}as GameSnapshot,assetId=crypto.randomUUID();
beforeEach(()=>{vi.resetAllMocks();mocks.resolve.mockResolvedValue({asset:{mimeType:"image/webp"},storageKey:"synthetic.webp"});});
describe("bounded peer media reader",()=>{
  it("reuses current role-filtered ACL before opening bytes",async()=>{
    mocks.resolve.mockResolvedValue(null);
    await expect(readLocalAssetChunk(db,auth,{assetId,offset:0},snapshot)).rejects.toThrow("ASSET_NOT_FOUND");
    expect(mocks.resolve).toHaveBeenCalledWith(db,auth,assetId,undefined,snapshot);expect(mocks.open).not.toHaveBeenCalled();
  });
  it("returns only the bounded range with integrity, not storage path",async()=>{
    const bytes=Buffer.from("synthetic image bytes"),stream=Readable.from([bytes]);
    mocks.open.mockResolvedValue({stream,size:200000});
    const result=await readLocalAssetChunk(db,auth,{assetId,offset:128},snapshot);
    expect(mocks.open).toHaveBeenCalledWith("synthetic.webp",`bytes=128-${128+LOCAL_MEDIA_CHUNK_BYTES-1}`);
    expect(result).toMatchObject({assetId,offset:128,total:200000,mimeType:"image/webp",base64:bytes.toString("base64"),sha256:createHash("sha256").update(bytes).digest("hex")});
    expect(JSON.stringify(result)).not.toContain("synthetic.webp");expect(stream.destroyed).toBe(true);
  });
  it("fences changed versions before reading a second chunk",async()=>{
    await expect(readLocalAssetChunk(db,auth,{assetId,offset:131072,version:"0".repeat(64)},snapshot)).rejects.toThrow("VERSION_CHANGED");
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("fences repaired bytes at the same imported path and closes rejected streams",async()=>{
    const storageKey="import-media/"+crypto.randomUUID()+"/"+crypto.randomUUID()+".bin";
    mocks.resolve.mockResolvedValue({asset:{mimeType:"image/png"},storageKey});
    const before=Readable.from([Buffer.from("old")]);
    mocks.open.mockResolvedValueOnce({stream:before,size:3,cacheRevision:"11:3:100:100"});
    const first=await readLocalAssetChunk(db,auth,{assetId,offset:0},snapshot);
    const after=Readable.from([Buffer.from("new")]);
    mocks.open.mockResolvedValueOnce({stream:after,size:3,cacheRevision:"12:3:101:101"});
    await expect(readLocalAssetChunk(db,auth,{assetId,offset:0,version:first.version},snapshot)).rejects.toThrow("ASSET_VERSION_CHANGED");
    expect(after.destroyed).toBe(true);
    mocks.open.mockResolvedValueOnce({stream:Readable.from([Buffer.from("new")]),size:3,cacheRevision:"12:3:101:101"});
    const repaired=await readLocalAssetChunk(db,auth,{assetId,offset:0},snapshot);
    expect(repaired.version).not.toBe(first.version);
    expect(repaired.base64).toBe(Buffer.from("new").toString("base64"));
  });
  it("destroys an oversized or failed stream",async()=>{
    const stream=Readable.from([Buffer.alloc(LOCAL_MEDIA_CHUNK_BYTES+1)]);mocks.open.mockResolvedValue({stream,size:LOCAL_MEDIA_CHUNK_BYTES+1});
    await expect(readLocalAssetChunk(db,auth,{assetId,offset:0},snapshot)).rejects.toThrow("TOO_LARGE");expect(stream.destroyed).toBe(true);
    const broken=new Readable({read(){this.destroy(Error("synthetic I/O failure"));}});mocks.open.mockResolvedValue({stream:broken,size:100});
    await expect(readLocalAssetChunk(db,auth,{assetId,offset:0},snapshot)).rejects.toThrow("I/O failure");expect(broken.destroyed).toBe(true);
  });
});

describe("story chunks use current story ACL",()=>{
 it("does not open missing or revoked story media",async()=>{
  mocks.story.mockResolvedValue(null);
  await expect(readLocalStoryMediaChunk(db,auth,{contentId:assetId,offset:0})).rejects.toThrow("STORY_MEDIA_NOT_FOUND");
  expect(mocks.story).toHaveBeenCalledWith(db,auth,assetId);expect(mocks.open).not.toHaveBeenCalled();
 });
 it("reauthorizes every chunk and fences changed storage versions",async()=>{
  mocks.story.mockResolvedValue({storageKey:"story.webp",mimeType:"image/webp"});
  mocks.open.mockResolvedValue({stream:Readable.from([Buffer.from("story")]),size:5});
  expect(await readLocalStoryMediaChunk(db,auth,{contentId:assetId,offset:0})).toMatchObject({assetId,base64:Buffer.from("story").toString("base64")});
  await expect(readLocalStoryMediaChunk(db,auth,{contentId:assetId,offset:131072,version:"0".repeat(64)})).rejects.toThrow("VERSION_CHANGED");
  expect(mocks.story).toHaveBeenCalledTimes(2);expect(mocks.open).toHaveBeenCalledOnce();
 });
});
