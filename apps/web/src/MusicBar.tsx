import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetDto, AudioStateDto, Role } from "@arken/contracts";
import { Button, Checkbox, Loader } from "@gravity-ui/uikit";
import type { GameSocket } from "./realtime";
import { ArkenDialog } from "./ui/ArkenDialog";
import { EmptyState, ErrorState } from "./ui/EntityState";
import { notify } from "./ui/notifications";
import { isAudioConsentError } from "./audio-playback";

const ENABLED_KEY = "arken.audio.enabled";
const VOLUME_KEY = "arken.audio.volume";
const formatTime = (value: number) => {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const formatBytes = (value: number) =>
  value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} КБ`
    : `${(value / 1024 / 1024).toFixed(1)} МБ`;

type PendingAudio = { file: File; url: string; duration: number | null };

export function MusicBar({
  audio,
  assets,
  role,
  socket,
  onUpload,
}: {
  audio: AudioStateDto;
  assets: AssetDto[];
  role: Role;
  socket: GameSocket | null;
  onUpload: (file: File, kind: "AUDIO") => Promise<AssetDto>;
}) {
  const element = useRef<HTMLAudioElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem(ENABLED_KEY) === "true",
  );
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.5;
  });
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(audio.positionSeconds);
  const [pending, setPending] = useState<PendingAudio | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const tracks = useMemo(
    () => assets.filter((asset) => asset.kind === "AUDIO"),
    [assets],
  );
  const current = tracks.find((asset) => asset.id === audio.assetId);

  const pendingUrl = pending?.url;
  useEffect(
    () => () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    },
    [pendingUrl],
  );
  useEffect(() => {
    const player = element.current;
    if (!player) return;
    player.volume = volume;
    player.loop = audio.loop;
    const elapsed =
      audio.playing && audio.startedAt
        ? (Date.now() - new Date(audio.startedAt).getTime()) / 1000
        : 0;
    const expected = audio.positionSeconds + Math.max(0, elapsed);
    setPosition(expected);
    if (!enabled || !current) {
      player.pause();
      return;
    }
    if (Math.abs(player.currentTime - expected) > 0.75)
      player.currentTime = expected;
    if (audio.playing && player.paused)
      void player.play().catch((reason: unknown) => {
        // Snapshot refreshes (including scene activation) can race with media
        // loading and reject play() with AbortError. That is transient and
        // must not revoke the user's local audio consent.
        if (!isAudioConsentError(reason)) return;
        setEnabled(false);
        notify({
          title: "Браузер заблокировал звук",
          message: "Включите звук вручную в верхней панели.",
          tone: "warning",
        });
      });
    else player.pause();
  }, [audio, current, enabled, volume]);
  useEffect(
    () => localStorage.setItem(ENABLED_KEY, String(enabled)),
    [enabled],
  );
  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume));
    if (element.current) element.current.volume = volume;
  }, [volume]);

  const sendCommand = (
    command:
      | { command: "SELECT"; assetId: string | null }
      | { command: "PLAY" | "PAUSE" | "END" }
      | { command: "SEEK"; positionSeconds: number }
      | { command: "SET_LOOP"; loop: boolean },
  ) =>
    socket?.emit(
      "audio:set",
      {
        actionId: crypto.randomUUID(),
        revision: audio.revision,
        ...command,
      },
      (result) => {
        if (!result.ok)
          notify({
            title: "Не удалось изменить музыку",
            message: result.reason ?? "Сервер отклонил команду",
            tone: "danger",
          });
      },
    );

  const chooseFile = (file?: File) => {
    if (!file) return;
    setPending({ file, url: URL.createObjectURL(file), duration: null });
    setUploadError(null);
  };
  const upload = async () => {
    if (!pending) return;
    setUploading(true);
    setUploadError(null);
    try {
      const asset = await onUpload(pending.file, "AUDIO");
      sendCommand({ command: "SELECT", assetId: asset.id });
      setPending(null);
      notify({ title: "Трек загружен", message: asset.name, tone: "success" });
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Не удалось загрузить файл",
      );
    } finally {
      setUploading(false);
    }
  };
  const togglePlayback = () =>
    sendCommand({ command: audio.playing ? "PAUSE" : "PLAY" });

  return (
    <>
      <audio
        ref={element}
        src={current?.url}
        preload="auto"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onEnded={() => {
          if (role === "GM" && !audio.loop) sendCommand({ command: "END" });
        }}
      />
      <section className="music-topbar" aria-label="Музыка">
        <div className="music-now-playing" title={current?.name}>
          <span>Музыка</span>
          <strong>{current?.name ?? "Трек не выбран"}</strong>
        </div>
        {role === "GM" ? (
          <>
            <Button size="s" disabled={!current} onClick={togglePlayback}>
              {audio.playing ? "Пауза" : "Играть"}
            </Button>
            <Button size="s" view="flat" onClick={() => setLibraryOpen(true)}>
              Библиотека
            </Button>
          </>
        ) : !enabled ? (
          <Button size="s" view="action" onClick={() => setEnabled(true)}>
            Включить звук
          </Button>
        ) : null}
        {enabled ? (
          <>
            <label className="music-local-volume">
              <span className="visually-hidden">Личная громкость</span>
              <input
                aria-label="Личная громкость"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
            </label>
            <Button
              size="s"
              view="flat"
              aria-label="Выключить звук лично для себя"
              onClick={() => setEnabled(false)}
            >
              Выкл.
            </Button>
          </>
        ) : role === "GM" ? (
          <Button size="s" view="flat" onClick={() => setEnabled(true)}>
            Включить звук
          </Button>
        ) : null}
      </section>
      {role === "GM" ? (
        <ArkenDialog
          open={libraryOpen}
          footer={false}
          title="Музыкальная библиотека"
          onClose={() => setLibraryOpen(false)}
        >
          <div className="music-library">
            <section className="music-library-player">
              <div>
                <span>Сейчас играет</span>
                <strong>{current?.name ?? "Трек не выбран"}</strong>
              </div>
              <div className="music-library-controls">
                <Button disabled={!current} onClick={togglePlayback}>
                  {audio.playing ? "Пауза" : "Играть"}
                </Button>
                <span>
                  {formatTime(position)} / {formatTime(duration)}
                </span>
                <Checkbox
                  checked={audio.loop}
                  onUpdate={(checked) =>
                    sendCommand({ command: "SET_LOOP", loop: checked })
                  }
                >
                  Повторять
                </Checkbox>
              </div>
              <input
                aria-label="Позиция воспроизведения"
                type="range"
                min="0"
                max={Math.max(1, duration || audio.positionSeconds + 300)}
                step="1"
                disabled={!current}
                value={Math.min(
                  position,
                  duration || audio.positionSeconds + 300,
                )}
                onChange={(event) => {
                  const positionSeconds = Number(event.target.value);
                  setPosition(positionSeconds);
                  if (element.current)
                    element.current.currentTime = positionSeconds;
                }}
                onPointerUp={(event) =>
                  sendCommand({
                    command: "SEEK",
                    positionSeconds: Number(event.currentTarget.value),
                  })
                }
                onKeyUp={(event) =>
                  sendCommand({
                    command: "SEEK",
                    positionSeconds: Number(event.currentTarget.value),
                  })
                }
              />
            </section>
            <section>
              <h3>Треки</h3>
              {tracks.length === 0 ? (
                <EmptyState
                  title="Библиотека пуста"
                  description="Загрузите MP3 или OGG, чтобы включить музыку группе."
                />
              ) : (
                <div className="music-track-list">
                  {tracks.map((track) => (
                    <button
                      type="button"
                      key={track.id}
                      className={
                        track.id === audio.assetId
                          ? "music-track is-selected"
                          : "music-track"
                      }
                      onClick={() =>
                        sendCommand({ command: "SELECT", assetId: track.id })
                      }
                    >
                      <strong>{track.name}</strong>
                      <span>{formatBytes(track.sizeBytes)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="music-upload">
              <h3>Загрузить трек</h3>
              <input
                aria-label="Аудиофайл"
                type="file"
                accept=".mp3,.ogg,audio/mpeg,audio/ogg"
                disabled={uploading}
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
              {pending ? (
                <div className="music-upload-preview">
                  <audio
                    controls
                    src={pending.url}
                    onLoadedMetadata={(event) => {
                      const next = event.currentTarget.duration;
                      setPending((value) =>
                        value ? { ...value, duration: next } : null,
                      );
                    }}
                  />
                  <div>
                    <strong>{pending.file.name}</strong>
                    <span>
                      {formatBytes(pending.file.size)} ·{" "}
                      {pending.duration == null
                        ? "читаем длительность…"
                        : formatTime(pending.duration)}
                    </span>
                  </div>
                  <Button
                    view="action"
                    loading={uploading}
                    onClick={() => void upload()}
                  >
                    Загрузить и выбрать
                  </Button>
                </div>
              ) : uploading ? (
                <div className="music-upload-loading">
                  <Loader size="m" /> Загрузка…
                </div>
              ) : null}
              {uploadError ? (
                <ErrorState
                  title="Не удалось загрузить трек"
                  description={uploadError}
                  onRetry={() => void upload()}
                />
              ) : null}
            </section>
          </div>
        </ArkenDialog>
      ) : null}
    </>
  );
}
