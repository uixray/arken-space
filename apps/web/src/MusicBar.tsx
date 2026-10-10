import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetDto, AudioStateDto, AudioTrackDto, AudioTrackCommand, AudioPurpose, CommandAck, Role } from "@arken/contracts";
import { Checkbox } from "./design-system/Checkbox";
import { Loader } from "./design-system/Loader";
import { Button } from "./design-system/Button";
import type { GameSocket } from "./realtime";
import { ArkenDialog } from "./ui/ArkenDialog";
import { EmptyState, ErrorState } from "./ui/EntityState";
import { notify } from "./ui/notifications";
import { isAudioConsentError } from "./audio-playback";
import { volumeSliderToGain } from "./audio-volume";
import { resolveTrackPosition } from "./music-playback";
import { useDismissibleDetails } from "./ui/dismissible-details";
import { AppIcon } from "./ui/AppIcon";
import {
  PlaylistIcon,
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
  ["AUDIO_PURPOSE_NOT_MUSIC", "Этот файл предназначен для звуковых эффектов, а не для музыки."],
  ["TRACK_LIMIT_REACHED", "Достигнут предел дорожек микшера."],
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

/** One stable media element per authoritative track. Local gain is deliberately
 * kept out of transport reconciliation, so a mixer fader cannot seek/restart. */
function AudioTrackPlayback({ track, asset, enabled, masterVolume, retryToken, onBlocked, onProgress, onEnded, seekToSeconds }: {
  track: AudioTrackDto;
  asset: AssetDto | undefined;
  enabled: boolean;
  masterVolume: number;
  retryToken: number;
  onBlocked: (trackId: string | null) => void;
  onProgress: (trackId: string, assetId: string | null, positionSeconds: number, durationSeconds: number) => void;
  onEnded: (track: AudioTrackDto) => void;
  seekToSeconds: number | null;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const blocked = useRef(false);
  const lastPlaybackKey = useRef<string | null>(null);
  const lastRetryToken = useRef(0);
  useEffect(() => {
    if (ref.current) ref.current.volume = volumeSliderToGain(masterVolume * track.mixVolume);
  }, [masterVolume, track.mixVolume]);
  useEffect(() => {
    if (ref.current && seekToSeconds !== null && Number.isFinite(seekToSeconds))
      ref.current.currentTime = Math.max(0, seekToSeconds);
  }, [seekToSeconds]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const playbackKey = JSON.stringify([enabled, track.assetId, asset?.url, track.playing]);
    const transportChanged = lastPlaybackKey.current !== playbackKey;
    lastPlaybackKey.current = playbackKey;
    const retryRequested = retryToken > lastRetryToken.current;
    if (retryRequested) lastRetryToken.current = retryToken;
    el.loop = track.loop;
    if (!enabled || !track.playing || !asset) { el.pause(); return; }
    const duration = el.duration > 0 ? el.duration : asset.durationSeconds ?? 0;
    const elapsed = track.startedAt ? Math.max(0, (Date.now() - Date.parse(track.startedAt)) / 1000) : 0;
    const raw = track.positionSeconds + elapsed;
    const expected = resolveTrackPosition(raw, duration, track.loop);
    if (Math.abs(el.currentTime - expected) > 0.75) el.currentTime = expected;
    if ((!blocked.current || retryRequested) && ((transportChanged && track.playing) || retryRequested)) {
      try {
        void Promise.resolve(el.play()).then(() => onBlocked(null), (error: unknown) => {
          if (isAudioConsentError(error)) { blocked.current = true; onBlocked(track.id); }
        });
      } catch (error) {
        if (isAudioConsentError(error)) { blocked.current = true; onBlocked(track.id); }
      }
    }
  }, [track.id, track.playing, track.positionSeconds, track.startedAt, track.loop, asset?.id, asset?.url, enabled, retryToken, onBlocked]);
  useEffect(() => {
    if (enabled) blocked.current = false;
  }, [enabled, retryToken]);
  useEffect(() => {
    if (!enabled || !track.playing || !asset) return;
    const retry = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".music-volume-control")) return;
      const el = ref.current;
      if (!el || !blocked.current) return;
      blocked.current = false;
      void Promise.resolve(el.play()).then(() => onBlocked(null), (error: unknown) => { if (isAudioConsentError(error)) blocked.current = true; });
    };
    document.addEventListener("pointerdown", retry, true);
    document.addEventListener("keydown", retry, true);
    return () => { document.removeEventListener("pointerdown", retry, true); document.removeEventListener("keydown", retry, true); };
  }, [enabled, track.id, track.playing, asset?.id, onBlocked]);
  useEffect(() => {
    const el = ref.current;
    return () => { el?.pause(); if (el) { el.removeAttribute("src"); el.load(); } };
  }, []);
  const reportProgress = (element: HTMLAudioElement) =>
    onProgress(track.id, track.assetId, element.currentTime,
      Number.isFinite(element.duration) && element.duration > 0 ? element.duration : asset?.durationSeconds ?? 0);
  return <audio ref={ref} src={asset?.url} preload="auto" aria-label={asset?.name ?? "Аудиодорожка"}
    onTimeUpdate={(event) => reportProgress(event.currentTarget)}
    onLoadedMetadata={(event) => reportProgress(event.currentTarget)}
    onDurationChange={(event) => reportProgress(event.currentTarget)}
    onSeeked={(event) => reportProgress(event.currentTarget)}
    onEnded={(event) => { reportProgress(event.currentTarget); if (!track.loop && track.playing) onEnded(track); }} />;
}

function MixerTrackControls({ track, asset, livePositionSeconds, liveDurationSeconds, onCommand }: {
  track: AudioTrackDto;
  asset: AssetDto | undefined;
  livePositionSeconds: number;
  liveDurationSeconds: number;
  onCommand: (track: AudioTrackDto, command: { command: "PLAY" | "PAUSE" | "END" } | { command: "SEEK"; positionSeconds: number } | { command: "SET_LOOP"; loop: boolean } | { command: "SET_MIX_VOLUME"; mixVolume: number } | { command: "SELECT"; assetId: string | null } | { command: "REMOVE_TRACK" }) => void;
}) {
  const [mix, setMix] = useState(track.mixVolume);
  const [position, setPosition] = useState(livePositionSeconds);
  const seeking = useRef(false);
  useEffect(() => setMix(track.mixVolume), [track.mixVolume]);
  useEffect(() => { if (!seeking.current) setPosition(livePositionSeconds); }, [livePositionSeconds]);
  const commitMix = () => onCommand(track, { command: "SET_MIX_VOLUME", mixVolume: mix });
  const commitPosition = (value = position) => { seeking.current = false; setPosition(value); onCommand(track, { command: "SEEK", positionSeconds: value }); };
  const duration = (liveDurationSeconds > 0 ? liveDurationSeconds : asset?.durationSeconds) ?? Math.max(livePositionSeconds, 1);
  return <div className="music-mixer-track" key={track.id}>
    <strong>{asset?.name ?? "Без аудио"}</strong>
    <Button disabled={!asset} onClick={() => onCommand(track, { command: track.playing ? "PAUSE" : "PLAY" })}>{track.playing ? "Пауза" : "Играть"}</Button>
    <label>Позиция дорожки <input aria-label={`Позиция дорожки ${asset?.name ?? track.id}`} type="range" min="0" max={Math.max(1, duration)} step="1" value={Math.min(position, duration)} disabled={!asset} onPointerDown={() => { seeking.current = true; }} onChange={(event) => { seeking.current = true; setPosition(Number(event.target.value)); }} onPointerUp={(event) => commitPosition(Number(event.currentTarget.value))} onKeyUp={(event) => commitPosition(Number(event.currentTarget.value))} /></label>
    <Checkbox checked={track.loop} onUpdate={(loop) => onCommand(track, { command: "SET_LOOP", loop })}>Повтор</Checkbox>
    <label>Громкость дорожки <input aria-label={`Громкость дорожки ${asset?.name ?? track.id}`} type="range" min="0" max="1" step="0.05" value={mix} onChange={(event) => setMix(Number(event.target.value))} onPointerUp={commitMix} onKeyUp={commitMix} /></label>
    <Button onClick={() => onCommand(track, { command: "REMOVE_TRACK" })}>Убрать</Button>
  </div>;
}

export function MusicBar({
  audioTracks,
  assets,
  role,
  socket,
  onUpload,
  controlsTarget,
}: {
  audio: AudioStateDto;
  audioTracks: AudioTrackDto[];
  assets: AssetDto[];
  role: Role;
  socket: GameSocket | null;
  onUpload: (file: File, kind: "AUDIO", options?: { audioPurpose?: AudioPurpose }) => Promise<AssetDto>;
  controlsTarget?: HTMLElement | null;
}) {
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
  const [, setBlockedTrackId] = useState<string | null>(null);
  const [playbackRetryToken, setPlaybackRetryToken] = useState(0);
  const [volume, setVolume] = useState(() => {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored === null) return 0.5;
    const saved = Number(stored);
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.5;
  });
  const [trackProgress, setTrackProgress] = useState<Record<string, { assetId: string | null; positionSeconds: number; durationSeconds: number }>>({});
  const [seekDraft, setSeekDraft] = useState<{ trackId: string; positionSeconds: number } | null>(null);
  const seekingTrackId = useRef<string | null>(null);
  const [pending, setPending] = useState<PendingAudio | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const tracks = useMemo(
    () => assets.filter((asset) => asset.kind === "AUDIO" && (asset.audioPurpose ?? "MUSIC") !== "SOUND_EFFECT"),
    [assets],
  );
  const mixerTracks = audioTracks.slice().sort((a, b) => a.slotOrder - b.slotOrder).slice(0, 4);
  const activeTrack = mixerTracks[0];
  const activeAsset = tracks.find((asset) => asset.id === activeTrack?.assetId);
  const activeProgress = activeTrack && trackProgress[activeTrack.id]?.assetId === activeTrack.assetId
    ? trackProgress[activeTrack.id]
    : undefined;
  const duration = activeProgress?.durationSeconds || activeAsset?.durationSeconds || 0;
  const position = seekDraft !== null && seekDraft.trackId === activeTrack?.id
    ? seekDraft.positionSeconds
    : activeProgress?.positionSeconds ?? activeTrack?.positionSeconds ?? 0;
  const trackSourcesRef = useRef(new Map<string, string | null>());
  trackSourcesRef.current = new Map(mixerTracks.map((track) => [track.id, track.assetId]));
  const trackSourceKey = mixerTracks.map((track) => `${track.id}:${track.assetId ?? "none"}`).join("|");
  const previousTrackSourceKey = useRef(trackSourceKey);
  useEffect(() => {
    setTrackProgress((previous) => Object.fromEntries(
      Object.entries(previous).filter(([trackId, progress]) => trackSourcesRef.current.get(trackId) === progress.assetId),
    ));
    if (previousTrackSourceKey.current !== trackSourceKey) {
      previousTrackSourceKey.current = trackSourceKey;
      seekingTrackId.current = null;
      setSeekDraft(null);
    }
  }, [trackSourceKey]);
  const reportProgress = (trackId: string, assetId: string | null, positionSeconds: number, durationSeconds: number) => {
    if (trackSourcesRef.current.get(trackId) !== assetId || seekingTrackId.current === trackId) return;
    setTrackProgress((previous) => ({ ...previous, [trackId]: {
      assetId,
      positionSeconds: Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0,
      durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
    } }));
  };

  const pendingUrl = pending?.url;
  useEffect(
    () => () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    },
    [pendingUrl],
  );
  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume]);

  const setAudioEnabled = (next: boolean) => {
    localStorage.setItem(ENABLED_KEY, String(next));
    setEnabled(next);
    if (next) setPlaybackRetryToken((value) => value + 1);
  };

  useDismissibleDetails(volumeRef);
  useDismissibleDetails(overflowRef);

  const sendTrackCommand = (track: AudioTrackDto, command: { command: "PLAY" | "PAUSE" | "END" } | { command: "SEEK"; positionSeconds: number } | { command: "SET_LOOP"; loop: boolean } | { command: "SELECT"; assetId: string | null } | { command: "SET_MIX_VOLUME"; mixVolume: number } | { command: "REMOVE_TRACK" }) =>
    socket?.emit("audio:track:set", {
      actionId: crypto.randomUUID(), revision: track.revision, trackId: track.id, ...command,
    } as AudioTrackCommand, (result: CommandAck<AudioTrackDto>) => {
      if (!result.ok) notify({ title: "Не удалось изменить дорожку", message: audioCommandErrors.get(result.reason ?? "") ?? "Сервер отклонил команду", tone: "danger" });
    });

  const addTrack = (assetId: string) => socket?.emit("audio:track:set", {
    actionId: crypto.randomUUID(), command: "ADD_TRACK", assetId,
  }, (result: CommandAck<AudioTrackDto>) => { if (!result.ok) notify({ title: "Не удалось добавить дорожку", message: audioCommandErrors.get(result.reason ?? "") ?? "Сервер отклонил команду", tone: "danger" }); });

  const selectAsset = (assetId: string) => {
    if (activeTrack) sendTrackCommand(activeTrack, { command: "SELECT", assetId });
    else addTrack(assetId);
  };
  const commitSeek = (positionSeconds: number) => {
    if (!activeTrack) return;
    seekingTrackId.current = null;
    setSeekDraft(null);
    sendTrackCommand(activeTrack, { command: "SEEK", positionSeconds });
  };

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
      const asset = await onUpload(pending.file, "AUDIO", { audioPurpose: "MUSIC" });
      if (activeTrack) sendTrackCommand(activeTrack, { command: "SELECT", assetId: asset.id });
      else addTrack(asset.id);
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
  const togglePlayback = () => activeTrack && sendTrackCommand(activeTrack, { command: activeTrack.playing ? "PAUSE" : "PLAY" });

  const controls = (
    <section className="music-topbar" aria-label="Музыка">
      <strong
        className="music-topbar__title"
        title={activeAsset?.name ?? "Композиция 4'33"}
      >
        {activeAsset?.name ?? "Композиция 4'33"}
      </strong>
      <button
        type="button"
        className="music-icon-button"
        aria-label={activeTrack?.playing ? "Пауза" : "Играть"}
        title={activeTrack?.playing ? "Пауза" : "Играть"}
        disabled={role !== "GM" || !activeTrack}
        onClick={togglePlayback}
      >
        <AppIcon icon={activeTrack?.playing ? PauseIcon : PlayIcon} />
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
          <summary aria-label="Плейлист" title="Плейлист">
            <AppIcon icon={PlaylistIcon} />
          </summary>
          <div className="music-overflow__menu">
            <button
              type="button"
              className="music-overflow__library"
              onClick={() => {
                if (overflowRef.current) {
                  overflowRef.current.open = false;
                  overflowRef.current.querySelector<HTMLElement>("summary")?.focus();
                }
                setLibraryOpen(true);
              }}
            >
              <AppIcon icon={PlaylistIcon} />
              Открыть библиотеку
            </button>
            <span className="music-overflow__now-playing">
              {activeAsset?.name ?? "Трек не выбран"}
            </span>
            {tracks.length ? (
              tracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  className={
                    track.id === activeTrack?.assetId ? "is-selected" : undefined
                  }
                  onClick={() => {
                    selectAsset(track.id);
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
          </div>
        </details>
      ) : null}
    </section>
  );

  return (
    <>
      {mixerTracks.map((track) => <AudioTrackPlayback key={`${track.id}:${track.assetId ?? "none"}`} track={track} asset={tracks.find((item) => item.id === track.assetId)} enabled={enabled} masterVolume={volume} retryToken={playbackRetryToken} onBlocked={setBlockedTrackId} onProgress={reportProgress} onEnded={(endedTrack) => { if (role === "GM") sendTrackCommand(endedTrack, { command: "END" }); }} seekToSeconds={seekDraft?.trackId === track.id ? seekDraft.positionSeconds : null} />)}
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
                <strong>{activeAsset?.name ?? "Трек не выбран"}</strong>
              </div>
              <div className="music-library-controls">
                <Button disabled={!activeTrack} onClick={togglePlayback}>
                  {activeTrack?.playing ? "Пауза" : "Играть"}
                </Button>
                <span>
                  {formatTime(position)} / {formatTime(duration)}
                </span>
                <Checkbox
                  checked={activeTrack?.loop ?? false}
                  disabled={!activeTrack}
                  onUpdate={(checked) => activeTrack && sendTrackCommand(activeTrack, { command: "SET_LOOP", loop: checked })}
                >
                  Повторять
                </Checkbox>
              </div>
              <input
                aria-label="Позиция воспроизведения"
                type="range"
                min="0"
                max={Math.max(1, duration || position + 300)}
                step="1"
                disabled={!activeTrack?.assetId}
                value={Math.min(
                  position,
                  duration || position + 300,
                )}
                onChange={(event) => {
                  const positionSeconds = Number(event.target.value);
                  if (activeTrack) {
                    seekingTrackId.current = activeTrack.id;
                    setSeekDraft({ trackId: activeTrack.id, positionSeconds });
                  }
                }}
                onPointerDown={() => { if (activeTrack) seekingTrackId.current = activeTrack.id; }}
                onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
                onKeyUp={(event) => commitSeek(Number(event.currentTarget.value))}
              />
            </section>
            <section>
              <h3>Микшер · до 4 дорожек</h3>
              <div className="music-mixer-list">
                {mixerTracks.map((track) => {
                  const asset = tracks.find((item) => item.id === track.assetId);
                  const progress = trackProgress[track.id]?.assetId === track.assetId ? trackProgress[track.id] : undefined;
                  return <MixerTrackControls key={track.id} track={track} asset={asset} livePositionSeconds={progress?.positionSeconds ?? track.positionSeconds} liveDurationSeconds={progress?.durationSeconds ?? 0} onCommand={sendTrackCommand} />;
                })}
              </div>
              {mixerTracks.length < 4 && tracks.length > 0 ? <label>Добавить дорожку <select aria-label="Добавить дорожку" value="" onChange={(event) => { if (event.target.value) addTrack(event.target.value); }}><option value="">Выберите аудио</option>{tracks.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label> : null}
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
                        track.id === activeTrack?.assetId
                          ? "music-track is-selected"
                          : "music-track"
                      }
                      onClick={() => selectAsset(track.id)}
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
