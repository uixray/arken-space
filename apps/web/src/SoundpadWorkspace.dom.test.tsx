// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SoundpadWorkspace } from "./SoundpadWorkspace";

const sound = { id: "11111111-1111-4111-8111-111111111111", packId: "22222222-2222-4222-8222-222222222222", assetId: "33333333-3333-4333-8333-333333333333", label: "Злодейский смех", icon: "😈", category: "Реакции", sortOrder: 0, defaultGain: 0.5, audience: "ALL_MEMBERS" as const, sourceNote: "CC0" };
const pack = { id: sound.packId, campaignId: "44444444-4444-4444-8444-444444444444", name: "Тестовый пак", published: true, audience: "ALL_MEMBERS" as const, sortOrder: 0, sounds: [sound] };

it("renders real sound buttons and sends one authorized trigger intent without local double-play", async () => {
  const callbacks = new Map<string, (event: any) => void>();
  const emit = vi.fn();
  const socket = { connected: true, on: vi.fn((name: string, cb: (event: any) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) }));
  const audio = { src: "", currentTime: 0, volume: 1, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  function mockAudio(this: unknown, url?: string) { audio.src = url ?? ""; return audio; }
  vi.stubGlobal("Audio", vi.fn(mockAudio));
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL: vi.fn() });
  render(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[{ id: sound.assetId, kind: "AUDIO", name: "laugh.ogg", mimeType: "audio/ogg", sizeBytes: 28146, width: null, height: null, durationSeconds: 2.5, url: "/api/assets/test/content", createdAt: new Date().toISOString() }]} socket={socket as never} onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Включить звук" }));
  await screen.findByRole("button", { name: /Злодейский смех/ });
  fireEvent.click(screen.getByRole("button", { name: /Злодейский смех/ }));
  await waitFor(() => expect(emit).toHaveBeenCalledWith("soundpad:trigger", expect.objectContaining({ soundId: sound.id, actionId: expect.any(String) })));
  expect(audio.play).toHaveBeenCalledTimes(1); // silent autoplay unlock only; trigger awaits authoritative socket event
  callbacks.get("soundpad:triggered")?.({ eventId: "event-1", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await waitFor(() => expect(audio.src).toBe("/api/assets/test/content"));
  expect(audio.volume).toBeCloseTo(0.25);
  expect(audio.play).toHaveBeenCalledTimes(2);
});

it("refetches the role-filtered catalogue after reconnect/change and then plays a newly published sound", async () => {
  const callbacks = new Map<string, (event?: any) => void>();
  let current = { packs: [] as typeof pack[], playerPlaybackEnabled: true };
  const fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => current }));
  vi.stubGlobal("fetch", fetchMock);
  const socket = { connected: true, on: vi.fn((name: string, cb: (event?: any) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit: vi.fn() };
  const audio = { src: "", currentTime: 0, volume: 1, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  function mockAudio(this: unknown, url?: string) { audio.src = url ?? ""; return audio; }
  vi.stubGlobal("Audio", vi.fn(mockAudio));
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL: vi.fn() });
  render(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[{ id: sound.assetId, kind: "AUDIO", name: "laugh.ogg", mimeType: "audio/ogg", sizeBytes: 28146, width: null, height: null, durationSeconds: 2.5, url: "/api/assets/test/content", createdAt: new Date().toISOString() }]} socket={socket as never} onUpload={vi.fn()} />);
  await screen.findByText(/Пока нет паков/);
  current = { packs: [pack], playerPlaybackEnabled: true };
  fireEvent.click(screen.getByRole("button", { name: "Включить звук" }));
  callbacks.get("soundpad:triggered")?.({ eventId: "publish-race", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await screen.findByRole("button", { name: /Злодейский смех/ });
  await waitFor(() => expect(audio.src).toBe("/api/assets/test/content"));
  audio.src = "";
  callbacks.get("soundpad:catalog:changed")?.();
  await screen.findByRole("button", { name: /Злодейский смех/ });
  callbacks.get("soundpad:triggered")?.({ eventId: "published-event", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await waitFor(() => expect(audio.src).toBe("/api/assets/test/content"));
});

it("does not play an unknown trigger if catalogue lookup resolves after GM stop", async () => {
  const callbacks = new Map<string, (event?: any) => void>();
  let calls = 0;
  let resolveLookup!: (value: { ok: boolean; json: () => Promise<any> }) => void;
  const fetchMock = vi.fn().mockImplementation(() => {
    calls++;
    if (calls === 1) return Promise.resolve({ ok: true, json: async () => ({ packs: [], playerPlaybackEnabled: true }) });
    return new Promise((resolve) => { resolveLookup = resolve; });
  });
  vi.stubGlobal("fetch", fetchMock);
  const socket = { connected: true, on: vi.fn((name: string, cb: (event?: any) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit: vi.fn() };
  const audio = { src: "", currentTime: 0, volume: 1, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  function mockAudio(this: unknown, url?: string) { audio.src = url ?? ""; return audio; }
  vi.stubGlobal("Audio", vi.fn(mockAudio));
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL: vi.fn() });
  render(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[{ id: sound.assetId, kind: "AUDIO", name: "laugh.ogg", mimeType: "audio/ogg", sizeBytes: 28146, width: null, height: null, durationSeconds: 2.5, url: "/api/assets/test/content", createdAt: new Date().toISOString() }]} socket={socket as never} onUpload={vi.fn()} />);
  await screen.findByText(/Пока нет паков/);
  fireEvent.click(screen.getByRole("button", { name: "Включить звук" }));
  callbacks.get("soundpad:triggered")?.({ eventId: "pending-stop", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await waitFor(() => expect(calls).toBe(2));
  callbacks.get("soundpad:stopped")?.();
  resolveLookup({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) });
  await waitFor(() => expect(screen.getByRole("button", { name: /Злодейский смех/ })).toBeTruthy());
  expect(audio.src).not.toBe("/api/assets/test/content");
  expect(audio.play).toHaveBeenCalledTimes(1); // unlock only; stopped pending trigger never starts
});

it("does not play a pre-reconnect trigger after the socket reconnects during catalogue lookup", async () => {
  const callbacks = new Map<string, (event?: any) => void>();
  let calls = 0;
  let resolveLookup!: (value: { ok: boolean; json: () => Promise<any> }) => void;
  const fetchMock = vi.fn().mockImplementation(() => {
    calls++;
    if (calls === 1) return Promise.resolve({ ok: true, json: async () => ({ packs: [], playerPlaybackEnabled: true }) });
    if (calls === 2) return new Promise((resolve) => { resolveLookup = resolve; });
    return Promise.resolve({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  const socket = { connected: true, on: vi.fn((name: string, cb: (event?: any) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit: vi.fn() };
  const audio = { src: "", currentTime: 0, volume: 1, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  function mockAudio(this: unknown, url?: string) { audio.src = url ?? ""; return audio; }
  vi.stubGlobal("Audio", vi.fn(mockAudio));
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unlock"), revokeObjectURL: vi.fn() });
  render(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[{ id: sound.assetId, kind: "AUDIO", name: "laugh.ogg", mimeType: "audio/ogg", sizeBytes: 28146, width: null, height: null, durationSeconds: 2.5, url: "/api/assets/test/content", createdAt: new Date().toISOString() }]} socket={socket as never} onUpload={vi.fn()} />);
  await screen.findByText(/Пока нет паков/);
  fireEvent.click(screen.getByRole("button", { name: "Включить звук" }));
  callbacks.get("soundpad:triggered")?.({ eventId: "pending-reconnect", soundId: sound.id, serverTime: new Date().toISOString(), defaultGain: 0.5 });
  await waitFor(() => expect(calls).toBe(2));
  socket.connected = false;
  callbacks.get("disconnect")?.();
  socket.connected = true;
  callbacks.get("connect")?.();
  resolveLookup({ ok: true, json: async () => ({ packs: [pack], playerPlaybackEnabled: true }) });
  await waitFor(() => expect(calls).toBe(3));
  await screen.findByRole("button", { name: /Злодейский смех/ });
  expect(audio.src).not.toBe("/api/assets/test/content");
  expect(audio.play).toHaveBeenCalledTimes(1);
});

it("performs a trailing catalogue fetch when invalidation arrives during an older in-flight fetch", async () => {
  const callbacks = new Map<string, (event?: any) => void>();
  let current = { packs: [pack], playerPlaybackEnabled: true };
  let resolveInitial!: (value: { ok: boolean; json: () => Promise<any> }) => void;
  const fetchMock = vi.fn().mockImplementation(() => fetchMock.mock.calls.length === 1
    ? new Promise((resolve) => { resolveInitial = resolve; })
    : Promise.resolve({ ok: true, json: async () => current }));
  vi.stubGlobal("fetch", fetchMock);
  const socket = { connected: false, on: vi.fn((name: string, cb: (event?: any) => void) => callbacks.set(name, cb)), off: vi.fn((name: string) => callbacks.delete(name)), emit: vi.fn() };
  render(<SoundpadWorkspace campaignId={pack.campaignId} membershipId="55555555-5555-4555-8555-555555555555" role="PLAYER" assets={[]} socket={socket as never} onUpload={vi.fn()} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  callbacks.get("soundpad:catalog:changed")?.();
  resolveInitial({ ok: true, json: async () => ({ packs: [], playerPlaybackEnabled: true }) });
  await screen.findByRole("button", { name: /Злодейский смех/ });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
