import {parsePlayerReadArchive} from "./player-read-archive";
import {parsePlayerStoryArchive,storyArchiveMedia,storyPageCacheKey} from "./player-story-cache";
import type {LocalPeerResponse} from "@arken/contracts";
import {ApiError} from "../api";
import type {PlayerCacheScope} from "./player-snapshot-cache";
import type {PlayerCachedBundle} from "./player-cache-media";
import {snapshotMediaManifest} from "./player-cache-media";
import {installLocalPlayerRuntime} from "./player-runtime";
import type {bindLocalPlayerChannel} from "./session-channel";

/** Same renderer and media verification pipeline, but no network-capable client.
 * Never turn an offline intent into an acknowledged or queued game mutation. */
export function installPlayerCopyRuntime(scope:PlayerCacheScope,bundle:PlayerCachedBundle,options?:{onLogout?:()=>Promise<void>}){
  const original=bundle.snapshot;
  const reads=bundle.reads?parsePlayerReadArchive(original,bundle.reads):undefined;
  if(original.me.role!=="PLAYER"||original.me.id!==scope.membershipId||original.campaign.id!==scope.authority.campaignId)throw Error("PLAYER_CACHE_SCOPE_MISMATCH");
  let closed=false;const allowed=snapshotMediaManifest(original),epoch=crypto.randomUUID();
  const story=bundle.story?parsePlayerStoryArchive(bundle.story):undefined;for(const url of storyArchiveMedia(story))allowed.add(url);
  const blobs=new Map([...bundle.media].filter(([url])=>allowed.has(url)));
  const scrub=(value:unknown,field?:string):unknown=>{
    if(typeof value==="string"&&field&&(/url$/i.test(field)||field==="src")&&allowed.has(value)&&!blobs.has(value))return "";
    if(Array.isArray(value))return value.map(item=>scrub(item,field));
    if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,scrub(item,key)]));
    return value;
  };
  const snapshot=scrub(original) as typeof original;
  snapshot.assets=snapshot.assets.filter(asset=>Boolean(asset.url));
  snapshot.messages=snapshot.messages.map(message=>({...message,attachments:message.attachments?.filter(item=>blobs.has(`/api/chat/attachments/${item.contentId}/content`))}));
  const prepared=new Map<string,Promise<{bytes:Uint8Array<ArrayBuffer>;version:string;mimeType:string}>>();
  const hash=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  const client:Awaited<ReturnType<typeof bindLocalPlayerChannel>>={
    authority:scope.authority,membershipId:scope.membershipId,
    async request(command){
      if(closed)throw Error("PEER_CLOSED");
      if(command.kind==="SNAPSHOT")return {authority:scope.authority,snapshot};
      if(command.kind==="ASSET_CHUNK"||command.kind==="CHAT_ATTACHMENT_CHUNK"||command.kind==="STORY_MEDIA_CHUNK"){
        const wanted=command.kind==="ASSET_CHUNK"?`/api/assets/${command.assetId}/content`:command.kind==="STORY_MEDIA_CHUNK"?`/api/story/media/${command.contentId}`:`/api/chat/attachments/${command.contentId}/content`;
        const url=[...blobs.keys()].find(url=>{const parsed=new URL(url,"https://copy.invalid");return parsed.pathname===wanted&&(parsed.searchParams.get("variant")??undefined)===(command.kind==="ASSET_CHUNK"?command.variant:undefined);});
        if(!url)throw new ApiError(404,"LOCAL_MEDIA_NOT_SAVED","Этот файл отсутствует в сохранённой копии.");
        if(!prepared.has(url))prepared.set(url,(async()=>{const blob=blobs.get(url)!,bytes=new Uint8Array(await blob.arrayBuffer());return {bytes,version:await hash(bytes),mimeType:blob.type};})());
        const media=await prepared.get(url)!;
        if(command.version&&command.version!==media.version)throw Error("PEER_MEDIA_SCOPE_CHANGED");
        const part=media.bytes.slice(command.offset,command.offset+131072);let binary="";
        for(let i=0;i<part.length;i+=32768)binary+=String.fromCharCode(...part.subarray(i,i+32768));
        return {authority:scope.authority,snapshot,assetChunk:{assetId:command.kind==="ASSET_CHUNK"?command.assetId:command.contentId,...(command.kind==="ASSET_CHUNK"&&command.variant?{variant:command.variant}:{}),offset:command.offset,total:media.bytes.length,version:media.version,mimeType:media.mimeType,base64:btoa(binary),sha256:await hash(part)}} satisfies LocalPeerResponse;
      }
      if(command.kind==="SOUNDPAD_READ"&&reads?.soundpad)return {authority:scope.authority,snapshot,soundpad:reads.soundpad};
      if(command.kind==="CANVAS_HISTORY"){const history=reads?.history.find(item=>item.sceneId===command.sceneId);if(history)return {authority:scope.authority,snapshot,canvasHistory:history.entries};}
      if(command.kind==="CANVAS_HISTORY"||command.kind==="SOUNDPAD_READ"){
        throw new ApiError(404,"LOCAL_COPY_DATA_NOT_SAVED",command.kind==="SOUNDPAD_READ"
          ?"Каталог саундпада не сохранён в этой копии. Подключитесь к мастеру для его загрузки."
          :"История отмены действий не сохранена в этой копии. Игровые изменения доступны после подключения к мастеру.");
      }
      if(command.kind==="CHAT_READ"){
        // Personal, ephemeral view metadata only: no host/cloud write, outbox or
        // remote read receipt. Reopening the saved copy restores its saved cursors.
        const {threadId,sequence}=command.payload;
        const thread=snapshot.chatThreads.find(thread=>thread.id===threadId&&thread.campaignId===snapshot.campaign.id);
        if(!thread)throw new ApiError(403,"LOCAL_COPY_THREAD_FORBIDDEN","Переписка отсутствует в сохранённой копии.");
        const messages=snapshot.messages.filter(message=>message.threadId===threadId);
        const latest=messages.reduce((max,message)=>Math.max(max,message.sequence),0);
        const previous=snapshot.chatThreadStates.find(state=>state.threadId===threadId);
        const next=Math.max(previous?.lastReadSequence??0,Math.min(sequence,latest));
        const state={threadId,stream:thread.stream,lastReadSequence:next,latestSequence:latest,unreadCount:messages.filter(message=>message.sequence>next).length};
        snapshot.chatThreadStates=[...snapshot.chatThreadStates.filter(state=>state.threadId!==threadId),state];
        return {authority:scope.authority,snapshot,chatReadCursor:{campaignId:snapshot.campaign.id,threadId,lastReadSequence:next,updatedAt:new Date().toISOString()}};
      }
      if(command.kind==="CHAT_HISTORY"){
        const {threadId,limit,before}=command.payload;
        const allowedThread=snapshot.chatThreads?.some(thread=>thread.id===threadId);
        if(!allowedThread)throw new ApiError(403,"LOCAL_COPY_THREAD_FORBIDDEN","Переписка отсутствует в сохранённой копии.");
        const messages=snapshot.messages.filter(message=>message.threadId===threadId&&(before===undefined||message.sequence<before));
        return {authority:scope.authority,snapshot,chatHistory:{messages:messages.slice(-limit),hasMore:false}};
      }
      if(command.kind==="STORY_PAGE"){
        const page=story?.pages.find(entry=>entry.key===storyPageCacheKey(command.query))?.page;
        if(page){const frozen=structuredClone(page);for(const post of frozen.posts)post.media=post.media.filter(item=>blobs.has(`/api/story/media/${item.contentId}`));return {authority:scope.authority,snapshot,storyPage:frozen};}
        throw new ApiError(404,"LOCAL_COPY_DATA_NOT_SAVED","Эта страница сюжетного архива не сохранена в копии.");
      }
      throw new ApiError(403,"LOCAL_COPY_READ_ONLY","Сохранённая копия доступна только для просмотра. Подключитесь к мастеру для игровых действий.");
    },
    async sendPreview(){return {authority:scope.authority,membershipId:scope.membershipId,accepted:false};},
    async pollPreviews(){return {authority:scope.authority,membershipId:scope.membershipId,epoch,cursor:0,reset:false,events:[]};},
    close(){closed=true;prepared.clear();blobs.clear();},
  };
  const read=client.request;client.request=async command=>({...await read(command),storyFingerprint:story?.fingerprint});
  return installLocalPlayerRuntime(client,snapshot,{readOnly:true,onLogout:options?.onLogout});
}
