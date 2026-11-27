import {readCanvasHistory} from "./canvas-routes.js";
import {readSoundpadCatalogue} from "./soundpad-routes.js";
import {readLocalMediaRevision} from './local-media-revision.js';
import {readPlayerStoryFingerprint} from "./story-media-content.js";
import {localCharacterCommand} from "./local-character-command.js";
import {localUploadCommand} from "./local-upload-command.js";
import {reconcileChatUploadFile,finishChatUploadFileLease} from "./chat-upload-reconcile.js";
import {applyAbilityArea} from "./ability-area-apply.js";
import {cancelAbilityArea} from "./ability-area-state.js";
import {undoApplication} from "./undo-application.js";
import {localAbilityCommand,LocalAbilityRejection,localAbilityTransactionFailure} from "./local-ability-command.js";
import {updateCharacterCounters} from "./character-counters-command.js";
import {executeCharacterEntry} from "./entry-roll-command.js";
import {rechargeCharacterEntry} from "./entry-recharge-command.js";
import {receiveLocalChatUpload} from "./local-chat-upload.js";
import {openDirectChat,submitDirectChat} from "./direct-chat-command.js";
import {readChatHistory,markChatRead} from "./chat-read-command.js";
import { createHash } from "node:crypto";
import { and,eq,sql } from "drizzle-orm";
import { campaigns,gameEvents } from "@arken/db";
import { localPeerRequestSchema,type LocalPeerAck,type LocalPeerResponse } from "@arken/contracts";
import { commitTokenMove,editableToken } from "./realtime.js";
import { withLocalPeer } from "./local-session-authority.js";
import { buildSnapshot } from "./snapshot.js";
import { readLocalAssetChunk,readLocalChatAttachmentChunk,readLocalStoryMediaChunk } from "./local-session-media.js";
import {submitDiceRoll} from "./dice-command.js";
import {submitStreamChat} from "./stream-chat-command.js";
import { readStoryPage } from "./story.js";

type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Trusted host entrypoint. Never accept a peer-supplied AuthContext or snapshot. */
export async function executeLocalPeerRequest(db:Database,input:unknown):Promise<LocalPeerResponse>{
  const request=localPeerRequestSchema.parse(input);
  const newFiles:string[]=[];
  try{const response = await withLocalPeer(db,request.peer,async(tx,auth,authority)=>{
    // The transaction uses the exact query API consumed by legacy projections.
    // No independent connection may be used here: revoke and mutation share a fence.
    const projectionDb=tx as unknown as Database;
    let ack:LocalPeerAck|undefined;
    if(request.command.kind==="TOKEN_MOVE"){
      const command=request.command.payload;
      const hash=createHash("sha256").update(JSON.stringify({kind:"TOKEN_MOVE",...command})).digest("hex");
      const receipts=await tx.execute<{membership_id:string;device_id:string;request_hash:string;sequence:string|number}>(sql`
        SELECT membership_id,device_id,request_hash,sequence FROM local_command_receipts
        WHERE campaign_id=${auth.campaignId} AND action_id=${command.actionId}`);
      const receipt=receipts[0];
      if(receipt){
        ack=receipt.membership_id===auth.membershipId&&receipt.device_id===request.peer.deviceId&&receipt.request_hash===hash
          ?{ok:true,status:"DUPLICATE",sequence:Number(receipt.sequence)}:{ok:false,reason:"ACTION_CONFLICT"};
      }else{
        const [event]=await tx.select().from(gameEvents).where(and(eq(gameEvents.campaignId,auth.campaignId),eq(gameEvents.actionId,command.actionId))).limit(1);
        if(event){
          // The same action can arrive via the old route after an uncertain send.
          const p=event.payload as Record<string,unknown>;
          const same=event.membershipId===auth.membershipId&&event.type==="TOKEN_MOVED"&&event.entityId===command.tokenId
            &&event.entityRevision===command.revision+1&&p.x===command.x&&p.y===command.y&&p.z===command.z&&(p.levelId??null)===command.levelId;
          ack=same?{ok:true,status:"DUPLICATE",sequence:event.sequence}:{ok:false,reason:"ACTION_CONFLICT"};
        }else{
          const [campaign]=await tx.select({paused:campaigns.paused}).from(campaigns).where(eq(campaigns.id,auth.campaignId));
          const current=await editableToken(tx,auth,command.tokenId);
          if(campaign?.paused)ack={ok:false,reason:"CAMPAIGN_PAUSED"};
          else if(!current)ack={ok:false,reason:"TOKEN_FORBIDDEN"};
          else if(current.revision!==command.revision)ack={ok:false,reason:"STALE_REVISION"};
          else{
            const result=await commitTokenMove(tx,auth,current,command);
            ack=result&&"movementBlocked"in result?{ok:false,reason:"MOVEMENT_FORBIDDEN"}
              :result?{ok:true,status:"APPLIED",sequence:result.event.sequence}:{ok:false,reason:"STALE_REVISION"};
          }
        }
        if(ack.ok)await tx.execute(sql`INSERT INTO local_command_receipts(campaign_id,action_id,membership_id,device_id,request_hash,sequence)
          VALUES(${auth.campaignId},${command.actionId},${auth.membershipId},${request.peer.deviceId},${hash},${ack.sequence})`);
      }
    }
    const command=request.command;
    const uploadCommand=request.command.kind==="CHAT_UPLOAD_CHUNK"?request.command:undefined;
    const upload=uploadCommand?await localUploadCommand(()=>receiveLocalChatUpload(projectionDb,auth,request.peer,uploadCommand,key=>newFiles.push(key))):undefined;
    const recharged=command.kind==="ENTRY_RECHARGE"?await localCharacterCommand(()=>rechargeCharacterEntry(projectionDb,auth,command.characterId,command.entryId,command.payload)):undefined;
    const entryRecharge=recharged?(recharged.duplicate?{duplicate:true}:JSON.parse(JSON.stringify(recharged.updated)) as Record<string,unknown>):undefined;
    const rolled=command.kind==="ENTRY_ROLL"?await localCharacterCommand(()=>executeCharacterEntry(projectionDb,auth,command.characterId,command.entryId,command.payload)):undefined;
    const entryRoll=rolled?(rolled.duplicate?{duplicate:true}:rolled.value):undefined;
    const counters=command.kind==="CHARACTER_COUNTERS"?await localCharacterCommand(()=>updateCharacterCounters(projectionDb,auth,command.characterId,command.payload)):undefined;
    if(counters)ack={ok:true,status:counters.duplicate?"DUPLICATE":"APPLIED",sequence:counters.sequence};
    const areaResult=command.kind==="AREA_APPLY"?await localAbilityCommand(command.kind,()=>applyAbilityArea(projectionDb,auth,command.payload)):command.kind==="AREA_CANCEL"?await localAbilityCommand(command.kind,()=>cancelAbilityArea(projectionDb,auth,command.payload)):undefined;
    const undone=command.kind==="APPLICATION_UNDO"?await localAbilityCommand(command.kind,()=>undoApplication(projectionDb,auth,command.payload)):undefined;
    const applicationUndo=undone?(undone.duplicate?{duplicate:true as const}:{ok:true as const}):undefined;
    const chat=request.command.kind==="CHAT_SEND"?await submitStreamChat(projectionDb,auth,request.command.payload):request.command.kind==="DICE_ROLL"?await submitDiceRoll(projectionDb,auth,request.command.payload):undefined;
    const direct=request.command.kind==="DIRECT_SEND"?await submitDirectChat(projectionDb,auth,request.command.payload):undefined;
    const opened=request.command.kind==="DIRECT_OPEN"?await openDirectChat(projectionDb,auth,request.command.payload):undefined;
    const chatHistory=request.command.kind==="CHAT_HISTORY"?await readChatHistory(projectionDb,auth,request.command.payload):undefined;
    const chatReadCursor=request.command.kind==="CHAT_READ"?await markChatRead(projectionDb,auth,request.command.payload):undefined;
    const chatResult=direct?direct.dto:chat?(chat.duplicate?{duplicate:true as const}:chat.dto):undefined;
    // Current role-filtered projection, never an old saved ACK's payload.
    const snapshot=await buildSnapshot(projectionDb,auth);
    const storyFingerprint=await readPlayerStoryFingerprint(projectionDb,auth);
    const storyPage=request.command.kind==="STORY_PAGE"?await readStoryPage(projectionDb,auth,request.command.query):undefined;
    const assetChunk=request.command.kind==="ASSET_CHUNK"?await readLocalAssetChunk(projectionDb,auth,request.command,snapshot):request.command.kind==="CHAT_ATTACHMENT_CHUNK"?await readLocalChatAttachmentChunk(projectionDb,auth,request.command):request.command.kind==="STORY_MEDIA_CHUNK"?await readLocalStoryMediaChunk(projectionDb,auth,request.command):undefined;
    const soundpad=(request.command.kind==="SOUNDPAD_READ"||request.command.kind==="SNAPSHOT")?await readSoundpadCatalogue(projectionDb,auth):undefined;
    const canvasHistory=request.command.kind==="CANVAS_HISTORY"?await readCanvasHistory(projectionDb,auth,{sceneId:request.command.sceneId}):undefined;
    const mediaRevision=await readLocalMediaRevision(projectionDb,auth.campaignId);
    return {authority,mediaRevision,storyFingerprint,...(soundpad?{soundpad}:{}),...(canvasHistory?{canvasHistory}:{}),...(areaResult?{areaResult}:{}),...(applicationUndo?{applicationUndo}:{}),...(counters?{characterCounters:counters.value}:{}),...(entryRoll?{entryRoll}:{}),...(entryRecharge?{entryRecharge}:{}),...(upload?{upload}:{}),...(opened?{directThread:opened.dto}:{}),...(chatHistory?{chatHistory}:{}),...(chatReadCursor?{chatReadCursor}:{}),...(chatResult?{chatResult}:{}),...(assetChunk?{assetChunk}:{}),...(ack?{ack}:{}),snapshot,...(storyPage?{storyPage}:{})};
  },request.command.kind==="AREA_APPLY"||request.command.kind==="APPLICATION_UNDO"?{isolationLevel:"serializable"}:undefined);
    for(const key of newFiles) await finishChatUploadFileLease(key);
    return response;
  }catch(error){
    // COMMIT may have succeeded before the connection failed. Reconcile only
    // after acquiring the same fence and proving no durable reference exists.
    for(const key of newFiles)await reconcileChatUploadFile(db,request.peer.campaignId,key);
    const kind=request.command.kind;
    const rejected=error instanceof LocalAbilityRejection?error:(kind==="AREA_APPLY"||kind==="AREA_CANCEL"||kind==="APPLICATION_UNDO")?localAbilityTransactionFailure(kind,error):undefined;
    if(rejected){
      // The mutating transaction has rolled back. Reauthenticate after rollback:
      // a concurrent revoke must prevent even a role-filtered error projection.
      return withLocalPeer(db,request.peer,async(tx,auth,authority)=>({authority,snapshot:await buildSnapshot(tx as unknown as Database,auth),commandError:rejected.failure}));
    }
    throw error;
  }
}
