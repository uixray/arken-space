import {localPreviewSubmitSchema,type LocalPreviewAccepted,type ServerToClientEvents} from "@arken/contracts";
import {withLocalPeer} from "./local-session-authority.js";
import {prepareTokenPreview,type PreparedTokenPreview} from "./realtime.js";
import {localTokenPreviews} from "./local-token-preview-buffer.js";
type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];
export type LocalPreviewDelivery=(campaignId:string,prepared:PreparedTokenPreview,movement:Parameters<ServerToClientEvents["token:moving"]>[0])=>void;
/** Ephemeral acceptance, not a durable movement ACK. No retry or game-event write. */
export async function submitLocalTokenPreview(db:Database,input:unknown,deliver:LocalPreviewDelivery):Promise<LocalPreviewAccepted>{
  const request=localPreviewSubmitSchema.parse(input);
  return withLocalPeer(db,request.peer,async(tx,auth,authority)=>{
    const prepared=await prepareTokenPreview(tx,auth,request.movement);
    if(!prepared)return {authority,membershipId:auth.membershipId,accepted:false};
    // Synchronous Socket.IO delivery while the same authority/revoke fence is held.
    deliver(auth.campaignId,prepared,request.movement);
    localTokenPreviews.publish(auth.campaignId,request.movement);
    return {authority,membershipId:auth.membershipId,accepted:true};
  });
}
