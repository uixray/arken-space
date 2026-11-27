import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from "vitest";
import {playerSnapshot} from "../test-support/game-snapshot-fixtures";
import {api,sendClientEventNow} from "../api";
import {createGameSocket} from "../realtime";
import {installLocalPlayerRuntime} from "./player-runtime";
import type {bindLocalPlayerChannel} from "./session-channel";
type Client=Awaited<ReturnType<typeof bindLocalPlayerChannel>>;
let runtime:ReturnType<typeof installLocalPlayerRuntime>|null=null;
afterEach(()=>{runtime?.dispose();runtime=null;vi.unstubAllGlobals();});
function setup(options?:Parameters<typeof installLocalPlayerRuntime>[2]){
  const snapshot=playerSnapshot({assets:[],worldMaps:{maps:[],locations:[],partyPosition:null}}),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  const request=vi.fn(async(_command:Parameters<Client["request"]>[0])=>({authority:{campaignId:snapshot.campaign.id,hostId:"host",sessionId:"session",epoch:1},snapshot}));
  const client={authority:{campaignId:snapshot.campaign.id,hostId:"host",sessionId:"session",epoch:1},membershipId:snapshot.me.id,request,sendPreview:vi.fn(async()=>({accepted:true})),pollPreviews:vi.fn(async()=>({epoch:crypto.randomUUID(),cursor:0,reset:false,events:[]})),close:vi.fn()} as unknown as Client;
  runtime=installLocalPlayerRuntime(client,snapshot,options);return {snapshot,fetch,request,client};
}
describe("shared App peer runtime",()=>{
  it("routes bootstrap to the peer and never sends unsupported API actions to cloud",async()=>{
    const {snapshot,fetch,request}=setup();expect(await api("/api/bootstrap")).toStrictEqual(snapshot);
    expect(request).toHaveBeenCalledWith({kind:"SNAPSHOT"});
    await expect(api("/api/unknown-action",{method:"POST",body:"{}"})).rejects.toMatchObject({code:"PEER_ACTION_PENDING"});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends chat intents through the canonical peer command without native fetch",async()=>{
    const {request,fetch}=setup(),payload={actionId:crypto.randomUUID(),body:"Synthetic chat",stream:"TABLE",visibility:"PUBLIC"};
    await api("/api/chat",{method:"POST",body:JSON.stringify(payload)});
    expect(request).toHaveBeenCalledWith({kind:"CHAT_SEND",payload:{...payload,attachmentContentIds:[]}});expect(fetch).not.toHaveBeenCalled();
  });
  it("sends free rolls through server RNG command and preserves the action ID",async()=>{
    const {request,fetch}=setup(),payload={actionId:crypto.randomUUID(),formula:"2d6",rollMode:"ADVANTAGE",visibility:"GM_ONLY"};
    await api("/api/dice",{method:"POST",body:JSON.stringify(payload)});
    expect(request).toHaveBeenCalledWith({kind:"DICE_ROLL",payload});expect(fetch).not.toHaveBeenCalled();
  });
  it("routes private threads, messages, history and read markers through peer commands",async()=>{
    const {request,fetch}=setup(),threadId=crypto.randomUUID(),participantMembershipId=crypto.randomUUID();
    await api("/api/chat/direct",{method:"POST",body:JSON.stringify({participantMembershipId})});
    expect(request).toHaveBeenLastCalledWith({kind:"DIRECT_OPEN",payload:{participantMembershipId}});
    const payload={threadId,actionId:crypto.randomUUID(),body:"Private",attachmentContentIds:[]};await api("/api/chat/direct/messages",{method:"POST",body:JSON.stringify(payload)});expect(request).toHaveBeenLastCalledWith({kind:"DIRECT_SEND",payload});
    await api(`/api/chat/threads/${threadId}/messages?limit=10&before=99`);expect(request).toHaveBeenLastCalledWith({kind:"CHAT_HISTORY",payload:{threadId,limit:10,before:99}});
    await api("/api/chat/read",{method:"POST",body:JSON.stringify({threadId,sequence:99})});expect(request).toHaveBeenLastCalledWith({kind:"CHAT_READ",payload:{threadId,sequence:99}});expect(fetch).not.toHaveBeenCalled();
  });
  it("adapts existing multipart image actions into chunk commands without fetch",async()=>{
    const {snapshot,request,fetch}=setup(),form=new FormData();form.append("file",new File([new Uint8Array([1,2,3])],"peer.png"));
    const metadata={contentId:crypto.randomUUID(),fileName:"peer.png",mimeType:"image/webp",sizeBytes:3,width:1,height:1,createdAt:new Date().toISOString()};
    request.mockImplementationOnce(async(command:any)=>({authority:{campaignId:snapshot.campaign.id,hostId:"host",sessionId:"session",epoch:1},snapshot,upload:{uploadId:command.uploadId,nextOffset:3,attachment:metadata}}));
    expect(await api("/api/chat/attachments",{method:"POST",body:form})).toEqual(metadata);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({kind:"CHAT_UPLOAD_CHUNK",offset:0,total:3,base64:"AQID"}));expect(fetch).not.toHaveBeenCalled();
  });
  it("routes ability recharge with immutable action and entry identity",async()=>{
    const {request,fetch}=setup(),characterId=crypto.randomUUID(),entryId=crypto.randomUUID(),payload={actionId:crypto.randomUUID(),revision:4};
    await api(`/api/characters/${characterId}/catalog/${entryId}/recharge`,{method:"POST",body:JSON.stringify(payload)});
    expect(request).toHaveBeenCalledWith({kind:"ENTRY_RECHARGE",characterId,entryId,payload});expect(fetch).not.toHaveBeenCalled();
  });
  it("routes skill and ability execution through canonical entry commands",async()=>{
    const {request,fetch}=setup(),characterId=crypto.randomUUID(),entryId=crypto.randomUUID(),payload={actionId:crypto.randomUUID(),entryRevision:2,executeAll:true,visibility:"PUBLIC"};
    await api(`/api/characters/${characterId}/catalog/${entryId}/roll`,{method:"POST",body:JSON.stringify(payload)});
    expect(request).toHaveBeenCalledWith({kind:"ENTRY_ROLL",characterId,entryId,payload});expect(fetch).not.toHaveBeenCalled();
  });
  it("routes resource and rest commands through peer with preserved revision",async()=>{
    const {request,fetch}=setup(),characterId=crypto.randomUUID(),payload={actionId:crypto.randomUUID(),revision:2,rest:"SHORT"};
    await api(`/api/characters/${characterId}/counters`,{method:"PATCH",body:JSON.stringify(payload)});
    expect(request).toHaveBeenCalledWith({kind:"CHARACTER_COUNTERS",characterId,payload});expect(fetch).not.toHaveBeenCalled();
  });
  it("routes areas/undo and preserves actor context and safe rejection semantics",async()=>{
    const {snapshot,request,fetch}=setup(),payload={actionId:crypto.randomUUID(),characterId:crypto.randomUUID(),entryId:crypto.randomUUID(),entryRevision:0,sceneId:crypto.randomUUID(),sceneRevision:0,casterTokenId:crypto.randomUUID(),casterTokenRevision:0};
    const headers={"x-entry-campaign":snapshot.campaign.id,"x-entry-member":snapshot.me.id};
    await api("/api/abilities/area/apply",{method:"POST",headers,body:JSON.stringify(payload)});expect(request).toHaveBeenLastCalledWith({kind:"AREA_APPLY",payload});
    await api("/api/abilities/area/cancel",{method:"POST",headers,body:JSON.stringify(payload)});expect(request).toHaveBeenLastCalledWith({kind:"AREA_CANCEL",payload});
    const undo={actionId:crypto.randomUUID(),messageId:crypto.randomUUID()};await api("/api/chat/application-undo",{method:"POST",body:JSON.stringify(undo)});expect(request).toHaveBeenLastCalledWith({kind:"APPLICATION_UNDO",payload:undo});
    const before=request.mock.calls.length;await expect(api("/api/abilities/area/cancel",{method:"POST",body:JSON.stringify(payload)})).rejects.toMatchObject({code:"ENTRY_CONTEXT_CHANGED"});expect(request.mock.calls).toHaveLength(before);
    request.mockImplementationOnce(async()=>({authority:{campaignId:snapshot.campaign.id,hostId:"host",sessionId:"session",epoch:1},snapshot,commandError:{status:409,code:"CAMPAIGN_PAUSED",notApplied:true}}));
    await expect(api("/api/abilities/area/apply",{method:"POST",headers,body:JSON.stringify(payload)})).rejects.toMatchObject({status:409,code:"CAMPAIGN_PAUSED",details:{error:"CAMPAIGN_PAUSED",notApplied:true}});expect(fetch).not.toHaveBeenCalled();
  });
  it("surfaces safe image validation messages instead of a generic transport failure",async()=>{
    const {snapshot,request,fetch}=setup(),form=new FormData();form.append("file",new File([new Uint8Array([1,2,3])],"bad.png"));
    request.mockImplementationOnce(async()=>({authority:{campaignId:snapshot.campaign.id,hostId:"host",sessionId:"session",epoch:1},snapshot,commandError:{status:400,code:"UNSUPPORTED_FILE_TYPE"}}));
    await expect(api("/api/chat/attachments",{method:"POST",body:form})).rejects.toMatchObject({status:400,code:"UNSUPPORTED_FILE_TYPE",message:"Выберите изображение PNG, JPEG или WebP."});expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps diagnostic events off cloud during and after a peer session",async()=>{
    const {fetch}=setup();expect(await sendClientEventNow({level:"info",event:"client.performance.peer"})).toBe(false);
    runtime!.dispose();expect(await sendClientEventNow({level:"warn",event:"peer.closed"})).toBe(false);expect(fetch).not.toHaveBeenCalled();
  });
  it("fences API and socket factories after disposal instead of silently reverting to cloud",async()=>{
    const {fetch,client}=setup();runtime!.dispose();
    await expect(api("/api/bootstrap")).rejects.toThrow("закрыт");
    expect(()=>createGameSocket()).toThrow("CLOSED");expect(fetch).not.toHaveBeenCalled();expect(client.close).toHaveBeenCalledOnce();
  });
  it("delivers canonical snapshots through the existing typed subscription surface",async()=>{
    const {snapshot}=setup(),socket=createGameSocket(),snapshots=vi.fn(),connect=vi.fn();
    socket.on("game:snapshot",snapshots).on("connect",connect);
    await vi.waitFor(()=>expect(socket.connected).toBe(true));
    expect(connect).toHaveBeenCalledOnce();expect(snapshots).toHaveBeenCalledWith(snapshot);
    socket.disconnect();expect(socket.connected).toBe(false);
    socket.connect();await vi.waitFor(()=>expect(socket.connected).toBe(true));
    expect(connect).toHaveBeenCalledTimes(2);
  });
  it("delivers server-filtered movement and redaction hints on the typed socket",async()=>{
    const {client}=setup(),socket=createGameSocket(),moving=vi.fn(),hidden=vi.fn(),epoch=crypto.randomUUID();
    socket.on("token:moving",moving).on("token:preview-hidden",hidden);
    const movement={actionId:crypto.randomUUID(),tokenId:crypto.randomUUID(),sceneId:crypto.randomUUID(),revision:0,x:128,y:64,z:0,levelId:null,previewEpoch:epoch};
    vi.mocked(client.pollPreviews).mockResolvedValueOnce({authority:client.authority,membershipId:client.membershipId,epoch,cursor:2,reset:false,events:[{kind:"MOVING",movement},{kind:"HIDDEN",event:{tokenId:movement.tokenId,sceneId:movement.sceneId,revision:0,previewEpoch:epoch}}]});
    await vi.waitFor(()=>expect(moving).toHaveBeenCalledWith(movement));expect(hidden).toHaveBeenCalledWith(expect.objectContaining({tokenId:movement.tokenId}));expect(socket.previewEpoch).toBe(epoch);
  });
  it("reapplies a fresh drag hint after a periodic snapshot instead of snapping back",async()=>{
    const {client,snapshot}=setup(),socket=createGameSocket(),moving=vi.fn(),epoch=crypto.randomUUID(),tokenId=crypto.randomUUID(),sceneId=crypto.randomUUID();
    snapshot.tokens=[{id:tokenId,sceneId,revision:0}as any];socket.on("token:moving",moving);
    const movement={actionId:crypto.randomUUID(),tokenId,sceneId,revision:0,x:128,y:64,z:0,levelId:null,previewEpoch:epoch};
    vi.mocked(client.pollPreviews).mockResolvedValueOnce({authority:client.authority,membershipId:client.membershipId,epoch,cursor:1,reset:false,events:[{kind:"MOVING",movement}]});
    await vi.waitFor(()=>expect(moving).toHaveBeenCalledOnce());
    await api("/api/bootstrap");expect(moving).toHaveBeenCalledTimes(2);
  });
  it("coalesces outgoing drag hints and never treats them as committed moves",async()=>{
    const {client,request}=setup(),socket=createGameSocket();await vi.waitFor(()=>expect(socket.connected).toBe(true));
    const movement={actionId:crypto.randomUUID(),tokenId:crypto.randomUUID(),revision:0,x:0,y:64,z:0,levelId:null};
    for(let x=0;x<30;x++)socket.volatile.emit("token:moving",{...movement,x});
    await vi.waitFor(()=>expect(client.sendPreview).toHaveBeenCalledOnce());expect(client.sendPreview).toHaveBeenCalledWith({...movement,x:29});
    expect((request.mock.calls as unknown as Array<[any]>).some(call=>call[0]?.kind==="TOKEN_MOVE")).toBe(false);
  });
  it("preserves action IDs when adapting a move and returns the actual ACK",async()=>{
    const {snapshot,request}=setup(),socket=createGameSocket();
    await vi.waitFor(()=>expect(socket.connected).toBe(true));
    const payload={actionId:crypto.randomUUID(),tokenId:crypto.randomUUID(),revision:0,x:64,y:64,z:0,levelId:null};
    request.mockImplementationOnce(async()=>({authority:{campaignId:snapshot.campaign.id,hostId:"host",sessionId:"session",epoch:1},snapshot,ack:{ok:true,status:"APPLIED",sequence:3}}));
    const ack=vi.fn();socket.emit("token:moved",payload,ack);
    await vi.waitFor(()=>expect(ack).toHaveBeenCalledWith(expect.objectContaining({ok:true,status:"ACCEPTED",sequence:3})));
    expect(request).toHaveBeenCalledWith({kind:"TOKEN_MOVE",payload});
  });
  it("keeps published world-map metadata without requiring a separate transport",async()=>{
    const {snapshot,request}=setup(),map={id:crypto.randomUUID(),name:"World",scope:"WORLD",visibility:"CAMPAIGN",lifecycle:"PUBLISHED",backgroundAssetId:null,revision:0};
    request.mockImplementationOnce(async()=>({authority:{campaignId:snapshot.campaign.id,hostId:"host",sessionId:"session",epoch:1},snapshot:{...snapshot,worldMaps:{maps:[map],locations:[],partyPosition:null}}} as any));
    expect((await api<any>("/api/bootstrap")).worldMaps.maps).toEqual([map]);
  });
  it("publishes refreshed state on a character conflict and keeps the channel usable",async()=>{
    const {snapshot,request,client,fetch}=setup();const socket=createGameSocket(),seen:any[]=[],disconnect=vi.fn();
    socket.on("game:snapshot",value=>seen.push(value));socket.on("disconnect",disconnect);await new Promise(r=>setTimeout(r,50));
    const updated={...snapshot,snapshotVersion:snapshot.snapshotVersion+1};
    request.mockImplementationOnce(async()=>({authority:client.authority,snapshot:updated,commandError:{status:409,code:"CHARACTER_CONFLICT"}}));
    await expect(api('/api/characters/'+crypto.randomUUID()+'/counters',{method:'PATCH',body:JSON.stringify({actionId:crypto.randomUUID(),revision:0,rest:'SHORT'})})).rejects.toMatchObject({status:409,code:'CHARACTER_CONFLICT',message:'Персонаж изменился. Проверьте обновлённые значения и повторите действие.'});
    expect(seen.at(-1)?.snapshotVersion).toBe(updated.snapshotVersion);expect(disconnect).not.toHaveBeenCalled();expect(socket.connected).toBe(true);
    await expect(api('/api/bootstrap')).resolves.toBeDefined();expect(fetch).not.toHaveBeenCalled();socket.disconnect();
  });

  it("observes the raw authorized projection and isolates cache failures from game requests",async()=>{
    const observer=vi.fn(async(_snapshot:Parameters<NonNullable<NonNullable<Parameters<typeof installLocalPlayerRuntime>[2]>["onSnapshot"]>>[0])=>{throw Error("synthetic cache quota");});const {snapshot}=setup({onSnapshot:observer});
    await expect(api('/api/bootstrap')).resolves.toBeDefined();await new Promise(r=>setTimeout(r,0));
    expect(observer).toHaveBeenCalledOnce();expect(observer.mock.calls[0]?.[0]).toBe(snapshot);
    await expect(api('/api/bootstrap')).resolves.toBeDefined();
  });

  it("waits for logout cleanup and closes the client even when deletion fails",async()=>{
    const cleanup=vi.fn().mockRejectedValue(Error("synthetic cleanup failure"));const {client,fetch}=setup({onLogout:cleanup});
    await expect(api('/api/auth/logout',{method:'POST'})).rejects.toThrow('synthetic cleanup failure');expect(cleanup).toHaveBeenCalledOnce();expect(client.close).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
  });

});

it("refreshes the open story once when host fingerprint changes, not on unrelated gameplay",async()=>{
 const {snapshot,request}=setup();let fingerprint="a".repeat(64);
 request.mockImplementation(async()=>({authority:{campaignId:snapshot.campaign.id,hostId:"host",sessionId:"session",epoch:1},snapshot,storyFingerprint:fingerprint}));
 const socket=createGameSocket(),changed=vi.fn();socket.on("story:changed",changed);socket.connect();await api("/api/bootstrap");
 changed.mockClear();snapshot.snapshotVersion++;await api("/api/bootstrap");expect(changed).not.toHaveBeenCalled();
 fingerprint="b".repeat(64);await api("/api/bootstrap");expect(changed).toHaveBeenCalledOnce();
 await api("/api/bootstrap");expect(changed).toHaveBeenCalledOnce();socket.disconnect();
});

it('persists repaired media at the same snapshot version through the actual player runtime',async()=>{
 const saved:ReadonlyMap<string,Blob>[]=[];
 const {snapshot,request}=setup({onSnapshot:async(_snapshot,media)=>{saved.push(media);}});
 const id=crypto.randomUUID(),url=`/api/assets/${id}/content?v=stable`;
 snapshot.assets=[{id,kind:'IMAGE',name:'Synthetic',mimeType:'image/png',sizeBytes:3,width:1,height:1,durationSeconds:null,url,createdAt:''}];
 let generation='a'.repeat(64),payload=Buffer.from('old');let blobs=0;
 const create=vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:runtime-${++blobs}`),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 try{
  request.mockImplementation(async(command:any)=>({authority:{campaignId:snapshot.campaign.id,hostId:'host',sessionId:'session',epoch:1},snapshot,mediaRevision:generation,...(command.kind==='ASSET_CHUNK'?{assetChunk:{assetId:id,offset:0,total:3,version:generation,mimeType:'image/png',base64:payload.toString('base64'),sha256:createHash('sha256').update(payload).digest('hex')}}:{})}));
  const first=await api('/api/bootstrap') as typeof snapshot;
  await vi.waitFor(()=>expect(saved.length).toBe(1));expect(await saved[0]!.get(url)?.text()).toBe('old');
  generation='b'.repeat(64);payload=Buffer.from('new');
  const second=await api('/api/bootstrap') as typeof snapshot;
  await vi.waitFor(()=>expect(saved.length).toBe(2));expect(await saved[1]!.get(url)?.text()).toBe('new');
  expect(second.snapshotVersion).toBe(first.snapshotVersion);expect(second.assets[0]!.url).not.toBe(first.assets[0]!.url);
  expect(revoke).toHaveBeenCalledWith('blob:runtime-1');
 }finally{runtime?.dispose();create.mockRestore();revoke.mockRestore();}
});

it('routes automatic soundpad/history reads to the authorized host and denies operator capability',async()=>{
 const {request,fetch}=setup(),sceneId=crypto.randomUUID();
 await api('/api/soundpad');expect(request).toHaveBeenLastCalledWith({kind:'SOUNDPAD_READ'});
 await api('/api/canvas/history?sceneId='+sceneId);expect(request).toHaveBeenLastCalledWith({kind:'CANVAS_HISTORY',sceneId});
 expect(await api('/api/operator/feedback/capability')).toEqual({allowed:false,bugIntakeEnabled:false});
 expect(fetch).not.toHaveBeenCalled();
});
it('ignores PLAYER scene-view hints like the hosted server rather than reporting failed actions',async()=>{
 setup();const socket=createGameSocket(),error=vi.fn();socket.on('server:error',error);
 socket.emit('scene:view',{sceneId:crypto.randomUUID()});socket.emit('scene:view',{sceneId:null});socket.emit('cursor:gone');
 await Promise.resolve();expect(error).not.toHaveBeenCalled();socket.disconnect();
});

it('never persists an older exact snapshot whose numeric version rounds to the current value',async()=>{
 const captured=vi.fn();const {snapshot,request}=setup({onSnapshot:captured});
 snapshot.snapshotSequence='9007199254743016';snapshot.snapshotVersion=Number(snapshot.snapshotSequence);
 await api('/api/bootstrap');await vi.waitFor(()=>expect(captured).toHaveBeenCalledTimes(1));
 request.mockResolvedValueOnce({authority:{campaignId:snapshot.campaign.id,hostId:'host',sessionId:'session',epoch:1},snapshot:{...snapshot,snapshotSequence:'9007199254743015'}});
 await api('/api/bootstrap');await Promise.resolve();expect(captured).toHaveBeenCalledTimes(1);
});
