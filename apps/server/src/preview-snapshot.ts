import type { Server } from "socket.io";
import type { ClientToServerEvents, GameSnapshot, ServerToClientEvents } from "@arken/contracts";
import { tokenPreviewEpochs } from "./token-preview-epochs.js";
import { campaignRoom } from "./rooms.js";

type SnapshotSocket = {
  id: string;
  emit(event: "game:snapshot", snapshot: GameSnapshot): unknown;
  emit(event: "token:preview-epoch", epoch: string): unknown;
};
export function emitPreviewSnapshot(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: SnapshotSocket,
  campaignId: string,
  snapshot: GameSnapshot,
): void {
  const { epoch, changed } = tokenPreviewEpochs.snapshot(socket.id, campaignId, snapshot.tokens.map(token => token.id));
  if (changed) io.to(campaignRoom(campaignId)).emit("token:preview-epoch", epoch);
  else socket.emit("token:preview-epoch", epoch);
  socket.emit("game:snapshot", snapshot);
}
