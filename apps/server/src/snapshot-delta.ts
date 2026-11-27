import { randomUUID } from "node:crypto";
import type { GameSnapshot, SnapshotDelta } from "@arken/contracts";

type SnapshotSocket = {
  id: string;
  data?: { snapshotDeltaV1?: boolean };
  emit(event: "game:snapshot", snapshot: GameSnapshot, deliveryId?: string): unknown;
  emit(event: "game:delta", delta: SnapshotDelta): unknown;
};
type Baseline = {
  id: string;
  audience: string;
  fields: Map<keyof GameSnapshot, string>;
  bytes: number;
};
type Cache = { entries: Map<string, Baseline>; bytes: number };
const caches = new WeakMap<object, Cache>();
const MAX_BASELINE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_BASELINES = 1024;

export function forgetSnapshotBaseline(server: object, socketId: string) {
  const cache = caches.get(server);
  const previous = cache?.entries.get(socketId);
  if (!cache || !previous) return;
  cache.bytes -= previous.bytes;
  cache.entries.delete(socketId);
}

/** Diff ONLY a freshly authorized per-socket projection, never raw DB rows.
 * This reduces wire payload, not snapshot reads. Point events keep their own
 * ordering; the receiver reconstructs this canonical image before reconciling.
 */
export function emitSnapshotDelivery(
  server: object,
  socket: SnapshotSocket,
  snapshot: GameSnapshot,
  allowDelta: boolean,
) {
  if (socket.data?.snapshotDeltaV1 !== true) {
    forgetSnapshotBaseline(server, socket.id);
    socket.emit("game:snapshot", snapshot);
    return;
  }
  let cache = caches.get(server);
  if (!cache) {
    cache = { entries: new Map(), bytes: 0 };
    caches.set(server, cache);
  }
  const audience = JSON.stringify([
    snapshot.campaign.id, snapshot.me.id, snapshot.me.role,
  ]);
  const fields = new Map<keyof GameSnapshot, string>();
  for (const key of Object.keys(snapshot) as (keyof GameSnapshot)[]) {
    const value = JSON.stringify(snapshot[key]);
    if (value !== undefined) fields.set(key, value);
  }
  const fullBytes = Buffer.byteLength(JSON.stringify(snapshot));
  const previous = cache.entries.get(socket.id);
  const id = randomUUID();
  let delta: SnapshotDelta | null = null;
  if (allowDelta && previous?.audience === audience) {
    const changes: Partial<GameSnapshot> = {};
    for (const [key, value] of fields)
      if (previous.fields.get(key) !== value)
        Object.assign(changes, { [key]: snapshot[key] });
    const removed = [...previous.fields.keys()].filter(key => !fields.has(key));
    const candidate: SnapshotDelta = {
      baseId: previous.id, id, changes, removed,
    };
    // Do not turn a large change into a more expensive patch.
    if (Buffer.byteLength(JSON.stringify(candidate)) < fullBytes)
      delta = candidate;
  }
  forgetSnapshotBaseline(server, socket.id);
  if (fullBytes > MAX_BASELINE_BYTES) {
    socket.emit("game:snapshot", snapshot);
    return;
  }
  while (cache.entries.size >= MAX_BASELINES ||
         cache.bytes + fullBytes > MAX_CACHE_BYTES) {
    const oldest = cache.entries.keys().next().value;
    if (oldest === undefined) break;
    forgetSnapshotBaseline(server, oldest);
  }
  cache.entries.set(socket.id, { id, audience, fields, bytes: fullBytes });
  cache.bytes += fullBytes;
  if (delta) socket.emit("game:delta", delta);
  else socket.emit("game:snapshot", snapshot, id);
}
