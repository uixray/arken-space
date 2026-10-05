import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetDto, AudioStateDto, Role } from "@arken/contracts";
import { Checkbox } from "./design-system/Checkbox";
import { Loader } from "./design-system/Loader";
import { Button } from "./design-system/Button";
import type { GameSocket } from "./realtime";
import { ArkenDialog } from "./ui/ArkenDialog";
import { EmptyState, ErrorState } from "./ui/EntityState";
import { notify } from "./ui/notifications";
import { isAudioConsentError } from "./audio-playback";
import { volumeSliderToGain } from "./audio-volume";
import { resolvePlaybackAction } from "./music-playback";
import { useDismissibleDetails } from "./ui/dismissible-details";
import { AppIcon } from "./ui/AppIcon";
import {
  MoreIcon,
  MutedVolumeIcon,
  PauseIcon,
  PlayIcon,
  VolumeIcon,
} from "./ui/icons";
import { createPortal } from "react-dom";

const ENABLED_KEY = "arken.audio.enabled";
const VOLUME_KEY = "arken.audio.volume";
// ACK reasons are protocol strings, not display text. Map only known reasons;
// an unknown value (including an object-prototype key) gets a safe fallback.
const audioCommandErrors: ReadonlyMap<string, string> = new Map([
  ["GM_REQUIRED", "Управлять музыкой может только ведущий."],
  ["INVALID_COMMAND", "Некорректная команда управления музыкой."],
  ["ASSET_NOT_FOUND", "Аудиофайл не найден. Выберите другой трек."],
  ["REVISION_CONFLICT", "Состояние музыки изменилось. Повторите команду."],
  ["AUDIO_NOT_SELECTED", "Трек не выбран или его длительность недоступна."],
  [
    "AUDIO_END_NOT_APPLICABLE",
    "Сейчас нельзя завершить воспроизведение трека.",
  ],
  ["AUDIO_UPDATE_FAILED", "Не удалось обновить музыку. Повторите команду."],
]);
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
  controlsTarget,
}: {
  audio: AudioStateDto;
  assets: AssetDto[];
  role: Role;
  socket: GameSocket | null;
  onUpload: (file: File, kind: "AUDIO") => Promise<AssetDto>;
  controlsTarget?: HTMLElement | null;
}) {
  const element = useRef<HTMLAudioElement>(null);
  // Both topbar popovers are absolutely positioned over the sidebar, so an
  // open one swallows clicks meant for the chat tabs underneath it. Every
  // other `details` popover in the app already dismisses on outside pointer
  // and Escape; these two were the only ones left behind.
  const volumeRef = useRef<HTMLDetailsElement>(null);
  const overflowRef = useRef<HTMLDetailsElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem(ENABLED_KEY) !== "false",
  );
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const playbackBlockedRef = useRef(false);
  const [volume, setVolume] = useState(() => {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored === null) return 0.5;
    const saved = Number(stored);
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
    localStorage.setItem(VOLUME_KEY, String(volume));
    if (element.current) element.current.volume = volumeSliderToGain(volume);
  }, [volume]);

  const lastSyncRef = useRef<{
    revision: number;
    assetId: string | null;
    sourceUrl: string | null;
    playing: boolean;
    loop: boolean;
    enabled: boolean;
    hasCurrent: boolean;
  }>({
    revision: -1,
    assetId: null,
    sourceUrl: null,
    playing: false,
    loop: false,
    enabled: false,
    hasCurrent: false,
  });
  const playAttemptInFlightRef = useRef(false);
  const attemptPlayback = (player: HTMLAudioElement) => {
    if (playAttemptInFlightRef.current) return;
    playAttemptInFlightRef.current = true;
    const onFailure = (reason: unknown) => {
      playAttemptInFlightRef.current = false;
      // A scene/snapshot change may abort a pending play request; only
      // consent failures require a new user gesture.
      if (!isAudioConsentError(reason)) return;
      playbackBlockedRef.current = true;
      setPlaybackBlocked(true);
    };
    let pending: Promise<void> | undefined;
    try {
      pending = player.play();
    } catch (reason) {
      onFailure(reason);
      return;
    }
    void Promise.resolve(pending).then(() => {
      playAttemptInFlightRef.current = false;
      playbackBlockedRef.current = false;
      setPlaybackBlocked(false);
    }, onFailure);
  };

  useEffect(() => {
    const player = element.current;
    if (!player) return;
    player.loop = audio.loop;

    const trackDuration =
      (Number.isFinite(player.duration) && player.duration > 0
        ? player.duration
        : current?.durationSeconds) || 0;

    const elapsed =
      audio.playing && audio.startedAt
        ? (Date.now() - new Date(audio.startedAt).getTime()) / 1000
        : 0;
    const rawExpected = audio.positionSeconds + Math.max(0, elapsed);
    const expected =
      audio.loop && trackDuration > 0
        ? ((rawExpected % trackDuration) + trackDuration) % trackDuration
        : rawExpected;

    const hasCurrent = Boolean(current);
    const lastSync = lastSyncRef.current;
    const isUnrelatedUpdate =
      lastSync.revision === audio.revision &&
      lastSync.assetId === audio.assetId &&
      lastSync.sourceUrl === (current?.url ?? null) &&
      lastSync.playing === audio.playing &&
      lastSync.loop === audio.loop &&
      lastSync.enabled === enabled &&
      lastSync.hasCurrent === hasCurrent;

    if (isUnrelatedUpdate) {
      // LOCAL-9802: Unrelated snapshot updates (e.g. token deletion or moving objects)
      // must not disturb ongoing playback, re-seek, or overwrite continuous playback.
      return;
    }

    lastSyncRef.current = {
      revision: audio.revision,
      assetId: audio.assetId,
      sourceUrl: current?.url ?? null,
      playing: audio.playing,
      loop: audio.loop,
      enabled,
      hasCurrent,
    };

    setPosition(expected);
    if (!enabled || !current) {
      player.pause();
      return;
    }
    if (Math.abs(player.currentTime - expected) > 0.75)
      player.currentTime = expected;
    const action = resolvePlaybackAction(audio.playing, player.paused);
    if (action === "play" && !playbackBlockedRef.current)
      attemptPlayback(player);
    else if (action === "pause") player.pause();
  }, [audio, current, enabled]);
  // A blocked autoplay attempt is not an explicit mute. Retry in the next
  // user gesture instead of forcing an extra consent click in the popover.
  useEffect(() => {
    if (!playbackBlocked || !enabled || !audio.playing || !current) return;
    const onGesture = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".music-volume-control, .music-enable-button")
      )
        return;
      if (!playbackBlockedRef.current) return;
      const player = element.current;
      if (!player) return;
      playbackBlockedRef.current = false;
      attemptPlayback(player);
    };
    document.addEventListener("pointerdown", onGesture, true);
    document.addEventListener("keydown", onGesture, true);
    return () => {
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("keydown", onGesture, true);
    };
  }, [playbackBlocked, enabled, audio.playing, current]);

  const retryPlayback = () => {
    const player = element.current;
    if (!enabled || !audio.playing || !current || !player) return;
    playbackBlockedRef.current = false;
    attemptPlayback(player);
  };
  const setAudioEnabled = (next: boolean) => {
    localStorage.setItem(ENABLED_KEY, String(next));
    setEnabled(next);
    playbackBlockedRef.current = false;
    setPlaybackBlocked(false);
    if (next && audio.playing && current && element.current)
      attemptPlayback(element.current);
    else if (!next) element.current?.pause();
  };

  useDismissibleDetails(volumeRef);
  useDismissibleDetails(overflowRef);

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
            message:
              audioCommandErrors.get(result.reason ?? "") ??
              "Сервер отклонил команду",
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

  const controls = (
    <section className="music-topbar" aria-label="Музыка">
      <strong
        className="music-topbar__title"
        title={current?.name ?? "Композиция 4'33"}
      >
        {current?.name ?? "Композиция 4'33"}
      </strong>
      {playbackBlocked && enabled && audio.playing && current ? (
        <button
          type="button"
          className="music-enable-button"
          onClick={retryPlayback}
        >
          Включить звук
        </button>
      ) : null}
      <button
        type="button"
        className="music-icon-button"
        aria-label={audio.playing ? "Пауза" : "Играть"}
        title={audio.playing ? "Пауза" : "Играть"}
        disabled={role !== "GM" || !current}
        onClick={togglePlayback}
      >
        <AppIcon icon={audio.playing ? PauseIcon : PlayIcon} />
      </button>
      <details className="music-volume-control" ref={volumeRef}>
        <summary aria-label="Громкость" title="Громкость">
          <AppIcon icon={VolumeIcon} />
        </summary>
        <div className="music-volume-popover">
          <label>
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
          <button
            type="button"
            className="music-volume-popover__mute"
            aria-label={enabled ? "Выключить звук" : "Включить звук"}
            title={enabled ? "Выключить звук" : "Включить звук"}
            onClick={() => setAudioEnabled(!enabled)}
          >
            <AppIcon icon={enabled ? VolumeIcon : MutedVolumeIcon} />
          </button>
        </div>
      </details>
      {role === "GM" ? (
        <details className="music-overflow" ref={overflowRef}>
          <summary aria-label="Меню музыки" title="Меню музыки">
            <AppIcon icon={MoreIcon} />
          </summary>
          <div className="music-overflow__menu">
            <span className="music-overflow__now-playing">
              {current?.name ?? "Трек не выбран"}
            </span>
            {tracks.length ? (
              tracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  className={
                    track.id === current?.id ? "is-selected" : undefined
                  }
                  onClick={() => {
                    sendCommand({ command: "SELECT", assetId: track.id });
                    if (overflowRef.current) {
                      overflowRef.current.open = false;
                      overflowRef.current
                        .querySelector<HTMLElement>("summary")
                        ?.focus();
                    }
                  }}
                >
                  {track.name}
                </button>
              ))
            ) : (
              <span className="music-overflow__empty">
                Нет доступных треков
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                if (overflowRef.current) {
                  overflowRef.current.open = false;
                  overflowRef.current
                    .querySelector<HTMLElement>("summary")
                    ?.focus();
                }
                setLibraryOpen(true);
              }}
            >
              Открыть библиотеку
            </button>
          </div>
        </details>
      ) : null}
    </section>
  );

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
      {controlsTarget ? createPortal(controls, controlsTarget) : controls}
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
