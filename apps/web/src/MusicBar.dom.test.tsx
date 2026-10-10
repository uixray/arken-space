// @vitest-environment jsdom
import { createElement } from "react";
import type { ReactNode } from "react";
import type { AssetDto, AudioStateDto, AudioTrackDto, CommandAck, Role } from "@arken/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "./ui/notifications";
import type { GameSocket } from "./realtime";
import { fireEvent, renderComponent, screen, waitFor } from "./test-support/render";

vi.mock("./ui/ArkenDialog", () => ({
  ArkenDialog: ({ open, children, title }: { open: boolean; children: ReactNode; title: string }) =>
    open ? createElement("div", { role: "dialog", "aria-label": title }, children) : null,
}));
vi.mock("./ui/notifications", () => ({ notify: vi.fn() }));

const { MusicBar } = await import("./MusicBar");
const asset = (id: string, name: string): AssetDto => ({
  id, kind: "AUDIO", audioPurpose: "MUSIC", name, mimeType: "audio/mpeg",
  sizeBytes: 2048, width: null, height: null, durationSeconds: 90,
  url: `/${id}.mp3`, createdAt: "2026-10-10T10:00:00.000Z",
});
const track = (overrides: Partial<AudioTrackDto> = {}): AudioTrackDto => ({
  id: "synthetic-track", assetId: "music-one", mixVolume: 1, playing: false,
  positionSeconds: 0, loop: false, startedAt: null, slotOrder: 0, revision: 9,
  updatedAt: "2026-10-10T10:00:00.000Z", ...overrides,
});
const legacyAudio: AudioStateDto = {
  assetId: null, playing: false, positionSeconds: 0, loop: false,
  startedAt: null, revision: 77, updatedAt: "2026-10-10T10:00:00.000Z",
};
const first = asset("music-one", "First music");
const second = asset("music-two", "Second music");

function socketWithAck() {
  const emit = vi.fn((_event: string, _payload: unknown, ack?: (result: CommandAck<AudioTrackDto>) => void) =>
    ack?.({ ok: true, status: "ACCEPTED", data: track() } as CommandAck<AudioTrackDto>));
  return { emit, socket: { emit } as unknown as GameSocket };
}
function renderMusic({ audioTracks = [track()], assets = [first, second], role = "GM", socket = socketWithAck().socket }: {
  audioTracks?: AudioTrackDto[]; assets?: AssetDto[]; role?: Role; socket?: GameSocket | null;
} = {}) {
  return renderComponent(createElement(MusicBar, {
    audio: legacyAudio, audioTracks, assets, role, socket, onUpload: vi.fn(),
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.mocked(notify).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("MusicBar authoritative track controls", () => {
  it("routes overflow and library selection through the same canonical track command", () => {
    const { emit, socket } = socketWithAck();
    renderMusic({ socket });
    fireEvent.click(screen.getByLabelText("Плейлист"));
    fireEvent.click(screen.getByRole("button", { name: "Second music" }));
    fireEvent.click(screen.getByLabelText("Плейлист"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть библиотеку" }));
    fireEvent.click(screen.getByRole("button", { name: "First music" }));

    expect(emit).toHaveBeenCalledTimes(2);
    for (const [, command] of emit.mock.calls) {
      expect(command).toMatchObject({ command: "SELECT", trackId: "synthetic-track", revision: 9 });
      expect(command).toHaveProperty("actionId");
    }
    expect(emit.mock.calls.map(([, command]) => (command as { assetId: string }).assetId)).toEqual(["music-two", "music-one"]);
    expect(emit.mock.calls.every(([event]) => event === "audio:track:set")).toBe(true);
    expect(emit.mock.calls.some(([event]) => event === "audio:set")).toBe(false);
  });

  it("uses ADD_TRACK from both selectors when the authoritative mixer is empty", () => {
    const { emit, socket } = socketWithAck();
    renderMusic({ audioTracks: [], socket });
    fireEvent.click(screen.getByLabelText("Плейлист"));
    fireEvent.click(screen.getByRole("button", { name: "Second music" }));
    expect(emit).toHaveBeenCalledWith("audio:track:set", {
      actionId: expect.any(String), command: "ADD_TRACK", assetId: "music-two",
    }, expect.any(Function));
  });

  it("updates timeline and mixer progress from media events without restarting playback on gain changes", async () => {
    const playing = track({ playing: true });
    const { container } = renderMusic({ audioTracks: [playing] });
    const player = container.querySelector<HTMLAudioElement>('audio[aria-label="First music"]')!;
    Object.defineProperty(player, "duration", { configurable: true, value: 130 });
    Object.defineProperty(player, "currentTime", { configurable: true, writable: true, value: 37 });
    fireEvent.loadedMetadata(player);
    fireEvent.timeUpdate(player);
    fireEvent.click(screen.getByLabelText("Плейлист"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть библиотеку" }));
    await waitFor(() => expect(screen.getByRole("slider", { name: "Позиция воспроизведения" })).toHaveValue("37"));
    expect(screen.getByText("0:37 / 2:10")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Позиция дорожки First music" })).toHaveValue("37");
    expect(screen.getByRole("slider", { name: "Позиция дорожки First music" })).toHaveAttribute("max", "130");
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const beforeVolume = play.mock.calls.length;
    fireEvent.click(screen.getByLabelText("Громкость"));
    fireEvent.change(screen.getByRole("slider", { name: "Личная громкость" }), { target: { value: "0.25" } });
    expect(play).toHaveBeenCalledTimes(beforeVolume);
  });

  it("keeps a seek draft stable during playback progress and sends canonical SEEK", async () => {
    const { emit, socket } = socketWithAck();
    const { container } = renderMusic({ audioTracks: [track({ playing: true })], socket });
    const player = container.querySelector<HTMLAudioElement>('audio[aria-label="First music"]')!;
    Object.defineProperty(player, "duration", { configurable: true, value: 90 });
    Object.defineProperty(player, "currentTime", { configurable: true, writable: true, value: 12 });
    fireEvent.timeUpdate(player);
    fireEvent.click(screen.getByLabelText("Плейлист"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть библиотеку" }));
    const seek = screen.getByRole("slider", { name: "Позиция воспроизведения" });
    fireEvent.pointerDown(seek);
    fireEvent.change(seek, { target: { value: "24" } });
    player.currentTime = 15;
    fireEvent.timeUpdate(player);
    expect(seek).toHaveValue("24");
    fireEvent.pointerUp(seek, { currentTarget: { value: "24" } });
    expect(emit).toHaveBeenCalledWith("audio:track:set", {
      actionId: expect.any(String), revision: 9, trackId: "synthetic-track",
      command: "SEEK", positionSeconds: 24,
    }, expect.any(Function));
  });

  it("sends SET_LOOP on the canonical revision and applies native repeat/end behavior", () => {
    const { emit, socket } = socketWithAck();
    const looping = track({ playing: true, loop: true });
    const { container } = renderMusic({ audioTracks: [looping], socket });
    const player = container.querySelector<HTMLAudioElement>('audio[aria-label="First music"]')!;
    expect(player.loop).toBe(true);
    fireEvent.ended(player);
    expect(emit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Плейлист"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть библиотеку" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Повторять" }));
    expect(emit).toHaveBeenCalledWith("audio:track:set", {
      actionId: expect.any(String), revision: 9, trackId: "synthetic-track",
      command: "SET_LOOP", loop: false,
    }, expect.any(Function));
  });

  it("sends END when a non-looping media element ends and reports command rejection", () => {
    const { emit, socket } = socketWithAck();
    emit.mockImplementation((_event, _command, ack) => ack?.({ ok: false, status: "CONFLICT", reason: "REVISION_CONFLICT" } as CommandAck<AudioTrackDto>));
    const { container } = renderMusic({ audioTracks: [track({ playing: true })], socket });
    const player = container.querySelector<HTMLAudioElement>('audio[aria-label="First music"]')!;
    fireEvent.ended(player);
    expect(emit).toHaveBeenCalledWith("audio:track:set", {
      actionId: expect.any(String), revision: 9, trackId: "synthetic-track", command: "END",
    }, expect.any(Function));
    expect(notify).toHaveBeenCalledWith({ title: "Не удалось изменить дорожку", message: "Состояние музыки изменилось. Повторите команду.", tone: "danger" });
  });

  it("does not expose GM controls to players", () => {
    const initial = [track({ assetId: "music-one", positionSeconds: 4 })];
    renderMusic({ audioTracks: initial, role: "PLAYER" });
    expect(screen.queryByLabelText("Плейлист")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Играть" })).toBeDisabled();
  });

  it("does not send a privileged END command when a PLAYER track ends locally", () => {
    const { emit, socket } = socketWithAck();
    const { container } = renderMusic({ audioTracks: [track({ playing: true })], role: "PLAYER", socket });
    fireEvent.ended(container.querySelector<HTMLAudioElement>('audio[aria-label="First music"]')!);
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects stale progress after track replacement and resets to new track position", async () => {
    const initial = [track({ assetId: "music-one", positionSeconds: 4 })];
    const view = renderMusic({ audioTracks: initial });
    fireEvent.click(screen.getByLabelText("Плейлист"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть библиотеку" }));
    const oldPlayer = view.container.querySelector<HTMLAudioElement>('audio[aria-label="First music"]')!;
    const nextTrack = track({ assetId: "music-two", positionSeconds: 6 });
    view.rerender(createElement(MusicBar, { audio: legacyAudio, audioTracks: [nextTrack], assets: [first, second], role: "GM", socket: null, onUpload: vi.fn() }));
    const seek = screen.getByRole("slider", { name: "Позиция дорожки Second music" });
    oldPlayer.currentTime = 55;
    fireEvent.timeUpdate(oldPlayer);
    await waitFor(() => expect(seek).toHaveValue("6"));
  });

  it("maps a server permission rejection to role-safe feedback", () => {
    const { socket } = socketWithAck();
    const emit = vi.fn((_event: string, _command: unknown, ack?: (result: CommandAck<AudioTrackDto>) => void) =>
      ack?.({ ok: false, status: "FORBIDDEN", reason: "GM_REQUIRED" } as CommandAck<AudioTrackDto>));
    renderMusic({ socket: { emit } as unknown as GameSocket });
    fireEvent.click(screen.getByRole("button", { name: "Играть" }));
    expect(notify).toHaveBeenCalledWith({ title: "Не удалось изменить дорожку", message: "Управлять музыкой может только ведущий.", tone: "danger" });
    void socket;
  });
});
