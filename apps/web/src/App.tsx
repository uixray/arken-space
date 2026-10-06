import { DiceTrayPanel } from "./sidebar/DiceTrayPanel";
import { RollVisibilityContext } from "./roll-visibility-context";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type {
  GameSnapshot,
  MapPing,
  MessageVisibility,
  PersonalThemeDto,
  StoryPostAdminDto,
  StoryPostDto,
  TokenDto,
} from "@arken/contracts";
import { api, ApiError } from "./api";
import { mergeTokenPlacementUpdate } from "./token-projection";
import { AuthGate } from "./AuthGate";
import { useGameSocketSubscriptions } from "./use-game-socket-subscriptions";
import { Sidebar } from "./Sidebar";
import { AppHeader } from "./AppHeader";
import {
  focusWorkspaceReturnTarget,
  workspaceReturnTarget,
} from "./WorkspaceNav";
import { MusicBar } from "./MusicBar";
import { AppModals } from "./AppModals";
import { TokenTray } from "./TokenTray";
import { CompactMenuSurface } from "./ui/CompactMenuSurface";
import { fetchOperatorCapability } from "./operator-feedback";
import { setErrorReportContext } from "./error-report-context";
import { removeRollToast, type RollToast } from "./toast-state";
import { notify } from "./ui/notifications";
import { ErrorState, LoadingState } from "./ui/EntityState";
import { AppIcon } from "./ui/AppIcon";
import { CloseIcon, SidebarExpandIcon } from "./ui/icons";
import { canvasHistoryVersion } from "./canvas-history-label";
import { normalizeClientDiceResult } from "./dice-result";
import {
  acknowledgeBulkMoveIntent,
  appendBulkMoveIntent,
  projectBulkMoveIntents,
  reconcileBulkMoveIntents,
  rejectBulkMoveIntent,
  retainBulkMoveIntentsForScene,
  type CanvasBulkMoveIntent,
} from "./canvas-bulk-move";
import { useMutationRunners } from "./use-mutation-runners";
import { useSceneActions } from "./use-scene-actions";
import { useWorldMapActions } from "./use-world-map-actions";
import { useLatestRef } from "./use-latest-ref";
import { useTokenDefinitionActions } from "./use-token-definition-actions";
import { OptimisticTokenMutations } from "./optimistic-token-mutations";
import {
  createOptimisticTokenPlacer,
  type OptimisticTokenPlacer,
} from "./optimistic-token-placement";
import { useChatActions } from "./use-chat-actions";
import { useAccessActions } from "./use-access-actions";
import { useCatalogActions } from "./use-catalog-actions";
import { useStatLayoutActions } from "./use-stat-layout-actions";
import { useInitiativeActions } from "./use-initiative-actions";
import { CompactNavigation } from "./CompactNavigation";
import {
  useCompactNavigation,
  type CompactSurface,
} from "./ui/useCompactNavigation";
import { MapToolbar } from "./MapToolbar";
import { GamePauseOverlay } from "./GamePauseOverlay";
import { useChatHistoryActions } from "./use-chat-history-actions";
import { useStoryActions } from "./use-story-actions";
import { usePlayerRequestActions } from "./use-player-request-actions";
import { useAssetActions } from "./use-asset-actions";
import { CampaignActionsContext } from "./campaign-actions-context";
import type { MapTool } from "./renderers/map-interaction";
import {
  buildCharacterCounterPatch,
  isCharacterCounterPatchNoop,
  shouldRetryCharacterCounterConflict,
  type CharacterCounterMutationIntent,
  type CharacterCounterPatch,
} from "./character-counter-mutation";
import type { RollMode } from "./RollModeControl";
import {
  applyCharacterMutationToSnapshot,
  mergeCharacterMutationResponse,
  reconcileGameSnapshot,
} from "./character-mutation";
import {
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "./sidebar-preference";
import { useSidebarResize } from "./use-sidebar-resize";
import type { CursorPresence } from "./renderers/cursor-presence";
import {
  CURSOR_PREFERENCE_DEFAULT,
  type CursorPreference,
  readCursorPreference,
  writeCursorPreference,
} from "./cursor-preference";
import { usePlayerThemeRuntime } from "./design-system/player-theme-runtime-context";
import { usePlayerThemePreference } from "./design-system/usePlayerThemePreference";
import { patchPersonalThemePreference } from "./design-system/personal-theme-api";
const Orthographic2DRenderer = lazy(() =>
  import("./renderers/Orthographic2DRenderer").then((module) => ({
    default: module.Orthographic2DRenderer,
  })),
);

type WorkspaceDestination =
  | "characters"
  | "story"
  | "tokens"
  | "scenes"
  | "setup"
  | "media"
  | "world-maps"
  | "operator-feedback"
  | "player-requests"
  | "world-encyclopedia"
  | "world-codex";

function replacePersonalTheme(
  snapshot: GameSnapshot,
  personalTheme: PersonalThemeDto,
): GameSnapshot {
  return { ...snapshot, personalTheme };
}

export function App() {
  const { setThemeId: setRootThemeId } = usePlayerThemeRuntime();
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const personalTheme = snapshot?.personalTheme;
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false);
  const publishedThemeIds = useMemo(
    () => personalTheme?.publishedThemes.map(({ id }) => id) ?? [],
    [personalTheme?.publishedThemes],
  );
  const saveThemePreference = useCallback(
    async (
      selectedThemeId: string | null,
      { signal }: { signal: AbortSignal },
    ) => {
      const source = snapshot?.personalTheme;
      if (!source) throw new Error("Настройки темы недоступны.");
      try {
        const updated = await patchPersonalThemePreference({
          source,
          selectedThemeId,
          signal,
        });
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        setSnapshot((current) => {
          const existing = current?.personalTheme;
          if (
            !current ||
            existing?.scopeKey !== source.scopeKey ||
            (existing.revision ?? -1) > updated.revision
          )
            return current;
          return replacePersonalTheme(current, updated);
        });
        return updated;
      } catch (reason) {
        const conflict =
          reason instanceof ApiError &&
          reason.status === 409 &&
          reason.code === "THEME_PREFERENCE_CONFLICT"
            ? (reason.details?.personalTheme as PersonalThemeDto | undefined)
            : undefined;
        if (!signal.aborted && conflict?.scopeKey === source.scopeKey) {
          setSnapshot((current) => {
            const existing = current?.personalTheme;
            if (
              !current ||
              existing?.scopeKey !== source.scopeKey ||
              (existing.revision ?? -1) > conflict.revision
            )
              return current;
            return replacePersonalTheme(current, conflict);
          });
          throw new Error(
            "Настройка темы изменилась в другом окне. Проверьте актуальный выбор.",
            { cause: reason },
          );
        }
        throw reason;
      }
    },
    [snapshot],
  );
  const themePreference = usePlayerThemePreference({
    scopeKey: personalTheme?.scopeKey ?? null,
    preference: personalTheme ?? {
      selectedThemeId: null,
      defaultThemeId: null,
      revision: 0,
    },
    publishedThemeIds,
    save: saveThemePreference,
  });
  useLayoutEffect(() => {
    setRootThemeId(themePreference.selection);
  }, [setRootThemeId, themePreference.selection]);
  useLayoutEffect(() => {
    setThemeSettingsOpen(false);
  }, [personalTheme?.scopeKey]);
  useEffect(
    () => () => {
      setRootThemeId(null);
    },
    [setRootThemeId],
  );
  const [bulkMoveIntents, setBulkMoveIntents] = useState<
    readonly CanvasBulkMoveIntent[]
  >([]);
  useEffect(() => {
    setBulkMoveIntents((current) =>
      snapshot
        ? reconcileBulkMoveIntents(
            current,
            snapshot.tokens,
            snapshot.drawings ?? [],
          )
        : [],
    );
  }, [snapshot]);
  const [mapRollVisibility, setMapRollVisibility] =
    useState<import("@arken/contracts").MessageVisibility>("PUBLIC");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [storyPosts, setStoryPosts] = useState<
    Array<StoryPostDto | StoryPostAdminDto>
  >([]);
  const [storyNextCursor, setStoryNextCursor] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [presence, setPresence] = useState<
    Array<{ membershipId: string; online: boolean }>
  >([]);
  const [tool, setTool] = useState<MapTool>("PAN");
  // UIX-313: shared brush radius (world units) for the circular fog brush,
  // reused for both FOG_BRUSH and COVER_BRUSH.
  const [fogBrushRadius, setFogBrushRadius] = useState(40);
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
  const [sceneDialogRequest, setSceneDialogRequest] = useState(0);
  const [requestedSceneEditId, setRequestedSceneEditId] = useState<
    string | null
  >(null);
  const [campaignRenameOpen, setCampaignRenameOpen] = useState(false);
  const [playerHandoffOpen, setPlayerHandoffOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [playerHandoffPending, setPlayerHandoffPending] = useState(false);
  const [playerHandoffError, setPlayerHandoffError] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceDestination | null>(null);
  const [mapObjectsOpen, setMapObjectsOpen] = useState(false);
  const compactIdentity = snapshot
    ? `${snapshot.campaign.id}:${snapshot.me.id}:${snapshot.me.role}:${previewSnapshot?.me.id ?? ""}`
    : null;
  const compactNavigation = useCompactNavigation(compactIdentity, workspace);
  const {
    compact,
    surface: compactSurface,
    selectSurface,
    previousSurface,
  } = compactNavigation;
  const compactNavigationRef = useLatestRef({
    compact,
    selectSurface,
    previousSurface,
  });
  const [compactSectionsOpen, setCompactSectionsOpen] = useState(false);
  const [headerMusicTarget, setHeaderMusicTarget] =
    useState<HTMLElement | null>(null);
  const [menuMusicTarget, setMenuMusicTarget] = useState<HTMLElement | null>(
    null,
  );
  useEffect(() => {
    setWorkspace(null);
    setCompactSectionsOpen(false);
  }, [compactIdentity]);
  useEffect(() => {
    // The compact trigger disappears on desktop. Discard its open state so
    // returning to a narrow viewport cannot revive a modal over the map.
    if (!compact) setCompactSectionsOpen(false);
  }, [compact]);
  const selectCompactSurface = useCallback(
    (surface: CompactSurface) => {
      selectSurface(surface);
      setWorkspace(surface === "character" ? "characters" : null);
    },
    [selectSurface],
  );
  const [operatorFeedbackAllowed, setOperatorFeedbackAllowed] = useState(false);
  const [requestedCharacterId, setRequestedCharacterId] = useState<
    string | null
  >(null);
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
      const returnTarget =
        nextWorkspace === null ? workspaceReturnTarget() : null;
      const { compact, selectSurface, previousSurface } =
        compactNavigationRef.current;
      if (compact) {
        selectSurface(
          nextWorkspace === "characters"
            ? "character"
            : nextWorkspace
              ? "journal"
              : previousSurface,
          !nextWorkspace || nextWorkspace === "characters",
        );
      }
      setWorkspace(nextWorkspace);
      if (nextWorkspace === null && !compact)
        requestAnimationFrame(() => focusWorkspaceReturnTarget(returnTarget));
    },
    [compactNavigationRef],
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
  const {
    sidebarWidth,
    handleSidebarResizeStart,
    handleSidebarResizeMove,
    handleSidebarResizeEnd,
  } = useSidebarResize(sidebarCampaignId, sidebarMembershipId);
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
      readCursorPreference(
        window.localStorage,
        campaignId,
        snapshot.me.id,
        snapshot.me.role === "GM" ? "GM" : "PLAYER",
      ),
    );
  }, [campaignId, snapshot?.me.id]);
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

  const { socket, setSocket, connection, setConnection } =
    useGameSocketSubscriptions({
      campaignId: campaignId ?? null,
      authRequired,
      ownMembershipId: snapshot?.me.id,
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
    });

  const updateCursorPreference = useCallback(
    (next: CursorPreference) => {
      setCursorPreference((current) => {
        // Turning broadcasting off has to retract the last position, not just
        // stop sending new ones: otherwise the cursor freezes where it was and
        // stays on everyone's screen — for a GM, on exactly the spot they
        // decided to stop showing.
        if (current.sendEnabled && !next.sendEnabled)
          socket?.emit("cursor:gone");
        if (campaignId && snapshot)
          writeCursorPreference(
            window.localStorage,
            campaignId,
            snapshot.me.id,
            next,
          );
        return next;
      });
    },
    [campaignId, snapshot, socket],
  );

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

  /*
   * UIX-398 step A0. These four back 45 call sites between them and used to
   * be plain function declarations here — a fresh identity every render, so
   * every handler closing over one was unstable too, and no React.memo below
   * the sidebar could hold. They now live in `use-mutation-runners.ts`, where
   * the identity guarantee is actually testable.
   */
  const { run, runResult, runWorldMapMutation, recoverFromCanvasMutation } =
    useMutationRunners({ load, setError });
  const toggleCampaignPause = () => {
    if (!snapshot) return Promise.resolve();
    return runWorldMapMutation(() =>
      api("/api/campaign/pause", {
        method: "POST",
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          revision: snapshot.campaign.revision,
          paused: !snapshot.campaign.paused,
        }),
      }),
    );
  };

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
  const [tokenMutations] = useState(
    // The constructor only stores callbacks; readToken runs on user mutations,
    // never during construction/render. Keep one coordinator across renders.
    // eslint-disable-next-line react-hooks/refs
    () =>
      new OptimisticTokenMutations({
        readToken: (id) =>
          snapshotRef.current?.tokens.find((token) => token.id === id),
        acceptToken: (updated) =>
          setSnapshot((current) => {
            if (
              !current ||
              !current.scenes.some((scene) => scene.id === updated.sceneId)
            )
              return current;
            const existing = current.tokens.find(
              (token) => token.id === updated.id,
            );
            if (existing && existing.revision > updated.revision)
              return current;
            return {
              ...current,
              tokens: existing
                ? current.tokens.map((token) =>
                    token.id === updated.id ? updated : token,
                  )
                : [...current.tokens, updated],
            };
          }),
        sendConditions: (token, conditions) =>
          api(`/api/tokens/${token.id}/conditions`, {
            method: "PATCH",
            body: JSON.stringify({
              actionId: crypto.randomUUID(),
              revision: token.revision,
              conditions,
            }),
          }),
        reloadToken: async (id) =>
          (await api<GameSnapshot>("/api/bootstrap")).tokens.find(
            (token) => token.id === id,
          ),
        onError: (reason) =>
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось сохранить токен",
          ),
      }),
  );
  const tokenMutationVersion = useSyncExternalStore(
    tokenMutations.subscribe,
    tokenMutations.getVersion,
  );
  useEffect(() => {
    tokenMutations.reset();
    return () => tokenMutations.reset();
  }, [tokenMutations, snapshot?.campaign.id, snapshot?.me.id]);
  const placeOptimistically = useCallback<OptimisticTokenPlacer>(
    (request, options) =>
      createOptimisticTokenPlacer({
        readSnapshot: () => snapshotRef.current,
        tokenMutations,
        clearError: () => setError(""),
      })(request, options),
    [snapshotRef, tokenMutations],
  );

  const replaceCharacterControllers = useCallback(
    async (
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
                        controllerMembershipIds:
                          response.controllerMembershipIds,
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
    },
    [],
  );

  const patchCharacter = useCallback(
    (id: string, patch: Partial<import("@arken/contracts").CharacterDto>) => {
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
      const previousQueue = characterMutationQueuesRef.current.get(id);
      const previous = previousQueue ?? Promise.resolve(undefined);
      const operation = previous.then(async (previousCharacter) => {
        const { revision: _revision, ...updates } = patch;
        // An existing tail resolving undefined confirms canonical absence;
        // only a new queue may read the current snapshot as its initial base.
        const base = previousQueue
          ? previousCharacter
          : snapshotRef.current?.characters.find(
              (character) => character.id === id,
            );
        if (!base)
          throw new Error(
            "Персонаж больше недоступен. Обновите список персонажей.",
          );
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
            refreshed.characters.find((character) => character.id === id) ??
            null;
        }
        if (!updated)
          throw new Error(
            "Персонаж больше недоступен. Обновите список персонажей.",
          );
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
    },
    [snapshotRef],
  );

  const updateCharacterCounters = (
    characterId: string,
    requestedRevision: number,
    patch: CharacterCounterPatch,
    intent?: CharacterCounterMutationIntent,
  ) => {
    const previous =
      characterMutationQueuesRef.current.get(characterId) ??
      Promise.resolve(
        snapshotRef.current?.characters.find(
          (character) => character.id === characterId,
        ),
      );
    const operation = previous.then(async (queuedCharacter) => {
      let canonical = queuedCharacter;
      const submit = async (base: import("@arken/contracts").CharacterDto) => {
        const nextPatch = buildCharacterCounterPatch(base, patch, intent);
        if (isCharacterCounterPatchNoop(base, nextPatch)) return base;
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
        if (!freshCharacter) throw reason;
        const freshPatch = buildCharacterCounterPatch(
          freshCharacter,
          patch,
          intent,
        );
        if (isCharacterCounterPatchNoop(freshCharacter, freshPatch))
          return freshCharacter;
        if (!shouldRetryCharacterCounterConflict(intent, patch)) throw reason;
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
    return !previewSnapshot && view.me.role === "GM" && viewedSceneId
      ? (view.scenes.find((scene) => scene.id === viewedSceneId) ?? broadcast)
      : broadcast;
  }, [previewSnapshot, snapshot, viewedSceneId]);
  useEffect(() => {
    setBulkMoveIntents((current) =>
      retainBulkMoveIntentsForScene(current, activeSceneValue?.id),
    );
  }, [activeSceneValue?.id]);

  const activeSceneRef = useLatestRef(activeSceneValue);
  const tokenActions = useTokenDefinitionActions({
    run,
    snapshotRef,
    activeSceneRef,
    placeOptimistically,
  });
  const accessActions = useAccessActions({ run });
  const catalogActions = useCatalogActions({ run, load, setError });
  const assetActions = useAssetActions({ load });
  const statLayoutActions = useStatLayoutActions({ load });
  /**
   * UIX-431: выделение рамкой живёт в рендерере, а нужно оно панели очереди в
   * боковой колонке. Поднято сюда, а не продублировано: второй набор «что
   * выделено» разошёлся бы с подсветкой на карте при первом же клике.
   */
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
  useEffect(() => {
    setPings([]);
    setRulers([]);
    setCursors([]);
    if (!snapshot?.campaign.paused) return;
    setTool("PAN");
    setSelectedTokenIds([]);
    setGridPreview(null);
    setCanvasEditMode(null);
  }, [snapshot?.campaign.paused]);
  const initiativeActions = useInitiativeActions({ load });
  const chatHistoryActions = useChatHistoryActions({
    setSnapshot,
    snapshotRef,
  });
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
      statLayout: statLayoutActions,
      chatHistory: chatHistoryActions,
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
      statLayoutActions,
      chatHistoryActions,
    ],
  );

  const viewSnapshot = useMemo(() => {
    // Reproject optimistic tokens whenever the external mutation store changes.
    void tokenMutationVersion;
    if (previewSnapshot) return previewSnapshot;
    if (!snapshot) return null;
    return {
      ...snapshot,
      tokens: projectBulkMoveIntents(
        tokenMutations.project(snapshot.tokens),
        "TOKEN",
        bulkMoveIntents,
      ) as GameSnapshot["tokens"],
      drawings: projectBulkMoveIntents(
        snapshot.drawings ?? [],
        "DRAWING",
        bulkMoveIntents,
      ) as GameSnapshot["drawings"],
    };
  }, [
    previewSnapshot,
    snapshot,
    tokenMutations,
    tokenMutationVersion,
    bulkMoveIntents,
  ]);

  const broadcastScene = viewSnapshot
    ? (viewSnapshot.scenes.find((scene) => scene.active) ??
      viewSnapshot.scenes[0])
    : undefined;
  const activeScene = activeSceneValue;
  const activeTokens = useMemo(
    () =>
      activeScene && viewSnapshot
        ? viewSnapshot.tokens.filter(
            (token) => token.sceneId === activeScene.id,
          )
        : [],
    [activeScene?.id, viewSnapshot?.tokens],
  );
  const activeFog = useMemo(
    () =>
      activeScene && viewSnapshot
        ? viewSnapshot.fogReveals.filter(
            (fog) => fog.sceneId === activeScene.id,
          )
        : [],
    [activeScene?.id, viewSnapshot?.fogReveals],
  );
  const activeDrawings = useMemo(
    () =>
      activeScene && viewSnapshot
        ? (viewSnapshot.drawings ?? []).filter(
            (drawing) => drawing.sceneId === activeScene.id,
          )
        : [],
    [activeScene?.id, viewSnapshot?.drawings],
  );

  const activePings = useMemo(
    () =>
      activeScene
        ? pings.filter((ping) => ping.sceneId === activeScene.id)
        : [],
    [activeScene?.id, pings],
  );

  const activeRulers = useMemo(
    () =>
      activeScene
        ? rulers.filter((ruler) => ruler.sceneId === activeScene.id)
        : [],
    [activeScene?.id, rulers],
  );

  const activeCursors = useMemo(
    () =>
      cursorPreference.receiveEnabled && activeScene
        ? cursors.filter((cursor) => cursor.sceneId === activeScene.id)
        : [],
    [cursorPreference.receiveEnabled, activeScene?.id, cursors],
  );

  // UIX-395: undo/redo history only ever depends on the active scene's own
  // canvas content (fog, drawings, token placement/movement) -- not on
  // unrelated campaign events like chat, dice or audio, which used to also
  // bump the campaign-wide snapshotVersion this used to key off, refetching
  // /api/canvas/history on literally every event anywhere in the campaign.
  const activeCanvasVersion = canvasHistoryVersion(
    activeScene,
    activeFog,
    activeDrawings,
    activeTokens,
  );

  const handleOpenCharacter = useCallback(
    (characterId: string) => {
      setRequestedCharacterId(null);
      handleWorkspaceChange("characters");
      requestAnimationFrame(() => setRequestedCharacterId(characterId));
    },
    [handleWorkspaceChange],
  );

  const handleCanvasEditCancel = useCallback(() => {
    setCanvasEditMode(null);
  }, []);

  const handleCanvasPatch = useCallback(
    async (
      patch: Parameters<
        NonNullable<
          import("./renderers/SceneRenderer").SceneRendererProps["onCanvasPatch"]
        >
      >[0],
    ) => {
      if (!activeScene) return;
      await run(() =>
        api(`/api/scenes/${activeScene.id}/canvas`, {
          method: "PATCH",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision: activeScene.revision ?? 0,
            ...patch,
          }),
        }),
      );
    },
    [activeScene?.id, activeScene?.revision, run],
  );

  const handleFogCreate = useCallback(
    async (
      payload: Parameters<
        NonNullable<
          import("./renderers/SceneRenderer").SceneRendererProps["onFogCreate"]
        >
      >[0],
    ) => {
      if (!activeScene) return;
      const isCover =
        tool === "COVER" || tool === "COVER_BRUSH" || tool === "COVER_POLYGON";
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
    },
    [activeScene?.id, tool, run],
  );

  const handleDrawingCreate = useCallback(
    async (
      drawing: Parameters<
        NonNullable<
          import("./renderers/SceneRenderer").SceneRendererProps["onDrawingCreate"]
        >
      >[0],
    ) => {
      if (!activeScene) return undefined;
      let created: import("@arken/contracts").DrawingDto | undefined;
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
    },
    [activeScene?.id, run],
  );

  const handlePing = useCallback(
    (
      point: Parameters<
        NonNullable<
          import("./renderers/SceneRenderer").SceneRendererProps["onPing"]
        >
      >[0],
    ) => {
      if (!activeScene) return;
      socket?.emit(
        "map:ping",
        {
          sceneId: activeScene.id,
          ...point,
        },
        (result: { ok: boolean; reason?: string }) => {
          if (!result.ok && result.reason === "NO_VISIBLE_PLAYERS")
            notify({
              title: "На карте нет игроков, которые могут это увидеть",
              tone: "info",
            });
        },
      );
    },
    [activeScene?.id, socket],
  );

  const handleTokenLayerChange = useCallback(
    (tokenId: string, revision: number, layer: TokenDto["layer"]) =>
      run(() =>
        api(`/api/tokens/${tokenId}/layer`, {
          method: "PATCH",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision,
            layer,
          }),
        }),
      ),
    [run],
  );

  const handleTokenConditionsChange = useCallback(
    async (
      tokenId: string,
      _revision: number,
      conditions: import("@arken/contracts").TokenCondition[],
    ) => tokenMutations.setConditions(tokenId, conditions),
    [tokenMutations],
  );

  const handleTokenDelete = useCallback(
    (tokenId: string, revision: number) =>
      run(() =>
        api(`/api/tokens/${tokenId}`, {
          method: "DELETE",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision,
          }),
        }),
      ),
    [run],
  );

  const handleTokenResize = useCallback(
    async (
      tokenId: string,
      revision: number,
      size: { width: number; height: number },
    ) => {
      const actionId = crypto.randomUUID();
      try {
        const updated = await runResult(() =>
          api<Partial<TokenDto> & Pick<TokenDto, "id">>(
            `/api/tokens/${tokenId}/size`,
            {
              method: "PATCH",
              headers: { "x-action-id": actionId },
              body: JSON.stringify({
                actionId,
                revision,
                ...size,
              }),
            },
          ),
        );
        setSnapshot((current) =>
          current
            ? {
                ...current,
                tokens: current.tokens.map((token) =>
                  token.id === updated.id
                    ? mergeTokenPlacementUpdate(token, updated)
                    : token,
                ),
              }
            : current,
        );
      } catch (reason) {
        await recoverFromCanvasMutation(reason);
        throw reason;
      }
    },
    [recoverFromCanvasMutation, runResult],
  );

  const handleTokenAppearanceChange = useCallback(
    (
      tokenId: string,
      revision: number,
      appearance: { baseColor: string; frameColor: string | null },
    ) =>
      run(() =>
        api(`/api/tokens/${tokenId}/appearance`, {
          method: "PATCH",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision,
            ...appearance,
          }),
        }),
      ),
    [run],
  );

  const handleDrawingUpdate = useCallback(
    async (
      drawingId: string,
      revision: number,
      patch: Record<string, unknown>,
    ) => {
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
        await recoverFromCanvasMutation(reason);
        throw reason;
      }
    },
    [recoverFromCanvasMutation, runResult],
  );

  const handleDrawingDelete = useCallback(
    (drawingId: string, revision: number) =>
      run(() =>
        api(`/api/drawings/${drawingId}`, {
          method: "DELETE",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision,
          }),
        }),
      ),
    [run],
  );

  const handleDrawingCopy = useCallback(
    (drawingId: string, revision: number) =>
      run(() =>
        api(`/api/drawings/${drawingId}/copy`, {
          method: "POST",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision,
          }),
        }),
      ),
    [run],
  );

  const handleBulkMovePreview = useCallback(
    (
      intentId: string,
      targets: Parameters<
        NonNullable<
          import("./renderers/SceneRenderer").SceneRendererProps["onBulkMovePreview"]
        >
      >[1],
      delta: Parameters<
        NonNullable<
          import("./renderers/SceneRenderer").SceneRendererProps["onBulkMovePreview"]
        >
      >[2],
    ) => {
      if (!activeScene) return;
      setBulkMoveIntents((current) =>
        appendBulkMoveIntent(current, {
          actionId: intentId,
          sceneId: activeScene.id,
          targets,
          delta,
        }),
      );
    },
    [activeScene?.id],
  );

  const handleBulkMoveDiscard = useCallback((intentIds: readonly string[]) => {
    const discarded = new Set(intentIds);
    setBulkMoveIntents((current) => {
      const next = current.filter((intent) => !discarded.has(intent.actionId));
      return next.length === current.length ? current : next;
    });
  }, []);

  const handleBulkMove = useCallback(
    async (
      intentId: string,
      targets: Parameters<
        NonNullable<
          import("./renderers/SceneRenderer").SceneRendererProps["onBulkMove"]
        >
      >[1],
      delta: Parameters<
        NonNullable<
          import("./renderers/SceneRenderer").SceneRendererProps["onBulkMove"]
        >
      >[2],
    ) => {
      if (!activeScene) return { revisions: { tokens: {}, drawings: {} } };
      try {
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
        setBulkMoveIntents((current) => {
          const acknowledged = acknowledgeBulkMoveIntent(
            current,
            intentId,
            acknowledgement.revisions,
          );
          const canonical = snapshotRef.current;
          return canonical
            ? reconcileBulkMoveIntents(
                acknowledged,
                canonical.tokens,
                canonical.drawings ?? [],
              )
            : acknowledged;
        });
        return acknowledgement;
      } catch (reason) {
        setBulkMoveIntents((current) =>
          rejectBulkMoveIntent(current, intentId),
        );
        throw reason;
      }
    },
    [activeScene?.id, runResult, snapshotRef],
  );

  const handleBulkMoveFailure = useCallback(
    async (reason: unknown) => {
      await recoverFromCanvasMutation(reason);
    },
    [recoverFromCanvasMutation],
  );

  const handleBulkDelete = useCallback(
    (
      request: Parameters<
        NonNullable<
          import("./renderers/SceneRenderer").SceneRendererProps["onBulkDelete"]
        >
      >[0],
    ) =>
      run(() =>
        api("/api/canvas/bulk", {
          method: "POST",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            sceneId: request.sceneId,
            operation: "DELETE",
            targets: request.targets,
          }),
        }),
      ),
    [run],
  );

  const battleZone = viewSnapshot?.campaign.battleZone;
  const campaignRevision = viewSnapshot?.campaign.revision;
  const handleRecruitFromBattleZone = useCallback(() => {
    if (!battleZone || campaignRevision === undefined) return;
    void run(() => initiativeActions.onRecruitFromBattleZone(campaignRevision));
  }, [battleZone, campaignRevision, initiativeActions, run]);

  const handleCreateCharacter = useCallback(
    async (
      name: string,
      template?: import("./character-workspace-state").CharacterTemplateFields,
    ) =>
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
      ),
    [run],
  );

  const handlePreviewPlayer = useCallback(async (membershipId: string) => {
    const playerView = await api<GameSnapshot>(`/api/preview/${membershipId}`);
    setTool("PAN");
    setPreviewSnapshot(playerView);
  }, []);

  const handleCampaignClock = useCallback(
    (
      command:
        | "ADVANCE_DAY"
        | "LONG_REST"
        | "START_BATTLE"
        | "END_BATTLE"
        | "RESET_CLOCK",
      revision: number,
    ) =>
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
      ),
    [run],
  );

  const handlePublishActiveScene = useCallback(() => {
    if (!activeScene) return;
    if ([broadcastScene?.id, recentlyPublishedSceneId].includes(activeScene.id))
      return;
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
  }, [activeScene, broadcastScene?.id, recentlyPublishedSceneId, notify, run]);

  const handlePlaceTokenFromTray = useCallback(
    (definitionId: string) => {
      if (!activeScene) return;
      void placeOptimistically({
        path: `/api/token-definitions/${definitionId}/placements`,
        body: {
          actionId: crypto.randomUUID(),
          definitionId,
          sceneId: activeScene.id,
        },
      });
    },
    [activeScene, placeOptimistically],
  );

  const handleCampaignRename = useCallback(
    async (name: string) => {
      const current = snapshotRef.current;
      if (!current) return;
      const updated = await api<GameSnapshot["campaign"]>("/api/campaign", {
        method: "PATCH",
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          revision: current.campaign.revision,
          name,
        }),
      });
      setSnapshot((prev) => (prev ? { ...prev, campaign: updated } : prev));
      setCampaignRenameOpen(false);
    },
    [snapshotRef],
  );

  const handleLogout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.replace("/");
  }, []);

  const handleResync = useCallback(() => {
    const current = snapshotRef.current;
    if (!current) return;
    setConnection("RESYNCING");
    socket?.emit("game:resync", current.snapshotVersion);
  }, [socket, snapshotRef]);

  const handleOpenThemeSettings = useCallback(() => {
    themePreference.cancel();
    setThemeSettingsOpen(true);
  }, [themePreference]);

  const handleUploadAudio = useCallback(
    (file: File, kind: "AUDIO") => assetActions.uploadAsset(file, kind),
    [assetActions],
  );

  const loadAfterHome = () => {
    window.history.replaceState(null, "", "/");
    void load();
  };
  if (authRequired || new URLSearchParams(window.location.search).has("home"))
    return <AuthGate onAuthenticated={loadAfterHome} />;

  if (!snapshot || !viewSnapshot)
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

  const workspaceHidden =
    workspace === "characters" ||
    workspace === "setup" ||
    workspace === "world-maps";

  return (
    <CampaignActionsContext.Provider value={campaignActions}>
      <RollVisibilityContext.Provider value={mapRollVisibility}>
        <div
          className={`app-shell${compact ? " app-shell--compact" : ""}`}
          data-compact-surface={compact ? compactSurface : undefined}
        >
          {/* UIX-532: без этой ссылки путь с клавиатуры к карте проходит через
            всю верхнюю панель. Прячется, пока рабочая область открыта поверх
            карты: там карта помечена `aria-hidden`, и уводить фокус в
            скрытое — хуже, чем не предлагать переход вовсе. */}
          {!workspaceHidden && (!compact || compactSurface === "map") && (
            <a className="skip-link" href="#main-content">
              Перейти к карте
            </a>
          )}
          <AppHeader
            compact={compact}
            activeScene={activeScene}
            broadcastScene={broadcastScene}
            recentlyPublishedSceneId={recentlyPublishedSceneId}
            viewSnapshot={viewSnapshot}
            snapshot={snapshot}
            connection={connection}
            previewSnapshot={previewSnapshot}
            operatorFeedbackAllowed={operatorFeedbackAllowed}
            workspace={workspace}
            personalTheme={personalTheme}
            onMusicControlsTarget={setHeaderMusicTarget}
            onOpenCompactSections={() => setCompactSectionsOpen(true)}
            onSelectScene={setViewedSceneId}
            onRequestEditScene={(sceneId) => {
              setRequestedSceneEditId(sceneId);
              setSceneDialogRequest((value) => value + 1);
            }}
            onPublishScene={handlePublishActiveScene}
            onRequestCreateScene={() => {
              setRequestedSceneEditId(null);
              setSceneDialogRequest((value) => value + 1);
            }}
            onSelectWorkspace={handleWorkspaceChange}
            onResync={handleResync}
            onOpenCampaignRename={() => setCampaignRenameOpen(true)}
            onOpenThemeSettings={handleOpenThemeSettings}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onExitPreview={() => setPreviewSnapshot(null)}
            onOpenPlayerHandoff={() => setPlayerHandoffOpen(true)}
            onLogout={handleLogout}
          />
          <AppModals
            personalTheme={personalTheme}
            themePreference={themePreference}
            publishedThemeIds={publishedThemeIds}
            themeSettingsOpen={themeSettingsOpen}
            onCloseThemeSettings={() => {
              if (themePreference.pending) return;
              themePreference.cancel();
              setThemeSettingsOpen(false);
            }}
            compact={compact}
            compactSectionsOpen={compactSectionsOpen}
            onCloseCompactSections={() => setCompactSectionsOpen(false)}
            isGm={snapshot.me.role === "GM"}
            operatorFeedbackAllowed={operatorFeedbackAllowed}
            onSelectWorkspace={handleWorkspaceChange}
            playerHandoffOpen={playerHandoffOpen}
            playerHandoffPending={playerHandoffPending}
            playerHandoffError={playerHandoffError}
            onApplyPlayerHandoff={handOffToNextPlayer}
            onClosePlayerHandoff={() => {
              if (!playerHandoffPending) {
                setPlayerHandoffError("");
                setPlayerHandoffOpen(false);
              }
            }}
            campaignRenameOpen={campaignRenameOpen}
            campaignName={snapshot.campaign.name}
            onApplyCampaignRename={handleCampaignRename}
            onCloseCampaignRename={() => setCampaignRenameOpen(false)}
            shortcutsOpen={shortcutsOpen}
            onCloseShortcuts={() => setShortcutsOpen(false)}
          />
          <div
            className={`workbench${
              sidebarCollapsed && !previewSnapshot && !compact
                ? " is-sidebar-collapsed"
                : ""
            }`}
            style={
              sidebarWidth != null
                ? ({ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties)
                : undefined
            }
          >
            {sidebarCollapsed && !previewSnapshot && !compact && (
              <button
                type="button"
                className="sidebar-restore-button"
                aria-controls="activity-sidebar"
                aria-label="Развернуть боковую панель"
                title="Развернуть боковую панель"
                aria-expanded="false"
                onClick={() => handleSidebarCollapsedChange(false)}
              >
                <AppIcon icon={SidebarExpandIcon} />
              </button>
            )}
            <main
              id="main-content"
              // UIX-532: цель ссылки «к карте». `-1` даёт фокус по переходу, но
              // не добавляет карту в обход табом — она и так первая за панелью.
              tabIndex={-1}
              className={`map-shell${workspaceHidden ? " is-workspace-hidden" : ""}`}
              hidden={compact && compactSurface !== "map"}
              inert={workspaceHidden || (compact && compactSurface !== "map")}
              aria-hidden={
                workspaceHidden || (compact && compactSurface !== "map")
              }
            >
              {!previewSnapshot && (
                <div className="map-dice-tray" aria-label="Броски на карте">
                  <DiceTrayPanel
                    characterId={snapshot.me.characterId}
                    visibility={mapRollVisibility}
                    onVisibilityChange={setMapRollVisibility}
                    onRoll={submitRoll}
                  />
                </div>
              )}
              {snapshot.campaign.paused && (
                <GamePauseOverlay
                  paused={snapshot.campaign.paused}
                  isGm={snapshot.me.role === "GM"}
                  onToggle={toggleCampaignPause}
                />
              )}
              {!snapshot.campaign.paused && (
                <MapToolbar
                  pauseControl={
                    snapshot.me.role === "GM" && !previewSnapshot ? (
                      <GamePauseOverlay
                        paused={false}
                        isGm
                        onToggle={toggleCampaignPause}
                      />
                    ) : undefined
                  }
                  tokenTrayControl={
                    !previewSnapshot ? (
                      <TokenTray
                        tokenDefinitions={snapshot.tokenDefinitions}
                        assets={snapshot.assets}
                        role={snapshot.me.role}
                        onPlaceToken={handlePlaceTokenFromTray}
                      />
                    ) : undefined
                  }
                  objectListOpen={mapObjectsOpen}
                  onToggleObjectList={() => setMapObjectsOpen((open) => !open)}
                  tool={tool}
                  onToolSelect={setTool}
                  snapshot={snapshot}
                  viewSnapshot={viewSnapshot}
                  previewSnapshot={previewSnapshot}
                  activeScene={activeScene}
                  activeCanvasVersion={activeCanvasVersion}
                  cursorPreference={cursorPreference}
                  onCursorPreferenceChange={updateCursorPreference}
                  fogBrushRadius={fogBrushRadius}
                  onFogBrushRadiusChange={setFogBrushRadius}
                  canvasEditMode={canvasEditMode}
                  onCanvasEditModeChange={setCanvasEditMode}
                  onGridPreview={setGridPreview}
                  onGridSave={(grid) => {
                    if (!activeScene) return Promise.resolve();
                    return run(
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
                    );
                  }}
                  gmFogOpacity={gmFogOpacity}
                  onGmFogOpacityChange={(value) => {
                    setGmFogOpacity(value);
                    localStorage.setItem("arken.gmFogOpacity", String(value));
                  }}
                  gmFogVisible={gmFogVisible}
                  onGmFogVisibleChange={setGmFogVisible}
                  gmGridVisible={gmGridVisible}
                  onGmGridVisibleChange={(visible) => {
                    setGmGridVisible(visible);
                    localStorage.setItem(
                      "arken.gmGridVisible",
                      String(visible),
                    );
                  }}
                />
              )}
              {activeScene ? (
                <Suspense
                  fallback={<div className="empty-map">Загружаем карту…</div>}
                >
                  <Orthographic2DRenderer
                    key={`${activeScene.id}:${snapshot.campaign.paused}`}
                    paused={snapshot.campaign.paused}
                    externalObjectListOpen={mapObjectsOpen}
                    onObjectListToggle={() =>
                      setMapObjectsOpen((open) => !open)
                    }
                    onObjectListClose={() => setMapObjectsOpen(false)}
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
                    onOpenCharacter={handleOpenCharacter}
                    membershipId={viewSnapshot.me.id}
                    onSelectionChange={setSelectedTokenIds}
                    socket={snapshot.campaign.paused ? null : socket}
                    tool={snapshot.campaign.paused ? "PAN" : tool}
                    onToolSelect={setTool}
                    pings={activePings}
                    rulers={activeRulers}
                    cursors={activeCursors}
                    cursorSendEnabled={cursorPreference.sendEnabled}
                    cursorShared={
                      snapshot.me.role === "GM" && cursorPreference.sendEnabled
                    }
                    gmFogOpacity={gmFogOpacity}
                    gmFogVisible={gmFogVisible}
                    gmGridVisible={gmGridVisible}
                    fogBrushRadius={fogBrushRadius}
                    encounters={[]}
                    canvasEditMode={canvasEditMode}
                    onCanvasEditCancel={handleCanvasEditCancel}
                    onCanvasPatch={handleCanvasPatch}
                    onFogCreate={handleFogCreate}
                    onDrawingCreate={handleDrawingCreate}
                    onPing={handlePing}
                    onPlaceTokenDefinition={async (definitionId, point) => {
                      void placeOptimistically({
                        path: `/api/token-definitions/${definitionId}/placements`,
                        body: {
                          actionId: crypto.randomUUID(),
                          definitionId,
                          sceneId: activeScene.id,
                          ...point,
                        },
                      });
                    }}
                    onTokenLayerChange={handleTokenLayerChange}
                    onTokenConditionsChange={handleTokenConditionsChange}
                    onTokenDelete={handleTokenDelete}
                    onTokenResize={handleTokenResize}
                    onTokenAppearanceChange={handleTokenAppearanceChange}
                    onDrawingUpdate={handleDrawingUpdate}
                    onDrawingDelete={handleDrawingDelete}
                    onDrawingCopy={handleDrawingCopy}
                    onBulkMovePreview={handleBulkMovePreview}
                    onBulkMoveDiscard={handleBulkMoveDiscard}
                    onBulkMove={handleBulkMove}
                    onBulkMoveFailure={handleBulkMoveFailure}
                    onBulkDelete={handleBulkDelete}
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
                          if (compact) selectCompactSurface("journal");
                          else handleSidebarCollapsedChange(false);
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
                          {normalizeClientDiceResult(message.dice)?.total ??
                            "—"}
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
                        <AppIcon icon={CloseIcon} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </main>
            {previewSnapshot ? (
              <aside
                className="sidebar"
                id="activity-sidebar"
                tabIndex={-1}
                hidden={compact && compactSurface !== "journal"}
                inert={compact && compactSurface !== "journal"}
              >
                <div className="panel-scroll">
                  <section className="panel-section">
                    <span className="eyebrow">Режим мастера</span>
                    <h2>Глазами игрока</h2>
                    <p>
                      Сейчас показаны только активная сцена, видимые токены и
                      файлы, доступные игроку {viewSnapshot.me.displayName}.
                    </p>
                    <button onClick={() => setPreviewSnapshot(null)}>
                      Завершить просмотр
                    </button>
                  </section>
                </div>
              </aside>
            ) : (
              <Sidebar
                key={compactIdentity}
                compact={compact}
                chatVisible={
                  compact ? compactSurface === "journal" : !sidebarCollapsed
                }
                keepCharacterWorkspaceMounted={
                  compactNavigation.characterVisited
                }
                selectedTokenIds={selectedTokenIds}
                onUpdateInitiative={initiativeActions.onUpdateInitiative}
                onSetOwnInitiative={initiativeActions.onSetOwnInitiative}
                onRollInitiative={initiativeActions.onRollInitiative}
                onRecruitFromBattleZone={
                  viewSnapshot.campaign.battleZone
                    ? handleRecruitFromBattleZone
                    : undefined
                }
                snapshot={snapshot}
                requestedCharacterId={requestedCharacterId}
                socket={socket}
                presence={presence}
                requestedChatMessageId={requestedChatMessageId}
                onRequestedChatMessageHandled={handleRequestedChatMessage}
                onChatVisibilityChange={handleChatVisibilityChange}
                collapsed={compact ? false : sidebarCollapsed}
                onCollapsedChange={handleSidebarCollapsedChange}
                onResizeHandleDown={handleSidebarResizeStart}
                onResizeHandleMove={handleSidebarResizeMove}
                onResizeHandleUp={handleSidebarResizeEnd}
                workspaceSidebarWidth={sidebarWidth}
                workspace={workspace}
                operatorFeedbackAllowed={operatorFeedbackAllowed}
                onWorkspaceChange={handleWorkspaceChange}
                onPatchCharacter={patchCharacter}
                onReplaceCharacterControllers={replaceCharacterControllers}
                storyPosts={storyPosts}
                storyNextCursor={storyNextCursor}
                onRoll={submitRoll}
                onCreateCharacter={handleCreateCharacter}
                sceneDialogRequest={sceneDialogRequest}
                requestedSceneEditId={requestedSceneEditId}
                viewedSceneId={activeScene?.id ?? null}
                onPreviewPlayer={handlePreviewPlayer}
                onUpdateCounters={updateCharacterCounters}
                onCampaignClock={handleCampaignClock}
              />
            )}
            {compact && compactSurface === "menu" && (
              <CompactMenuSurface
                snapshot={snapshot}
                viewSnapshot={viewSnapshot}
                connection={connection}
                operatorFeedbackAllowed={operatorFeedbackAllowed}
                onSelectWorkspace={(w) => handleWorkspaceChange(w)}
                onSelectSurface={selectCompactSurface}
                onMusicControlsTarget={setMenuMusicTarget}
                onOpenThemeSettings={handleOpenThemeSettings}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onOpenPlayerHandoff={() => setPlayerHandoffOpen(true)}
                onLogout={handleLogout}
              />
            )}
          </div>
          <MusicBar
            audio={snapshot.audio}
            assets={snapshot.assets}
            role={snapshot.me.role}
            socket={socket}
            onUpload={handleUploadAudio}
            controlsTarget={
              compact && compactSurface === "menu"
                ? menuMusicTarget
                : headerMusicTarget
            }
          />
          {compact && (
            <CompactNavigation
              active={compactSurface}
              onSelect={selectCompactSurface}
              characterVisited={compactNavigation.characterVisited}
              characterAvailable={!previewSnapshot}
            />
          )}
        </div>
      </RollVisibilityContext.Provider>
    </CampaignActionsContext.Provider>
  );
}
