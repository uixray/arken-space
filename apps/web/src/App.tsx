import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  GameSnapshot,
  MapPing,
  MessageVisibility,
  StoryPostAdminDto,
  StoryPostDto,
  TokenDto,
} from "@arken/contracts";
import { api, ApiError, reportClientEvent } from "./api";
import { AuthGate } from "./AuthGate";
import { createGameSocket, type GameSocket } from "./realtime";
import { Sidebar } from "./Sidebar";
import { MusicBar } from "./MusicBar";
import { FeedbackReporter } from "./FeedbackReporter";
import { fetchOperatorCapability } from "./operator-feedback";
import { appendChatMessage } from "./chat-state";
import { upsertDirectThread } from "./direct-chat-state";
import { isEditableEventTarget } from "./input-diagnostics";
import { setErrorReportContext } from "./error-report-context";
import {
  addRollToast,
  removeRollToast,
  scheduleRollToastRemoval,
  shouldShowRollToast,
  type RollToast,
} from "./toast-state";
import { notify } from "./ui/notifications";
import { TextPromptDialog } from "./ui/TextPromptDialog";
import { ArkenDialog } from "./ui/ArkenDialog";
import { ErrorState, LoadingState } from "./ui/EntityState";
import { useDismissibleDetails } from "./ui/dismissible-details";
import { normalizeClientDiceResult } from "./dice-result";
import { applyBulkMoveResult } from "./canvas-bulk-move";
import { useMutationRunners } from "./use-mutation-runners";
import { useSceneActions } from "./use-scene-actions";
import { useWorldMapActions } from "./use-world-map-actions";
import { useLatestRef } from "./use-latest-ref";
import { useTokenDefinitionActions } from "./use-token-definition-actions";
import { useChatActions } from "./use-chat-actions";
import { useAccessActions } from "./use-access-actions";
import { useCatalogActions } from "./use-catalog-actions";
import { useStoryActions } from "./use-story-actions";
import { usePlayerRequestActions } from "./use-player-request-actions";
import { useAssetActions } from "./use-asset-actions";
import { CampaignActionsContext } from "./campaign-actions-context";
import type { MapTool } from "./renderers/map-interaction";
import { normalizeWallet } from "./wallet";
import type { RollMode } from "./RollModeControl";
import {
  applyCharacterMutationToSnapshot,
  mergeCharacterMutationResponse,
  reconcileGameSnapshot,
} from "./character-mutation";
import { applyPlayerRequestChanged } from "./player-request-realtime";
import {
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "./sidebar-preference";
import {
  clampSidebarWidth,
  readSidebarWidth,
  writeSidebarWidth,
} from "./sidebar-width-preference";
import {
  EncounterConfirmDialog,
  type EncounterDraft,
} from "./EncounterConfirmDialog";
import { endEncounter } from "./encounter-actions";
import { locationSceneNames } from "./world-map-workspace-state";
import type { CursorPresence } from "./renderers/cursor-presence";
import {
  CURSOR_PREFERENCE_DEFAULT,
  readCursorPreference,
  writeCursorPreference,
} from "./cursor-preference";

const Orthographic2DRenderer = lazy(() =>
  import("./renderers/Orthographic2DRenderer").then((module) => ({
    default: module.Orthographic2DRenderer,
  })),
);

type WorkspaceDestination =
  | "characters"
  | "tokens"
  | "scenes"
  | "setup"
  | "media"
  | "world-maps"
  | "operator-feedback"
  | "player-requests"
  | "world-encyclopedia"
  | "world-codex";

function CanvasHistoryControls({
  sceneId,
  disabled,
  version,
}: {
  sceneId?: string;
  disabled: boolean;
  version: string;
}) {
  const [history, setHistory] = useState<
    Array<{ status: "APPLIED" | "UNDONE" | "INVALIDATED" }>
  >([]);
  const refresh = useCallback(async () => {
    if (!sceneId || disabled) return setHistory([]);
    try {
      setHistory(await api(`/api/canvas/history?sceneId=${sceneId}`));
    } catch {
      setHistory([]);
    }
  }, [sceneId, disabled]);
  useEffect(() => {
    void refresh();
  }, [refresh, version]);
  const canUndo = history.some((item) => item.status === "APPLIED");
  const canRedo = history.some((item) => item.status === "UNDONE");
  const act = useCallback(
    async (direction: "undo" | "redo") => {
      if (!sceneId) return;
      await api(`/api/canvas/${direction}`, {
        method: "POST",
        body: JSON.stringify({ actionId: crypto.randomUUID(), sceneId }),
      });
      await refresh();
    },
    [sceneId, refresh],
  );
  useEffect(() => {
    if (!sceneId || disabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || isEditableEventTarget(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z")
        return;
      event.preventDefault();
      const direction = event.shiftKey ? "redo" : "undo";
      if (direction === "undo" ? canUndo : canRedo)
        void act(direction).catch(() => undefined);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sceneId, disabled, canUndo, canRedo, act]);
  return (
    <>
      <button
        className="map-tool"
        data-tool="UNDO"
        aria-label="Отменить последнее действие"
        title="Отменить последнее действие"
        disabled={disabled || !canUndo}
        onClick={() => void act("undo")}
      >
        <span aria-hidden="true">&#x21b6;</span>
      </button>
      <button
        className="map-tool"
        data-tool="REDO"
        aria-label="Повторить отменённое действие"
        title="Повторить отменённое действие"
        disabled={disabled || !canRedo}
        onClick={() => void act("redo")}
      >
        <span aria-hidden="true">&#x21b7;</span>
      </button>
    </>
  );
}

function GridSettings({
  scene,
  onSave,
  onPreview,
}: {
  scene: import("@arken/contracts").SceneDto;
  onSave: (grid: import("@arken/contracts").SceneDto["grid"]) => Promise<void>;
  onPreview: (grid: import("@arken/contracts").SceneDto["grid"] | null) => void;
}) {
  const [draft, setDraft] = useState(scene.grid);
  const [saving, setSaving] = useState(false);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => setDraft(scene.grid), [scene]);
  const dismissGridSettings = useCallback(() => {
    setDraft(scene.grid);
    onPreview(null);
  }, [onPreview, scene.grid]);
  useDismissibleDetails(settingsRef, dismissGridSettings);
  const resetGrid = () => {
    const next = {
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#c8b78b",
      opacity: 0.22,
    };
    setDraft(next);
    onPreview(next);
  };
  return (
    <details className="grid-settings" ref={settingsRef}>
      <summary
        aria-label="Настройки сетки"
        title="Настройки сетки"
        className="toolbar-detail-trigger"
        data-tool="GRID"
      >
        Сетка
      </summary>
      <div className="grid-settings-popover">
        <label>
          Шаг
          <input
            type="number"
            min="16"
            max="256"
            value={draft.size}
            onChange={(event) => {
              const next = { ...draft, size: Number(event.target.value) };
              setDraft(next);
              onPreview(next);
            }}
          />
        </label>
        <label>
          Сдвиг X
          <input
            type="number"
            value={draft.offsetX}
            onChange={(event) => {
              const next = { ...draft, offsetX: Number(event.target.value) };
              setDraft(next);
              onPreview(next);
            }}
          />
        </label>
        <label>
          Сдвиг Y
          <input
            type="number"
            value={draft.offsetY}
            onChange={(event) => {
              const next = { ...draft, offsetY: Number(event.target.value) };
              setDraft(next);
              onPreview(next);
            }}
          />
        </label>
        <div className="inline-fields">
          <button type="button" onClick={resetGrid}>
            {"Сбросить"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(draft);
                onPreview(null);
                if (settingsRef.current) settingsRef.current.open = false;
              } catch {
                // The shared mutation runner exposes the server error. Keep the
                // draft open so a conflict or validation failure can be fixed
                // and retried instead of looking like a successful reset.
              } finally {
                setSaving(false);
              }
            }}
          >
            Сохранить
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(scene.grid);
              onPreview(null);
              if (settingsRef.current) settingsRef.current.open = false;
            }}
          >
            Отмена
          </button>
        </div>
      </div>
    </details>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // UIX-372: drag-resized sidebar width in px; null keeps the CSS default
  // (--sidebar-width fallback) until the GM/player has customized it.
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const sidebarWidthRef = useRef<number | null>(null);
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);
  const sidebarResizeDragRef = useRef<{
    pointerId: number;
    anchorRight: number;
  } | null>(null);
  const [storyPosts, setStoryPosts] = useState<
    Array<StoryPostDto | StoryPostAdminDto>
  >([]);
  const [storyNextCursor, setStoryNextCursor] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [presence, setPresence] = useState<
    Array<{ membershipId: string; online: boolean }>
  >([]);
  const [connection, setConnection] = useState<
    "CONNECTING" | "ONLINE" | "RECONNECTING" | "RESYNCING" | "OFFLINE"
  >("CONNECTING");
  const [tool, setTool] = useState<MapTool>("PAN");
  // UIX-313: shared brush radius (world units) for the circular fog brush,
  // reused for both FOG_BRUSH and COVER_BRUSH.
  const [fogBrushRadius, setFogBrushRadius] = useState(40);
  // UIX-311 Stage 4: real GM "Начать бой" flow state — replaces the Stage
  // 2/3 temp triggers. `encounterMenuOpen` is the SCENE_REGION/LINKED_SCENE
  // chooser, `encounterScenePickerOpen` is the canvas-context location/scene
  // picker for LINKED_SCENE, and `encounterDraft` is the pending confirm
  // step (set either once the GM commits a SCENE_REGION drag or picks a
  // LINKED_SCENE target) consumed by EncounterConfirmDialog.
  const [encounterMenuOpen, setEncounterMenuOpen] = useState(false);
  const [encounterScenePickerOpen, setEncounterScenePickerOpen] =
    useState(false);
  const [encounterDraft, setEncounterDraft] = useState<EncounterDraft | null>(
    null,
  );
  const [gmFogOpacity, setGmFogOpacity] = useState(() => {
    const stored = Number(localStorage.getItem("arken.gmFogOpacity") ?? 0.35);
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 0.35;
  });
  const [gmFogVisible, setGmFogVisible] = useState(true);
  const [gmGridVisible, setGmGridVisible] = useState(
    () => localStorage.getItem("arken.gmGridVisible") !== "false",
  );
  const [canvasEditMode, setCanvasEditMode] = useState<
    "BACKGROUND" | "WORLD" | null
  >(null);
  // A GM may inspect and prepare another scene without moving the players.
  // The server-side `active` flag remains the broadcast scene.
  const [viewedSceneId, setViewedSceneId] = useState<string | null>(null);
  const [recentlyPublishedSceneId, setRecentlyPublishedSceneId] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (!recentlyPublishedSceneId) return;
    const timeout = window.setTimeout(
      () => setRecentlyPublishedSceneId(null),
      4000,
    );
    return () => window.clearTimeout(timeout);
  }, [recentlyPublishedSceneId]);
  const [gridPreview, setGridPreview] = useState<
    import("@arken/contracts").SceneDto["grid"] | null
  >(null);
  const [pings, setPings] = useState<MapPing[]>([]);
  const [rulers, setRulers] = useState<
    Array<{
      sceneId: string;
      membershipId: string;
      displayName: string;
      points: Array<{ x: number; y: number }>;
      distance: number;
    }>
  >([]);
  // UIX-392: ephemeral cursor presence, keyed by membershipId so a later
  // cursor:moved always replaces a member's previous position instead of
  // accumulating a trail.
  const [cursors, setCursors] = useState<CursorPresence[]>([]);
  const [cursorPreference, setCursorPreference] = useState(
    CURSOR_PREFERENCE_DEFAULT,
  );
  const [previewSnapshot, setPreviewSnapshot] = useState<GameSnapshot | null>(
    null,
  );
  const [error, setError] = useState("");
  const [createSceneOpen, setCreateSceneOpen] = useState(false);
  const [sceneDialogRequest, setSceneDialogRequest] = useState(0);
  const [campaignRenameOpen, setCampaignRenameOpen] = useState(false);
  const [playerHandoffOpen, setPlayerHandoffOpen] = useState(false);
  const [playerHandoffPending, setPlayerHandoffPending] = useState(false);
  const [playerHandoffError, setPlayerHandoffError] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceDestination | null>(null);
  const [operatorFeedbackAllowed, setOperatorFeedbackAllowed] = useState(false);
  const [requestedCharacterId, setRequestedCharacterId] = useState<
    string | null
  >(null);
  const workspaceMenuRef = useRef<HTMLDetailsElement>(null);
  const scenePickerRef = useRef<HTMLDetailsElement>(null);
  const resizeSettingsRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(workspaceMenuRef);
  useDismissibleDetails(scenePickerRef);
  useDismissibleDetails(resizeSettingsRef);

  useEffect(() => {
    if (!snapshot) {
      setOperatorFeedbackAllowed(false);
      return;
    }
    let active = true;
    void fetchOperatorCapability()
      .then(() => {
        if (active) setOperatorFeedbackAllowed(true);
      })
      .catch(() => {
        if (!active) return;
        setOperatorFeedbackAllowed(false);
        setWorkspace((current) =>
          current === "operator-feedback" ? null : current,
        );
      });
    return () => {
      active = false;
    };
  }, [snapshot?.me.id]);

  const handleWorkspaceChange = useCallback(
    (nextWorkspace: WorkspaceDestination | null) => {
      setWorkspace(nextWorkspace);
      if (workspaceMenuRef.current) workspaceMenuRef.current.open = false;
      if (nextWorkspace === null) {
        requestAnimationFrame(() =>
          workspaceMenuRef.current?.querySelector("summary")?.focus(),
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (!error || !snapshot) return;
    notify({
      title: "Не удалось выполнить действие",
      message: error,
      tone: "danger",
    });
    setError("");
  }, [error, snapshot]);
  const chatOpenRef = useRef(false);
  const activeChatThreadIdRef = useRef<string | null>(null);
  const [requestedChatMessageId, setRequestedChatMessageId] = useState<
    string | null
  >(null);
  const [rollToasts, setRollToasts] = useState<RollToast[]>([]);
  const toastAppearanceRef = useRef(0);
  const knownChatMessageIdsRef = useRef(new Set<string>());
  const characterMutationQueuesRef = useRef(
    new Map<
      string,
      Promise<import("@arken/contracts").CharacterDto | undefined>
    >(),
  );
  const handleChatVisibilityChange = useCallback((visible: boolean) => {
    chatOpenRef.current = visible;
    if (visible)
      setRollToasts((current) => (current.length > 0 ? [] : current));
  }, []);
  const sidebarCampaignId = snapshot?.campaign.id;
  const sidebarMembershipId = snapshot?.me.id;
  useEffect(() => {
    if (!sidebarCampaignId || !sidebarMembershipId) return;
    setSidebarCollapsed(
      readSidebarCollapsed(
        window.localStorage,
        sidebarCampaignId,
        sidebarMembershipId,
      ),
    );
  }, [sidebarCampaignId, sidebarMembershipId]);
  const handleSidebarCollapsedChange = useCallback(
    (collapsed: boolean) => {
      setSidebarCollapsed(collapsed);
      if (!snapshot) return;
      writeSidebarCollapsed(
        window.localStorage,
        snapshot.campaign.id,
        snapshot.me.id,
        collapsed,
      );
    },
    [snapshot],
  );
  useEffect(() => {
    if (!sidebarCampaignId || !sidebarMembershipId) return;
    setSidebarWidth(
      readSidebarWidth(
        window.localStorage,
        sidebarCampaignId,
        sidebarMembershipId,
      ),
    );
  }, [sidebarCampaignId, sidebarMembershipId]);
  const handleSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const aside = event.currentTarget.closest<HTMLElement>(".sidebar");
      const rect = aside?.getBoundingClientRect();
      if (!rect) return;
      sidebarResizeDragRef.current = {
        pointerId: event.pointerId,
        anchorRight: rect.right,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [],
  );
  const handleSidebarResizeMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = sidebarResizeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setSidebarWidth(clampSidebarWidth(drag.anchorRight - event.clientX));
      event.preventDefault();
    },
    [],
  );
  const handleSidebarResizeEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = sidebarResizeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      sidebarResizeDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (snapshot && sidebarWidthRef.current != null) {
        writeSidebarWidth(
          window.localStorage,
          snapshot.campaign.id,
          snapshot.me.id,
          sidebarWidthRef.current,
        );
      }
    },
    [snapshot],
  );
  const handleRequestedChatMessage = useCallback(
    () => setRequestedChatMessageId(null),
    [],
  );
  const campaignId = snapshot?.campaign.id;
  useEffect(() => {
    if (!snapshot) return;
    for (const message of snapshot.messages)
      knownChatMessageIdsRef.current.add(message.id);
  }, [snapshot]);
  useEffect(() => {
    if (!campaignId || !snapshot) return;
    setCursorPreference(
      readCursorPreference(window.localStorage, campaignId, snapshot.me.id),
    );
  }, [campaignId, snapshot?.me.id]);
  const toggleCursorPreference = useCallback(() => {
    setCursorPreference((current) => {
      const next = {
        sendEnabled: !current.sendEnabled,
        receiveEnabled: !current.receiveEnabled,
      };
      if (campaignId && snapshot)
        writeCursorPreference(
          window.localStorage,
          campaignId,
          snapshot.me.id,
          next,
        );
      return next;
    });
  }, [campaignId, snapshot]);

  const loadStoryPosts = useCallback(async (cursor?: string) => {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const page = await api<{
      posts: Array<StoryPostDto | StoryPostAdminDto>;
      nextCursor: string | null;
    }>(`/api/story/posts?${query.toString()}`);
    setStoryPosts((current) => {
      if (!cursor) return page.posts;
      const byId = new Map(current.map((post) => [post.id, post]));
      for (const post of page.posts) byId.set(post.id, post);
      return [...byId.values()];
    });
    setStoryNextCursor(page.nextCursor);
  }, []);

  const load = useCallback(async () => {
    try {
      setError("");
      const next = await api<GameSnapshot>("/api/bootstrap");
      setSnapshot(next);
      setAuthRequired(false);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401)
        setAuthRequired(true);
      else
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить кампанию",
        );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!campaignId) {
      setStoryPosts([]);
      setStoryNextCursor(null);
      return;
    }
    void loadStoryPosts().catch((reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить сюжетный канал",
      ),
    );
  }, [campaignId, loadStoryPosts]);
  // UIX-397: global window.error/unhandledrejection handlers are now
  // registered at app start (main.tsx installGlobalErrorReporting), so they
  // capture startup/login/bootstrap failures too. This effect only keeps the
  // non-content state snapshot they read (scene/tool/role/build) current.
  useEffect(() => {
    setErrorReportContext({
      sceneId: snapshot?.scenes.find((scene) => scene.active)?.id,
      tool,
      role: snapshot?.me.role,
      buildRevision: snapshot?.buildRevision,
    });
  }, [snapshot, tool]);
  useEffect(() => {
    if (!campaignId || authRequired) return;
    const next = createGameSocket();
    setSocket(next);
    next.on("connect", () => setConnection("ONLINE"));
    next.on("disconnect", (reason) => {
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
      setCursors((current) => [
        ...current.filter((item) => item.membershipId !== cursor.membershipId),
        cursor,
      ]),
    );
    next.on("cursor:gone", (event) =>
      setCursors((current) =>
        current.filter((item) => item.membershipId !== event.membershipId),
      ),
    );
    next.on("story:changed", () => {
      void loadStoryPosts().catch(() => undefined);
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
      setSocket(null);
      setCursors([]);
    };
  }, [authRequired, campaignId, loadStoryPosts]);

  /*
   * UIX-398 step A0. These four back 45 call sites between them and used to
   * be plain function declarations here — a fresh identity every render, so
   * every handler closing over one was unstable too, and no React.memo below
   * the sidebar could hold. They now live in `use-mutation-runners.ts`, where
   * the identity guarantee is actually testable.
   */
  const {
    run,
    runResult,
    runWorldMapMutation,
    recoverFromCanvasMutation,
  } = useMutationRunners({ load, setError });

  // UIX-398 step A1: the scene domain, now a single stable object instead of
  // six inline arrows rebuilt on every render.
  const sceneActions = useSceneActions({ run, setViewedSceneId });
  const worldMapActions = useWorldMapActions({
    runWorldMapMutation,
    runResult,
  });

  /**
   * UIX-396 stage 1: recovery for the fast spatial entities (token geometry,
   * drawings), where a failure used to trigger `load()` -- a full
   * `/api/bootstrap` rebuild (20 server queries) plus a whole-tree re-render.
   *
   * A 409 here means someone else's write won. That write was already
   * broadcast to this client over the socket, so the authoritative state is
   * either already applied or in flight: refetching everything to learn what
   * we are about to be told anyway is pure cost, and it is most likely to
   * happen exactly when the user is working quickly. So a conflict now only
   * surfaces the message and lets the broadcast converge us.
   *
   * Anything else (5xx, network failure) is still treated as "local state may
   * be arbitrarily wrong" and falls back to the full rebuild.
   */
  const handOffToNextPlayer = async () => {
    const finishHandoff = () => {
      setSocket(null);
      setSnapshot(null);
      setPresence([]);
      setPreviewSnapshot(null);
      setWorkspace(null);
      window.location.replace("/");
    };

    setPlayerHandoffError("");
    setPlayerHandoffPending(true);
    socket?.disconnect();
    try {
      await api("/api/auth/logout", { method: "POST" });
      finishHandoff();
    } catch (reason) {
      try {
        await api("/api/bootstrap");
        socket?.connect();
        setPlayerHandoffError(
          reason instanceof Error
            ? reason.message
            : "Не удалось завершить текущую сессию",
        );
        setPlayerHandoffPending(false);
      } catch (verificationReason) {
        if (
          verificationReason instanceof ApiError &&
          verificationReason.status === 401
        ) {
          finishHandoff();
          return;
        }

        setSocket(null);
        setSnapshot(null);
        setPresence([]);
        setPreviewSnapshot(null);
        setWorkspace(null);
        setError(
          "Не удалось проверить завершение сессии. Данные игрока скрыты; проверьте соединение и обновите страницу.",
        );
      }
    }
  };

  const submitRoll = async (
    formula: string,
    label?: string,
    visibility = "PUBLIC" as MessageVisibility,
    characterId: string | null = null,
    rollMode: RollMode = "NORMAL",
  ) =>
    run(() =>
      api("/api/dice", {
        method: "POST",
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          formula,
          label,
          visibility,
          characterId,
          rollMode,
        }),
      }),
    );

  /*
   * UIX-398 — the character domain is the first that genuinely reads live
   * state: `patchCharacter` needs the current snapshot to resolve a
   * character's base revision. Depending on `snapshot` in a `useCallback`
   * would rebuild these on every game event — a chat message would
   * invalidate them — so they read it through `useLatestRef` instead and keep
   * a fixed identity. Safe here because both are only ever invoked from user
   * events, never during render.
   */
  const snapshotRef = useLatestRef(snapshot);

  const replaceCharacterControllers = useCallback(async (
    characterId: string,
    revision: number,
    controllerMembershipIds: string[],
  ) => {
    try {
      const response = await api<{
        ok: true;
        controllerMembershipIds: string[];
        revision: number;
      }>(`/api/characters/${characterId}/controllers`, {
        method: "PUT",
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          revision,
          controllerMembershipIds,
        }),
      });
      setSnapshot((current) =>
        current
          ? {
              ...current,
              characters: current.characters.map((character) =>
                character.id === characterId &&
                character.revision <= response.revision
                  ? {
                      ...character,
                      controllerMembershipIds: response.controllerMembershipIds,
                      revision: response.revision,
                    }
                  : character,
              ),
            }
          : current,
      );
    } catch (reason) {
      const canonical = await api<GameSnapshot>("/api/bootstrap");
      setSnapshot((current) => reconcileGameSnapshot(current, canonical));
      throw reason;
    }
  }, []);

  const patchCharacter = useCallback((
    id: string,
    patch: Partial<import("@arken/contracts").CharacterDto>,
  ) => {
    const requestedRevision =
      patch.revision ??
      snapshotRef.current?.characters.find((character) => character.id === id)
        ?.revision;
    setSnapshot((current) =>
      current
        ? {
            ...current,
            characters: current.characters.map((character) =>
              character.id === id
                ? {
                    ...character,
                    ...patch,
                    stats: patch.stats
                      ? { ...character.stats, ...patch.stats }
                      : character.stats,
                  }
                : character,
            ),
          }
        : current,
    );
    const previous =
      characterMutationQueuesRef.current.get(id) ?? Promise.resolve(undefined);
    const operation = previous.then(async (previousCharacter) => {
      const { revision: _revision, ...updates } = patch;
      const base =
        previousCharacter ??
        snapshotRef.current?.characters.find(
          (character) => character.id === id,
        );
      if (!base) throw new Error("CHARACTER_NOT_FOUND");
      const response = await api<unknown>(`/api/characters/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...updates,
          actionId: crypto.randomUUID(),
          revision: base.revision ?? requestedRevision,
        }),
      });
      let updated = mergeCharacterMutationResponse(base, response);
      if (!updated) {
        const refreshed = await api<GameSnapshot>("/api/bootstrap");
        setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
        updated =
          refreshed.characters.find((character) => character.id === id) ?? null;
      }
      if (!updated) throw new Error("CHARACTER_NOT_FOUND");
      setSnapshot((current) =>
        applyCharacterMutationToSnapshot(current, updated),
      );
      return updated;
    });
    // Keep the queue tail fulfilled after a failed mutation. Later local edits
    // then rebase on the freshly loaded canonical revision instead of being
    // skipped because an earlier promise rejected.
    const queueTail = operation
      .catch(async (reason) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось сохранить персонажа",
        );
        const canonical = await api<GameSnapshot>("/api/bootstrap");
        setSnapshot(canonical);
        return canonical.characters.find((character) => character.id === id);
      })
      .finally(() => {
        if (characterMutationQueuesRef.current.get(id) === queueTail)
          characterMutationQueuesRef.current.delete(id);
      });
    characterMutationQueuesRef.current.set(id, queueTail);
    return operation
      .then(() => undefined)
      .catch(async (reason) => {
        await queueTail;
        throw reason;
      });
  }, [snapshotRef]);

  const updateCharacterCounters = (
    characterId: string,
    requestedRevision: number,
    patch: {
      wallet?: import("@arken/contracts").CharacterDto["wallet"];
      resources?: import("@arken/contracts").CharacterDto["resources"];
      rest?: "SHORT" | "LONG" | "CATCH_BREATH";
    },
    intent?: {
      walletDelta?: {
        key: keyof import("@arken/contracts").CharacterDto["wallet"];
        delta: number;
      };
    },
  ) => {
    const previous =
      characterMutationQueuesRef.current.get(characterId) ??
      Promise.resolve(
        snapshot?.characters.find((character) => character.id === characterId),
      );
    const operation = previous.then(async (queuedCharacter) => {
      let canonical = queuedCharacter;
      const submit = async (base: import("@arken/contracts").CharacterDto) => {
        const baseWallet = normalizeWallet(base.wallet);
        const nextPatch = intent?.walletDelta
          ? {
              wallet: {
                ...baseWallet,
                [intent.walletDelta.key]: Math.max(
                  0,
                  baseWallet[intent.walletDelta.key] + intent.walletDelta.delta,
                ),
              },
            }
          : patch.wallet
            ? { ...patch, wallet: normalizeWallet(patch.wallet) }
            : patch;
        const response = await api<unknown>(
          `/api/characters/${characterId}/counters`,
          {
            method: "PATCH",
            body: JSON.stringify({
              ...nextPatch,
              actionId: crypto.randomUUID(),
              revision: base.revision,
            }),
          },
        );
        const updated = mergeCharacterMutationResponse(base, response);
        if (updated) return updated;

        // Older servers returned `{ duplicate: true }` for a successfully
        // replayed request. Reconcile the canonical DTO rather than placing
        // that placeholder in React state and tripping the error boundary.
        const refreshed = await api<GameSnapshot>("/api/bootstrap");
        setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
        const replayed = refreshed.characters.find(
          (character) => character.id === characterId,
        );
        if (!replayed)
          throw new Error("Персонаж больше не доступен. Обновите страницу.");
        return replayed;
      };
      if (!canonical) {
        const refreshed = await api<GameSnapshot>("/api/bootstrap");
        setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
        canonical = refreshed.characters.find(
          (character) => character.id === characterId,
        );
      }
      if (!canonical)
        throw new Error("Персонаж больше не доступен. Обновите страницу.");
      try {
        const updated = await submit({
          ...canonical,
          revision: canonical.revision ?? requestedRevision,
        });
        setSnapshot((current) =>
          applyCharacterMutationToSnapshot(current, updated),
        );
        return updated;
      } catch (reason) {
        if (
          !(reason instanceof ApiError) ||
          reason.code !== "CHARACTER_CONFLICT"
        )
          throw reason;
        const refreshed = await api<GameSnapshot>("/api/bootstrap");
        setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
        const freshCharacter = refreshed.characters.find(
          (character) => character.id === characterId,
        );
        if (!freshCharacter || !intent?.walletDelta) throw reason;
        const updated = await submit(freshCharacter);
        setSnapshot((current) =>
          applyCharacterMutationToSnapshot(current, updated),
        );
        return updated;
      }
    });
    const queueTail = operation
      .catch(async () => {
        const refreshed = await api<GameSnapshot>("/api/bootstrap");
        setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
        return refreshed.characters.find(
          (character) => character.id === characterId,
        );
      })
      .finally(() => {
        if (characterMutationQueuesRef.current.get(characterId) === queueTail)
          characterMutationQueuesRef.current.delete(characterId);
      });
    characterMutationQueuesRef.current.set(characterId, queueTail);
    return operation
      .then(() => undefined)
      .catch(async (reason) => {
        await queueTail;
        throw reason;
      });
  };

  const renderedActiveSceneId = (previewSnapshot ?? snapshot)?.scenes.find(
    (scene) => scene.active,
  )?.id;
  useEffect(() => {
    setGridPreview(null);
  }, [renderedActiveSceneId]);

  /*
   * UIX-398: the active scene is derived here, above the auth and loading
   * guards below, rather than alongside the other render derivations.
   *
   * The Rules of Hooks forbid calling a hook after a conditional return, and
   * the remaining action domains (tokens, chat, player access) all need to
   * read the active scene from a stable handler — which means a hook, which
   * means it has to exist before those guards. Deriving it here and reusing
   * the result below keeps a single source of truth rather than computing it
   * twice; it is nullable up here for the same reason `renderedActiveSceneId`
   * above is.
   */
  const activeSceneValue = useMemo(() => {
    const view = previewSnapshot ?? snapshot;
    if (!view) return undefined;
    const broadcast =
      view.scenes.find((scene) => scene.active) ?? view.scenes[0];
    // The GM can look at a scene other than the broadcast one; players always
    // see whatever is being broadcast. `!previewSnapshot` short-circuits
    // first, so reading the role off `view` matches the original behaviour of
    // reading it off `snapshot`.
    return !previewSnapshot && view.me.role === "GM" && viewedSceneId
      ? (view.scenes.find((scene) => scene.id === viewedSceneId) ?? broadcast)
      : broadcast;
  }, [previewSnapshot, snapshot, viewedSceneId]);
  const activeSceneRef = useLatestRef(activeSceneValue);
  const tokenActions = useTokenDefinitionActions({
    run,
    snapshotRef,
    activeSceneRef,
  });
  const accessActions = useAccessActions({ run });
  const catalogActions = useCatalogActions({ run, load, setError });
  const assetActions = useAssetActions({ load });
  const openPlayerRequests = useCallback(
    () => handleWorkspaceChange("player-requests"),
    [handleWorkspaceChange],
  );
  const playerRequestActions = usePlayerRequestActions({
    setSnapshot,
    load,
    openPlayerRequests,
  });
  const storyNextCursorRef = useLatestRef(storyNextCursor);
  const storyActions = useStoryActions({
    loadStoryPosts,
    storyNextCursorRef,
  });
  const chatActions = useChatActions({
    run,
    setSnapshot,
    snapshotRef,
    knownChatMessageIdsRef,
    activeChatThreadIdRef,
  });

  /*
   * UIX-398 step B. Every domain object above is stable, so this one is too —
   * which is what makes delivering them by context safe. Context has no
   * selective subscription, so a value that changed would re-render every
   * consumer on every change; see `campaign-actions-context.tsx`, and the
   * test that rejects any non-function smuggled in here.
   */
  const campaignActions = useMemo(
    () => ({
      scene: sceneActions,
      worldMap: worldMapActions,
      token: tokenActions,
      chat: chatActions,
      access: accessActions,
      catalog: catalogActions,
      story: storyActions,
      playerRequest: playerRequestActions,
      asset: assetActions,
    }),
    [
      sceneActions,
      worldMapActions,
      tokenActions,
      chatActions,
      accessActions,
      catalogActions,
      storyActions,
      playerRequestActions,
      assetActions,
    ],
  );

  if (authRequired) return <AuthGate onAuthenticated={load} />;

  if (!snapshot)
    return (
      <main className="loading">
        <div className="wordmark">arken-space</div>
        {error ? (
          <ErrorState description={error} onRetry={load} />
        ) : (
          <LoadingState label="Загружаем кампанию…" />
        )}
      </main>
    );

  const viewSnapshot = previewSnapshot ?? snapshot;
  const broadcastScene =
    viewSnapshot.scenes.find((scene) => scene.active) ?? viewSnapshot.scenes[0];
  // Derived above the guards so a hook can read it; see `activeSceneValue`.
  const activeScene = activeSceneValue;
  const activeTokens = activeScene
    ? viewSnapshot.tokens.filter((token) => token.sceneId === activeScene.id)
    : [];
  const activeFog = activeScene
    ? viewSnapshot.fogReveals.filter((fog) => fog.sceneId === activeScene.id)
    : [];
  // UIX-311 Stage 4: the campaign has at most one ACTIVE encounter at a
  // time (server-enforced). Its presence drives the "Начать бой" ↔
  // "Завершить бой" toolbar swap.
  const activeEncounter =
    viewSnapshot.encounters?.find((encounter) => encounter.status === "ACTIVE") ??
    null;
  const activeDrawings = activeScene
    ? (viewSnapshot.drawings ?? []).filter(
        (drawing) => drawing.sceneId === activeScene.id,
      )
    : [];
  // UIX-395: undo/redo history only ever depends on the active scene's own
  // canvas content (fog, drawings, token placement/movement) -- not on
  // unrelated campaign events like chat, dice or audio, which used to also
  // bump the campaign-wide snapshotVersion this used to key off, refetching
  // /api/canvas/history on literally every event anywhere in the campaign.
  const activeCanvasVersion = [
    activeFog.length,
    activeFog.reduce((max, fog) => Math.max(max, fog.revision ?? 0), 0),
    activeDrawings.length,
    activeDrawings.reduce((max, drawing) => Math.max(max, drawing.revision), 0),
    activeTokens.length,
    activeTokens.reduce((max, token) => Math.max(max, token.revision), 0),
  ].join(":");

  return (
    <CampaignActionsContext.Provider value={campaignActions}>
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>arken-space</strong>
          {snapshot.me.role === "GM" && !previewSnapshot ? (
            <button
              type="button"
              className="campaign-name-button"
              aria-label="Переименовать кампанию"
              onClick={() => setCampaignRenameOpen(true)}
            >
              {viewSnapshot.campaign.name}
              <span className="campaign-name-button__icon" aria-hidden="true">
                &#x270e;
              </span>
            </button>
          ) : (
            <span>{viewSnapshot.campaign.name}</span>
          )}
        </div>
        <div className="scene-switcher">
          {snapshot.me.role === "GM" && !previewSnapshot ? (
            <details ref={scenePickerRef} className="scene-picker">
              <summary
                aria-label="Выбрать просматриваемую сцену"
                aria-haspopup="listbox"
              >
                {activeScene?.mapAssetId &&
                viewSnapshot.assets.find(
                  (asset) => asset.id === activeScene.mapAssetId,
                ) ? (
                  <img
                    src={
                      viewSnapshot.assets.find(
                        (asset) => asset.id === activeScene.mapAssetId,
                      )!.url
                    }
                    alt=""
                  />
                ) : (
                  <span
                    className="scene-picker__placeholder"
                    aria-hidden="true"
                  />
                )}
                <span>{activeScene?.name ?? "Сцена не выбрана"}</span>
                <span aria-hidden="true">⌄</span>
              </summary>
              <div
                className="scene-picker__menu"
                role="listbox"
                aria-label="Сцены"
              >
                {viewSnapshot.scenes.map((scene) => {
                  const background = viewSnapshot.assets.find(
                    (asset) => asset.id === scene.mapAssetId,
                  );
                  const tokenCount = viewSnapshot.tokens.filter(
                    (token) => token.sceneId === scene.id,
                  ).length;
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      role="option"
                      aria-selected={scene.id === activeScene?.id}
                      onClick={(event) => {
                        setViewedSceneId(scene.id);
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                    >
                      {background ? (
                        <img src={background.url} alt="" />
                      ) : (
                        <span
                          className="scene-picker__placeholder"
                          aria-hidden="true"
                        />
                      )}
                      <span>
                        <strong>{scene.name}</strong>
                        <small>{tokenCount} токенов</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </details>
          ) : (
            <div
              className="scene-picker scene-picker--readonly"
              aria-label="Активная сцена"
            >
              <span>{activeScene?.name ?? "Сцена не выбрана"}</span>
            </div>
          )}
          {!previewSnapshot && snapshot.me.role === "GM" && activeScene && (
            <button
              className="topbar-icon-button publish-scene"
              aria-label={
                activeScene.id === broadcastScene?.id ||
                activeScene.id === recentlyPublishedSceneId
                  ? "Сцена уже показана игрокам"
                  : "Показать выбранную сцену игрокам"
              }
              title={
                activeScene.id === broadcastScene?.id ||
                activeScene.id === recentlyPublishedSceneId
                  ? "Сцена у игроков"
                  : "Показать выбранную сцену игрокам"
              }
              aria-pressed={
                activeScene.id === broadcastScene?.id ||
                activeScene.id === recentlyPublishedSceneId
              }
              onClick={() => {
                void run(async () => {
                  await api("/api/scenes/activate", {
                    method: "POST",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      sceneId: activeScene.id,
                    }),
                  });
                  setRecentlyPublishedSceneId(activeScene.id);
                  notify({
                    title: "Игроки перемещены",
                    message: `Активная сцена: ${activeScene.name}`,
                    tone: "success",
                  });
                });
              }}
            >
              <span aria-hidden="true">
                {activeScene.id === broadcastScene?.id ? "⇥" : "◉"}
              </span>
            </button>
          )}
          {!previewSnapshot && snapshot.me.role === "GM" && (
            <button
              className="topbar-icon-button"
              aria-label="Создать сцену"
              title="Создать новую сцену"
              onClick={() => setSceneDialogRequest((value) => value + 1)}
            >
              <span aria-hidden="true">&#xff0b;</span>
            </button>
          )}
        </div>
        <details ref={workspaceMenuRef} className="workspace-menu">
          <summary aria-label="Открыть рабочее пространство">
            <span>Рабочее пространство</span>
            <span className="workspace-menu__chevron" aria-hidden="true">
              &#x2304;
            </span>
          </summary>
          <div className="workspace-menu__content">
            <button
              type="button"
              onClick={() => handleWorkspaceChange("characters")}
            >
              Персонажи
            </button>
            <button
              type="button"
              onClick={() => handleWorkspaceChange("tokens")}
            >
              Токены
            </button>
            {snapshot.me.role === "GM" ? (
              <>
                <button
                  type="button"
                  onClick={() => handleWorkspaceChange("scenes")}
                >
                  Сцены
                </button>
                <button
                  type="button"
                  onClick={() => handleWorkspaceChange("setup")}
                >
                  Подготовка
                </button>
                <button
                  type="button"
                  onClick={() => handleWorkspaceChange("world-encyclopedia")}
                >
                  Энциклопедия мира
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => handleWorkspaceChange("world-maps")}
            >
              World maps
            </button>
            <button
              type="button"
              onClick={() => handleWorkspaceChange("world-codex")}
            >
              Энциклопедия
            </button>
            <button
              type="button"
              onClick={() => handleWorkspaceChange("player-requests")}
            >
              {snapshot.me.role === "GM" ? "Открытые заявки" : "Мои заявки"}
            </button>
            {operatorFeedbackAllowed && (
              <button
                type="button"
                onClick={() => handleWorkspaceChange("operator-feedback")}
              >
                Operator feedback
              </button>
            )}
            <button
              type="button"
              onClick={() => handleWorkspaceChange("media")}
            >
              Файлы
            </button>
          </div>
        </details>
        <div className="status-line">
          <MusicBar
            audio={snapshot.audio}
            assets={snapshot.assets}
            role={snapshot.me.role}
            socket={socket}
            onUpload={(file) => assetActions.uploadAsset(file, "AUDIO")}
          />
          <details className="account-menu">
            <summary aria-label="Меню сеанса" title="Меню сеанса">
              <span aria-hidden="true">&#x2630;</span>
            </summary>
            <div className="account-menu__content">
              <span
                className={connection === "ONLINE" ? "status online" : "status"}
              >
                {connection === "ONLINE"
                  ? "в сети"
                  : connection === "RESYNCING"
                    ? "синхронизация"
                    : connection === "OFFLINE"
                      ? "нет связи"
                      : "переподключение"}
              </span>
              {connection !== "ONLINE" && (
                <button
                  onClick={() => {
                    setConnection("RESYNCING");
                    socket?.emit("game:resync", snapshot.snapshotVersion);
                  }}
                >
                  Синхронизировать
                </button>
              )}
              <span className="account-menu__identity">
                {previewSnapshot
                  ? `Просмотр: ${viewSnapshot.me.displayName}`
                  : snapshot.me.role === "PLAYER"
                    ? `Вы играете как: ${snapshot.me.displayName}`
                    : `${snapshot.me.displayName} · ${snapshot.me.role}`}
              </span>
              <span
                className="account-menu__build"
                title={`Схема ${snapshot.schemaVersion}, сборка ${snapshot.buildVersion}, Git ${snapshot.buildRevision ?? "unknown"}`}
              >
                v{snapshot.snapshotVersion} ·{" "}
                {(snapshot.buildRevision ?? "unknown").slice(0, 7)}
              </span>
              {!previewSnapshot && (
                <FeedbackReporter
                  buildVersion={snapshot.buildVersion}
                  buildRevision={snapshot.buildRevision}
                  connection={connection}
                />
              )}
              {previewSnapshot && (
                <button onClick={() => setPreviewSnapshot(null)}>
                  Вернуться к мастеру
                </button>
              )}
              {snapshot.me.role === "PLAYER" && !previewSnapshot ? (
                <button onClick={() => setPlayerHandoffOpen(true)}>
                  Сменить игрока
                </button>
              ) : (
                <button
                  onClick={async () => {
                    await api("/api/auth/logout", { method: "POST" });
                    window.location.replace("/");
                  }}
                >
                  Выйти
                </button>
              )}
            </div>
          </details>
        </div>
      </header>
      <ArkenDialog
        open={playerHandoffOpen}
        title="Сменить игрока?"
        applyLabel="Сменить игрока"
        loading={playerHandoffPending}
        error={playerHandoffError}
        onApply={() => void handOffToNextPlayer()}
        onClose={() => {
          if (!playerHandoffPending) {
            setPlayerHandoffError("");
            setPlayerHandoffOpen(false);
          }
        }}
      >
        <p className="arken-dialog-message">
          Завершите текущие действия перед передачей компьютера: несохранённые
          данные в открытых формах будут потеряны. Следующий игрок войдёт по
          своей личной ссылке. На общем экране не открывайте личные заметки или
          сообщения, которые не должны видеть другие игроки.
        </p>
      </ArkenDialog>
      <TextPromptDialog
        open={campaignRenameOpen}
        title="Название кампании"
        label="Название кампании"
        initialValue={snapshot.campaign.name}
        applyLabel="Сохранить"
        onClose={() => setCampaignRenameOpen(false)}
        onApply={async (name) => {
          const updated = await api<GameSnapshot["campaign"]>("/api/campaign", {
            method: "PATCH",
            body: JSON.stringify({
              actionId: crypto.randomUUID(),
              revision: snapshot.campaign.revision,
              name,
            }),
          });
          setSnapshot((current) =>
            current ? { ...current, campaign: updated } : current,
          );
          setCampaignRenameOpen(false);
        }}
      />
      {/*
       * UIX-311 Stage 4: "Начать бой" chooser — SCENE_REGION is only offered
       * here (tactical-canvas context); LINKED_SCENE opens the same
       * location/scene picker used from the world-map workspace.
       */}
      <ArkenDialog
        open={encounterMenuOpen}
        title="Начать бой"
        footer={false}
        onClose={() => setEncounterMenuOpen(false)}
      >
        <div className="encounter-menu">
          <button
            type="button"
            className="primary"
            disabled={!activeScene}
            onClick={() => {
              setEncounterMenuOpen(false);
              setTool("SCENE_REGION");
            }}
          >
            Выделить область текущей сцены
          </button>
          <button
            type="button"
            disabled={!broadcastScene}
            onClick={() => {
              setEncounterMenuOpen(false);
              setEncounterScenePickerOpen(true);
            }}
          >
            Перейти в другую локацию
          </button>
        </div>
      </ArkenDialog>
      <ArkenDialog
        open={encounterScenePickerOpen}
        title="Выбор локации"
        footer={false}
        onClose={() => setEncounterScenePickerOpen(false)}
      >
        <div className="encounter-scene-picker">
          {broadcastScene &&
            (viewSnapshot.worldMaps?.locations ?? [])
              .map((location) => ({
                location,
                scenes: locationSceneNames(location, viewSnapshot.scenes),
              }))
              .filter((entry) => entry.scenes.length > 0)
              .map(({ location, scenes }) => (
                <div
                  key={location.id}
                  className="encounter-scene-picker__group"
                >
                  <strong>{location.name}</strong>
                  {scenes.map((scene) => (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={() => {
                        setEncounterScenePickerOpen(false);
                        setEncounterDraft({
                          mode: "LINKED_SCENE",
                          sourceScene: broadcastScene,
                          targetSceneId: scene.id,
                          targetSceneName: scene.name,
                          locationId: location.id,
                        });
                      }}
                    >
                      {scene.name}
                    </button>
                  ))}
                </div>
              ))}
          {!(viewSnapshot.worldMaps?.locations ?? []).some(
            (location) => location.sceneIds.length > 0,
          ) ? <p>Нет локаций со связанными сценами.</p> : null}
        </div>
      </ArkenDialog>
      <EncounterConfirmDialog
        draft={encounterDraft}
        snapshot={viewSnapshot}
        onClose={() => setEncounterDraft(null)}
        onStarted={() => setEncounterDraft(null)}
      />
      <div
        className={`workbench${
          sidebarCollapsed && !previewSnapshot ? " is-sidebar-collapsed" : ""
        }`}
        style={
          sidebarWidth != null
            ? ({ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties)
            : undefined
        }
      >
        {sidebarCollapsed && !previewSnapshot && (
          <button
            type="button"
            className="sidebar-restore-button"
            aria-controls="activity-sidebar"
            aria-label="Развернуть боковую панель"
            title="Развернуть боковую панель"
            aria-expanded="false"
            onClick={() => handleSidebarCollapsedChange(false)}
          >
            <span aria-hidden="true">&#x2039;</span>
          </button>
        )}
        <main
          className={`map-shell${
            workspace === "characters" ||
            workspace === "setup" ||
            workspace === "world-maps"
              ? " is-workspace-hidden"
              : ""
          }`}
          aria-hidden={
            workspace === "characters" ||
            workspace === "setup" ||
            workspace === "world-maps"
          }
        >
          <div
            className="map-toolbar"
            role="toolbar"
            aria-label="Инструменты карты"
          >
            <div className="toolbar-group">
              <button
                aria-label="Перемещение"
                title="Перемещение по карте (средняя кнопка мыши)"
                className="map-tool"
                data-tool="PAN"
                aria-pressed={tool === "PAN"}
                onClick={() => setTool("PAN")}
              >
                Перемещение
              </button>
              {!previewSnapshot && snapshot.me.role === "GM" && (
                <>
                  <button
                    aria-label="Открыть туман"
                    title="Открыть выбранную область тумана"
                    className="map-tool"
                    data-tool="FOG"
                    aria-pressed={tool === "FOG"}
                    onClick={() => setTool("FOG")}
                  >
                    Открыть туман
                  </button>
                  <button
                    aria-label="Закрыть туман"
                    title="Закрыть выбранную область туманом"
                    className="map-tool"
                    data-tool="COVER"
                    aria-pressed={tool === "COVER"}
                    onClick={() => setTool("COVER")}
                  >
                    Закрыть туман
                  </button>
                  <button
                    aria-label="Открыть туман кистью"
                    title="Открыть туман круглой кистью (клик или протяжка)"
                    className="map-tool"
                    data-tool="FOG_BRUSH"
                    aria-pressed={tool === "FOG_BRUSH"}
                    onClick={() => setTool("FOG_BRUSH")}
                  >
                    Кисть тумана
                  </button>
                  <button
                    aria-label="Закрыть туман кистью"
                    title="Закрыть область круглой кистью тумана"
                    className="map-tool"
                    data-tool="COVER_BRUSH"
                    aria-pressed={tool === "COVER_BRUSH"}
                    onClick={() => setTool("COVER_BRUSH")}
                  >
                    Кисть покрытия
                  </button>
                  {(tool === "FOG_BRUSH" || tool === "COVER_BRUSH") && (
                    <label className="map-tool-text" title="Радиус кисти тумана">
                      Радиус
                      <input
                        type="range"
                        min={8}
                        max={200}
                        step={4}
                        value={fogBrushRadius}
                        onChange={(event) =>
                          setFogBrushRadius(Number(event.target.value))
                        }
                        aria-label="Радиус кисти тумана"
                        style={{ verticalAlign: "middle", margin: "0 6px" }}
                      />
                      {fogBrushRadius}
                    </label>
                  )}
                  <button
                    aria-label="Открыть туман полигоном"
                    title="Открыть туман многоугольником (клик — вершина, Enter/двойной клик — завершить, Esc — отмена)"
                    className="map-tool"
                    data-tool="FOG_POLYGON"
                    aria-pressed={tool === "FOG_POLYGON"}
                    onClick={() => setTool("FOG_POLYGON")}
                  >
                    Полигон тумана
                  </button>
                  <button
                    aria-label="Закрыть туман полигоном"
                    title="Закрыть область многоугольником тумана (клик — вершина, Enter/двойной клик — завершить, Esc — отмена)"
                    className="map-tool"
                    data-tool="COVER_POLYGON"
                    aria-pressed={tool === "COVER_POLYGON"}
                    onClick={() => setTool("COVER_POLYGON")}
                  >
                    Полигон покрытия
                  </button>
                  {/*
                   * UIX-311 Stage 4: real GM "Начать бой" / "Завершить бой"
                   * entry point, replacing the Stage 2/3 temp triggers. Only
                   * one encounter can be ACTIVE at a time (server-enforced),
                   * so the button swaps based on activeEncounter.
                   */}
                  {activeEncounter ? (
                    <button
                      aria-label="Завершить бой"
                      title="Завершить текущий бой"
                      className="map-tool"
                      data-tool="ENCOUNTER_END"
                      onClick={() =>
                        void run(() =>
                          endEncounter(
                            activeEncounter.id,
                            activeEncounter.revision,
                          ),
                        )
                      }
                    >
                      Завершить бой
                    </button>
                  ) : (
                    <button
                      aria-label="Начать бой"
                      title="Начать бой из области сцены или связанной локации"
                      className="map-tool"
                      data-tool="ENCOUNTER_START"
                      disabled={!activeScene}
                      onClick={() => setEncounterMenuOpen(true)}
                    >
                      Начать бой
                    </button>
                  )}
                </>
              )}
              <button
                aria-label="Рисование"
                title="Нарисовать линию на карте"
                className="map-tool"
                data-tool="DRAW"
                aria-pressed={tool === "DRAW"}
                onClick={() => setTool("DRAW")}
              >
                Рисование
              </button>
              <button
                aria-label="Линейка"
                title="Измерить расстояние на карте"
                className="map-tool"
                data-tool="RULER"
                aria-pressed={tool === "RULER"}
                onClick={() => setTool("RULER")}
              >
                Линейка
              </button>
              <button
                aria-label="Пинг"
                title="Показать точку группе"
                className="map-tool"
                data-tool="PING"
                aria-pressed={tool === "PING"}
                onClick={() => setTool("PING")}
              >
                Пинг
              </button>
              <button
                aria-label="Курсоры участников"
                title={
                  cursorPreference.sendEnabled
                    ? "Скрыть курсоры участников (перестать показывать и отправлять свой)"
                    : "Показывать курсоры участников"
                }
                className="map-tool"
                data-tool="CURSOR_PRESENCE"
                aria-pressed={cursorPreference.sendEnabled}
                onClick={toggleCursorPreference}
              >
                Курсоры
              </button>
              {!previewSnapshot && snapshot.me.role === "GM" && activeScene && (
                <>
                  <GridSettings
                    scene={activeScene}
                    onPreview={setGridPreview}
                    onSave={(grid) =>
                      run(
                        () =>
                          api(`/api/scenes/${activeScene.id}/canvas`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              actionId: crypto.randomUUID(),
                              revision: activeScene.revision ?? 0,
                              grid,
                            }),
                          }),
                        true,
                      )
                    }
                  />
                  <details ref={resizeSettingsRef} className="resize-settings">
                    <summary
                      aria-label="Настройки размера карты"
                      title="Настройки размера карты"
                      className="toolbar-detail-trigger"
                      data-tool="RESIZE"
                    >
                      Размер карты
                    </summary>
                    <div className="resize-settings-popover">
                      <button
                        aria-pressed={canvasEditMode === "BACKGROUND"}
                        onClick={() => {
                          setTool("PAN");
                          setCanvasEditMode("BACKGROUND");
                        }}
                      >
                        Изображение
                      </button>
                      <button
                        aria-pressed={canvasEditMode === "WORLD"}
                        onClick={() => {
                          setTool("PAN");
                          setCanvasEditMode("WORLD");
                        }}
                      >
                        Область
                      </button>
                      <button
                        onClick={() => {
                          setCanvasEditMode(null);
                          if (resizeSettingsRef.current) {
                            resizeSettingsRef.current.open = false;
                            resizeSettingsRef.current
                              .querySelector<HTMLElement>("summary")
                              ?.focus();
                          }
                        }}
                      >
                        Готово
                      </button>
                    </div>
                  </details>
                </>
              )}
            </div>
            {!previewSnapshot && (
              <div className="toolbar-history">
                <CanvasHistoryControls
                  sceneId={activeScene?.id}
                  disabled={!activeScene}
                  version={activeCanvasVersion}
                />
              </div>
            )}
            {!previewSnapshot && (
              <details className="toolbar-overflow">
                <summary
                  aria-label="Дополнительные инструменты"
                  title="Дополнительные инструменты карты"
                >
                  •••
                </summary>
                <div className="toolbar-overflow-menu">
                  {snapshot.me.role === "GM" && (
                    <div className="fog-view-controls">
                      <label>
                        <input
                          type="checkbox"
                          checked={gmGridVisible}
                          onChange={(event) => {
                            const visible = event.target.checked;
                            setGmGridVisible(visible);
                            localStorage.setItem(
                              "arken.gmGridVisible",
                              String(visible),
                            );
                          }}
                        />
                        Показывать сетку
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={gmFogVisible}
                          onChange={(event) =>
                            setGmFogVisible(event.target.checked)
                          }
                        />
                        Показывать туман
                      </label>
                      <label>
                        Прозрачность мастера
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={gmFogOpacity}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setGmFogOpacity(value);
                            localStorage.setItem(
                              "arken.gmFogOpacity",
                              String(value),
                            );
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
          {activeScene ? (
            <Suspense
              fallback={<div className="empty-map">Загружаем карту…</div>}
            >
              <Orthographic2DRenderer
                scene={
                  gridPreview
                    ? { ...activeScene, grid: gridPreview }
                    : activeScene
                }
                tokens={activeTokens}
                fogReveals={activeFog}
                drawings={activeDrawings}
                assets={viewSnapshot.assets}
                role={viewSnapshot.me.role}
                onOpenCharacter={(characterId) => {
                  setRequestedCharacterId(null);
                  handleWorkspaceChange("characters");
                  requestAnimationFrame(() =>
                    setRequestedCharacterId(characterId),
                  );
                }}
                membershipId={viewSnapshot.me.id}
                socket={socket}
                tool={tool}
                onToolSelect={setTool}
                pings={pings.filter((ping) => ping.sceneId === activeScene.id)}
                rulers={rulers.filter(
                  (ruler) => ruler.sceneId === activeScene.id,
                )}
                cursors={
                  cursorPreference.receiveEnabled
                    ? cursors.filter(
                        (cursor) => cursor.sceneId === activeScene.id,
                      )
                    : []
                }
                cursorSendEnabled={cursorPreference.sendEnabled}
                gmFogOpacity={gmFogOpacity}
                gmFogVisible={gmFogVisible}
                gmGridVisible={gmGridVisible}
                fogBrushRadius={fogBrushRadius}
                encounters={viewSnapshot.encounters}
                onEncounterRegionSelect={(rect) => {
                  // UIX-311 Stage 4: the committed drag rect opens the real
                  // GM confirm step (EncounterConfirmDialog) instead of
                  // starting combat silently.
                  setTool("PAN");
                  setEncounterDraft({
                    mode: "SCENE_REGION",
                    sourceScene: activeScene,
                    targetSceneId: activeScene.id,
                    targetSceneName: activeScene.name,
                    focusRegion: rect,
                  });
                }}
                canvasEditMode={canvasEditMode}
                onCanvasEditCancel={() => setCanvasEditMode(null)}
                onCanvasPatch={(patch) =>
                  run(() =>
                    api(`/api/scenes/${activeScene.id}/canvas`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        revision: activeScene.revision ?? 0,
                        ...patch,
                      }),
                    }),
                  )
                }
                onFogCreate={async (payload) => {
                  const isCover =
                    tool === "COVER" ||
                    tool === "COVER_BRUSH" ||
                    tool === "COVER_POLYGON";
                  await run(() =>
                    api("/api/fog-reveals", {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        sceneId: activeScene.id,
                        operation: isCover ? "COVER" : "REVEAL",
                        ...payload,
                      }),
                    }),
                  );
                }}
                onDrawingCreate={async (drawing) => {
                  let created:
                    import("@arken/contracts").DrawingDto | undefined;
                  await run(async () => {
                    created = await api<import("@arken/contracts").DrawingDto>(
                      "/api/drawings",
                      {
                        method: "POST",
                        body: JSON.stringify({
                          actionId: crypto.randomUUID(),
                          sceneId: activeScene.id,
                          ...drawing,
                        }),
                      },
                    );
                  });
                  if (created) {
                    const reconciled = created;
                    setSnapshot((current) => {
                      if (!current) return current;
                      const drawings = current.drawings ?? [];
                      if (drawings.some((item) => item.id === reconciled.id))
                        return current;
                      return {
                        ...current,
                        drawings: [...drawings, reconciled],
                      };
                    });
                  }
                  return created;
                }}
                onPing={(point) => {
                  socket?.emit(
                    "map:ping",
                    {
                      sceneId: activeScene.id,
                      ...point,
                    },
                    (result) => {
                      if (!result.ok && result.reason === "NO_VISIBLE_PLAYERS")
                        notify({
                          title:
                            "На карте нет игроков, которые могут это увидеть",
                          tone: "info",
                        });
                    },
                  );
                }}
                onPlaceTokenDefinition={async (definitionId, point) =>
                  run(() =>
                    api(`/api/token-definitions/${definitionId}/placements`, {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        definitionId,
                        sceneId: activeScene.id,
                        ...point,
                      }),
                    }),
                  )
                }
                onTokenLayerChange={(tokenId, revision, layer) =>
                  run(() =>
                    api(`/api/tokens/${tokenId}/layer`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        revision,
                        layer,
                      }),
                    }),
                  )
                }
                onTokenDelete={(tokenId, revision) =>
                  run(() =>
                    api(`/api/tokens/${tokenId}`, {
                      method: "DELETE",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        revision,
                      }),
                    }),
                  )
                }
                onTokenResize={async (tokenId, revision, size) => {
                  const actionId = crypto.randomUUID();
                  try {
                    const updated = await runResult(() =>
                      api<TokenDto>(`/api/tokens/${tokenId}/size`, {
                        method: "PATCH",
                        headers: { "x-action-id": actionId },
                        body: JSON.stringify({
                          actionId,
                          revision,
                          ...size,
                        }),
                      }),
                    );
                    setSnapshot((current) =>
                      current
                        ? {
                            ...current,
                            tokens: current.tokens.map((token) =>
                              token.id === updated.id ? updated : token,
                            ),
                          }
                        : current,
                    );
                  } catch (reason) {
                    await recoverFromCanvasMutation(reason);
                    throw reason;
                  }
                }}
                onTokenAppearanceChange={(tokenId, revision, appearance) =>
                  run(() =>
                    api(`/api/tokens/${tokenId}/appearance`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        revision,
                        ...appearance,
                      }),
                    }),
                  )
                }
                onDrawingUpdate={async (drawingId, revision, patch) => {
                  try {
                    const updated = await runResult(() =>
                      api<import("@arken/contracts").DrawingDto>(
                        `/api/drawings/${drawingId}`,
                        {
                          method: "PATCH",
                          body: JSON.stringify({
                            actionId: crypto.randomUUID(),
                            revision,
                            ...patch,
                          }),
                        },
                      ),
                    );
                    // Apply the PATCH response (with its new revision)
                    // directly rather than waiting for the broadcast
                    // snapshot round-trip: on a slow network the broadcast
                    // can lag behind the next debounced edit, which would
                    // otherwise keep reading a stale revision and 409 on
                    // every subsequent request.
                    setSnapshot((current) =>
                      current
                        ? {
                            ...current,
                            drawings: (current.drawings ?? []).map((item) =>
                              item.id === updated.id ? updated : item,
                            ),
                          }
                        : current,
                    );
                  } catch (reason) {
                    // This used to rebuild everything on 409 and stay silent
                    // on every other failure -- backwards on both counts. A
                    // conflict is the one case the broadcast already corrects,
                    // while a 5xx or a dropped connection is what actually
                    // leaves local state untrustworthy, and swallowing it left
                    // the user's edit silently discarded.
                    await recoverFromCanvasMutation(reason);
                    throw reason;
                  }
                }}
                onDrawingDelete={(drawingId, revision) =>
                  run(() =>
                    api(`/api/drawings/${drawingId}`, {
                      method: "DELETE",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        revision,
                      }),
                    }),
                  )
                }
                onDrawingCopy={(drawingId, revision) =>
                  run(() =>
                    api(`/api/drawings/${drawingId}/copy`, {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        revision,
                      }),
                    }),
                  )
                }
                onBulkMove={async (targets, delta) => {
                  const acknowledgement = await runResult(() =>
                    api<{
                      revisions: {
                        tokens: Record<string, number>;
                        drawings: Record<string, number>;
                      };
                    }>("/api/canvas/bulk", {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        sceneId: activeScene.id,
                        operation: "MOVE",
                        deltaX: delta.x,
                        deltaY: delta.y,
                        targets,
                      }),
                    }),
                  );
                  // UIX-396 stage 2: the response carries the new revision for
                  // every moved entity and used to be thrown away, so a second
                  // drag before the broadcast landed still sent the superseded
                  // one and was rejected with a 409 -- losing the move on the
                  // app's most frequent action. See canvas-bulk-move.ts.
                  const revisions = acknowledgement?.revisions;
                  setSnapshot((current) =>
                    current
                      ? {
                          ...current,
                          tokens: applyBulkMoveResult(
                            current.tokens,
                            revisions?.tokens,
                            delta,
                          ) as GameSnapshot["tokens"],
                          drawings: applyBulkMoveResult(
                            current.drawings ?? [],
                            revisions?.drawings,
                            delta,
                          ) as GameSnapshot["drawings"],
                        }
                      : current,
                  );
                  return acknowledgement;
                }}
                onBulkDelete={(selection) =>
                  run(() =>
                    api("/api/canvas/bulk", {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        sceneId: activeScene.id,
                        operation: "DELETE",
                        targets: [
                          ...selection.tokenIds.flatMap((id) => {
                            const token = activeTokens.find(
                              (item) => item.id === id,
                            );
                            return token
                              ? [
                                  {
                                    targetType: "TOKEN" as const,
                                    targetId: id,
                                    revision: token.revision,
                                  },
                                ]
                              : [];
                          }),
                          ...selection.drawingIds.flatMap((id) => {
                            const drawing = activeDrawings.find(
                              (item) => item.id === id,
                            );
                            return drawing
                              ? [
                                  {
                                    targetType: "DRAWING" as const,
                                    targetId: id,
                                    revision: drawing.revision,
                                  },
                                ]
                              : [];
                          }),
                        ],
                      }),
                    }),
                  )
                }
              />
            </Suspense>
          ) : (
            <div className="empty-map">Мастер ещё не создал сцену.</div>
          )}
          {rollToasts.length > 0 && (
            <div className="roll-toast-stack" aria-live="polite">
              {rollToasts.map(({ message, appearanceId }) => (
                <div
                  className="roll-toast"
                  key={`${message.id}-${appearanceId}`}
                >
                  <button
                    className="roll-toast-open"
                    onClick={() => {
                      handleSidebarCollapsedChange(false);
                      setRequestedChatMessageId(message.id);
                      setRollToasts((current) =>
                        removeRollToast(current, message.id),
                      );
                    }}
                  >
                    <strong>
                      {message.displayName}: {message.body}
                    </strong>
                    <span>
                      {normalizeClientDiceResult(message.dice)?.total ?? "—"}
                    </span>
                  </button>
                  <button
                    className="roll-toast-close"
                    aria-label="Закрыть уведомление"
                    onClick={() =>
                      setRollToasts((current) =>
                        removeRollToast(current, message.id),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {!previewSnapshot && (
            <details className="token-tray">
              <summary>
                Токены · {snapshot.tokenDefinitions?.length ?? 0}
              </summary>
              <div className="token-tray-list">
                {(snapshot.tokenDefinitions?.length ?? 0) === 0 && (
                  <p className="muted">
                    {snapshot.me.role === "GM"
                      ? "Создайте токен персонажа в подготовке."
                      : "Мастер ещё не назначил вам доступные токены."}
                  </p>
                )}
                {(snapshot.tokenDefinitions ?? []).map((definition) => {
                  const asset = snapshot.assets.find(
                    (item) => item.id === definition.defaultAssetId,
                  );
                  return (
                    <button
                      key={definition.id}
                      draggable
                      onDragStart={(event) =>
                        event.dataTransfer.setData(
                          "application/x-arken-token-definition",
                          definition.id,
                        )
                      }
                      onClick={() =>
                        activeScene &&
                        void run(() =>
                          api(
                            `/api/token-definitions/${definition.id}/placements`,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                actionId: crypto.randomUUID(),
                                definitionId: definition.id,
                                sceneId: activeScene.id,
                              }),
                            },
                          ),
                        )
                      }
                    >
                      {asset ? (
                        <img src={asset.url} alt="" />
                      ) : (
                        <span>{definition.name.slice(0, 2).toUpperCase()}</span>
                      )}
                      <strong>{definition.name}</strong>
                    </button>
                  );
                })}
              </div>
            </details>
          )}
        </main>
        {previewSnapshot ? (
          <aside className="sidebar">
            <div className="panel-scroll">
              <section className="panel-section">
                <span className="eyebrow">Режим мастера</span>
                <h2>Глазами игрока</h2>
                <p>
                  Сейчас показаны только активная сцена, видимые токены и файлы,
                  доступные игроку {viewSnapshot.me.displayName}.
                </p>
                <button onClick={() => setPreviewSnapshot(null)}>
                  Завершить просмотр
                </button>
              </section>
            </div>
          </aside>
        ) : (
          <Sidebar
            snapshot={snapshot}
            requestedCharacterId={requestedCharacterId}
            socket={socket}
            presence={presence}
            requestedChatMessageId={requestedChatMessageId}
            onRequestedChatMessageHandled={handleRequestedChatMessage}
            onChatVisibilityChange={handleChatVisibilityChange}
            collapsed={sidebarCollapsed}
            onCollapsedChange={handleSidebarCollapsedChange}
            onResizeHandleDown={handleSidebarResizeStart}
            onResizeHandleMove={handleSidebarResizeMove}
            onResizeHandleUp={handleSidebarResizeEnd}
            workspace={workspace}
            operatorFeedbackAllowed={operatorFeedbackAllowed}
            onWorkspaceChange={handleWorkspaceChange}
            onPlaceTokenDefinition={tokenActions.onPlaceTokenDefinition}
            onDeleteTokenDefinition={tokenActions.onDeleteTokenDefinition}
            onPatchTokenDefinition={tokenActions.onPatchTokenDefinition}
            onCreateTokenDefinition={tokenActions.onCreateTokenDefinition}
            onReplaceTokenControllers={tokenActions.onReplaceTokenControllers}
            onPatchCharacter={patchCharacter}
            onReplaceCharacterControllers={replaceCharacterControllers}
            storyPosts={storyPosts}
            storyNextCursor={storyNextCursor}
            onChat={chatActions.onChat}
            onSticker={chatActions.onSticker}
            onCreateDirectThread={chatActions.onCreateDirectThread}
            onDirectChat={chatActions.onDirectChat}
            onUploadChatAttachment={chatActions.onUploadChatAttachment}
            onActiveChatThreadChange={chatActions.onActiveChatThreadChange}
            onMarkChatRead={chatActions.onMarkChatRead}
            onRoll={submitRoll}
            onCreateCharacter={async (name, template) =>
              run(
                () =>
                  api("/api/characters", {
                    method: "POST",
                    body: JSON.stringify({
                      name,
                      actionId: crypto.randomUUID(),
                      ...(template ? { template } : {}),
                    }),
                  }),
                true,
              )
            }
            onCreateInvite={accessActions.onCreateInvite}
            onListPlayerAccess={accessActions.onListPlayerAccess}
            onRotatePlayerAccess={accessActions.onRotatePlayerAccess}
            onRevokePlayerAccess={accessActions.onRevokePlayerAccess}
            sceneDialogRequest={sceneDialogRequest}
            viewedSceneId={activeScene?.id ?? null}
            onRenameMembership={accessActions.onRenameMembership}
            onCreateToken={tokenActions.onCreateToken}
            onUpload={assetActions.uploadAsset}
            onGenerateTokenImage={assetActions.generateTokenImage}
            onPreviewPlayer={async (membershipId) => {
              const playerView = await api<GameSnapshot>(
                `/api/preview/${membershipId}`,
              );
              setTool("PAN");
              setPreviewSnapshot(playerView);
            }}
            onCreateCatalogEntry={catalogActions.onCreateCatalogEntry}
            onUpdateCatalogEntry={catalogActions.onUpdateCatalogEntry}
            onDeleteCatalogEntry={catalogActions.onDeleteCatalogEntry}
            onAssignCatalogEntry={catalogActions.onAssignCatalogEntry}
            onUpdateCharacterEntry={catalogActions.onUpdateCharacterEntry}
            onDeleteCharacterEntry={catalogActions.onDeleteCharacterEntry}
            onRollEntry={catalogActions.onRollEntry}
            onRechargeEntry={catalogActions.onRechargeEntry}
            onUpdateCounters={updateCharacterCounters}
            onCampaignClock={(command, revision) =>
              run(
                () =>
                  api("/api/campaign/clock", {
                    method: "POST",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      command,
                      revision,
                    }),
                  }),
                true,
              )
            }
          />
        )}
      </div>
      <TextPromptDialog
        open={createSceneOpen}
        title="Новая сцена"
        label="Название сцены"
        applyLabel="Создать"
        onClose={() => setCreateSceneOpen(false)}
        onApply={async (name) => {
          await run(async () => {
            const scene = await api<import("@arken/contracts").SceneDto>(
              "/api/scenes",
              {
                method: "POST",
                body: JSON.stringify({
                  actionId: crypto.randomUUID(),
                  name,
                }),
              },
            );
            setViewedSceneId(scene.id);
          }, true);
          setCreateSceneOpen(false);
        }}
      />
    </div>
    </CampaignActionsContext.Provider>
  );
}
