/** Isolated reachability spike. Carries no campaign data, credentials or commands. */
export type PeerProbeState = "CONNECTING" | "READY" | "UNREACHABLE" | "CLOSED";
export type ProbeResult = {ok:true;roundTripMs:number}|{ok:false;reason:"NOT_READY"|"BUSY"|"TIMEOUT"|"CLOSED"|"BACKPRESSURE"};
const MAX_WIRE_BYTES=1024,MAX_BUFFERED_BYTES=16384;
const LABEL="arken-peer-probe-v1";
type Packet={version:1;kind:"PING"|"PONG";id:string};

/** SDP exchange must be delivered by a trusted signaling flow before use. */
export function createPeerProbe(options:{
  initiator:boolean;
  iceServers?:RTCIceServer[];
  onIceCandidate:(candidate:RTCIceCandidateInit|null)=>void;
  onState:(state:PeerProbeState)=>void;
}) {
  const peer=new RTCPeerConnection({iceServers:options.iceServers??[],iceCandidatePoolSize:0});
  let channel:RTCDataChannel|null=null,closed=false;
  let pending:{id:string;started:number;timer:ReturnType<typeof setTimeout>;resolve:(r:ProbeResult)=>void}|null=null;
  let lastPing=-Infinity;
  const state=(s:PeerProbeState)=>{if(!closed)options.onState(s);};
  const complete=(result:ProbeResult)=>{const p=pending;pending=null;if(p){clearTimeout(p.timer);p.resolve(result);}};
  const writable=()=>channel?.readyState==="open"&&channel.bufferedAmount<MAX_BUFFERED_BYTES;
  const receive=(event:MessageEvent)=>{
    if(closed||typeof event.data!=="string"||event.data.length>MAX_WIRE_BYTES)return;
    let packet:Packet;
    try {
      const p:unknown=JSON.parse(event.data);
      if(!p||typeof p!=="object"||Array.isArray(p))return;
      const value=p as Record<string,unknown>;
      if(Object.keys(value).length!==3||value.version!==1||(value.kind!=="PING"&&value.kind!=="PONG")||typeof value.id!=="string"||!/^[a-f0-9-]{36}$/i.test(value.id))return;
      packet=value as Packet;
    }catch{return;}
    if(packet.kind==="PONG") {
      if(packet.id===pending?.id)complete({ok:true,roundTripMs:Math.max(0,performance.now()-pending.started)});
      return;
    }
    const now=performance.now();if(now-lastPing<100)return;lastPing=now;
    if(writable())try{channel!.send(JSON.stringify({...packet,kind:"PONG"}));}catch{state("UNREACHABLE");}
  };
  const attach=(next:RTCDataChannel)=>{
    if(closed||channel||next.label!==LABEL||!next.ordered||next.maxRetransmits!==null||next.maxPacketLifeTime!==null){next.close();return;}
    channel=next;next.addEventListener("message",receive);
    next.addEventListener("open",()=>state("READY"));
    next.addEventListener("close",()=>{complete({ok:false,reason:"CLOSED"});state("UNREACHABLE");});
    next.addEventListener("error",()=>{complete({ok:false,reason:"CLOSED"});state("UNREACHABLE");});
    if(next.readyState==="open")state("READY");
  };
  peer.addEventListener("icecandidate",event=>{if(!closed)options.onIceCandidate(event.candidate?.toJSON()??null);});
  peer.addEventListener("connectionstatechange",()=>{
    if(["failed","disconnected","closed"].includes(peer.connectionState)){complete({ok:false,reason:"CLOSED"});state("UNREACHABLE");}
  });
  peer.addEventListener("datachannel",event=>attach(event.channel));
  if(options.initiator)attach(peer.createDataChannel(LABEL,{ordered:true}));
  state("CONNECTING");
  return {
    async offer():Promise<RTCSessionDescriptionInit>{if(closed||!options.initiator)throw Error("INVALID_PROBE_STATE");const description=await peer.createOffer();await peer.setLocalDescription(description);return {type:description.type,sdp:description.sdp};},
    async answer(offer:RTCSessionDescriptionInit):Promise<RTCSessionDescriptionInit>{if(closed||options.initiator||offer.type!=="offer")throw Error("INVALID_PROBE_STATE");await peer.setRemoteDescription(offer);const answer=await peer.createAnswer();await peer.setLocalDescription(answer);return {type:answer.type,sdp:answer.sdp};},
    async acceptAnswer(answer:RTCSessionDescriptionInit){if(closed||!options.initiator||answer.type!=="answer")throw Error("INVALID_PROBE_STATE");await peer.setRemoteDescription(answer);},
    async addCandidate(candidate:RTCIceCandidateInit|null){if(closed)throw Error("PROBE_CLOSED");await peer.addIceCandidate(candidate??undefined);},
    ping(timeoutMs=5000):Promise<ProbeResult>{
      if(closed)return Promise.resolve({ok:false,reason:"CLOSED"});
      if(channel?.readyState!=="open")return Promise.resolve({ok:false,reason:"NOT_READY"});
      if(pending)return Promise.resolve({ok:false,reason:"BUSY"});
      if(!writable())return Promise.resolve({ok:false,reason:"BACKPRESSURE"});
      if(!Number.isFinite(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw Error("INVALID_PROBE_TIMEOUT");
      return new Promise(resolve=>{
        const id=crypto.randomUUID(),timer=setTimeout(()=>complete({ok:false,reason:"TIMEOUT"}),timeoutMs);
        pending={id,started:performance.now(),timer,resolve};
        try{channel!.send(JSON.stringify({version:1,kind:"PING",id}));}catch{complete({ok:false,reason:"CLOSED"});}
      });
    },
    close(){if(closed)return;complete({ok:false,reason:"CLOSED"});closed=true;channel?.removeEventListener("message",receive);channel?.close();peer.close();options.onState("CLOSED");},
  };
}
