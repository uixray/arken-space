import {createPlayerReadArchive,type PlayerReadArchive} from "./player-read-archive";
import {compareSnapshotSequence} from "@arken/contracts";
import {createPlayerStoryArchive,type PlayerStoryArchive} from "./player-story-cache";
import {installStoryMediaUrls} from "../story-media-url";
import {peerCommandErrorMessage} from "./peer-command-error";
import {uploadPeerAttachment} from "./peer-attachment-upload";
import {abilityAreaApplySchema,undoApplicationCommandSchema,localCommandErrorSchema,characterCountersCommandSchema,entryRollRequestSchema,rechargeEntryCommandSchema,moveTokenSchema,createOrGetDirectChatThreadSchema,createDirectChatMessageSchema,localChatHistorySchema,markChatThreadReadSchema,createChatMessageSchema,diceRequestSchema,tokenMovingSchema,type GameSnapshot,type LocalPreviewEvent,type ClientToServerEvents,type localPeerRequestSchema} from "@arken/contracts";
import {z} from "zod";
import {ApiError,installApiTransport} from "../api";
import {installGameSocketFactory,type GameSocket} from "../realtime";
import {createPeerMediaProjection} from "./peer-media-projection";
import type {bindLocalPlayerChannel} from "./session-channel";

type Client=Awaited<ReturnType<typeof bindLocalPlayerChannel>>;
type Command=z.infer<typeof localPeerRequestSchema>["command"];
type Listener=(...args:unknown[])=>void;

/** Reuse the complete App + renderers; never send peer-mode commands to cloud. */
export function installLocalPlayerRuntime(client:Client,initial:GameSnapshot,options?:{onLogout?:()=>Promise<void>;readOnly?:boolean;onSnapshot?:(snapshot:GameSnapshot,media:ReadonlyMap<string,Blob>,story?:PlayerStoryArchive,reads?:PlayerReadArchive)=>void|Promise<void>}){
  const media=createPeerMediaProjection(command=>client.request(command));
  const readArchive=createPlayerReadArchive();
  const storyArchive=createPlayerStoryArchive();let storyFingerprint:string|null|undefined;let storyObserved=false;
  let disposed=false,queued=0,inFlight=false,latest=initial,tail=Promise.resolve(),previewCursor=0;
  let pendingPreview:z.infer<typeof tokenMovingSchema>|null=null,pendingPreviewAt=0;
  const previewHints=new Map<string,{at:number;event:LocalPreviewEvent}>();
  let previewEpoch:string|undefined;
  const sockets=new Set<GameSocket>(),listeners=new Map<GameSocket,Map<string,Set<Listener>>>();
  const fire=(socket:GameSocket,event:string,...args:unknown[])=>{for(const fn of listeners.get(socket)?.get(event)??[])fn(...args);};
  const publish=(snapshot:GameSnapshot)=>{
    if(snapshot.campaign.id!==initial.campaign.id||snapshot.me.id!==initial.me.id)throw Error("PEER_SCOPE_CHANGED");
    if(compareSnapshotSequence(snapshot,latest)<0)return;
    latest=snapshot;
    for(const [id,hint]of previewHints){
      const identity=hint.event.kind==="MOVING"?hint.event.movement:hint.event.event;
      const token=snapshot.tokens.find(token=>token.id===id);
      if(Date.now()-hint.at>750||!token||token.revision!==identity.revision||token.sceneId!==identity.sceneId||identity.previewEpoch!==previewEpoch)previewHints.delete(id);
    }
    for(const socket of sockets)if(socket.connected){
      fire(socket,"game:snapshot",snapshot);
      // Periodic canonical reads must not snap a currently dragged token back.
      for(const {event}of previewHints.values())if(event.kind==="MOVING")fire(socket,"token:moving",event.movement);else fire(socket,"token:preview-hidden",event.event);
    }
  };
  const request=(command:Command)=>{
    if(disposed)return Promise.reject(Error("PEER_CLOSED"));
    if(queued>=16)return Promise.reject(Error("Слишком много ожидающих действий. Дождитесь подтверждения."));
    queued++;
    const result=tail.then(async()=>{inFlight=true;try{if(disposed)throw Error("PEER_CLOSED");const raw=await client.request(command);if(disposed)throw Error("PEER_CLOSED");
      if(raw.snapshot.campaign.id!==initial.campaign.id||raw.snapshot.me.id!==initial.me.id)throw Error("PEER_SCOPE_CHANGED");
      const failure=raw.commandError?localCommandErrorSchema.parse(raw.commandError):undefined;
      const storyChanged=storyObserved&&storyFingerprint!==raw.storyFingerprint;
      storyObserved=true;storyFingerprint=raw.storyFingerprint;
      storyArchive.reconcile(raw.storyFingerprint);
      if(command.kind==="STORY_PAGE"&&raw.storyPage)storyArchive.capture(command.query,raw.storyPage);
      const savedReads=options?.onSnapshot?readArchive.observe(raw.snapshot,raw,command.kind==="CANVAS_HISTORY"?command.sceneId:undefined):undefined;
      const response=await media.prepare(raw);if(disposed)throw Error("PEER_CLOSED");publish(response.snapshot);
      if(storyChanged)for(const socket of sockets)if(socket.connected)fire(socket,"story:changed",{campaignId:initial.campaign.id,postId:null});
      // Persist only the original, authenticated projection, never ephemeral Blob URLs.
      if(options?.onSnapshot&&compareSnapshotSequence(raw.snapshot,latest)>=0){
        const savedStory=storyArchive.snapshot(),savedMedia=media.snapshotMedia(raw.snapshot,savedStory);
        void Promise.resolve().then(()=>{if(!disposed)return options.onSnapshot?.(raw.snapshot,savedMedia,savedStory,savedReads);}).catch(()=>undefined);
      }
      if(failure)throw new ApiError(failure.status,failure.code,peerCommandErrorMessage(failure.code),undefined,undefined,{error:failure.code,...(failure.notApplied?{notApplied:true}:{})});
      return response;}finally{inFlight=false;queued--;}});
    tail=result.then(()=>undefined,()=>undefined);return result;
  };
  const pollPreviews=()=>{
    if(disposed||inFlight||queued)return Promise.resolve();queued++;
    const result=tail.then(async()=>{inFlight=true;try{
      if(disposed)return;const batch=await client.pollPreviews(previewCursor);if(disposed)return;previewCursor=batch.cursor;
      const epochChanged=previewEpoch!==undefined&&previewEpoch!==batch.epoch;
      if(batch.reset||epochChanged)previewHints.clear();previewEpoch=batch.epoch;
      if(!batch.reset)for(const event of batch.events){const id=event.kind==="MOVING"?event.movement.tokenId:event.event.tokenId;previewHints.set(id,{at:Date.now(),event});}

      for(const socket of sockets)if(socket.connected){
        socket.previewEpoch=batch.epoch;fire(socket,"token:preview-epoch",batch.epoch);
        if(!batch.reset)for(const event of batch.events)if(event.kind==="MOVING")fire(socket,"token:moving",event.movement);else fire(socket,"token:preview-hidden",event.event);
      }
      if(batch.reset||epochChanged)void request({kind:"SNAPSHOT"}).catch(()=>undefined);
    }finally{inFlight=false;queued--;}});
    tail=result.then(()=>undefined,()=>undefined);return result;
  };
  const flushPreview=()=>{
    if(pendingPreview&&Date.now()-pendingPreviewAt>250)pendingPreview=null;
    if(disposed||inFlight||queued||!pendingPreview)return Promise.resolve();
    const movement=pendingPreview;pendingPreview=null;queued++;
    const result=tail.then(async()=>{inFlight=true;try{
      if(disposed)return;const response=await client.sendPreview(movement);if(disposed)return;
      if(!response.accepted)void request({kind:"SNAPSHOT"}).catch(()=>undefined);
    }finally{inFlight=false;queued--;}});
    tail=result.then(()=>undefined,()=>undefined);return result;
  };
  const makeSocket=():GameSocket=>{
    const handlers=new Map<string,Set<Listener>>(),warned=new Set<string>();let timer:ReturnType<typeof setInterval>|null=null,previewTimer:ReturnType<typeof setInterval>|null=null;
    const fail=()=>{if(previewTimer)clearInterval(previewTimer);previewTimer=null;if(timer)clearInterval(timer);timer=null;socket.active=false;if(socket.connected){socket.connected=false;fire(socket,"disconnect","peer unavailable");}fire(socket,"connect_error",Error("Прямой канал недоступен. Нужен новый код подключения мастера."));};
    const sync=()=>request({kind:"SNAPSHOT"}).then(()=>{
      if(!socket.active)return;
      if(!socket.connected){socket.connected=true;fire(socket,"connect");fire(socket,"game:snapshot",latest);}
    }).catch(()=>fail());
    const socket:GameSocket={
      id:`peer:${client.authority.sessionId}:${client.membershipId}`,connected:false,active:false,recovered:false,
      on(event,listener){let group=handlers.get(event);if(!group)handlers.set(event,group=new Set());group.add(listener as Listener);return socket;},
      off(event,listener){if(listener)handlers.get(event)?.delete(listener as Listener);else handlers.delete(event);return socket;},
      emit(event,...args){
        if(event==="game:resync"){void sync();return socket;}
        // PLAYER always follows the host active scene, just like hosted Socket.IO.
        if(event==="scene:view")return socket;
        // No cursor presence has been published by this transport, so its
        // automatic blur/unmount cleanup has no remote state to remove.
        if(event==="cursor:gone")return socket;
        if(options?.readOnly){
          const ack=args.at(-1);if(typeof ack==="function")ack({ok:false,status:"INVALID",reason:"LOCAL_COPY_READ_ONLY"});
          if(!warned.has(event)){warned.add(event);fire(socket,"server:error",{code:"LOCAL_COPY_READ_ONLY",message:"Сохранённая копия доступна только для просмотра. Подключитесь к мастеру для игровых действий."});}
          return socket;
        }
        if(event==="token:moving"){
          const parsed=tokenMovingSchema.safeParse(args[0]);if(parsed.success){pendingPreview=parsed.data;pendingPreviewAt=Date.now();}
          return socket;
        }
        if(event==="token:moved"){
          const ack=args[1] as Parameters<ClientToServerEvents["token:moved"]>[1];
          try{
            const payload=moveTokenSchema.parse(args[0]);
            if(pendingPreview?.tokenId===payload.tokenId)pendingPreview=null;
            void request({kind:"TOKEN_MOVE",payload}).then(response=>{
              if(typeof ack!=="function")return;
              const result=response.ack;
              ack(result?.ok?{ok:true,status:result.status==="APPLIED"?"ACCEPTED":"DUPLICATE",sequence:result.sequence,data:response.snapshot.tokens.find(t=>t.id===payload.tokenId)}
                :{ok:false,status:"CONFLICT",reason:result&&!result.ok?result.reason:"RESULT_UNCERTAIN"});
            }).catch(()=>{if(typeof ack==="function")ack({ok:false,status:"CONFLICT",reason:"RESULT_UNCERTAIN"});fail();});
          }catch{if(typeof ack==="function")ack({ok:false,status:"INVALID",reason:"INVALID_COMMAND"});}
          return socket;
        }
        // Optional lossy previews are not faked as durable commits.
        if(!warned.has(event)){
          warned.add(event);fire(socket,"server:error",{code:"PEER_ACTION_PENDING",message:"Это действие ещё не поддерживается прямым каналом. Основной стол и подтверждённые ходы доступны."});
        }
        const ack=args.at(-1);if(typeof ack==="function")ack({ok:false,status:"INVALID",reason:"PEER_ACTION_PENDING"});
        return socket;
      },
      connect(){
        if(socket.active)return socket;socket.active=true;sockets.add(socket);listeners.set(socket,handlers);
        void sync();timer=setInterval(()=>{if(!inFlight&&!queued&&socket.active)void sync();},1000);previewTimer=setInterval(()=>{if(socket.active)void flushPreview().then(pollPreviews).catch(fail);},120);return socket;
      },
      disconnect(){if(previewTimer)clearInterval(previewTimer);previewTimer=null;if(timer)clearInterval(timer);timer=null;socket.active=false;socket.connected=false;fire(socket,"disconnect","io client disconnect");sockets.delete(socket);listeners.delete(socket);if(!sockets.size)pendingPreview=null;return socket;},
      io:{on:()=>undefined},volatile:{emit:(...args)=>socket.emit(...args)},
    };
    sockets.add(socket);listeners.set(socket,handlers);
    // Same asynchronous delivery contract as Socket.IO: subscriptions register first.
    queueMicrotask(()=>{if(!disposed&&sockets.has(socket))socket.connect();});
    return socket;
  };
  const releaseApi=installApiTransport(async(path,init)=>{
    const method=(init?.method??"GET").toUpperCase(),url=new URL(path,"https://peer.invalid");
    if(url.origin!=="https://peer.invalid")throw new ApiError(403,"PEER_ORIGIN_FORBIDDEN","Недопустимый адрес игрового запроса");
    if(method==="GET"&&url.pathname==="/api/operator/feedback/capability")return {allowed:false,bugIntakeEnabled:false};
    if(method==="GET"&&url.pathname==="/api/soundpad")return (await request({kind:"SOUNDPAD_READ"})).soundpad;
    if(method==="GET"&&url.pathname==="/api/canvas/history")return (await request({kind:"CANVAS_HISTORY",sceneId:z.string().uuid().parse(url.searchParams.get("sceneId"))})).canvasHistory;
    if(method==="GET"&&url.pathname==="/api/bootstrap")return (await request({kind:"SNAPSHOT"})).snapshot;
    if(method==="POST"&&(url.pathname==="/api/abilities/area/apply"||url.pathname==="/api/abilities/area/cancel")){
      const headers=new Headers(init?.headers),campaign=headers.get("x-entry-campaign"),member=headers.get("x-entry-member"),cancel=url.pathname.endsWith("/cancel");
      if((cancel&&(campaign!==initial.campaign.id||member!==initial.me.id))||(!cancel&&((campaign!==null&&campaign!==initial.campaign.id)||(member!==null&&member!==initial.me.id))))throw new ApiError(409,"ENTRY_CONTEXT_CHANGED","Контекст персонажа изменился");
      return (await request({kind:cancel?"AREA_CANCEL":"AREA_APPLY",payload:abilityAreaApplySchema.parse(JSON.parse(String(init?.body??"null")))})).areaResult;
    }
    if(method==="POST"&&url.pathname==="/api/chat/application-undo")return (await request({kind:"APPLICATION_UNDO",payload:undoApplicationCommandSchema.parse(JSON.parse(String(init?.body??"null")))})).applicationUndo;
    const counters=/^\/api\/characters\/([0-9a-f-]{36})\/counters$/.exec(url.pathname);
    if(method==="PATCH"&&counters)return (await request({kind:"CHARACTER_COUNTERS",characterId:counters[1]!,payload:characterCountersCommandSchema.parse(JSON.parse(String(init?.body??"null")))})).characterCounters;
    const entryRoll=/^\/api\/characters\/([0-9a-f-]{36})\/catalog\/([0-9a-f-]{36})\/roll$/.exec(url.pathname);
    if(method==="POST"&&entryRoll)return (await request({kind:"ENTRY_ROLL",characterId:entryRoll[1]!,entryId:entryRoll[2]!,payload:entryRollRequestSchema.parse(JSON.parse(String(init?.body??"null")))})).entryRoll;
    const recharge=/^\/api\/characters\/([0-9a-f-]{36})\/catalog\/([0-9a-f-]{36})\/recharge$/.exec(url.pathname);
    if(method==="POST"&&recharge)return (await request({kind:"ENTRY_RECHARGE",characterId:recharge[1]!,entryId:recharge[2]!,payload:rechargeEntryCommandSchema.strict().parse(JSON.parse(String(init?.body??"null")))})).entryRecharge;
    if(method==="POST"&&url.pathname==="/api/chat/attachments"){
      if(!(init?.body instanceof FormData))throw new ApiError(400,"UPLOAD_REQUIRED","Выберите изображение");
      const files=init.body.getAll("file");
      if(files.length!==1||!(files[0] instanceof File))throw new ApiError(400,"UPLOAD_REQUIRED","Выберите одно изображение");
      return uploadPeerAttachment(files[0],request,()=>disposed);
    }
    if(method==="POST"&&url.pathname==="/api/chat/direct")return (await request({kind:"DIRECT_OPEN",payload:createOrGetDirectChatThreadSchema.parse(JSON.parse(String(init?.body??"null")))})).directThread;
    if(method==="POST"&&url.pathname==="/api/chat/direct/messages")return (await request({kind:"DIRECT_SEND",payload:createDirectChatMessageSchema.parse(JSON.parse(String(init?.body??"null")))})).chatResult;
    if(method==="POST"&&url.pathname==="/api/chat/read")return (await request({kind:"CHAT_READ",payload:markChatThreadReadSchema.parse(JSON.parse(String(init?.body??"null")))})).chatReadCursor;
    const history=/^\/api\/chat\/threads\/([0-9a-f-]{36})\/messages$/.exec(url.pathname);
    if(method==="GET"&&history)return (await request({kind:"CHAT_HISTORY",payload:localChatHistorySchema.parse({...Object.fromEntries(url.searchParams),threadId:history[1]})})).chatHistory;
    if(method==="POST"&&url.pathname==="/api/dice")return (await request({kind:"DICE_ROLL",payload:diceRequestSchema.parse(JSON.parse(String(init?.body??"null")))})).chatResult;
    if(method==="POST"&&url.pathname==="/api/chat")return (await request({kind:"CHAT_SEND",payload:createChatMessageSchema.parse(JSON.parse(String(init?.body??"null")))})).chatResult;
    if(method==="GET"&&url.pathname==="/api/story/posts")return (await request({kind:"STORY_PAGE",query:Object.fromEntries(url.searchParams)})).storyPage;
    if(method==="POST"&&url.pathname==="/api/auth/logout"){try{await options?.onLogout?.();}finally{media.dispose();client.close();}return {ok:true};}
    if(options?.readOnly)throw new ApiError(method==="GET"?404:403,method==="GET"?"LOCAL_COPY_DATA_NOT_SAVED":"LOCAL_COPY_READ_ONLY",method==="GET"?"Эти данные не сохранены в локальной копии. Подключитесь к мастеру для загрузки.":"Сохранённая копия доступна только для просмотра.");
    throw new ApiError(501,"PEER_ACTION_PENDING","Этот раздел ещё не подключён к прямому каналу. Запрос в облако не отправлен.");
  });
  const releaseStoryMedia=installStoryMediaUrls(id=>media.storyMediaUrl(id));
  let releaseSocket:()=>void;
  try{releaseSocket=installGameSocketFactory(makeSocket);}catch(error){releaseStoryMedia();releaseApi();media.dispose();throw error;}
  return {dispose(){if(disposed)return;disposed=true;pendingPreview=null;previewHints.clear();media.dispose();for(const socket of [...sockets])socket.disconnect();client.close();releaseStoryMedia();releaseSocket();releaseApi();}};
}
