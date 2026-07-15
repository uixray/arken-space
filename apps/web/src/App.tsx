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
  GameSnapshot,
  MapPing,
  MessageVisibility,
} from "@arken/contracts";
import { api, ApiError, reportClientEvent } from "./api";
import { AuthGate } from "./AuthGate";
import { createGameSocket, type GameSocket } from "./realtime";
import { Sidebar } from "./Sidebar";
import { appendChatMessage } from "./chat-state";
import { addRollToast, removeRollToast, type RollToast } from "./toast-state";

const Orthographic2DRenderer = lazy(() =>
  import("./renderers/Orthographic2DRenderer").then((module) => ({
    default: module.Orthographic2DRenderer,
  })),
);

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
  const chatOpenRef = useRef(false);
  const [requestedChatMessageId, setRequestedChatMessageId] = useState<
    string | null
  >(null);
  const [rollToasts, setRollToasts] = useState<RollToast[]>([]);
  const toastAppearanceRef = useRef(0);
  const knownChatMessageIdsRef = useRef(new Set<string>());
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
      if (unseen && event.data.kind === "DICE" && !chatOpenRef.current) {
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
        window.setTimeout(() => {
          if (added)
            setRollToasts((current) =>
              removeRollToast(current, event.data.id, appearanceId),
            );
        }, 5000);
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

  if (authRequired) return <AuthGate onAuthenticated={load} />;
  if (!snapshot)
    return (
      <main className="loading">
        <div className="wordmark">arken-space</div>
        <p>{error || "Загружаем кампанию…"}</p>
        {error && <button onClick={load}>Повторить</button>}
      </main>
    );

  const viewSnapshot = previewSnapshot ?? snapshot;
  const activeScene =
    viewSnapshot.scenes.find((scene) => scene.active) ?? viewSnapshot.scenes[0];
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
          <span>{viewSnapshot.campaign.name}</span>
        </div>
        <div className="scene-title">{activeScene?.name ?? "Нет сцены"}</div>
        <div className="status-line">
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
      <div className="workbench">
        <main className="map-shell">
          <div className="map-toolbar">
            <button
              aria-pressed={tool === "PAN"}
              onClick={() => setTool("PAN")}
            >
              Панорама
            </button>
            {!previewSnapshot && snapshot.me.role === "GM" && (
              <>
                <button
                  aria-pressed={tool === "FOG"}
                  onClick={() => setTool("FOG")}
                >
                  Открыть туман
                </button>
                <button
                  aria-pressed={tool === "COVER"}
                  onClick={() => setTool("COVER")}
                >
                  Закрыть туман
                </button>
                <label>
                  Масштаб
                  <input
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    defaultValue={activeScene?.mapScale ?? 1}
                    onBlur={(event) =>
                      activeScene &&
                      run(() =>
                        api(`/api/scenes/${activeScene.id}/canvas`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            actionId: crypto.randomUUID(),
                            revision: activeScene.revision ?? 0,
                            mapScale: Number(event.target.value),
                          }),
                        }),
                      )
                    }
                  />
                </label>
                {(["size", "offsetX", "offsetY"] as const).map((key) => (
                  <label key={key}>
                    {key}
                    <input
                      type="number"
                      min={key === "size" ? 16 : undefined}
                      max={key === "size" ? 256 : undefined}
                      defaultValue={activeScene?.grid[key] ?? 0}
                      onBlur={(event) =>
                        activeScene &&
                        run(() =>
                          api(`/api/scenes/${activeScene.id}/canvas`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              actionId: crypto.randomUUID(),
                              revision: activeScene.revision ?? 0,
                              grid: {
                                ...activeScene.grid,
                                [key]: Number(event.target.value),
                              },
                            }),
                          }),
                        )
                      }
                    />
                  </label>
                ))}
                <button
                  onClick={() =>
                    run(() =>
                      api("/api/canvas/undo", {
                        method: "POST",
                        body: JSON.stringify({
                          actionId: crypto.randomUUID(),
                          sceneId: activeScene?.id,
                        }),
                      }),
                    )
                  }
                >
                  Отменить
                </button>
                <button
                  onClick={() =>
                    run(() =>
                      api("/api/canvas/redo", {
                        method: "POST",
                        body: JSON.stringify({
                          actionId: crypto.randomUUID(),
                          sceneId: activeScene?.id,
                        }),
                      }),
                    )
                  }
                >
                  Повторить
                </button>
              </>
            )}
            {!previewSnapshot && (
              <>
                {snapshot.me.role === "PLAYER" && (
                  <>
                    <button
                      onClick={() =>
                        run(() =>
                          api("/api/canvas/undo", {
                            method: "POST",
                            body: JSON.stringify({
                              actionId: crypto.randomUUID(),
                              sceneId: activeScene?.id,
                            }),
                          }),
                        )
                      }
                    >
                      Отменить
                    </button>
                    <button
                      onClick={() =>
                        run(() =>
                          api("/api/canvas/redo", {
                            method: "POST",
                            body: JSON.stringify({
                              actionId: crypto.randomUUID(),
                              sceneId: activeScene?.id,
                            }),
                          }),
                        )
                      }
                    >
                      Повторить
                    </button>
                  </>
                )}
                <button
                  aria-pressed={tool === "DRAW"}
                  onClick={() => setTool("DRAW")}
                >
                  Рисовать
                </button>
                <button
                  aria-pressed={tool === "RULER"}
                  onClick={() => setTool("RULER")}
                >
                  Линейка
                </button>
                <button
                  aria-pressed={tool === "PING"}
                  onClick={() => setTool("PING")}
                >
                  Ping
                </button>
              </>
            )}
            <span>{activeTokens.length} токенов</span>
          </div>
          {activeScene ? (
            <Suspense
              fallback={<div className="empty-map">Загружаем карту…</div>}
            >
              <Orthographic2DRenderer
                scene={activeScene}
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
                  setTool("PAN");
                }}
                onDrawingCreate={async (drawing) => {
                  await run(() =>
                    api("/api/drawings", {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        sceneId: activeScene.id,
                        ...drawing,
                      }),
                    }),
                  );
                  setTool("PAN");
                }}
                onPing={(point) => {
                  socket?.emit("map:ping", {
                    sceneId: activeScene.id,
                    ...point,
                  });
                  setTool("PAN");
                }}
                onPlaceTokenDefinition={async (definitionId, point) =>
                  run(() =>
                    api(`/api/token-definitions/${definitionId}/placements`, {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        definitionId,
                        ...point,
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
            onPatchCharacter={async (id, patch) =>
              run(() =>
                api(`/api/characters/${id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    ...patch,
                    actionId: crypto.randomUUID(),
                  }),
                }),
              )
            }
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
              await run(
                () =>
                  api(`/api/assets?kind=${kind}`, {
                    method: "POST",
                    headers: { "x-action-id": crypto.randomUUID() },
                    body: form,
                  }),
                true,
              );
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
            onUpdateCounters={(characterId, revision, patch) =>
              run(
                () =>
                  api(`/api/characters/${characterId}/counters`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      ...patch,
                      actionId: crypto.randomUUID(),
                      revision,
                    }),
                  }),
                true,
              )
            }
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
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Закрыть</button>
        </div>
      )}
    </div>
  );
}
