import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {LocalPeerResponse} from "@arken/contracts";
import {playerSnapshot} from "../test-support/game-snapshot-fixtures";
import {createPeerMediaProjection} from "./peer-media-projection";
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("./peer-media",()=>({readPeerMedia:mocks.read}));
let projection:ReturnType<typeof createPeerMediaProjection>|undefined;
const assetId=crypto.randomUUID(),url=`/api/assets/${assetId}/content?v=first`;
function response(assetUrl:string|null=url):LocalPeerResponse{
  const snapshot=playerSnapshot({assets:assetUrl?[{id:assetId,kind:"IMAGE",name:"Synthetic",mimeType:"image/webp",sizeBytes:3,width:1,height:1,durationSeconds:null,url:assetUrl,createdAt:""}]:[],worldMaps:{maps:[],locations:[],partyPosition:null}});
  return {authority:{campaignId:snapshot.campaign.id,hostId:crypto.randomUUID(),sessionId:crypto.randomUUID(),epoch:1},snapshot};
}
beforeEach(()=>{vi.restoreAllMocks();mocks.read.mockReset().mockResolvedValue(new Blob(["abc"],{type:"image/webp"}));let id=0;vi.spyOn(URL,"createObjectURL").mockImplementation(()=>`blob:synthetic-${++id}`);vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>undefined);projection=createPeerMediaProjection(vi.fn());});
afterEach(()=>{projection?.dispose();vi.restoreAllMocks();});
describe("memory-only authorized media projection",()=>{
  it("rewrites URLs without mutating host data and caches identical versions",async()=>{
    const raw=response(),first=await projection!.prepare(raw),second=await projection!.prepare(raw);
    expect(first.snapshot.assets[0]!.url).toBe("blob:synthetic-1");expect(second.snapshot.assets[0]!.url).toBe("blob:synthetic-1");expect(raw.snapshot.assets[0]!.url).toBe(url);expect(mocks.read).toHaveBeenCalledOnce();
  });
  it("exports verified blobs only for references in the current snapshot",async()=>{
    const raw=response();await projection!.prepare(raw);const exported=projection!.snapshotMedia(raw.snapshot);
    expect(exported.size).toBe(1);expect(await exported.get(url)?.text()).toBe("abc");expect(projection!.snapshotMedia(response(null).snapshot).size).toBe(0);
  });
  it("preserves user text that happens to equal a canonical content URL",async()=>{
    await projection!.prepare(response());
    expect(projection!.rewrite({body:url,name:url,url,posterUrl:url})).toEqual({body:url,name:url,url:"blob:synthetic-1",posterUrl:"blob:synthetic-1"});
  });
  it("revokes old URLs on content change, removal, and session close",async()=>{
    await projection!.prepare(response());await projection!.prepare(response(url.replace("first","next")));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-1");
    await projection!.prepare(response(null));expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-2");
    await projection!.prepare(response());projection!.dispose();expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-3");
    await expect(projection!.prepare(response())).rejects.toThrow("CLOSED");
  });
  it("clears cached bytes after a failed changed-version download",async()=>{
    await projection!.prepare(response());mocks.read.mockRejectedValueOnce(Error("revoked"));
    await expect(projection!.prepare(response(url.replace("first","next")))).rejects.toThrow("revoked");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-1");expect(()=>projection!.rewrite(url)).toThrow("NOT_AUTHORIZED");
  });
  it("rejects unrecognized URLs instead of falling back to cloud",async()=>{
    await expect(projection!.prepare(response("https://cloud.invalid/private.webp"))).rejects.toThrow("URL_UNSUPPORTED");expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rewrites private attachment URLs, keeps older history while the thread is authorized, and revokes on removal",async()=>{
    const raw=response(null),threadId=crypto.randomUUID(),contentId=crypto.randomUUID();raw.snapshot.chatThreads=[{id:threadId,type:"DIRECT"}as any];
    raw.chatHistory={hasMore:false,messages:[{threadId,body:"Private",attachments:[{contentId,fileName:"private.png",mimeType:"image/png",sizeBytes:3,width:1,height:1,createdAt:new Date(0).toISOString()}]}as any]};
    const prepared=await projection!.prepare(raw);expect(prepared.chatHistory!.messages[0]!.attachments![0]!.url).toBe("blob:synthetic-1");expect(mocks.read).toHaveBeenCalledWith(expect.anything(),contentId,undefined,expect.any(AbortSignal),"CHAT_ATTACHMENT");
    delete raw.chatHistory;await projection!.prepare(raw);expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    raw.snapshot.chatThreads=[];await projection!.prepare(raw);expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-1");
  });
  it("projects world-map backgrounds through the existing asset cache and clears removed references",async()=>{
    const raw=response(),mapId=crypto.randomUUID();raw.snapshot.assets[0]!.kind="MAP";raw.snapshot.worldMaps={maps:[{id:mapId,name:"World",scope:"WORLD",visibility:"CAMPAIGN",lifecycle:"PUBLISHED",backgroundAssetId:assetId,revision:0}],locations:[],partyPosition:null};
    const prepared=await projection!.prepare(raw);expect(prepared.snapshot.worldMaps!.maps[0]!.backgroundAssetId).toBe(assetId);expect(prepared.snapshot.assets[0]!.url).toBe("blob:synthetic-1");expect(mocks.read).toHaveBeenCalledOnce();
    await projection!.prepare(raw);expect(mocks.read).toHaveBeenCalledOnce();
    await projection!.prepare(response(null));expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-1");
  });
  it("does not retain a late download after disposal",async()=>{
    let finish!:(blob:Blob)=>void;mocks.read.mockImplementationOnce(()=>new Promise<Blob>(resolve=>{finish=resolve;}));
    const pending=projection!.prepare(response());projection!.dispose();finish(new Blob(["late"]));
    await expect(pending).rejects.toThrow();expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

it("downloads authorized story media and clears its UI URL on inventory change",async()=>{
 const raw=response(null),id=crypto.randomUUID(),contentId=crypto.randomUUID();raw.storyFingerprint="a".repeat(64);
 raw.storyPage={posts:[{id,threadId:id,authorMembershipId:id,title:"Synthetic",body:"Public",lifecycle:"PUBLISHED",revision:1,entityLinks:[],media:[{contentId,order:0,altText:"Image",caption:"",fileName:"story.webp",mimeType:"image/webp",sizeBytes:3,width:1,height:1,createdAt:""}],publishedAt:"",correctedAt:null,worldDay:null,era:null,linkTargets:[],createdAt:"",updatedAt:""}],nextCursor:null,eras:[]};
 await projection!.prepare(raw);expect(projection!.storyMediaUrl(contentId)).toBe("blob:synthetic-1");
 expect(mocks.read).toHaveBeenCalledWith(expect.anything(),contentId,undefined,expect.any(AbortSignal),"STORY_MEDIA");
 delete raw.storyPage;await projection!.prepare(raw);expect(mocks.read).toHaveBeenCalledOnce();
 raw.storyFingerprint="b".repeat(64);await projection!.prepare(raw);expect(projection!.storyMediaUrl(contentId)).toBe("");expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-1");
});

it('replaces cached bytes at identical URLs after host media repair',async()=>{
 const raw=response();raw.mediaRevision='a'.repeat(64);
 await projection!.prepare(raw);await projection!.prepare(raw);
 expect(mocks.read).toHaveBeenCalledOnce();
 mocks.read.mockResolvedValueOnce(new Blob(['repaired'],{type:'image/webp'}));
 raw.mediaRevision='b'.repeat(64);
 const fresh=await projection!.prepare(raw);
 expect(mocks.read).toHaveBeenCalledTimes(2);
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-1');
 expect(fresh.snapshot.assets[0]!.url).toBe('blob:synthetic-2');
 expect(await projection!.snapshotMedia(raw.snapshot).get(url)?.text()).toBe('repaired');
});
it('fails closed on malformed media revision and releases old blobs',async()=>{
 const raw=response();raw.mediaRevision='a'.repeat(64);await projection!.prepare(raw);
 raw.mediaRevision='untrusted';await expect(projection!.prepare(raw)).rejects.toThrow('REVISION_INVALID');
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-1');
});

it('drops cached attachment blobs on media revision change even when content IDs stay stable',async()=>{
 const raw=response(null),thread=crypto.randomUUID(),contentId=crypto.randomUUID();
 raw.snapshot.chatThreads=[{id:thread,kind:'STREAM'}] as any;
 raw.chatHistory={messages:[{id:crypto.randomUUID(),threadId:thread,attachments:[{contentId}]}] as any,hasMore:false};
 raw.mediaRevision='a'.repeat(64);await projection!.prepare(raw);
 raw.mediaRevision='b'.repeat(64);await projection!.prepare(raw);
 expect(mocks.read).toHaveBeenCalledTimes(2);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-1');
});
