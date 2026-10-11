import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SceneDto } from "@arken/contracts";
import type { GameSocket } from "../realtime";
import { useGameSocketSubscriptions } from "../use-game-socket-subscriptions";
import { Orthographic2DRenderer } from "../renderers/Orthographic2DRenderer";

declare global {
  interface Window {
    __rulerEvents: Array<{ at: number; event: string; payload?: unknown }>;
    __simulateReconnect?: () => void;
  }
}
const scene: SceneDto = {
  id: "synthetic-scene", name: "Synthetic scene", projection: "ORTHOGRAPHIC_2D",
  mapAssetId: null, width: 900, height: 600,
  backgroundFrame: { x: 0, y: 0, width: 900, height: 600 },
  grid: { enabled: false, size: 64, offsetX: 0, offsetY: 0, color: "#ffffff", opacity: 0.5 },
  active: true,
};

function SyntheticRulerClient() {
  const client = new URLSearchParams(location.search).get("client") ?? "alpha";
  const membershipId = client === "alpha" ? "member-alpha" : "member-beta";
  const [, setSnapshot] = useState<any>(null);
  const [pings, setPings] = useState<any[]>([]);
  const [rulers, setRulers] = useState<any[]>([]);
  const [cursors, setCursors] = useState<any[]>([]);
  const [, setRollToasts] = useState<any[]>([]);
  const [, setPresence] = useState<any[]>([]);
  const [error, setError] = useState("");
  const knownChatMessageIdsRef = useRef(new Set<string>());
  const activeChatThreadIdRef = useRef<string | null>(null);
  const chatOpenRef = useRef(false);
  const loadStoryPosts = useCallback(async () => undefined, []);
  const onError = useCallback((message: string) => setError(message), []);
  const realtime = useGameSocketSubscriptions({
    campaignId: "synthetic-campaign",
    authRequired: false,
    ownMembershipId: membershipId,
    viewedSceneId: scene.id,
    loadStoryPosts,
    setSnapshot,
    setPings,
    setRulers,
    setCursors,
    setRollToasts,
    setPresence,
    setError: onError,
    knownChatMessageIdsRef,
    activeChatThreadIdRef,
    chatOpenRef,
  });
  const socket = realtime.socket as (GameSocket & { simulateTransportReconnect?: () => void }) | null;

  useEffect(() => {
    window.__rulerEvents = [];
    window.__simulateReconnect = () => {
      if (!socket) return;
      socket.disconnect();
      window.setTimeout(() => socket.simulateTransportReconnect?.(), 80);
    };
    return () => { delete window.__simulateReconnect; };
  }, [socket]);

  const props = {
    scene, tokens: [], fogReveals: [], drawings: [], assets: [], role: "PLAYER" as const,
    membershipId, socket, tool: "RULER" as const,
    onToolSelect: () => undefined, pings, cursors, cursorSendEnabled: false,
    cursorShared: false, rulers, onFogCreate: async () => undefined,
    onDrawingCreate: async () => undefined, onPing: () => undefined,
  };
  return <main>
    <output data-testid="client">{client}</output>
    <output data-testid="connected">{realtime.connection}</output>
    <output data-testid="ruler-count">{rulers.length}</output>
    <output data-testid="error">{error}</output>
    <button type="button" data-testid="reconnect" onClick={() => window.__simulateReconnect?.()}>Simulate transport reconnect</button>
    <Orthographic2DRenderer {...props} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<SyntheticRulerClient />);

