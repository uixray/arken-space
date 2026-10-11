import type { GameSocket } from "../realtime";

type Handler = (value?: any) => void;
type RulerPayload = {
  sceneId: string;
  membershipId: string;
  displayName: string;
  points: Array<{ x: number; y: number }>;
  distance: number;
};
type SyntheticSocket = GameSocket & { simulateTransportReconnect: () => void };

const channelName = "uix682-ruler-hook-synthetic";
const clientId = new URLSearchParams(location.search).get("client") ?? "alpha";
const membershipId = clientId === "alpha" ? "member-alpha" : "member-beta";
const handlers = (target: Map<string, Set<Handler>>, event: string, value?: unknown) => {
  for (const listener of target.get(event) ?? []) listener(value);
};

export function createGameSocket(): GameSocket {
  const listeners = new Map<string, Set<Handler>>();
  const managerListeners = new Map<string, Set<Handler>>();
  let channel: BroadcastChannel;
  let connected = false;
  let id = "synthetic-" + clientId + "-1";
  const log = (event: string, payload?: unknown) => {
    window.__rulerEvents ??= [];
    window.__rulerEvents.push({ at: Date.now(), event, payload });
  };
  const open = () => {
    channel = new BroadcastChannel(channelName);
    channel.onmessage = ({ data }: MessageEvent<{ event: string; ruler: RulerPayload }>) => {
      log("in:" + data.event, data.ruler);
      handlers(listeners, data.event, data.ruler);
    };
    connected = true;
    setTimeout(() => handlers(listeners, "connect"), 0);
  };
  const socket = {
    id,
    connected,
    io: {
      on(event: string, handler: Handler) {
        const group = managerListeners.get(event) ?? new Set<Handler>();
        group.add(handler);
        managerListeners.set(event, group);
        return this;
      },
    },
    on(event: string, handler: Handler) {
      const group = listeners.get(event) ?? new Set<Handler>();
      group.add(handler);
      listeners.set(event, group);
      return this;
    },
    emit(event: string, payload: any) {
      log("out:" + event, payload);
      if (event === "ruler:update" || event === "ruler:clear") {
        const points = payload.points ?? [];
        const ruler: RulerPayload = {
          sceneId: payload.sceneId,
          membershipId,
          displayName: clientId,
          points,
          distance: points.length > 1 ? Math.hypot(points.at(-1)!.x - points[0]!.x, points.at(-1)!.y - points[0]!.y) : 0,
        };
        channel.postMessage({
          event: event === "ruler:update" ? "ruler:updated" : "ruler:cleared",
          ruler,
        });
      }
      return true;
    },
    disconnect() {
      if (!connected) return this;
      connected = false;
      log("transport:disconnect");
      handlers(listeners, "disconnect", "synthetic disconnect");
      channel.close();
      return this;
    },
    simulateTransportReconnect() {
      if (connected) return;
      id = "synthetic-" + clientId + "-" + Date.now();
      this.id = id;
      log("transport:reconnect");
      open();
    },
  };
  open();
  return socket as unknown as SyntheticSocket;
}


