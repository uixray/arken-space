import { io } from "socket.io-client";
import { routeCampaignId } from "./campaign-route";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";

export type GameIncomingEvents = ServerToClientEvents & {
  connect:()=>void;
  disconnect:(reason:string)=>void;
  connect_error:(error:Error)=>void;
};
/** Shared transport surface; game code must not depend on Socket.IO internals. */
export interface GameSocket {
  on<K extends keyof GameIncomingEvents>(event:K,listener:GameIncomingEvents[K]):GameSocket;
  off<K extends keyof GameIncomingEvents>(event:K,listener?:GameIncomingEvents[K]):GameSocket;
  emit<K extends keyof ClientToServerEvents>(event:K,...args:Parameters<ClientToServerEvents[K]>):GameSocket;
  connect():GameSocket;
  disconnect():GameSocket;
  connected:boolean;
  active:boolean;
  recovered:boolean;
  id?:string;
  volatile:{emit:GameSocket["emit"]};
  io:{on(event:"reconnect_attempt"|"reconnect_failed",listener:()=>void):unknown};
  previewSnapshotVersion?: number;
  previewEpoch?: string;
}

let factory:(()=>GameSocket)|null=null;
const closedFactory=():GameSocket=>{throw Error("GAME_TRANSPORT_CLOSED");};
export function installGameSocketFactory(next:()=>GameSocket){
  if(factory&&factory!==closedFactory)throw Error("GAME_TRANSPORT_ALREADY_INSTALLED");factory=next;
  return ()=>{if(factory===next)factory=closedFactory;};
}

export function createGameSocket(): GameSocket {
  if(factory)return factory();
  return io({
    auth: { campaignId: routeCampaignId(), snapshotDeltaV1: true },
    withCredentials: true,
    autoConnect: true,
    transports: ["websocket", "polling"],
  }) as unknown as GameSocket;
}
