import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetDto, AudioPurpose, Role, SoundpadPackDto } from "@arken/contracts";
import type { GameSocket } from "./realtime.js";
import { SoundEffectsPlayback } from "./sound-effects-playback.js";
import { ArkenDialog } from "./ui/ArkenDialog";
import "./SoundpadWorkspace.css";

type Props = { campaignId: string; membershipId: string; role: Role; assets: AssetDto[]; socket: GameSocket | null; onUpload: (file: File, kind: "AUDIO", options?: { audioPurpose?: AudioPurpose }) => Promise<AssetDto>; onRefreshSnapshot?: () => Promise<void>; launcherTarget?: HTMLElement | null };
type SoundpadResponse = { packs: SoundpadPackDto[]; playerPlaybackEnabled: boolean };
const DEFAULT_CLIPS = [
  { file: "evil-laugh.ogg", label: "Злодейский смех", icon: "😈", category: "Реакции", sourceNote: "CC0 · AntumDeluge — Evil Laugh · OpenGameArt" },
  { file: "surprise-oh-my.wav", label: "О, боже!", icon: "😮", category: "Реакции", sourceNote: "CC0 · rubenwardy — Oh My / Help Me (English voice) · OpenGameArt" },
] as const;

function isEffectAsset(asset: AssetDto | undefined): asset is AssetDto {
  return Boolean(asset && asset.kind === "AUDIO" && (asset.audioPurpose === "SOUND_EFFECT" || asset.audioPurpose === "BOTH"));
}

function readFavoriteIds(storageKey: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set<string>(); }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : "REQUEST_FAILED");
  return value as T;
}

export function SoundpadWorkspace({ campaignId, membershipId, role, assets, socket, onUpload, onRefreshSnapshot, launcherTarget }: Props) {
  const [data, setData] = useState<SoundpadResponse>({ packs: [], playerPlaybackEnabled: true });
  const [error, setError] = useState("");
  const busRef = useRef<SoundEffectsPlayback | null>(null);
  if (!busRef.current) busRef.current = new SoundEffectsPlayback(undefined, 4, () => setError("Не удалось воспроизвести звуковой эффект."));
  const bus = busRef.current;
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const unlockPending = useRef(false);
  const [unlocked, setUnlocked] = useState(false);
  const [volume, setVolume] = useState(() => {
    const stored = localStorage.getItem(`arken.effects.volume.${campaignId}.${membershipId}`);
    if (stored === null) return 0.5;
    const saved = Number(stored);
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.5;
  });
  const [muted, setMuted] = useState(() => localStorage.getItem(`arken.effects.muted.${campaignId}.${membershipId}`) === "true");
  const [newPackName, setNewPackName] = useState("");
  const [selectedPack, setSelectedPack] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const favoriteStorageKey = `arken.soundpad.favorites.${campaignId}.${membershipId}`;
  const [favoriteSnapshot, setFavoriteSnapshot] = useState(() => ({ key: favoriteStorageKey, ids: readFavoriteIds(favoriteStorageKey) }));
  const favorites = favoriteSnapshot.key === favoriteStorageKey ? favoriteSnapshot.ids : readFavoriteIds(favoriteStorageKey);
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const [managePackId, setManagePackId] = useState("");
  const managementPack = data.packs.find((pack) => pack.id === managePackId) ?? data.packs[0];
  const filteredPacks = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return data.packs.map((pack) => {
      const packMatches = query.length === 0 || pack.name.toLocaleLowerCase().includes(query);
      const sounds = pack.sounds.filter((sound) => {
        const asset = assetsById.get(sound.assetId);
        const available = isEffectAsset(asset) && asset.durationSeconds !== null && asset.durationSeconds > 0 && asset.durationSeconds <= 10;
        const matchesQuery = query.length === 0 || packMatches || sound.label.toLocaleLowerCase().includes(query);
        return available && matchesQuery && (!onlyFavorites || favorites.has(sound.id));
      }).sort((left, right) => Number(favorites.has(right.id)) - Number(favorites.has(left.id)));
      const showEmptyGmPack = role === "GM" && !onlyFavorites && pack.sounds.length === 0 && (!query || packMatches);
      return { ...pack, sounds, show: sounds.length > 0 || showEmptyGmPack };
    }).filter((pack) => pack.show);
  }, [data.packs, assetsById, searchTerm, onlyFavorites, favorites, role]);
  const latestRef = useRef({ packs: data.packs, assetsById, unlocked, volume, muted });
  latestRef.current = { packs: data.packs, assetsById, unlocked, volume, muted };
  const loadInFlight = useRef<Promise<SoundpadResponse | null> | null>(null);
  const loadAgain = useRef(false);
  const playbackSession = useRef(0);
  const catalogueSession = useRef(0);
  const load = () => {
    if (loadInFlight.current) {
      loadAgain.current = true;
      return loadInFlight.current;
    }
    const fetchUntilFresh = async () => {
      while (true) {
        loadAgain.current = false;
        let fresh: SoundpadResponse;
        try {
          fresh = await request<SoundpadResponse>("/api/soundpad");
        } catch (error) {
          if (loadAgain.current) continue;
          throw error;
        }
        setData(fresh); setError("");
        if (!loadAgain.current) return fresh;
      }
    };
    const task = fetchUntilFresh().catch(() => { setError("Не удалось загрузить саундпад."); return null; }).finally(() => {
      if (loadInFlight.current === task) loadInFlight.current = null;
    });
    loadInFlight.current = task;
    return task;
  };
  useEffect(() => { void load(); }, [campaignId]);
  useEffect(() => {
    if (!socket) return;
    const session = ++catalogueSession.current;
    const connect = () => { playbackSession.current++; bus.setConnected(); void load(); };
    const disconnect = () => { playbackSession.current++; bus.setDisconnected(); };
    const onTrigger = (event: Parameters<typeof bus.play>[0]) => {
      const playFrom = (packs: SoundpadPackDto[]) => {
        const state = latestRef.current;
        const sound = packs.flatMap((pack) => pack.sounds).find((item) => item.id === event.soundId);
        const asset = sound ? state.assetsById.get(sound.assetId) : undefined;
        if (sound && isEffectAsset(asset)) bus.play(event, asset.url, state.volume, state.muted);
        return Boolean(sound && isEffectAsset(asset));
      };
      if (!playFrom(latestRef.current.packs)) {
        const capturedSession = playbackSession.current;
        void load().then((fresh) => {
          if (fresh && capturedSession === playbackSession.current && socket.connected) playFrom(fresh.packs);
        });
      }
    };
    const onStop = () => { playbackSession.current++; bus.stop(); };
    const onPolicy = (policy: { playerPlaybackEnabled: boolean }) => setData((current) => ({ ...current, playerPlaybackEnabled: policy.playerPlaybackEnabled }));
    const onCatalogueChanged = async () => {
      try {
        // A newly published sound may reference an asset that was not yet
        // eligible for the previous snapshot projection. Refresh metadata
        // after the server's catalog mutation has committed, then re-read
        // the role-filtered pack list.
        await onRefreshSnapshot?.();
      } catch {
        // Still refresh the catalogue; a later invalidation/reconnect can
        // retry snapshot metadata without an unhandled rejection.
      }
      if (catalogueSession.current !== session) return;
      await load();
    };
    socket.on("connect", connect); socket.on("disconnect", disconnect); socket.on("soundpad:triggered", onTrigger); socket.on("soundpad:stopped", onStop); socket.on("soundpad:policy", onPolicy); socket.on("soundpad:catalog:changed", onCatalogueChanged);
    if (socket.connected) connect();
    return () => { catalogueSession.current++; playbackSession.current++; socket.off("connect", connect); socket.off("disconnect", disconnect); socket.off("soundpad:triggered", onTrigger); socket.off("soundpad:stopped", onStop); socket.off("soundpad:policy", onPolicy); socket.off("soundpad:catalog:changed", onCatalogueChanged); bus.disposeAll(); };
  }, [socket, bus, onRefreshSnapshot]);
  useEffect(() => { localStorage.setItem(`arken.effects.volume.${campaignId}.${membershipId}`, String(volume)); }, [campaignId, membershipId, volume]);
  useEffect(() => { localStorage.setItem(`arken.effects.muted.${campaignId}.${membershipId}`, String(muted)); if (muted) bus.mute(); }, [campaignId, membershipId, muted, bus]);

  const mutate = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); await load(); } catch { setError("Команда не выполнена. Проверьте соединение и права."); } finally { setBusy(false); }
  };
  const createPack = () => mutate(async () => {
    const name = newPackName.trim(); if (!name) return;
    const result = await request<{ packId: string }>("/api/soundpad/packs", "POST", { name });
    setSelectedPack(result.packId); setNewPackName("");
  });
  const addSound = (assetId: string, label: string, icon: string, category: string, note: string) => mutate(async () => {
    const packId = selectedPack || data.packs[0]?.id;
    if (!packId) throw new Error("PACK_REQUIRED");
    await request(`/api/soundpad/packs/${packId}/sounds`, "POST", { assetId, label, icon, category, sourceNote: note || null, defaultGain: 0.5, audience: "ALL_MEMBERS" });
    setSourceNote("");
  });
  const installStarter = () => mutate(async () => {
    const latest = await request<SoundpadResponse>("/api/soundpad");
    setData(latest);
    const pack = await request<{ packId: string }>("/api/soundpad/packs", "POST", { name: "Arken CC0 — ситуативные звуки" });
    setSelectedPack(pack.packId);
    for (const clip of DEFAULT_CLIPS) {
      const existing = latest.packs.flatMap((item) => item.sounds).some((sound) => sound.sourceNote === clip.sourceNote);
      if (existing) continue;
      const response = await fetch(`/soundpad-defaults/${clip.file}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("BUNDLED_CLIP_UNAVAILABLE");
      const blob = await response.blob();
      const file = new File([blob], clip.file, { type: blob.type || (clip.file.endsWith(".ogg") ? "audio/ogg" : "audio/wav") });
      const asset = await onUpload(file, "AUDIO", { audioPurpose: "SOUND_EFFECT" });
      await request(`/api/soundpad/packs/${pack.packId}/sounds`, "POST", { assetId: asset.id, label: clip.label, icon: clip.icon, category: clip.category, sourceNote: clip.sourceNote, defaultGain: 0.5, audience: "ALL_MEMBERS" });
    }
  });
  const setPackPublished = (packId: string, published: boolean) => mutate(() => request(`/api/soundpad/packs/${packId}`, "PATCH", { published }));
  const setPackAudience = (packId: string, audience: "ALL_MEMBERS" | "GM_ONLY") => mutate(() => request(`/api/soundpad/packs/${packId}`, "PATCH", { audience }));
  const closeSoundpad = () => {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  };
  const setPlayerPolicy = (playerPlaybackEnabled: boolean) => mutate(() => request("/api/soundpad/player-policy", "PUT", { playerPlaybackEnabled }));
  const toggleFavorite = (soundId: string) => {
    const next = new Set(favorites);
    if (next.has(soundId)) next.delete(soundId); else next.add(soundId);
    setFavoriteSnapshot({ key: favoriteStorageKey, ids: next });
    try { localStorage.setItem(favoriteStorageKey, JSON.stringify([...next])); } catch { setError("Не удалось сохранить избранное на этом устройстве."); }
  };
  const enableEffects = useCallback(() => {
    if (muted || unlocked || unlockPending.current) return;
    unlockPending.current = true;
    setError("");
    // A 1-sample silent WAV attempts to unlock during a genuine user action;
    // it is never a pack sound and contains no audible test tone.
    const bytes = new Uint8Array(45); const view = new DataView(bytes.buffer);
    const ascii = (offset: number, text: string) => [...text].forEach((character, index) => bytes[offset + index] = character.charCodeAt(0));
    ascii(0, "RIFF"); view.setUint32(4, 37, true); ascii(8, "WAVEfmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
    ascii(36, "data"); view.setUint32(40, 1, true); bytes[44] = 128;
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    const unlockAudio = new Audio(url); unlockAudio.volume = 0;
    void unlockAudio.play().then(() => {
      if (!latestRef.current.muted) {
        setUnlocked(true);
        bus.setConnected(Date.now());
      }
    }).catch(() => {
      setUnlocked(false);
      setError("Браузер блокирует звук. Следующее действие повторит попытку.");
    }).finally(() => {
      unlockPending.current = false;
      unlockAudio.pause();
      URL.revokeObjectURL(url);
    });
  }, [bus, muted, unlocked]);
  useEffect(() => {
    const unlockFromTrustedGesture = (event: Event) => {
      if (!event.isTrusted || latestRef.current.muted || latestRef.current.unlocked || unlockPending.current) return;
      if (event.type === "keydown" && ["Tab", "Shift", "Control", "Alt", "Meta", "Escape"].includes((event as KeyboardEvent).key)) return;
      enableEffects();
    };
    document.addEventListener("pointerdown", unlockFromTrustedGesture, true);
    document.addEventListener("keydown", unlockFromTrustedGesture, true);
    return () => {
      document.removeEventListener("pointerdown", unlockFromTrustedGesture, true);
      document.removeEventListener("keydown", unlockFromTrustedGesture, true);
    };
  }, [enableEffects]);
  const trigger = (soundId: string) => {
    if (!unlocked) enableEffects();
    socket?.emit("soundpad:trigger", { soundId, actionId: crypto.randomUUID() });
  };
  const audioAssets = assets.filter((asset) => isEffectAsset(asset) && asset.durationSeconds !== null && asset.durationSeconds > 0 && asset.durationSeconds <= 10);

  const launcher = <button ref={launcherRef} className="soundpad__launcher" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Саундпад</button>;

  return <>
    {launcherTarget ? createPortal(launcher, launcherTarget) : launcher}
    <ArkenDialog open={open} title="Саундпад" footer={false} className="soundpad__dialog" onClose={closeSoundpad}>
    <section className="soundpad" aria-label="Саундпад">
    <header className="soundpad__header"><span className="soundpad__status" role="status">{unlocked ? "Звук включён" : "Эффекты включатся при первом действии"}</span>
      <label>Эффекты <input aria-label="Громкость эффектов" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => { setVolume(Number(event.target.value)); bus.setVolume(Number(event.target.value)); }} /></label>
      <button type="button" aria-pressed={muted} onClick={() => setMuted((value) => !value)}>{muted ? "Включить эффекты" : "Выключить эффекты"}</button>
      {role === "GM" && <button type="button" onClick={() => socket?.emit("soundpad:stop")}>Остановить эффекты</button>}
    </header>
    {error && <p className="soundpad__error" role="alert">{error}</p>}
    <div className="soundpad__discovery">
      <label>Поиск по звукам и пакам <input type="search" aria-label="Поиск звуков и паков" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Название звука или пака" /></label>
      <label className="soundpad__favorites-filter"><input type="checkbox" checked={onlyFavorites} onChange={(event) => setOnlyFavorites(event.target.checked)} /> Только избранное</label>
    </div>
    {role === "GM" && <details className="soundpad__manager-disclosure"><summary>Управление паками</summary><div className="soundpad__manager">
      <button type="button" disabled={busy} onClick={() => void installStarter()}>Добавить стартовый CC0-пак</button>
      {managementPack && <>
        <label>Управляемый пак <select value={managementPack.id} onChange={(event) => setManagePackId(event.target.value)}>{data.packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}</select></label>
        <button type="button" disabled={busy} onClick={() => void setPackPublished(managementPack.id, !managementPack.published)}>{managementPack.published ? "Скрыть пак" : "Опубликовать пак"}</button>
        <label>Кому доступен <select aria-label={`Кому доступен ${managementPack.name}`} value={managementPack.audience} disabled={busy} onChange={(event) => void setPackAudience(managementPack.id, event.target.value as "ALL_MEMBERS" | "GM_ONLY")}><option value="ALL_MEMBERS">Всем участникам</option><option value="GM_ONLY">Только ведущему</option></select></label>
      </>}
      <form onSubmit={(event) => { event.preventDefault(); void createPack(); }}>
        <label>Название пака <input value={newPackName} maxLength={80} onChange={(event) => setNewPackName(event.target.value)} /></label>
        <button type="submit" disabled={busy || !newPackName.trim()}>Создать пак</button>
      </form>
      <label>Пак для нового звука <select value={selectedPack} onChange={(event) => setSelectedPack(event.target.value)}>
        <option value="">Первый доступный пак</option>{data.packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
      </select></label>
      <label>Источник / лицензия <input value={sourceNote} maxLength={240} onChange={(event) => setSourceNote(event.target.value)} placeholder="Укажите источник и права" /></label>
      <label>Добавить существующий AUDIO <select defaultValue="" onChange={(event) => { const asset = assetsById.get(event.target.value); if (asset) void addSound(asset.id, asset.name.replace(/\.[^.]+$/, ""), "🔊", "Другое", sourceNote); event.currentTarget.value = ""; }}>
        <option value="">Выберите файл ≤ 10 секунд</option>{audioAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </select></label>
      <label className="soundpad__policy"><input type="checkbox" checked={data.playerPlaybackEnabled} onChange={(event) => void setPlayerPolicy(event.target.checked)} disabled={busy} /> Игрокам можно запускать звуки</label>
    </div></details>}
    {data.packs.length === 0 && <p className="soundpad__empty">Пока нет паков. Ведущий может создать пак или добавить стартовый CC0-пак.</p>}
    {data.packs.length > 0 && filteredPacks.length === 0 && <p className="soundpad__empty" role="status">Ничего не найдено. Измените поиск или фильтр избранного.</p>}
    {filteredPacks.map((pack) => <section className="soundpad__pack" key={pack.id} aria-label={pack.name}>
      <div className="soundpad__pack-heading"><h3>{pack.name}</h3></div>
      {pack.sounds.length === 0 ? <p>В этом паке пока нет доступных звуков.</p> : <div className="soundpad__grid">{pack.sounds.map((sound) => {
        return <div className="soundpad__sound-card" key={sound.id}>
          <button type="button" className="soundpad__sound" aria-label={`Запустить звук: ${sound.label}`} disabled={!data.playerPlaybackEnabled && role !== "GM"} onClick={() => trigger(sound.id)} title={sound.sourceNote ?? undefined}>
            <span aria-hidden="true">{sound.icon}</span><span>{sound.label}</span><small>{sound.category}</small>
          </button>
          <button type="button" className="soundpad__favorite" aria-label={`${favorites.has(sound.id) ? "Убрать из" : "Добавить в"} избранное: ${sound.label}`} aria-pressed={favorites.has(sound.id)} onClick={() => toggleFavorite(sound.id)}>{favorites.has(sound.id) ? "★" : "☆"}</button>
        </div>;
      })}</div>}
    </section>)}
    <p className="soundpad__limits">Предложенные лимиты первого среза: эффект до 10 с, не более 4 голосов на устройстве; более старый голос завершается первым. Эффекты не управляют музыкой.</p>
    </section>
    </ArkenDialog>
  </>;
}
