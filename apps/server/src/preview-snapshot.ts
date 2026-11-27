import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  GameSnapshot,
  ServerToClientEvents,
} from "@arken/contracts";
import { tokenPreviewEpochs } from "./token-preview-epochs.js";
import { campaignRoom } from "./rooms.js";
import { emitSnapshotDelivery } from "./snapshot-delta.js";
import type { SnapshotDelta } from "@arken/contracts";

type SnapshotSocket = {
  id: string;
  data?: { snapshotDeltaV1?: boolean };
  emit(event: "game:snapshot", snapshot: GameSnapshot, deliveryId?: string): unknown;
  emit(event: "game:delta", delta: SnapshotDelta): unknown;
  emit(event: "token:preview-epoch", epoch: string): unknown;
};
export function emitPreviewSnapshot(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: SnapshotSocket,
  campaignId: string,
  snapshot: GameSnapshot,
  allowDelta = false,
): void {
  const { epoch, changed } = tokenPreviewEpochs.snapshot(
    socket.id,
    campaignId,
    snapshot.tokens.map((token) => token.id),
  );
  if (changed)
    io.to(campaignRoom(campaignId)).emit("token:preview-epoch", epoch);
  else socket.emit("token:preview-epoch", epoch);
  emitSnapshotDelivery(io, socket, snapshot, allowDelta);
}
