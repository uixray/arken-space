import {afterEach,expect,it,vi} from "vitest";
import {playerSnapshot} from "../test-support/game-snapshot-fixtures";
import {api} from "../api";
import {createGameSocket} from "../realtime";
import {installPlayerCopyRuntime} from "./player-copy-runtime";
let runtime:ReturnType<typeof installPlayerCopyRuntime>|undefined;
afterEach(()=>{runtime?.dispose();runtime=undefined;vi.unstubAllGlobals();});
function setup(withMedia=true,withChat=false){
 const snapshot=playerSnapshot({assets:[],worldMaps:{maps:[],locations:[],partyPosition:null}}),id=crypto.randomUUID(),url=`/api/assets/${id}/content?v=local`;
 snapshot.assets=[{id,kind:"IMAGE",name:"Saved image",mimeType:"image/png",sizeBytes:3,width:1,height:1,durationSeconds:null,url,createdAt:""}];
 const threadId=crypto.randomUUID();
 if(withChat){
  snapshot.chatThreads=[{id:threadId,campaignId:snapshot.campaign.id,type:"STREAM",stream:"TABLE",createdAt:"",updatedAt:""}];
  snapshot.messages=[3,7].map(sequence=>({id:crypto.randomUUID(),sequence,membershipId:snapshot.me.id,displayName:"Synthetic",characterId:null,body:"Cached",visibility:"PUBLIC",kind:"TEXT",threadId,stream:"TABLE",dice:null,createdAt:""}));
  snapshot.chatThreadStates=[{threadId,stream:"TABLE",lastReadSequence:1,latestSequence:7,unreadCount:2}];
 }
 const scope={authority:{campaignId:snapshot.campaign.id,hostId:crypto.randomUUID(),sessionId:crypto.randomUUID(),epoch:1},membershipId:snapshot.me.id,deviceId:crypto.randomUUID()};
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);runtime=installPlayerCopyRuntime(scope,{snapshot,media:withMedia?new Map([[url,new Blob(["abc"],{type:"image/png"})]]):new Map()});return {snapshot,fetch,threadId};
}
it("renders saved media through verified chunks without HTTP and denies game mutations",async()=>{
 const {fetch}=setup(),snapshot=await api<any>('/api/bootstrap');expect(snapshot.assets[0].url).toMatch(/^blob:/);
 await expect(api('/api/dice',{method:'POST',body:JSON.stringify({actionId:crypto.randomUUID(),formula:'1d6'})})).rejects.toMatchObject({code:'LOCAL_COPY_READ_ONLY',status:403});
 expect(fetch).not.toHaveBeenCalled();
});
it("omits missing media instead of fetching the origin",async()=>{
 const {fetch}=setup(false);const snapshot=await api<any>('/api/bootstrap');expect(snapshot.assets).toEqual([]);expect(fetch).not.toHaveBeenCalled();
});
it("rejects socket mutations without pretending they were queued or confirmed",async()=>{
 const {fetch}=setup(false),socket=createGameSocket(),ack=vi.fn();
 await new Promise(resolve=>setTimeout(resolve,30));socket.emit('token:moved',{tokenId:crypto.randomUUID(),actionId:crypto.randomUUID(),revision:0,x:1,y:2,z:0,levelId:null},ack);
 expect(ack).toHaveBeenCalledWith({ok:false,status:'INVALID',reason:'LOCAL_COPY_READ_ONLY'});expect(socket.connected).toBe(true);expect(fetch).not.toHaveBeenCalled();socket.disconnect();
});


it("keeps read markers local, monotonic, thread-scoped and bounded by cached messages",async()=>{
 const {snapshot,fetch,threadId}=setup(false,true);
 const mark=(id:string,sequence:number)=>api<any>('/api/chat/read',{method:'POST',body:JSON.stringify({threadId:id,sequence})});
 expect(await mark(threadId,99)).toMatchObject({threadId,lastReadSequence:7});expect(await mark(threadId,2)).toMatchObject({lastReadSequence:7});
 const fresh=await api<any>('/api/bootstrap');expect(fresh.chatThreadStates[0]).toMatchObject({lastReadSequence:7,unreadCount:0});
 expect(snapshot.chatThreadStates[0]?.lastReadSequence).toBe(1); // Saved input remains unchanged.
 await expect(mark(crypto.randomUUID(),99)).rejects.toMatchObject({code:'LOCAL_COPY_THREAD_FORBIDDEN',status:403});expect(fetch).not.toHaveBeenCalled();
});

it('reports absent history/catalogue explicitly without fabricating empty data or fetching a host',async()=>{
 const {fetch}=setup(false);
 await expect(api('/api/soundpad')).rejects.toMatchObject({status:404,code:'LOCAL_COPY_DATA_NOT_SAVED'});
 await expect(api('/api/canvas/history?sceneId='+crypto.randomUUID())).rejects.toMatchObject({status:404,code:'LOCAL_COPY_DATA_NOT_SAVED'});
 expect(await api('/api/operator/feedback/capability')).toEqual({allowed:false,bugIntakeEnabled:false});
 expect(fetch).not.toHaveBeenCalled();
});

it('returns a genuinely saved soundpad catalogue without contacting a host',async()=>{
 const {snapshot,fetch}=setup(false);runtime?.dispose();snapshot.campaign.id=crypto.randomUUID();
 const scope={authority:{campaignId:snapshot.campaign.id,hostId:crypto.randomUUID(),sessionId:crypto.randomUUID(),epoch:1},membershipId:snapshot.me.id,deviceId:crypto.randomUUID()};
 const soundpad={packs:[{id:crypto.randomUUID(),campaignId:snapshot.campaign.id,name:'Actual saved catalogue',published:true,audience:'ALL_MEMBERS' as const,sortOrder:0,sounds:[]}],playerPlaybackEnabled:false};
 runtime=installPlayerCopyRuntime(scope,{snapshot,media:new Map(),reads:{soundpad,history:[]}});
 expect(await api('/api/soundpad')).toEqual(soundpad);expect(fetch).not.toHaveBeenCalled();
});

it('distinguishes unsaved read pages from forbidden editing without an origin request',async()=>{
 const {fetch}=setup(false);
 await expect(api('/api/characters/'+crypto.randomUUID()+'/media')).rejects.toMatchObject({status:404,code:'LOCAL_COPY_DATA_NOT_SAVED'});
 await expect(api('/api/characters/'+crypto.randomUUID(),{method:'PATCH',body:'{}'})).rejects.toMatchObject({status:403,code:'LOCAL_COPY_READ_ONLY'});
 expect(fetch).not.toHaveBeenCalled();
});
