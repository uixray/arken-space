import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createGameSocket(): GameSocket {
  return io({
    withCredentials: true,
    autoConnect: true,
    transports: ["websocket", "polling"],
  });
}
