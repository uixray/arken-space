import { fenceUnsafePointEvents } from "./unsafe-point-fence";
import { advanceSnapshotVersion } from "@arken/contracts";
import { createPlayerFogResync } from "./player-fog-resync";
import { shareStructure } from "./structural-sharing";
import { createSnapshotDelivery } from "./snapshot-delivery";
import {
  applyHiddenTokenPreview,
  applyTokenPointEvent,
  applyTokenPreview,
  recordTokenRemovals,
  type TokenRemovalWatermarks,
} from "./token-point-events";
import {
  applyDrawingRemoved,
  applyDrawingUpserted,
} from "./drawing-point-events";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  AudioTrackDto,
  GameSnapshot,
  MapPing,
  ServerToClientEvents,
} from "@arken/contracts";
import { reportClientEvent } from "./api";
import { createGameSocket, type GameSocket } from "./realtime";
import { applyChatCreated } from "./chat-state";
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
  applyAudioTrackRemoved,
  applyAudioTrackState,
  type AudioTrackEventCursor,
} from "./audio-tracks-state";
import {
  applyCursorMoved,
  type CursorPresence,
} from "./renderers/cursor-presence";

export type ConnectionState =
  "CONNECTING" | "ONLINE" | "RECONNECTING" | "RESYNCING" | "OFFLINE";

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
  initialSnapshotVersion?: number;
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
  initialSnapshotVersion,
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
  const initialSnapshotVersionRef = useLatestRef(initialSnapshotVersion);
  const loadStoryPostsRef = useLatestRef(loadStoryPosts);
  const toastAppearanceRef = useRef(0);

  useEffect(() => {
    if (!campaignId || authRequired) return;
    const next = createGameSocket();
    fenceUnsafePointEvents(next);
    const snapshotDelivery = createSnapshotDelivery(campaignId);
    next.on("disconnect", () => snapshotDelivery.reset());
    // Scoped to this socket/campaign. Track events have a per-track cursor;
    // the global snapshot version is used only to seed canonical state and is
    // never a gate that can discard an interleaved track event.
    const audioTrackCursor: AudioTrackEventCursor = new Map();
    const tokenRemovalWatermarks: TokenRemovalWatermarks = new Map();
    const redactedPreviews = new Map<
      string,
      Parameters<ServerToClientEvents["token:preview-hidden"]>[0]
    >();
    const redactedPreviewRecovery = new Map<
      string,
      ReturnType<typeof setTimeout>
    >();
    const clearRedactedPreviewRecovery = (tokenId: string) => {
      clearTimeout(redactedPreviewRecovery.get(tokenId));
      redactedPreviewRecovery.delete(tokenId);
    };
    const discardRedactedPreviews = () => {
      redactedPreviews.clear();
      for (const timer of redactedPreviewRecovery.values()) clearTimeout(timer);
      redactedPreviewRecovery.clear();
    };
    const playerFog = createPlayerFogResync((sequence) => {
      if (next.connected) next.emit("game:resync", sequence);
    });
    let canonicalAudioFloor = initialSnapshotVersionRef.current ?? 0;
    setSocket(next);
    next.on("connect", () => {
      setConnection("RESYNCING");
      // UIX-682 C20: rulers have no server snapshot. Only a recovered session
      // gets missed ruler:cleared replayed; after a fresh one a kept ruler
      // could never be cleared. An active drag redraws on its next update.
      if (!next.recovered) setRulers([]);
      emitSceneViewIfNeeded(
        next,
        lastSceneViewEmissionRef,
        viewedSceneIdRef.current,
      );
    });
    next.on("disconnect", (reason) => {
      playerFog.reset();
      discardRedactedPreviews();
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
    next.on("connect_error", () => {
      setConnection(next.active ? "RECONNECTING" : "OFFLINE");
    });
    next.on("token:preview-epoch", (epoch) => {
      next.previewEpoch = epoch;
    });
    const acceptCanonicalSnapshot = (nextSnapshot: GameSnapshot) => {
      if (nextSnapshot.snapshotVersion >= (next.previewSnapshotVersion ?? 0)) {
        const placements = new Map(
          nextSnapshot.tokens.map((token) => [token.id, token]),
        );
        for (const [id, redaction] of redactedPreviews) {
          const token = placements.get(id);
          if (
            token?.revision !== redaction.revision ||
            token.sceneId !== redaction.sceneId ||
            redaction.previewEpoch !== next.previewEpoch
          ) {
            redactedPreviews.delete(id);
            clearRedactedPreviewRecovery(id);
          }
        }
      }
      next.previewSnapshotVersion = Number.isSafeInteger(
        nextSnapshot.snapshotVersion,
      )
        ? nextSnapshot.snapshotVersion
        : undefined;
      // A chat action can send a canonical snapshot with the original token
      // position while a drag is still in flight. Preserve a redaction only
      // for the same placement revision, and never revive a missing row.
      const activeRedactions = [...redactedPreviews.values()];
      const previewEpoch = next.previewEpoch;
      setSnapshot((current) => {
        // Unchanged slices keep their identity, so a chat-only broadcast
        // does not re-render the map (see structural-sharing.ts).
        const reconciled = shareStructure(
          current,
          reconcileGameSnapshot(current, nextSnapshot),
        );
        if (reconciled.campaign.id !== campaignId) return reconciled;
        playerFog.scope(reconciled.scenes.find((scene) => scene.active)?.id);
        if (nextSnapshot.campaign.id === campaignId)
          playerFog.snapshot(
            nextSnapshot.scenes.find((scene) => scene.active)?.id,
            nextSnapshot.snapshotVersion,
          );
        recordTokenRemovals(current, reconciled, tokenRemovalWatermarks);
        if (nextSnapshot.snapshotVersion >= canonicalAudioFloor)
          canonicalAudioFloor = nextSnapshot.snapshotVersion;
        for (const track of reconciled.audioTracks ?? []) {
          const seen = audioTrackCursor.get(track.id);
          if (!seen || seen.sequence <= reconciled.snapshotVersion)
            audioTrackCursor.set(track.id, {
              sequence: reconciled.snapshotVersion,
              revision: track.revision,
            });
        }
        // Retain tombstones when a canonical snapshot supersedes a locally
        // active row; otherwise a delayed pre-snapshot state event could revive it.
        if (current?.campaign.id === campaignId) {
          const present = new Set(
            (reconciled.audioTracks ?? []).map((track) => track.id),
          );
          for (const previous of current.audioTracks ?? [])
            if (!present.has(previous.id))
              audioTrackCursor.set(previous.id, {
                sequence: reconciled.snapshotVersion,
                revision: Number.MAX_SAFE_INTEGER,
              });
        }
        if (reconciled === current) return reconciled;
        return activeRedactions.reduce(
          (state, redaction) =>
            applyHiddenTokenPreview(
              state,
              redaction,
              tokenRemovalWatermarks,
              previewEpoch,
            ),
          reconciled,
        );
      });
      setConnection("ONLINE");
    };
    next.on("game:snapshot", (snapshot, deliveryId) => {
      const canonical = snapshotDelivery.full(snapshot, deliveryId);
      if (canonical) acceptCanonicalSnapshot(canonical);
    });
    next.on("game:delta", (event) => {
      const canonical = snapshotDelivery.delta(event);
      if (canonical) {
        acceptCanonicalSnapshot(canonical);
      } else {
        // Missing/evicted baseline or missed packet: bootstrap again rather
        // than guess. The server's connection path supplies a full snapshot.
        snapshotDelivery.reset();
        next.disconnect();
        next.connect();
      }
    });
    next.on("scene:activated", (event) =>
      setSnapshot((current) => {
        if (!current || event.sequence <= current.snapshotVersion)
          return current;
        playerFog.scope(event.data);
        return {
          ...current,
          ...advanceSnapshotVersion(current,event.sequence),
          scenes: current.scenes.map((scene) => ({
            ...scene,
            active: scene.id === event.data,
          })),
        };
      }),
    );
    next.on("token:moving", (movement) => {
      const redaction = redactedPreviews.get(movement.tokenId);
      if (
        redaction &&
        movement.previewEpoch === redaction.previewEpoch &&
        movement.sceneId === redaction.sceneId &&
        movement.revision === redaction.revision &&
        (movement.snapshotVersion ?? 0) >= (redaction.snapshotVersion ?? 0)
      ) {
        redactedPreviews.delete(movement.tokenId);
        clearRedactedPreviewRecovery(movement.tokenId);
      }
      setSnapshot((current) =>
        current
          ? applyTokenPreview(
              current,
              movement,
              tokenRemovalWatermarks,
              next.previewEpoch,
            )
          : current,
      );
    });
    next.on("token:preview-hidden", (event) => {
      if (event.previewEpoch !== next.previewEpoch) return;
      redactedPreviews.set(event.tokenId, event);
      setSnapshot((current) =>
        current
          ? applyHiddenTokenPreview(
              current,
              event,
              tokenRemovalWatermarks,
              next.previewEpoch,
            )
          : current,
      );
      // An abandoned drag might not commit. Fall back to the server's
      // canonical view rather than leaving the token hidden indefinitely.
      clearRedactedPreviewRecovery(event.tokenId);
      redactedPreviewRecovery.set(
        event.tokenId,
        setTimeout(() => {
          redactedPreviews.delete(event.tokenId);
          redactedPreviewRecovery.delete(event.tokenId);
          if (next.connected)
            next.emit("game:resync", next.previewSnapshotVersion ?? 0);
        }, 8000),
      );
    });
    next.on("token:moved", (event) =>
      setSnapshot((current) =>
        current
          ? applyTokenPointEvent(current, event, tokenRemovalWatermarks)
          : current,
      ),
    );
    // A point event for an unrelated domain can advance snapshotVersion before
    // fog arrives. Do not silently discard the resulting discrepancy: request
    // the server's canonical projection instead of replaying potentially
    // stale fog after a deletion or scene switch. Coalesce a burst of strokes.
    let fogResyncScheduled = false;
    const requestFogResync = (knownSequence: number) => {
      if (fogResyncScheduled) return;
      fogResyncScheduled = true;
      queueMicrotask(() => {
        fogResyncScheduled = false;
        if (next.connected) next.emit("game:resync", knownSequence);
      });
    };
    next.on("fog:created", (event) =>
      setSnapshot((current) => {
        if (!current) return current;
        // A scene switch can overtake the server relay after it selected the
        // audience. Do not attach fog from a scene no longer in this view.
        const visibleScene =
          current.scenes.some(
            (scene) => scene.active && scene.id === event.data.sceneId,
          ) ||
          (current.me.role === "GM" &&
            viewedSceneIdRef.current === event.data.sceneId);
        if (!visibleScene) return current;
        const exists = current.fogReveals.some(
          (fog) => fog.id === event.data.id,
        );
        if (event.sequence <= current.snapshotVersion) {
          if (!exists) {
            if (current.me.role === "PLAYER")
              playerFog.request(event.data.sceneId, current.snapshotVersion);
            else requestFogResync(current.snapshotVersion);
          }
          return current;
        }
        if (!exists && current.me.role === "PLAYER")
          playerFog.request(event.data.sceneId, event.sequence);
        return {
          ...current,
          ...advanceSnapshotVersion(current, event.sequence),
          fogReveals: exists
            ? current.fogReveals
            : [...current.fogReveals, event.data],
        };
      }),
    );
    next.on("fog:removed", (event) =>
      setSnapshot((current) => {
        if (!current) return current;
        const previous = current.fogReveals.find(
          (fog) => fog.id === event.data.fogRevealId,
        );
        const playerScene =
          current.me.role === "PLAYER" &&
          previous &&
          current.scenes.some(
            (scene) => scene.active && scene.id === previous.sceneId,
          );
        if (event.sequence <= current.snapshotVersion) {
          if (playerScene)
            playerFog.request(previous.sceneId, current.snapshotVersion);
          else if (previous && current.me.role === "GM")
            requestFogResync(current.snapshotVersion);
          return current;
        }
        if (playerScene) playerFog.request(previous.sceneId, event.sequence);
        return {
          ...current,
          ...advanceSnapshotVersion(current, event.sequence),
          fogReveals: current.fogReveals.filter(
            (fog) => fog.id !== event.data.fogRevealId,
          ),
        };
      }),
    );
    // UIX-412: ordered by the server after any snapshot in flight, so there
    // is no snapshotVersion gate; an older revision never replaces a newer.
    next.on("token:updated", (event) =>
      setSnapshot((current) =>
        current
          ? applyTokenPointEvent(current, event, tokenRemovalWatermarks, true)
          : current,
      ),
    );
    next.on("drawing:upserted", (event) =>
      setSnapshot((current) =>
        current ? applyDrawingUpserted(current, event) : current,
      ),
    );
    next.on("drawing:removed", (event) =>
      setSnapshot((current) =>
        current ? applyDrawingRemoved(current, event) : current,
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
          ? applyChatCreated(current, event, {
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
    // UIX-412: like drawing events, ordered by the server after any snapshot
    // already in flight; the merge itself refuses an older revision.
    next.on("character:updated", (event) =>
      setSnapshot((current) =>
        current
          ? {
              ...current,
              ...advanceSnapshotVersion(current, event.sequence),
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
          ? {
              ...current,
              ...advanceSnapshotVersion(current, event.sequence),
              audio: event.data,
            }
          : current,
      ),
    );
    next.on("audio:track:state", (event) =>
      setSnapshot((current) => {
        if (!current || current.campaign.id !== campaignId) return current;
        if (event.sequence <= canonicalAudioFloor) return current;
        const audioTracks = applyAudioTrackState(
          current.audioTracks ?? [],
          event.data as AudioTrackDto,
          event.sequence,
          audioTrackCursor,
        );
        if (audioTracks === (current.audioTracks ?? [])) return current;
        return {
          ...current,
          audioTracks,
          ...advanceSnapshotVersion(current, event.sequence),
        };
      }),
    );
    next.on("audio:track:removed", (event) =>
      setSnapshot((current) => {
        if (!current || current.campaign.id !== campaignId) return current;
        if (event.sequence <= canonicalAudioFloor) return current;
        const audioTracks = applyAudioTrackRemoved(
          current.audioTracks ?? [],
          event.data.trackId,
          event.sequence,
          audioTrackCursor,
        );
        if (audioTracks === (current.audioTracks ?? [])) return current;
        return {
          ...current,
          audioTracks,
          ...advanceSnapshotVersion(current, event.sequence),
        };
      }),
    );
    next.on("presence:updated", setPresence);
    next.on("server:error", (problem) => setError(problem.message));
    return () => {
      playerFog.reset();
      discardRedactedPreviews();
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
    initialSnapshotVersionRef,
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
