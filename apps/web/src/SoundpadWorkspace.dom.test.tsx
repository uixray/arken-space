// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@gravity-ui/uikit";
import type { AssetDto } from "@arken/contracts";
import { useCallback, useState, type ReactElement } from "react";
import { SoundpadWorkspace } from "./SoundpadWorkspace";

const sound = { id: "11111111-1111-4111-8111-111111111111", packId: "22222222-2222-4222-8222-222222222222", assetId: "33333333-3333-4333-8333-333333333333", label: "Злодейский смех", icon: "😈", category: "Реакции", sortOrder: 0, defaultGain: 0.5, audience: "ALL_MEMBERS" as const, sourceNote: "CC0" };
const pack = { id: sound.packId, campaignId: "44444444-4444-4444-8444-444444444444", name: "Тестовый пак", published: true, audience: "ALL_MEMBERS" as const, sortOrder: 0, sounds: [sound] };
const asset = { id: sound.assetId, kind: "AUDIO" as const, audioPurpose: "SOUND_EFFECT" as const, name: "laugh.ogg", mimeType: "audio/ogg", sizeBytes: 28146, width: null, height: null, durationSeconds: 2.5, url: "/api/assets/test/content", createdAt: new Date().toISOString() };

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
});

function renderInTheme(element: ReactElement) {
  return render(element, { wrapper: ({ children }) => <ThemeProvider theme="dark" lang="ru">{children}</ThemeProvider> });
}

function renderCatalog(packs: typeof pack[], assets: AssetDto[] = [asset], membershipId = "55555555-5555-4555-8555-555555555555", campaignId = pack.campaignId) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packs, playerPlaybackEnabled: true }) }));
  const result = renderInTheme(<SoundpadWorkspace campaignId={campaignId} membershipId={membershipId} role="PLAYER" assets={assets} socket={null} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  return result;
}

it("keeps the soundpad closed until requested and closes its modal on Escape", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) }));
  renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[asset]} socket={null} onUpload={vi.fn()} />);
  const launcher = screen.getByRole("button", { name: "Саундпад" });
  expect(launcher).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("dialog", { name: "Саундпад" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Запустить звук: Злодейский смех" })).toBeNull();

  fireEvent.click(launcher);
  await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  expect(launcher).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Саундпад" })).toBeNull());
  expect(launcher).toHaveAttribute("aria-expanded", "false");
  await waitFor(() => expect(launcher).toHaveFocus());
});

it("mounts the launcher in the provided header navigation slot", () => {
  const slot = document.createElement("div");
  document.body.append(slot);
  const view = renderInTheme(
    <SoundpadWorkspace
      campaignId={pack.campaignId}
      membershipId="55555555-5555-4555-8555-555555555555"
      role="PLAYER"
      assets={[asset]}
      socket={null}
      onUpload={vi.fn()}
      launcherTarget={slot}
    />,
  );
  expect(slot).toContainElement(screen.getByRole("button", { name: "Саундпад" }));
  view.unmount();
  slot.remove();
});

it("keeps pack management collapsed for GMs and omits it for players", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) }));
  const gm = renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="GM" assets={[asset]} socket={null} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  const disclosure = await screen.findByText("Управление паками");
  expect(disclosure.closest("details")).not.toHaveAttribute("open");
  fireEvent.click(disclosure);
  expect(await screen.findByRole("button", { name: "Добавить стартовый CC0-пак" })).toBeTruthy();

  gm.unmount();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) }));
  renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[asset]} socket={null} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  expect(screen.queryByText("Управление паками")).toBeNull();
  expect(screen.queryByRole("button", { name: "Добавить стартовый CC0-пак" })).toBeNull();
});

it("marks starter-pack uploads explicitly as sound effects", async () => {
  const upload = vi.fn().mockResolvedValue(asset);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/soundpad") return { ok: true, json: async () => ({ packs: [], playerPlaybackEnabled: true }) };
    if (url === "/api/soundpad/packs") return { ok: true, json: async () => ({ packId: pack.id }) };
    if (url.startsWith("/soundpad-defaults/")) return { ok: true, blob: async () => new Blob(["starter"], { type: "audio/ogg" }) };
    return { ok: true, json: async () => ({}) };
  }));
  renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="GM" assets={[asset]} socket={null} onUpload={upload} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  fireEvent.click(await screen.findByText("Управление паками"));
  fireEvent.click(screen.getByRole("button", { name: "Добавить стартовый CC0-пак" }));
  await waitFor(() => expect(upload).toHaveBeenCalled());
  expect(upload).toHaveBeenCalledWith(expect.any(File), "AUDIO", { audioPurpose: "SOUND_EFFECT" });
});

it("renders real sound buttons and sends one authorized trigger intent without local double-play", async () => {
  const callbacks = new Map<string, (event: unknown) => void>();
  const emit = vi.fn();
  const socket = { connected: true, on: vi.fn((name: string, cb: (event: unknown) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) }));
  const audio = { src: "", currentTime: 0, volume: 1, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  function mockAudio(this: unknown, url?: string) { audio.src = url ?? ""; return audio; }
  vi.stubGlobal("Audio", vi.fn(mockAudio));
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL: vi.fn() });
  renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[{ id: sound.assetId, kind: "AUDIO", audioPurpose: "SOUND_EFFECT", name: "laugh.ogg", mimeType: "audio/ogg", sizeBytes: 28146, width: null, height: null, durationSeconds: 2.5, url: "/api/assets/test/content", createdAt: new Date().toISOString() }]} socket={socket as never} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  fireEvent.click(screen.getByRole("button", { name: "Запустить звук: Злодейский смех" }));
  await waitFor(() => expect(emit).toHaveBeenCalledWith("soundpad:trigger", expect.objectContaining({ soundId: sound.id, actionId: expect.any(String) })));
  expect(audio.play).toHaveBeenCalledTimes(1); // silent autoplay unlock only; trigger awaits authoritative socket event
  callbacks.get("soundpad:triggered")?.({ eventId: "event-1", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await waitFor(() => expect(audio.src).toBe("/api/assets/test/content"));
  expect(audio.volume).toBeCloseTo(0.25);
  expect(audio.play).toHaveBeenCalledTimes(2);
});

it("searches authorized sound labels and pack names and never exposes missing-asset sounds", async () => {
  const forestSound = { ...sound, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", packId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Шорох ветра" };
  const unavailableSound = { ...sound, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", label: "Удалённый сигнал", assetId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
  const musicSound = { ...sound, id: "ffffffff-ffff-4fff-8fff-ffffffffffff", label: "Длинный фон", assetId: "99999999-9999-4999-8999-999999999999" };
  const forestPack = { ...pack, id: forestSound.packId, name: "Лесная чаща", sounds: [forestSound] };
  renderCatalog([{ ...pack, sounds: [sound, unavailableSound, musicSound] }, forestPack], [asset, { ...asset, id: forestSound.assetId, name: "wind.ogg" }, { ...asset, id: musicSound.assetId, name: "background.mp3", audioPurpose: "MUSIC", durationSeconds: 180 }]);
  await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  expect(screen.queryByRole("button", { name: /Удалённый сигнал/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Длинный фон/ })).toBeNull();
  const search = screen.getByRole("searchbox", { name: "Поиск звуков и паков" });
  fireEvent.change(search, { target: { value: "лесная" } });
  expect(await screen.findByRole("button", { name: "Запустить звук: Шорох ветра" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Запустить звук: Злодейский смех" })).toBeNull();
  fireEvent.change(search, { target: { value: "удалённый" } });
  expect(await screen.findByText(/Ничего не найдено/)).toBeTruthy();
  fireEvent.change(search, { target: { value: "" } });
  expect(await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" })).toBeTruthy();
});

it("stores favorites per campaign and membership and filters to only authorized favorite sounds", async () => {
  renderCatalog([pack]);
  fireEvent.click(await screen.findByRole("button", { name: "Добавить в избранное: Злодейский смех" }));
  expect(localStorage.getItem(`arken.soundpad.favorites.${pack.campaignId}.55555555-5555-4555-8555-555555555555`)).toBe(JSON.stringify([sound.id]));
  fireEvent.click(screen.getByLabelText("Только избранное"));
  expect(screen.getByRole("button", { name: "Запустить звук: Злодейский смех" })).toBeTruthy();

  cleanup();
  renderCatalog([pack], [asset], "66666666-6666-4666-8666-666666666666");
  fireEvent.click(await screen.findByLabelText("Только избранное"));
  expect(await screen.findByText(/Ничего не найдено/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Запустить звук: Злодейский смех" })).toBeNull();
});

it("persists effects volume and mute per campaign and membership", async () => {
  const membershipId = "55555555-5555-4555-8555-555555555555";
  renderCatalog([pack], [asset], membershipId);
  const volume = await screen.findByRole("slider", { name: "Громкость эффектов" });
  fireEvent.change(volume, { target: { value: "0.23" } });
  fireEvent.click(screen.getByRole("button", { name: "Выключить эффекты" }));
  expect(localStorage.getItem(`arken.effects.volume.${pack.campaignId}.${membershipId}`)).toBe("0.23");
  expect(localStorage.getItem(`arken.effects.muted.${pack.campaignId}.${membershipId}`)).toBe("true");

  cleanup();
  renderCatalog([pack], [asset], membershipId);
  expect(await screen.findByRole("slider", { name: "Громкость эффектов" })).toHaveValue("0.23");
  expect(screen.getByRole("button", { name: "Включить эффекты" })).toHaveAttribute("aria-pressed", "true");

  cleanup();
  const otherMembership = "66666666-6666-4666-8666-666666666666";
  renderCatalog([pack], [asset], otherMembership);
  expect(await screen.findByRole("slider", { name: "Громкость эффектов" })).toHaveValue("0.5");
  expect(screen.getByRole("button", { name: "Выключить эффекты" })).toHaveAttribute("aria-pressed", "false");

  cleanup();
  const otherCampaign = "77777777-7777-4777-8777-777777777777";
  renderCatalog([pack], [asset], membershipId, otherCampaign);
  expect(await screen.findByRole("slider", { name: "Громкость эффектов" })).toHaveValue("0.5");
  expect(screen.getByRole("button", { name: "Выключить эффекты" })).toHaveAttribute("aria-pressed", "false");
});

it("shows blocked feedback and retries on the next ordinary effect action", async () => {
  const unlockAudio = { pause: vi.fn(), play: vi.fn().mockRejectedValueOnce(new Error("NotAllowedError")).mockResolvedValue(undefined) };
  vi.stubGlobal("Audio", vi.fn(function MockAudio() { return unlockAudio; }));
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL });
  renderCatalog([pack]);

  const effectButton = await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  expect(screen.queryByRole("button", { name: "Включить звук" })).toBeNull();
  fireEvent.click(effectButton);
  expect(await screen.findByRole("alert")).toHaveTextContent("Браузер блокирует звук. Следующее действие повторит попытку.");
  expect(screen.getByRole("status")).toHaveTextContent("Эффекты включатся при первом действии");
  expect(unlockAudio.play).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:unlock"));
  fireEvent.click(effectButton);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Звук включён"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(unlockAudio.play).toHaveBeenCalledTimes(2);
});

it("reports a rejected effect voice once and keeps the user unlock retry available", async () => {
  const callbacks = new Map<string, (event?: unknown) => void>();
  const socket = { connected: true, on: vi.fn((name: string, cb: (event?: unknown) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit: vi.fn() };
  const makeAudio = (play: ReturnType<typeof vi.fn>) => ({ src: "", currentTime: 0, volume: 1, onended: null as (() => void) | null, onerror: null as (() => void) | null, pause: vi.fn(), play });
  const initialUnlock = makeAudio(vi.fn().mockRejectedValue(new Error("NotAllowedError")));
  const rejectedVoice = makeAudio(vi.fn().mockRejectedValue(new Error("NotAllowedError")));
  const retryUnlock = makeAudio(vi.fn().mockResolvedValue(undefined));
  const audioQueue = [initialUnlock, rejectedVoice, retryUnlock];
  vi.stubGlobal("Audio", vi.fn(function MockAudio() { return audioQueue.shift()!; }));
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) }));
  renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[asset]} socket={socket as never} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));

  const effectButton = await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  fireEvent.click(effectButton);
  await waitFor(() => expect(initialUnlock.play).toHaveBeenCalledOnce());
  callbacks.get("soundpad:triggered")?.({ eventId: "rejected-effect", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось воспроизвести звуковой эффект.");
  expect(rejectedVoice.play).toHaveBeenCalledOnce();

  fireEvent.click(effectButton);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(retryUnlock.play).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent("Звук включён");
});

it("pins favorites first while preserving the relative order of other authorized sounds", async () => {
  const secondSound = { ...sound, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Шорох ветра", sortOrder: 1 };
  const secondAsset = { ...asset, id: secondSound.assetId, name: "wind.ogg" };
  renderCatalog([{ ...pack, sounds: [sound, secondSound] }], [asset, secondAsset]);
  await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  fireEvent.click(screen.getByRole("button", { name: "Добавить в избранное: Шорох ветра" }));
  const labels = screen.getAllByRole("button", { name: /^Запустить звук:/ }).map((button) => button.getAttribute("aria-label"));
  expect(labels).toEqual(["Запустить звук: Шорох ветра", "Запустить звук: Злодейский смех"]);
});

it("refetches the role-filtered catalogue after reconnect/change and then plays a newly published sound", async () => {
  const callbacks = new Map<string, (event?: unknown) => void>();
  let current = { packs: [] as typeof pack[], playerPlaybackEnabled: true };
  const fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => current }));
  vi.stubGlobal("fetch", fetchMock);
  const socket = { connected: true, on: vi.fn((name: string, cb: (event?: unknown) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit: vi.fn() };
  const audio = { src: "", currentTime: 0, volume: 1, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  function mockAudio(this: unknown, url?: string) { audio.src = url ?? ""; return audio; }
  vi.stubGlobal("Audio", vi.fn(mockAudio));
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL: vi.fn() });
  renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[{ id: sound.assetId, kind: "AUDIO", audioPurpose: "SOUND_EFFECT", name: "laugh.ogg", mimeType: "audio/ogg", sizeBytes: 28146, width: null, height: null, durationSeconds: 2.5, url: "/api/assets/test/content", createdAt: new Date().toISOString() }]} socket={socket as never} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  await screen.findByText(/Пока нет паков/);
  current = { packs: [pack], playerPlaybackEnabled: true };
  callbacks.get("soundpad:triggered")?.({ eventId: "publish-race", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  await waitFor(() => expect(audio.src).toBe("/api/assets/test/content"));
  audio.src = "";
  callbacks.get("soundpad:catalog:changed")?.();
  await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  callbacks.get("soundpad:triggered")?.({ eventId: "published-event", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await waitFor(() => expect(audio.src).toBe("/api/assets/test/content"));
});

it("refreshes player snapshot assets before reloading a newly published catalogue", async () => {
  const callbacks = new Map<string, (event?: unknown) => void | Promise<void>>();
  let current = { packs: [] as typeof pack[], playerPlaybackEnabled: true };
  const fetchMock = vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => current,
  }));
  vi.stubGlobal("fetch", fetchMock);
  const socket = {
    connected: false,
    on: vi.fn((name: string, cb: (event?: unknown) => void) => callbacks.set(name, cb)),
    off: vi.fn((name: string) => callbacks.delete(name)),
    emit: vi.fn(),
  };
  const refreshSnapshot = vi.fn(async () => undefined);
  function PlayerHarness() {
    const [assets, setAssets] = useState<typeof asset[]>([]);
    const refresh = useCallback(async () => {
      await refreshSnapshot();
      setAssets([asset]);
    }, []);
    return <SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={assets} socket={socket as never} onUpload={vi.fn()} onRefreshSnapshot={refresh} />;
  }
  renderInTheme(<PlayerHarness />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  await screen.findByText(/Пока нет паков/);

  current = { packs: [pack], playerPlaybackEnabled: true };
  await act(async () => {
    socket.connected = true;
    await callbacks.get("soundpad:catalog:changed")?.();
  });

  expect(refreshSnapshot).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Запустить звук: Злодейский смех" })).toBeTruthy();
});

it("does not play an unknown trigger if catalogue lookup resolves after GM stop", async () => {
  const callbacks = new Map<string, (event?: unknown) => void>();
  let calls = 0;
  let resolveLookup!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
  const fetchMock = vi.fn().mockImplementation(() => {
    calls++;
    if (calls === 1) return Promise.resolve({ ok: true, json: async () => ({ packs: [], playerPlaybackEnabled: true }) });
    return new Promise((resolve) => { resolveLookup = resolve; });
  });
  vi.stubGlobal("fetch", fetchMock);
  const socket = { connected: true, on: vi.fn((name: string, cb: (event?: unknown) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit: vi.fn() };
  const audio = { src: "", currentTime: 0, volume: 1, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  function mockAudio(this: unknown, url?: string) { audio.src = url ?? ""; return audio; }
  vi.stubGlobal("Audio", vi.fn(mockAudio));
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL: vi.fn() });
  renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[{ id: sound.assetId, kind: "AUDIO", audioPurpose: "SOUND_EFFECT", name: "laugh.ogg", mimeType: "audio/ogg", sizeBytes: 28146, width: null, height: null, durationSeconds: 2.5, url: "/api/assets/test/content", createdAt: new Date().toISOString() }]} socket={socket as never} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  await screen.findByText(/Пока нет паков/);
  callbacks.get("soundpad:triggered")?.({ eventId: "pending-stop", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await waitFor(() => expect(calls).toBe(2));
  callbacks.get("soundpad:stopped")?.();
  resolveLookup({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) });
  await waitFor(() => expect(screen.getByRole("button", { name: "Запустить звук: Злодейский смех" })).toBeTruthy());
  expect(audio.src).not.toBe("/api/assets/test/content");
  expect(audio.play).not.toHaveBeenCalled(); // stopped pending trigger never starts
});

it("does not play a pre-reconnect trigger after the socket reconnects during catalogue lookup", async () => {
  const callbacks = new Map<string, (event?: unknown) => void>();
  let calls = 0;
  let resolveLookup!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
  const fetchMock = vi.fn().mockImplementation(() => {
    calls++;
    if (calls === 1) return Promise.resolve({ ok: true, json: async () => ({ packs: [], playerPlaybackEnabled: true }) });
    if (calls === 2) return new Promise((resolve) => { resolveLookup = resolve; });
    return Promise.resolve({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  const socket = { connected: true, on: vi.fn((name: string, cb: (event?: unknown) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit: vi.fn() };
  const audio = { src: "", currentTime: 0, volume: 1, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  function mockAudio(this: unknown, url?: string) { audio.src = url ?? ""; return audio; }
  vi.stubGlobal("Audio", vi.fn(mockAudio));
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL: vi.fn() });
  renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[{ id: sound.assetId, kind: "AUDIO", audioPurpose: "SOUND_EFFECT", name: "laugh.ogg", mimeType: "audio/ogg", sizeBytes: 28146, width: null, height: null, durationSeconds: 2.5, url: "/api/assets/test/content", createdAt: new Date().toISOString() }]} socket={socket as never} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  await screen.findByText(/Пока нет паков/);
  callbacks.get("soundpad:triggered")?.({ eventId: "pending-reconnect", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await waitFor(() => expect(calls).toBe(2));
  socket.connected = false;
  callbacks.get("disconnect")?.();
  socket.connected = true;
  callbacks.get("connect")?.();
  resolveLookup({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) });
  await waitFor(() => expect(calls).toBe(3));
  await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  expect(audio.src).not.toBe("/api/assets/test/content");
  expect(audio.play).not.toHaveBeenCalled();
});

it("performs a trailing catalogue fetch when invalidation arrives during an older in-flight fetch", async () => {
  const callbacks = new Map<string, (event?: unknown) => void>();
  const current = { packs: [pack], playerPlaybackEnabled: true };
  let resolveInitial!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
  const fetchMock = vi.fn().mockImplementation(() => fetchMock.mock.calls.length === 1
    ? new Promise((resolve) => { resolveInitial = resolve; })
    : Promise.resolve({ ok: true, json: async () => current }));
  vi.stubGlobal("fetch", fetchMock);
  const socket = { connected: false, on: vi.fn((name: string, cb: (event?: unknown) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit: vi.fn() };
  renderInTheme(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[asset]} socket={socket as never} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Саундпад" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  callbacks.get("soundpad:catalog:changed")?.();
  resolveInitial({ ok: true, json: async () => ({ packs: [], playerPlaybackEnabled: true }) });
  await screen.findByRole("button", { name: "Запустить звук: Злодейский смех" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
