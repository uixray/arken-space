import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { GameSnapshot, MapPing } from "@arken/contracts";
import { reportClientEvent } from "./api";
import { createGameSocket, type GameSocket } from "./realtime";
import { appendChatMessage } from "./chat-state";
import { upsertDirectThread } from "./direct-chat-state";
import {
  addRollToast,
  removeRollToast,
  scheduleRollToastRemoval,
  shouldShowRollToast,
  type RollToast,
} from "./toast-state";
import { useLatestRef } from "./use-latest-ref";
import {
  mergeCharacterMutationResponse,
  reconcileGameSnapshot,
} from "./character-mutation";
import { applyPlayerRequestChanged } from "./player-request-realtime";
import {
  applyCursorMoved,
  type CursorPresence,
} from "./renderers/cursor-presence";

export type ConnectionState =
  | "CONNECTING"
  | "ONLINE"
  | "RECONNECTING"
  | "RESYNCING"
  | "OFFLINE";

export type SceneViewEmission = {
  socket: GameSocket;
  connectionId: string | null;
  sceneId: string | null;
};

export interface RulerItem {
  sceneId: string;
  membershipId: string;
  displayName: string;
  points: Array<{ x: number; y: number }>;
  distance: number;
}

export interface PresenceItem {
  membershipId: string;
  online: boolean;
}

/**
 * A socket can already be connected by the time React commits it to state.
 * Both the Socket.IO connect callback and the viewed-scene effect therefore
 * use this gate: exactly one of them emits a given value on a transport, while
 * a new socket id (or an explicit reset on disconnect) restores it again.
 */
export function emitSceneViewIfNeeded(
  socket: GameSocket,
  lastEmission: { current: SceneViewEmission | null },
  sceneId: string | null,
) {
  const connectionId = socket.id ?? null;
  const previous = lastEmission.current;
  if (
    previous?.socket === socket &&
    previous.connectionId === connectionId &&
    previous.sceneId === sceneId
  )
    return;
  lastEmission.current = { socket, connectionId, sceneId };
  socket.emit("scene:view", { sceneId });
}

export interface UseGameSocketSubscriptionsOptions {
  campaignId: string | null;
  authRequired: boolean;
  ownMembershipId?: string;
  viewedSceneId: string | null;
  loadStoryPosts: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<GameSnapshot | null>>;
  setPings: Dispatch<SetStateAction<MapPing[]>>;
  setRulers: Dispatch<SetStateAction<RulerItem[]>>;
  setCursors: Dispatch<SetStateAction<CursorPresence[]>>;
  setRollToasts: Dispatch<SetStateAction<RollToast[]>>;
  setPresence: Dispatch<SetStateAction<PresenceItem[]>>;
  setError: (msg: string) => void;
  knownChatMessageIdsRef: MutableRefObject<Set<string>>;
  activeChatThreadIdRef: MutableRefObject<string | null>;
  chatOpenRef: MutableRefObject<boolean>;
}

export interface UseGameSocketSubscriptionsResult {
  socket: GameSocket | null;
  setSocket: Dispatch<SetStateAction<GameSocket | null>>;
  connection: ConnectionState;
  setConnection: Dispatch<SetStateAction<ConnectionState>>;
}

export function useGameSocketSubscriptions({
  campaignId,
  authRequired,
  ownMembershipId,
  viewedSceneId,
  loadStoryPosts,
  setSnapshot,
  setPings,
  setRulers,
  setCursors,
  setRollToasts,
  setPresence,
  setError,
  knownChatMessageIdsRef,
  activeChatThreadIdRef,
  chatOpenRef,
}: UseGameSocketSubscriptionsOptions): UseGameSocketSubscriptionsResult {
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("CONNECTING");

  const lastSceneViewEmissionRef = useRef<SceneViewEmission | null>(null);
  const viewedSceneIdRef = useLatestRef(viewedSceneId);
  const ownMembershipIdRef = useLatestRef(ownMembershipId);
  const loadStoryPostsRef = useLatestRef(loadStoryPosts);
  const toastAppearanceRef = useRef(0);

  useEffect(() => {
    if (!campaignId || authRequired) return;
    const next = createGameSocket();
    setSocket(next);
    next.on("connect", () => {
      setConnection("ONLINE");
      emitSceneViewIfNeeded(
        next,
        lastSceneViewEmissionRef,
        viewedSceneIdRef.current,
      );
    });
    next.on("disconnect", (reason) => {
      if (lastSceneViewEmissionRef.current?.socket === next)
        lastSceneViewEmissionRef.current = null;
      setConnection("RECONNECTING");
      reportClientEvent({
        level: "warn",
        event: "realtime.disconnected",
        message: reason,
      });
    });
    next.io.on("reconnect_attempt", () => setConnection("RECONNECTING"));
    next.io.on("reconnect_failed", () => setConnection("OFFLINE"));
    next.on("game:snapshot", (nextSnapshot) => {
      setSnapshot((current) => reconcileGameSnapshot(current, nextSnapshot));
      setConnection("ONLINE");
    });
    next.on("scene:activated", (event) =>
      setSnapshot((current) =>
        current && event.sequence > current.snapshotVersion
          ? {
              ...current,
              snapshotVersion: event.sequence,
              scenes: current.scenes.map((scene) => ({
                ...scene,
                active: scene.id === event.data,
              })),
            }
          : current,
      ),
    );
    next.on("token:moving", (movement) =>
      setSnapshot((current) =>
        current
          ? {
              ...current,
              tokens: current.tokens.map((token) =>
                token.id === movement.tokenId
                  ? { ...token, x: movement.x, y: movement.y }
                  : token,
              ),
            }
          : current,
      ),
    );
    next.on("token:moved", (event) =>
      setSnapshot((current) =>
        current && event.sequence > current.snapshotVersion
          ? {
              ...current,
              snapshotVersion: event.sequence,
              tokens: current.tokens.map((token) =>
                token.id === event.data.id ? event.data : token,
              ),
            }
          : current,
      ),
    );
    next.on("fog:created", (event) =>
      setSnapshot((current) =>
        current && event.sequence > current.snapshotVersion
          ? {
              ...current,
              snapshotVersion: event.sequence,
              fogReveals: [...current.fogReveals, event.data],
            }
          : current,
      ),
    );
    next.on("fog:removed", (event) =>
      setSnapshot((current) =>
        current && event.sequence > current.snapshotVersion
          ? {
              ...current,
              snapshotVersion: event.sequence,
              fogReveals: current.fogReveals.filter(
                (fog) => fog.id !== event.data.fogRevealId,
              ),
            }
          : current,
      ),
    );
    next.on("map:ping", (ping) => {
      setPings((current) => [...current.slice(-7), ping]);
      window.setTimeout(
        () =>
          setPings((current) =>
            current.filter((item) => item.createdAt !== ping.createdAt),
          ),
        3500,
      );
    });
    next.on("ruler:updated", (ruler) =>
      setRulers((current) => [
        ...current.filter((item) => item.membershipId !== ruler.membershipId),
        ruler,
      ]),
    );
    next.on("ruler:cleared", (ruler) =>
      setRulers((current) =>
        current.filter(
          (item) =>
            item.membershipId !== ruler.membershipId ||
            item.sceneId !== ruler.sceneId,
        ),
      ),
    );
    next.on("cursor:moved", (cursor) =>
      setCursors((current) =>
        applyCursorMoved(current, cursor, ownMembershipIdRef.current),
      ),
    );
    next.on("cursor:gone", (event) =>
      setCursors((current) =>
        current.filter((item) => item.membershipId !== event.membershipId),
      ),
    );
    next.on("story:changed", () => {
      void loadStoryPostsRef.current().catch(() => undefined);
    });
    next.on("player-request:changed", (request) => {
      setSnapshot((current) => applyPlayerRequestChanged(current, request));
    });
    next.on("chat:thread_created", ({ thread, state }) => {
      setSnapshot((current) =>
        current ? upsertDirectThread(current, thread, state) : current,
      );
    });
    next.on("chat:created", (event) => {
      const unseen = !knownChatMessageIdsRef.current.has(event.data.id);
      if (unseen) knownChatMessageIdsRef.current.add(event.data.id);
      // Chat is append-only. It must be deduplicated by message id rather than
      // rejected by the global entity sequence: a later snapshot can arrive
      // before this envelope without containing this newly committed message.
      setSnapshot((current) =>
        current
          ? appendChatMessage(current, event.data, event.sequence, {
              activeThreadId: activeChatThreadIdRef.current,
              ownMembershipId: current.me.id,
            })
          : current,
      );
      if (shouldShowRollToast(unseen, event.data.kind, chatOpenRef.current)) {
        const appearanceId = ++toastAppearanceRef.current;
        let added = false;
        setRollToasts((current) => {
          const next = addRollToast(current, {
            message: event.data,
            appearanceId,
          });
          added = next !== current;
          return next;
        });
        scheduleRollToastRemoval(() => {
          if (added)
            setRollToasts((current) =>
              removeRollToast(current, event.data.id, appearanceId),
            );
        });
      }
    });
    next.on("character:updated", (event) =>
      setSnapshot((current) =>
        current && event.sequence > current.snapshotVersion
          ? {
              ...current,
              snapshotVersion: event.sequence,
              characters: current.characters.map((item) => {
                if (item.id !== event.data.id) return item;
                return mergeCharacterMutationResponse(item, event.data) ?? item;
              }),
            }
          : current,
      ),
    );
    next.on("audio:state", (event) =>
      setSnapshot((current) =>
        current && event.sequence > current.snapshotVersion
          ? { ...current, snapshotVersion: event.sequence, audio: event.data }
          : current,
      ),
    );
    next.on("presence:updated", setPresence);
    next.on("server:error", (problem) => setError(problem.message));
    return () => {
      next.disconnect();
      if (lastSceneViewEmissionRef.current?.socket === next)
        lastSceneViewEmissionRef.current = null;
      setSocket(null);
      setCursors([]);
    };
  }, [
    authRequired,
    campaignId,
    knownChatMessageIdsRef,
    activeChatThreadIdRef,
    chatOpenRef,
    loadStoryPostsRef,
    ownMembershipIdRef,
    setCursors,
    setError,
    setPings,
    setPresence,
    setRollToasts,
    setRulers,
    setSnapshot,
    viewedSceneIdRef,
  ]);

  /*
   * Server responds with fresh snapshot to this socket for GM canvas view changes.
   * Do not buffer this event while offline: the connect handler above emits
   * the latest value once per transport and avoids replaying an obsolete
   * intermediate selection after a reconnect.
   */
  useEffect(() => {
    if (socket?.connected)
      emitSceneViewIfNeeded(socket, lastSceneViewEmissionRef, viewedSceneId);
  }, [socket, viewedSceneId]);

  return {
    socket,
    setSocket,
    connection,
    setConnection,
  };
}
