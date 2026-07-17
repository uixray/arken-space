import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  AssetKind,
  AssetDto,
  GameSnapshot,
  MapPing,
  MessageVisibility,
} from "@arken/contracts";
import { api, ApiError, reportClientEvent } from "./api";
import { AuthGate } from "./AuthGate";
import { createGameSocket, type GameSocket } from "./realtime";
import { Sidebar } from "./Sidebar";
import { MusicBar } from "./MusicBar";
import { appendChatMessage } from "./chat-state";
import {
  addRollToast,
  removeRollToast,
  scheduleRollToastRemoval,
  shouldShowRollToast,
  type RollToast,
} from "./toast-state";
import { notify } from "./ui/notifications";
import { TextPromptDialog } from "./ui/TextPromptDialog";
import { ErrorState, LoadingState } from "./ui/EntityState";

const Orthographic2DRenderer = lazy(() =>
  import("./renderers/Orthographic2DRenderer").then((module) => ({
    default: module.Orthographic2DRenderer,
  })),
);

function CanvasHistoryControls({
  sceneId,
  disabled,
  version,
}: {
  sceneId?: string;
  disabled: boolean;
  version: number;
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
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z")
        return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]"))
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
        aria-label="Отменить последнее действие"
        title="Отменить последнее действие"
        disabled={disabled || !canUndo}
        onClick={() => void act("undo")}
      >
        Отменить
      </button>
      <button
        aria-label="Повторить отменённое действие"
        title="Повторить отменённое действие"
        disabled={disabled || !canRedo}
        onClick={() => void act("redo")}
      >
        Повторить
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
  useEffect(() => setDraft(scene.grid), [scene]);
  return (
    <details className="grid-settings">
      <summary aria-label="Настройки сетки" title="Настройки сетки">
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
          <button
            onClick={() => {
              void onSave(draft);
              onPreview(null);
            }}
          >
            Сохранить
          </button>
          <button
            onClick={() => {
              setDraft(scene.grid);
              onPreview(null);
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
  const [authRequired, setAuthRequired] = useState(false);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [presence, setPresence] = useState<
    Array<{ membershipId: string; online: boolean }>
  >([]);
  const [connection, setConnection] = useState<
    "CONNECTING" | "ONLINE" | "RECONNECTING" | "RESYNCING" | "OFFLINE"
  >("CONNECTING");
  const [tool, setTool] = useState<
    "PAN" | "FOG" | "COVER" | "DRAW" | "RULER" | "PING"
  >("PAN");
  const [gmFogOpacity, setGmFogOpacity] = useState(() => {
    const stored = Number(localStorage.getItem("arken.gmFogOpacity") ?? 0.35);
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 0.35;
  });
  const [gmFogVisible, setGmFogVisible] = useState(true);
  const [canvasEditMode, setCanvasEditMode] = useState<
    "BACKGROUND" | "WORLD" | null
  >(null);
  // A GM may inspect and prepare another scene without moving the players.
  // The server-side `active` flag remains the broadcast scene.
  const [viewedSceneId, setViewedSceneId] = useState<string | null>(null);
  const [gridPreview, setGridPreview] = useState<
    import("@arken/contracts").SceneDto["grid"] | null
  >(null);
  const [pings, setPings] = useState<MapPing[]>([]);
  const [rulers, setRulers] = useState<
    Array<{
      sceneId: string;
      membershipId: string;
      displayName: string;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      distance: number;
    }>
  >([]);
  const [previewSnapshot, setPreviewSnapshot] = useState<GameSnapshot | null>(
    null,
  );
  const [error, setError] = useState("");
  const [createSceneOpen, setCreateSceneOpen] = useState(false);
  const [sceneDialogRequest, setSceneDialogRequest] = useState(0);
  const [campaignRenameOpen, setCampaignRenameOpen] = useState(false);

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
    if (!campaignId) return;
    const onError = (event: ErrorEvent) =>
      reportClientEvent({
        level: "error",
        event: "window.error",
        message: event.message,
        context: { filename: event.filename, line: event.lineno },
      });
    const onRejection = (event: PromiseRejectionEvent) =>
      reportClientEvent({
        level: "error",
        event: "window.unhandled_rejection",
        message:
          event.reason instanceof Error
            ? event.reason.message
            : String(event.reason),
      });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [campaignId]);
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
      setSnapshot(nextSnapshot);
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
    next.on("chat:created", (event) => {
      const unseen = !knownChatMessageIdsRef.current.has(event.data.id);
      if (unseen) knownChatMessageIdsRef.current.add(event.data.id);
      // Chat is append-only. It must be deduplicated by message id rather than
      // rejected by the global entity sequence: a later snapshot can arrive
      // before this envelope without containing this newly committed message.
      setSnapshot((current) =>
        current
          ? appendChatMessage(current, event.data, event.sequence)
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
              characters: current.characters.map((item) =>
                item.id === event.data.id ? event.data : item,
              ),
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
    };
  }, [authRequired, campaignId]);

  const run = async (action: () => Promise<unknown>, refresh = false) => {
    try {
      setError("");
      await action();
      if (refresh) await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Операция не выполнена",
      );
      throw reason;
    }
  };

  const patchCharacter = (
    id: string,
    patch: Partial<import("@arken/contracts").CharacterDto>,
  ) => {
    const requestedRevision =
      patch.revision ??
      snapshot?.characters.find((character) => character.id === id)?.revision;
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
      const updated = await api<import("@arken/contracts").CharacterDto>(
        `/api/characters/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...updates,
            actionId: crypto.randomUUID(),
            revision: previousCharacter?.revision ?? requestedRevision,
          }),
        },
      );
      setSnapshot((current) =>
        current
          ? {
              ...current,
              characters: current.characters.map((character) =>
                character.id === id ? updated : character,
              ),
            }
          : current,
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
  };

  const updateCharacterCounters = (
    characterId: string,
    requestedRevision: number,
    patch: {
      wallet?: import("@arken/contracts").CharacterDto["wallet"];
      resources?: import("@arken/contracts").CharacterDto["resources"];
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
        const nextPatch = intent?.walletDelta
          ? {
              wallet: {
                ...base.wallet,
                [intent.walletDelta.key]: Math.max(
                  0,
                  base.wallet[intent.walletDelta.key] +
                    intent.walletDelta.delta,
                ),
              },
            }
          : patch;
        return api<import("@arken/contracts").CharacterDto>(
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
      };
      if (!canonical) {
        const refreshed = await api<GameSnapshot>("/api/bootstrap");
        setSnapshot(refreshed);
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
          current
            ? {
                ...current,
                characters: current.characters.map((character) =>
                  character.id === characterId ? updated : character,
                ),
              }
            : current,
        );
        return updated;
      } catch (reason) {
        if (
          !(reason instanceof ApiError) ||
          reason.code !== "CHARACTER_CONFLICT"
        )
          throw reason;
        const refreshed = await api<GameSnapshot>("/api/bootstrap");
        setSnapshot(refreshed);
        const freshCharacter = refreshed.characters.find(
          (character) => character.id === characterId,
        );
        if (!freshCharacter || !intent?.walletDelta) throw reason;
        const updated = await submit(freshCharacter);
        setSnapshot((current) =>
          current
            ? {
                ...current,
                characters: current.characters.map((character) =>
                  character.id === characterId ? updated : character,
                ),
              }
            : current,
        );
        return updated;
      }
    });
    const queueTail = operation
      .catch(async () => {
        const refreshed = await api<GameSnapshot>("/api/bootstrap");
        setSnapshot(refreshed);
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
  const activeScene =
    !previewSnapshot && snapshot.me.role === "GM" && viewedSceneId
      ? (viewSnapshot.scenes.find((scene) => scene.id === viewedSceneId) ??
        broadcastScene)
      : broadcastScene;
  const activeTokens = activeScene
    ? viewSnapshot.tokens.filter((token) => token.sceneId === activeScene.id)
    : [];
  const activeFog = activeScene
    ? viewSnapshot.fogReveals.filter((fog) => fog.sceneId === activeScene.id)
    : [];
  const activeDrawings = activeScene
    ? (viewSnapshot.drawings ?? []).filter(
        (drawing) => drawing.sceneId === activeScene.id,
      )
    : [];

  return (
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
            </button>
          ) : (
            <span>{viewSnapshot.campaign.name}</span>
          )}
        </div>
        <div className="scene-switcher">
          <select
            aria-label={
              snapshot.me.role === "GM"
                ? "Просматриваемая сцена"
                : "Активная сцена"
            }
            value={activeScene?.id ?? ""}
            disabled={Boolean(previewSnapshot) || snapshot.me.role !== "GM"}
            onChange={(event) => setViewedSceneId(event.target.value)}
          >
            {viewSnapshot.scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </select>
          {activeScene && (
            <span className="scene-token-count">
              {activeTokens.length} токенов
            </span>
          )}
          {!previewSnapshot && snapshot.me.role === "GM" && activeScene && (
            <button
              className="publish-scene"
              title="Опубликовать выбранную сцену для игроков"
              disabled={activeScene.id === broadcastScene?.id}
              onClick={() =>
                void run(() =>
                  api("/api/scenes/activate", {
                    method: "POST",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      sceneId: activeScene.id,
                    }),
                  }),
                )
              }
            >
              {activeScene.id === broadcastScene?.id
                ? "У игроков"
                : "Показать игрокам"}
            </button>
          )}
          {!previewSnapshot && snapshot.me.role === "GM" && (
            <button
              aria-label="Создать сцену"
              title="Создать новую сцену"
              onClick={() => setSceneDialogRequest((value) => value + 1)}
            >
              +
            </button>
          )}
        </div>
        <div className="status-line">
          <MusicBar
            audio={snapshot.audio}
            assets={snapshot.assets}
            role={snapshot.me.role}
            socket={socket}
            onUpload={async (file) => {
              const form = new FormData();
              form.append("file", file);
              const asset = await api<AssetDto>("/api/assets?kind=AUDIO", {
                method: "POST",
                headers: { "x-action-id": crypto.randomUUID() },
                body: form,
              });
              await load();
              return {
                ...asset,
                url: `/api/assets/${asset.id}/content`,
                createdAt: String(asset.createdAt),
              };
            }}
          />
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
          <span
            title={`Схема ${snapshot.schemaVersion}, сборка ${snapshot.buildVersion}, Git ${snapshot.buildRevision ?? "unknown"}`}
          >
            v{snapshot.snapshotVersion} ·{" "}
            {(snapshot.buildRevision ?? "unknown").slice(0, 7)}
          </span>
          <span>
            {previewSnapshot
              ? `Просмотр: ${viewSnapshot.me.displayName}`
              : `${snapshot.me.displayName} · ${snapshot.me.role}`}
          </span>
          {previewSnapshot && (
            <button onClick={() => setPreviewSnapshot(null)}>
              Вернуться к мастеру
            </button>
          )}
          <button
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST" });
              window.location.reload();
            }}
          >
            Выйти
          </button>
        </div>
      </header>
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
      <div className="workbench">
        <main className="map-shell">
          <div className="map-toolbar">
            <div className="toolbar-group">
              <button
                aria-label="Перемещение"
                title="Перемещение по карте (средняя кнопка мыши)"
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
                    aria-pressed={tool === "FOG"}
                    onClick={() => setTool("FOG")}
                  >
                    Открыть туман
                  </button>
                  <button
                    aria-label="Закрыть туман"
                    title="Закрыть выбранную область туманом"
                    aria-pressed={tool === "COVER"}
                    onClick={() => setTool("COVER")}
                  >
                    Закрыть туман
                  </button>
                </>
              )}
              <button
                aria-label="Рисование"
                title="Нарисовать линию на карте"
                aria-pressed={tool === "DRAW"}
                onClick={() => setTool("DRAW")}
              >
                Рисование
              </button>
              <button
                aria-label="Линейка"
                title="Измерить расстояние на карте"
                aria-pressed={tool === "RULER"}
                onClick={() => setTool("RULER")}
              >
                Линейка
              </button>
              <button
                aria-label="Пинг"
                title="Показать точку группе"
                aria-pressed={tool === "PING"}
                onClick={() => setTool("PING")}
              >
                Пинг
              </button>
              {!previewSnapshot && snapshot.me.role === "GM" && activeScene && (
                <>
                  <GridSettings
                    scene={activeScene}
                    onPreview={setGridPreview}
                    onSave={(grid) =>
                      run(() =>
                        api(`/api/scenes/${activeScene.id}/canvas`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            actionId: crypto.randomUUID(),
                            revision: activeScene.revision ?? 0,
                            grid,
                          }),
                        }),
                      )
                    }
                  />
                  <details className="resize-settings">
                    <summary
                      aria-label="Настройки размера карты"
                      title="Настройки размера карты"
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
                      <button onClick={() => setCanvasEditMode(null)}>
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
                  version={snapshot.snapshotVersion}
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
                membershipId={viewSnapshot.me.id}
                socket={socket}
                tool={tool}
                pings={pings.filter((ping) => ping.sceneId === activeScene.id)}
                rulers={rulers.filter(
                  (ruler) => ruler.sceneId === activeScene.id,
                )}
                gmFogOpacity={gmFogOpacity}
                gmFogVisible={gmFogVisible}
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
                onFogCreate={async (rect) => {
                  await run(() =>
                    api("/api/fog-reveals", {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        sceneId: activeScene.id,
                        operation: tool === "COVER" ? "COVER" : "REVEAL",
                        ...rect,
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
                  socket?.emit("map:ping", {
                    sceneId: activeScene.id,
                    ...point,
                  });
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
                onTokenResize={(tokenId, revision, size) =>
                  run(() =>
                    api(`/api/tokens/${tokenId}/size`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        revision,
                        ...size,
                      }),
                    }),
                  )
                }
                onDrawingUpdate={(drawingId, revision, patch) =>
                  run(() =>
                    api(`/api/drawings/${drawingId}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        revision,
                        ...patch,
                      }),
                    }),
                  )
                }
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
                onBulkMove={(selection, delta) =>
                  run(() =>
                    api("/api/canvas/bulk", {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        sceneId: activeScene.id,
                        operation: "MOVE",
                        deltaX: delta.x,
                        deltaY: delta.y,
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
                      setRequestedChatMessageId(message.id);
                      setRollToasts((current) =>
                        removeRollToast(current, message.id),
                      );
                    }}
                  >
                    <strong>
                      {message.displayName}: {message.body}
                    </strong>
                    <span>{message.dice?.total ?? "—"}</span>
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
            socket={socket}
            presence={presence}
            requestedChatMessageId={requestedChatMessageId}
            onRequestedChatMessageHandled={handleRequestedChatMessage}
            onChatVisibilityChange={handleChatVisibilityChange}
            onPlaceTokenDefinition={async (definitionId) =>
              run(() =>
                api(`/api/token-definitions/${definitionId}/placements`, {
                  method: "POST",
                  body: JSON.stringify({
                    actionId: crypto.randomUUID(),
                    definitionId,
                    sceneId: activeScene?.id,
                  }),
                }),
              )
            }
            onDeleteTokenDefinition={async (definitionId, revision) =>
              run(() =>
                api(`/api/token-definitions/${definitionId}`, {
                  method: "DELETE",
                  body: JSON.stringify({
                    actionId: crypto.randomUUID(),
                    revision,
                  }),
                }),
              )
            }
            onPatchTokenDefinition={(definitionId, revision, patch) =>
              run(() =>
                api(`/api/token-definitions/${definitionId}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    ...patch,
                    actionId: crypto.randomUUID(),
                    revision,
                  }),
                }),
              )
            }
            onCreateTokenDefinition={(input) =>
              run(
                () =>
                  api("/api/token-definitions", {
                    method: "POST",
                    body: JSON.stringify({
                      ...input,
                      actionId: crypto.randomUUID(),
                    }),
                  }),
                true,
              ).then(() => undefined)
            }
            onReplaceTokenControllers={(
              definitionId,
              revision,
              controllerMembershipIds,
            ) =>
              run(
                () =>
                  api(`/api/token-definitions/${definitionId}/controllers`, {
                    method: "PUT",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      revision,
                      controllerMembershipIds,
                    }),
                  }),
                true,
              ).then(() => undefined)
            }
            onPatchCharacter={patchCharacter}
            onChat={async (body, visibility) =>
              run(() =>
                api("/api/chat", {
                  method: "POST",
                  body: JSON.stringify({
                    actionId: crypto.randomUUID(),
                    body,
                    visibility,
                    characterId: snapshot.me.characterId,
                  }),
                }),
              )
            }
            onRoll={async (
              formula,
              label,
              visibility = "PUBLIC" as MessageVisibility,
              characterId = null,
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
                  }),
                }),
              )
            }
            onCreateCharacter={async (name) =>
              run(
                () =>
                  api("/api/characters", {
                    method: "POST",
                    body: JSON.stringify({
                      name,
                      actionId: crypto.randomUUID(),
                    }),
                  }),
                true,
              )
            }
            onCreateInvite={async (characterId, label) => {
              const result = await api<
                import("@arken/contracts").PlayerAccessSecretDto
              >("/api/invites", {
                method: "POST",
                body: JSON.stringify({
                  characterId,
                  label,
                  expiresInHours: 168,
                  actionId: crypto.randomUUID(),
                }),
              });
              return result;
            }}
            onListPlayerAccess={() =>
              api<import("@arken/contracts").PlayerAccessDto[]>(
                "/api/player-access",
              )
            }
            onRotatePlayerAccess={(id) =>
              api<import("@arken/contracts").PlayerAccessSecretDto>(
                `/api/player-access/${id}/rotate`,
                {
                  method: "POST",
                  body: JSON.stringify({ actionId: crypto.randomUUID() }),
                },
              )
            }
            onRevokePlayerAccess={(id) =>
              run(() =>
                api(`/api/player-access/${id}/revoke`, {
                  method: "POST",
                  body: JSON.stringify({ actionId: crypto.randomUUID() }),
                }),
              )
            }
            sceneDialogRequest={sceneDialogRequest}
            viewedSceneId={activeScene?.id ?? null}
            onViewScene={(sceneId) => setViewedSceneId(sceneId)}
            onSaveScene={async (scene, draft) => {
              if (!scene) {
                await run(async () => {
                  const created = await api<
                    import("@arken/contracts").SceneDto
                  >("/api/scenes", {
                    method: "POST",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      name: draft.name,
                      mapAssetId: draft.mapAssetId,
                      width: draft.width,
                      height: draft.height,
                      grid: {
                        enabled: draft.gridEnabled,
                        size: draft.gridSize,
                        offsetX: draft.gridOffsetX,
                        offsetY: draft.gridOffsetY,
                        color: draft.gridColor,
                        opacity: draft.gridOpacity,
                      },
                      backgroundFrame: {
                        x: draft.frameX,
                        y: draft.frameY,
                        width: draft.frameWidth,
                        height: draft.frameHeight,
                      },
                    }),
                  });
                  setViewedSceneId(created.id);
                }, true);
                return;
              }
              await run(
                () =>
                  api(`/api/scenes/${scene.id}/canvas`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      revision: scene.revision ?? 0,
                      name: draft.name,
                      mapAssetId: draft.mapAssetId,
                      world: { width: draft.width, height: draft.height },
                      grid: {
                        enabled: draft.gridEnabled,
                        size: draft.gridSize,
                        offsetX: draft.gridOffsetX,
                        offsetY: draft.gridOffsetY,
                        color: draft.gridColor,
                        opacity: draft.gridOpacity,
                      },
                      backgroundFrame: {
                        x: draft.frameX,
                        y: draft.frameY,
                        width: draft.frameWidth,
                        height: draft.frameHeight,
                      },
                    }),
                  }),
                true,
              );
            }}
            onCreateScene={async (name) =>
              run(
                () =>
                  api("/api/scenes", {
                    method: "POST",
                    body: JSON.stringify({
                      name,
                      actionId: crypto.randomUUID(),
                    }),
                  }),
                true,
              )
            }
            onActivateScene={async (sceneId) =>
              run(() =>
                api("/api/scenes/activate", {
                  method: "POST",
                  body: JSON.stringify({
                    sceneId,
                    actionId: crypto.randomUUID(),
                  }),
                }),
              )
            }
            onAssignMap={async (sceneId, mapAssetId) =>
              run(
                () =>
                  api(`/api/scenes/${sceneId}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      mapAssetId,
                      actionId: crypto.randomUUID(),
                    }),
                  }),
                true,
              )
            }
            onRenameScene={(sceneId, revision, name) =>
              run(() =>
                api(`/api/scenes/${sceneId}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    actionId: crypto.randomUUID(),
                    revision,
                    name,
                  }),
                }),
              )
            }
            onRenameMembership={(membershipId, revision, name) =>
              run(() =>
                api(`/api/memberships/${membershipId}/name`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    actionId: crypto.randomUUID(),
                    revision,
                    name,
                  }),
                }),
              )
            }
            onCreateToken={async (characterId) => {
              const character = snapshot.characters.find(
                (item) => item.id === characterId,
              );
              if (!activeScene || !character) return;
              await run(
                () =>
                  api("/api/tokens", {
                    method: "POST",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      sceneId: activeScene.id,
                      characterId,
                      ownerMembershipId: character.ownerMembershipId,
                      name: character.name,
                      x: activeScene.width / 2,
                      y: activeScene.height / 2,
                      width: activeScene.grid.size,
                      height: activeScene.grid.size,
                    }),
                  }),
                true,
              );
            }}
            onUpload={async (file, kind: AssetKind) => {
              const form = new FormData();
              form.append("file", file);
              const asset = await api<AssetDto>(`/api/assets?kind=${kind}`, {
                method: "POST",
                headers: { "x-action-id": crypto.randomUUID() },
                body: form,
              });
              await load();
              return {
                ...asset,
                url: `/api/assets/${asset.id}/content`,
                createdAt: String(asset.createdAt),
              };
            }}
            onPreviewPlayer={async (membershipId) => {
              const playerView = await api<GameSnapshot>(
                `/api/preview/${membershipId}`,
              );
              setTool("PAN");
              setPreviewSnapshot(playerView);
            }}
            onCreateCatalogEntry={(input) =>
              run(
                () =>
                  api("/api/catalog", {
                    method: "POST",
                    body: JSON.stringify({
                      ...input,
                      data: input.data ?? {},
                      actionId: crypto.randomUUID(),
                    }),
                  }),
                true,
              )
            }
            onUpdateCatalogEntry={(id, patch) =>
              run(
                () =>
                  api(`/api/catalog/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      ...patch,
                      actionId: crypto.randomUUID(),
                    }),
                  }),
                true,
              )
            }
            onDeleteCatalogEntry={(id, revision) =>
              run(
                () =>
                  api(`/api/catalog/${id}`, {
                    method: "DELETE",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      revision,
                    }),
                  }),
                true,
              )
            }
            onAssignCatalogEntry={(characterId, catalogEntryId) =>
              run(
                () =>
                  api(`/api/characters/${characterId}/catalog`, {
                    method: "POST",
                    body: JSON.stringify({
                      catalogEntryId,
                      actionId: crypto.randomUUID(),
                    }),
                  }),
                true,
              )
            }
            onUpdateCharacterEntry={(characterId, id, patch) =>
              run(
                () =>
                  api(`/api/characters/${characterId}/catalog/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      ...patch,
                      actionId: crypto.randomUUID(),
                    }),
                  }),
                true,
              )
            }
            onDeleteCharacterEntry={(characterId, id, revision) =>
              run(
                () =>
                  api(`/api/characters/${characterId}/catalog/${id}`, {
                    method: "DELETE",
                    body: JSON.stringify({
                      actionId: crypto.randomUUID(),
                      revision,
                    }),
                  }),
                true,
              )
            }
            onRollEntry={(characterId, entryId, rollActionId) =>
              run(
                () =>
                  api(
                    `/api/characters/${characterId}/catalog/${entryId}/roll`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        rollActionId,
                        visibility: "PUBLIC",
                      }),
                    },
                  ),
                true,
              )
            }
            onRechargeEntry={(characterId, entryId, revision) =>
              run(
                () =>
                  api(
                    `/api/characters/${characterId}/catalog/${entryId}/recharge`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        revision,
                      }),
                    },
                  ),
                true,
              )
            }
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
  );
}
