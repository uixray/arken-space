import { z } from "zod";
import { localAuthoritySchema,localPeerBindingSchema,localPeerRequestSchema,localPreviewPollSchema,localPreviewSubmitSchema,tokenMovingSchema,type LocalPreviewBatch,type LocalPreviewAccepted,type LocalPeerResponse,type LocalPeerBinding } from "@arken/contracts";
import { api } from "../api";
import { bindDataChannelRpc } from "./data-channel-rpc";
import {createPacedRpc} from "./paced-rpc";
import { sameAuthority } from "./route-policy";

export const localPairingCodeSchema=z.object({version:z.literal(1),authority:localAuthoritySchema,deviceId:z.string().uuid(),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
const pairRequestSchema=z.object({kind:z.literal("PAIR"),campaignId:z.string().uuid(),deviceId:z.string().uuid(),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
const pairReplySchema=z.object({authority:localAuthoritySchema,membershipId:z.string().uuid(),deviceId:z.string().uuid(),credential:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresInSeconds:z.number().int().min(1).max(43200)});

const previewBatchSchema=z.object({authority:localAuthoritySchema,membershipId:z.string().uuid(),epoch:z.string().uuid(),cursor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),reset:z.boolean(),events:z.array(z.discriminatedUnion("kind",[
  z.object({kind:z.literal("MOVING"),movement:tokenMovingSchema}).strict(),
  z.object({kind:z.literal("HIDDEN"),event:z.object({tokenId:z.string().uuid(),sceneId:z.string().uuid(),revision:z.number().int().nonnegative(),previewEpoch:z.string().uuid(),snapshotVersion:z.number().int().nonnegative().optional()}).strict()}).strict(),
])).max(32)}).strict();

/** Host browser is only a bridge to the loopback authority, never a game arbiter. */
export function bindLocalHostChannel(channel:RTCDataChannel,code:unknown,onClose?:()=>void){
  const pairing=localPairingCodeSchema.parse(code);
  return bindDataChannelRpc(channel,{role:"HOST",onClose:()=>{pairing.token="";onClose?.();},handle:async(input,signal)=>{
    const pair=pairRequestSchema.safeParse(input);
    if(pair.success){
      if(pair.data.campaignId!==pairing.authority.campaignId||pair.data.deviceId!==pairing.deviceId||pair.data.token!==pairing.token)throw Error("PAIRING_SCOPE_MISMATCH");
      const {kind:_,...body}=pair.data;
      const result=await api("/api/local-session/redeem",{method:"POST",body:JSON.stringify(body),signal});
      pairing.token="";return result;
    }
    const preview=localPreviewPollSchema.safeParse(input);
    if(preview.success){
      const peer=preview.data.peer;
      if(peer.campaignId!==pairing.authority.campaignId||peer.deviceId!==pairing.deviceId||peer.sessionId!==pairing.authority.sessionId||peer.epoch!==pairing.authority.epoch)throw Error("PEER_SCOPE_MISMATCH");
      return api("/api/local-session/previews",{method:"POST",body:JSON.stringify(preview.data),signal});
    }
    const submission=localPreviewSubmitSchema.safeParse(input);
    if(submission.success){
      const peer=submission.data.peer;
      if(peer.campaignId!==pairing.authority.campaignId||peer.deviceId!==pairing.deviceId||peer.sessionId!==pairing.authority.sessionId||peer.epoch!==pairing.authority.epoch)throw Error("PEER_SCOPE_MISMATCH");
      return api("/api/local-session/preview",{method:"POST",body:JSON.stringify(submission.data),signal});
    }
    const request=localPeerRequestSchema.parse(input);
    if(request.peer.campaignId!==pairing.authority.campaignId||request.peer.deviceId!==pairing.deviceId||request.peer.sessionId!==pairing.authority.sessionId||request.peer.epoch!==pairing.authority.epoch)throw Error("PEER_SCOPE_MISMATCH");
    const path=request.command.kind==="CHAT_UPLOAD_CHUNK"?"/api/local-session/upload":request.command.kind==="ASSET_CHUNK"||request.command.kind==="CHAT_ATTACHMENT_CHUNK"||request.command.kind==="STORY_MEDIA_CHUNK"?"/api/local-session/media":"/api/local-session/peer";
    return api(path,{method:"POST",body:JSON.stringify(request),signal});
  }});
}

/** Call only after trusted SDP/fingerprint exchange; DTLS alone is not identity. */
export async function bindLocalPlayerChannel(channel:RTCDataChannel,code:unknown,onClose?:()=>void){
  const pairing=localPairingCodeSchema.parse(code);
  const controller=new AbortController();
  let binding:LocalPeerBinding|null=null,closed=false,expires:ReturnType<typeof setTimeout>|null=null;
  const rpc=bindDataChannelRpc(channel,{role:"CLIENT",onClose:()=>{closed=true;controller.abort();binding=null;pairing.token="";if(expires)clearTimeout(expires);onClose?.();}});
  const send=createPacedRpc(rpc,controller.signal);
  const close=()=>{rpc.close();};
  try{
    const result=pairReplySchema.parse(await send({kind:"PAIR",campaignId:pairing.authority.campaignId,deviceId:pairing.deviceId,token:pairing.token}));
    pairing.token="";if(closed)throw Error("PEER_CLOSED");
    if(!sameAuthority(result.authority,pairing.authority)||result.deviceId!==pairing.deviceId)throw Error("PEER_AUTHORITY_MISMATCH");
    binding=localPeerBindingSchema.parse({campaignId:result.authority.campaignId,deviceId:result.deviceId,sessionId:result.authority.sessionId,epoch:result.authority.epoch,credential:result.credential});
    expires=setTimeout(close,result.expiresInSeconds*1000);
    return {
      authority:pairing.authority,
      membershipId:result.membershipId,
      async sendPreview(movement:z.infer<typeof tokenMovingSchema>):Promise<LocalPreviewAccepted>{
        if(!binding||closed)throw Error("PEER_CLOSED");
        const response=z.object({authority:localAuthoritySchema,membershipId:z.string().uuid(),accepted:z.boolean()}).strict().parse(await send(localPreviewSubmitSchema.parse({kind:"PREVIEW_SEND",peer:binding,movement})));
        if(closed)throw Error("PEER_CLOSED");
        if(!sameAuthority(response.authority,pairing.authority)||response.membershipId!==result.membershipId){close();throw Error("PEER_PREVIEW_SCOPE_MISMATCH");}
        return response;
      },
      async pollPreviews(cursor:number):Promise<LocalPreviewBatch>{
        if(!binding||closed)throw Error("PEER_CLOSED");
        const response=previewBatchSchema.parse(await send(localPreviewPollSchema.parse({kind:"PREVIEW_POLL",peer:binding,cursor})));
        if(closed)throw Error("PEER_CLOSED");
        if(!sameAuthority(response.authority,pairing.authority)||response.membershipId!==result.membershipId){close();throw Error("PEER_PREVIEW_SCOPE_MISMATCH");}
        return response;
      },
      async request(command:z.infer<typeof localPeerRequestSchema>["command"]):Promise<LocalPeerResponse>{
        if(!binding||closed)throw Error("PEER_CLOSED");
        const request=localPeerRequestSchema.parse({peer:binding,command});
        const response=await send<LocalPeerResponse>(request);
        if(closed)throw Error("PEER_CLOSED");
        if(!response||!sameAuthority(localAuthoritySchema.parse(response.authority),pairing.authority)||response.snapshot?.campaign.id!==pairing.authority.campaignId||response.snapshot?.me.id!==result.membershipId){close();throw Error("PEER_PROJECTION_MISMATCH");}
        return response;
      },close,
    };
  }catch(error){binding=null;rpc.close();throw error;}
}
