import { useEffect, useRef, useState } from "react";
import type { AssetDto, AudioStateDto, Role } from "@arken/contracts";
import type { GameSocket } from "./realtime";

export function MusicBar({
  audio,
  assets,
  role,
  socket,
}: {
  audio: AudioStateDto;
  assets: AssetDto[];
  role: Role;
  socket: GameSocket | null;
}) {
  const element = useRef<HTMLAudioElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const tracks = assets.filter((asset) => asset.kind === "AUDIO");
  const current = tracks.find((asset) => asset.id === audio.assetId);

  useEffect(() => {
    const player = element.current;
    if (!player || !enabled || !current) return;
    player.volume = volume;
    const elapsed =
      audio.playing && audio.startedAt
        ? (Date.now() - new Date(audio.startedAt).getTime()) / 1000
        : 0;
    const expected = audio.positionSeconds + Math.max(0, elapsed);
    if (Math.abs(player.currentTime - expected) > 0.75)
      player.currentTime = expected;
    player.loop = audio.loop;
    if (audio.playing) void player.play().catch(() => setEnabled(false));
    else player.pause();
  }, [audio, current, enabled, volume]);

  const setState = (next: Partial<AudioStateDto>) =>
    socket?.emit("audio:set", {
      actionId: crypto.randomUUID(),
      assetId: next.assetId === undefined ? audio.assetId : next.assetId,
      playing: next.playing ?? audio.playing,
      positionSeconds:
        next.positionSeconds ??
        element.current?.currentTime ??
        audio.positionSeconds,
      loop: next.loop ?? audio.loop,
      startedAt:
        next.startedAt === undefined ? audio.startedAt : next.startedAt,
    });

  return (
    <footer className="music-bar">
      <audio ref={element} src={current?.url} preload="auto" />
      <div className="music-state">
        <span>Музыка</span>
        <strong>{current?.name ?? "Трек не выбран"}</strong>
      </div>
      {role === "GM" && (
        <select
          aria-label="Трек"
          value={audio.assetId ?? ""}
          onChange={(event) =>
            setState({
              assetId: event.target.value || null,
              playing: false,
              positionSeconds: 0,
              startedAt: null,
            })
          }
        >
          <option value="">Без трека</option>
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </select>
      )}
      {role === "GM" && (
        <button
          disabled={!current}
          onClick={() =>
            setState(
              audio.playing
                ? {
                    playing: false,
                    positionSeconds: element.current?.currentTime ?? 0,
                    startedAt: null,
                  }
                : {
                    playing: true,
                    positionSeconds:
                      element.current?.currentTime ?? audio.positionSeconds,
                    startedAt: new Date().toISOString(),
                  },
            )
          }
        >
          {audio.playing ? "Пауза" : "Играть"}
        </button>
      )}
      {role === "GM" && (
        <label className="compact-check">
          <input
            type="checkbox"
            checked={audio.loop}
            onChange={(event) => setState({ loop: event.target.checked })}
          />{" "}
          Повтор
        </label>
      )}
      {!enabled ? (
        <button className="primary" onClick={() => setEnabled(true)}>
          Включить звук
        </button>
      ) : (
        <label className="volume">
          Громкость
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
      )}
    </footer>
  );
}
