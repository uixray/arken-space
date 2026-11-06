import { io, type Socket } from "socket.io-client";
import { routeCampaignId } from "./campaign-route";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createGameSocket(): GameSocket {
  return io({
    auth: { campaignId: routeCampaignId() },
    withCredentials: true,
    autoConnect: true,
    transports: ["websocket", "polling"],
  });
}
