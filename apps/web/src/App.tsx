import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type {
  AssetKind,
  GameSnapshot,
  MessageVisibility,
} from "@arken/contracts";
import { api, ApiError, reportClientEvent } from "./api";
import { AuthGate } from "./AuthGate";
import { MusicBar } from "./MusicBar";
import { createGameSocket, type GameSocket } from "./realtime";
import { Sidebar } from "./Sidebar";

const Orthographic2DRenderer = lazy(() =>
  import("./renderers/Orthographic2DRenderer").then((module) => ({
    default: module.Orthographic2DRenderer,
  })),
);

export function App() {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [connection, setConnection] = useState<
    "CONNECTING" | "ONLINE" | "RECONNECTING" | "RESYNCING" | "OFFLINE"
  >("CONNECTING");
  const [tool, setTool] = useState<"PAN" | "FOG">("PAN");
  const [error, setError] = useState("");
  const campaignId = snapshot?.campaign.id;

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
    next.on("chat:created", (event) =>
      setSnapshot((current) =>
        current &&
        event.sequence > current.snapshotVersion &&
        !current.messages.some((item) => item.id === event.data.id)
          ? {
              ...current,
              snapshotVersion: event.sequence,
              messages: [...current.messages, event.data],
            }
          : current,
      ),
    );
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

  const activeScene =
    snapshot.scenes.find((scene) => scene.active) ?? snapshot.scenes[0];
  const activeTokens = activeScene
    ? snapshot.tokens.filter((token) => token.sceneId === activeScene.id)
    : [];
  const activeFog = activeScene
    ? snapshot.fogReveals.filter((fog) => fog.sceneId === activeScene.id)
    : [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>arken-space</strong>
          <span>{snapshot.campaign.name}</span>
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
            title={`Схема ${snapshot.schemaVersion}, сборка ${snapshot.buildVersion}`}
          >
            v{snapshot.snapshotVersion}
          </span>
          <span>
            {snapshot.me.displayName} · {snapshot.me.role}
          </span>
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
            {snapshot.me.role === "GM" && (
              <button
                aria-pressed={tool === "FOG"}
                onClick={() => setTool("FOG")}
              >
                Открыть туман
              </button>
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
                assets={snapshot.assets}
                role={snapshot.me.role}
                membershipId={snapshot.me.id}
                socket={socket}
                tool={tool}
                onFogCreate={async (rect) => {
                  await run(() =>
                    api("/api/fog-reveals", {
                      method: "POST",
                      body: JSON.stringify({
                        actionId: crypto.randomUUID(),
                        sceneId: activeScene.id,
                        ...rect,
                      }),
                    }),
                  );
                  setTool("PAN");
                }}
              />
            </Suspense>
          ) : (
            <div className="empty-map">Мастер ещё не создал сцену.</div>
          )}
        </main>
        <Sidebar
          snapshot={snapshot}
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
                  body: JSON.stringify({ name, actionId: crypto.randomUUID() }),
                }),
              true,
            )
          }
          onCreateInvite={async (characterId, label) => {
            const result = await api<{ url: string }>("/api/invites", {
              method: "POST",
              body: JSON.stringify({
                characterId,
                label,
                expiresInHours: 168,
                actionId: crypto.randomUUID(),
              }),
            });
            return result.url;
          }}
          onCreateScene={async (name) =>
            run(
              () =>
                api("/api/scenes", {
                  method: "POST",
                  body: JSON.stringify({ name, actionId: crypto.randomUUID() }),
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
        />
      </div>
      <MusicBar
        audio={snapshot.audio}
        assets={snapshot.assets}
        role={snapshot.me.role}
        socket={socket}
      />
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Закрыть</button>
        </div>
      )}
    </div>
  );
}
