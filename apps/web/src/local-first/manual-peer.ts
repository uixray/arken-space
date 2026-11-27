import {z} from "zod";
export const peerDescriptionSchema=z.object({type:z.enum(["offer","answer"]),sdp:z.string().min(1).max(262144)}).strict();
const LABEL="arken-session-v1";

/** Out-of-band signaling: exchange the complete code privately with the intended peer. */
export function createManualPeer(options:{initiator:boolean;iceServers?:RTCIceServer[];onChannel:(channel:RTCDataChannel)=>void;onClosed:()=>void}){
  const peer=new RTCPeerConnection({iceServers:options.iceServers??[]}),controller=new AbortController();
  let closed=false,seen=false;
  const close=()=>{if(closed)return;closed=true;controller.abort();peer.close();options.onClosed();};
  const attach=(channel:RTCDataChannel)=>{
    if(closed||seen||channel.label!==LABEL||!channel.ordered||channel.maxRetransmits!==null||channel.maxPacketLifeTime!==null){channel.close();return;}
    seen=true;
    const ready=()=>{if(!closed)options.onChannel(channel);};
    if(channel.readyState==="open")ready();else channel.addEventListener("open",ready,{once:true});
    channel.addEventListener("close",close,{once:true});channel.addEventListener("error",close,{once:true});
  };
  peer.addEventListener("connectionstatechange",()=>{if(["failed","closed"].includes(peer.connectionState))close();});
  peer.addEventListener("datachannel",event=>attach(event.channel));
  if(options.initiator)attach(peer.createDataChannel(LABEL,{ordered:true}));
  const gather=async(description:RTCSessionDescriptionInit)=>{
    await peer.setLocalDescription(description);
    if(peer.iceGatheringState!=="complete")await new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);peer.removeEventListener("icegatheringstatechange",change);controller.signal.removeEventListener("abort",abort);};
      const change=()=>{if(peer.iceGatheringState==="complete"){cleanup();resolve();}};
      const abort=()=>{cleanup();reject(Error("PEER_CLOSED"));};
      const timer=setTimeout(()=>{cleanup();reject(Error("Не удалось подготовить сетевой код. Проверьте сеть."));},15000);
      peer.addEventListener("icegatheringstatechange",change);controller.signal.addEventListener("abort",abort,{once:true});
      if(closed)abort();else change();
    });
    if(closed||!peer.localDescription)throw Error("PEER_CLOSED");
    return peerDescriptionSchema.parse(peer.localDescription.toJSON());
  };
  return {
    async offer(){if(closed||!options.initiator)throw Error("INVALID_PEER_STATE");try{return await gather(await peer.createOffer());}catch(error){close();throw error;}},
    async answer(input:unknown){const description=peerDescriptionSchema.parse(input);if(closed||options.initiator||description.type!=="offer")throw Error("INVALID_PEER_STATE");try{await peer.setRemoteDescription(description);return await gather(await peer.createAnswer());}catch(error){close();throw error;}},
    async acceptAnswer(input:unknown){const description=peerDescriptionSchema.parse(input);if(closed||!options.initiator||description.type!=="answer")throw Error("INVALID_PEER_STATE");try{await peer.setRemoteDescription(description);}catch(error){close();throw error;}},close,
  };
}
