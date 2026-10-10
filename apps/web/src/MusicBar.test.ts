// @vitest-environment jsdom
import { createElement } from "react";
import type { ReactNode } from "react";
import type { AssetDto, AudioStateDto, AudioTrackDto, CommandAck } from "@arken/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAudioConsentError } from "./audio-playback";
import { volumeSliderToGain } from "./audio-volume";
import { resolvePlaybackAction, resolveTrackPosition } from "./music-playback";
import type { GameSocket } from "./realtime";
import { notify } from "./ui/notifications";
import { fireEvent, renderComponent, screen } from "./test-support/render";

vi.mock("@gravity-ui/uikit", () => ({
  Button: () => null,
  Checkbox: () => null,
  Loader: () => null,
}));
vi.mock("./ui/ArkenDialog", () => ({ ArkenDialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? createElement("div", { role: "dialog" }, children) : null }));
vi.mock("./ui/notifications", () => ({ notify: vi.fn() }));

const { MusicBar: ActualMusicBar } = await import("./MusicBar");
type MusicBarProps = Parameters<typeof ActualMusicBar>[0];
type LegacyTestProps = Omit<MusicBarProps, "audioTracks"> & { audioTracks?: AudioTrackDto[] };
function trackFromAudio(audio: AudioStateDto): AudioTrackDto {
  return { id: "test-track", assetId: audio.assetId, mixVolume: 1, playing: audio.playing, positionSeconds: audio.positionSeconds, loop: audio.loop, startedAt: audio.startedAt, slotOrder: 0, revision: audio.revision, updatedAt: audio.updatedAt };
}
// Test compatibility adapter: every test now gets an explicit canonical track
// derived from its singular fixture; production never infers tracks from audio.
function MusicBar(props: LegacyTestProps) {
  return createElement(ActualMusicBar, { ...props, audioTracks: props.audioTracks ?? [trackFromAudio(props.audio)] });
}

const audioAsset: AssetDto = {
  id: "audio-under-test",
  kind: "AUDIO",
  name: "Quiet track",
  mimeType: "audio/mpeg",
  sizeBytes: 1024,
  width: null,
  height: null,
  durationSeconds: 120,
  url: "/quiet-track.mp3",
  createdAt: new Date(0).toISOString(),
};
const playingAudio: AudioStateDto = {
  assetId: audioAsset.id,
  playing: true,
  positionSeconds: 0,
  loop: false,
  startedAt: null,
  revision: 1,
  updatedAt: new Date(0).toISOString(),
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("UIX-417 audio acknowledgement copy", () => {
  it.each<{
    reason?: string;
    status: CommandAck["status"];
    message: string;
  }>([
    {
      reason: "GM_REQUIRED",
      status: "FORBIDDEN",
      message: "Управлять музыкой может только ведущий.",
    },
    {
      reason: "INVALID_COMMAND",
      status: "INVALID",
      message: "Некорректная команда управления музыкой.",
    },
    {
      reason: "ASSET_NOT_FOUND",
      status: "INVALID",
      message: "Аудиофайл не найден. Выберите другой трек.",
    },
    {
      reason: "REVISION_CONFLICT",
      status: "CONFLICT",
      message: "Состояние музыки изменилось. Повторите команду.",
    },
    {
      reason: "AUDIO_NOT_SELECTED",
      status: "INVALID",
      message: "Трек не выбран или его длительность недоступна.",
    },
    {
      reason: "AUDIO_END_NOT_APPLICABLE",
      status: "INVALID",
      message: "Сейчас нельзя завершить воспроизведение трека.",
    },
    {
      reason: "AUDIO_UPDATE_FAILED",
      status: "CONFLICT",
      message: "Не удалось обновить музыку. Повторите команду.",
    },
    {
      reason: "UNRECOGNIZED_AUDIO_REASON",
      status: "INVALID",
      message: "Сервер отклонил команду",
    },
    { status: "INVALID", message: "Сервер отклонил команду" },
  ])(
    "renders Russian for $reason without changing the ACK",
    ({ reason, status, message }) => {
      vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
        () => {},
      );
      vi.mocked(notify).mockClear();
      const acknowledgement: CommandAck = Object.freeze({
        ok: false,
        status,
        ...(reason === undefined ? {} : { reason }),
      });
      const emit = vi.fn(
        (
          _event: string,
          _command: unknown,
          callback: (result: CommandAck) => void,
        ) => callback(acknowledgement),
      );
      const onUpload = vi.fn();
      renderComponent(
        createElement(MusicBar, {
          audio: { ...playingAudio, playing: false },
          assets: [audioAsset],
          role: "GM",
          socket: { emit } as unknown as GameSocket,
          onUpload,
        }),
      );

      // The actual visible topbar handler constructs the command and consumes
      // the controlled socket ACK; notification rendering is the browser gate.
      fireEvent.click(screen.getByRole("button", { name: "Играть" }));

      expect(emit).toHaveBeenCalledExactlyOnceWith(
        "audio:track:set",
        {
          command: "PLAY",
          revision: playingAudio.revision,
          trackId: "test-track",
          actionId: expect.any(String),
        },
        expect.any(Function),
      );
      expect(notify).toHaveBeenCalledExactlyOnceWith({
        title: "Не удалось изменить дорожку",
        message,
        tone: "danger",
      });
      expect(acknowledgement).toEqual({
        ok: false,
        status,
        ...(reason === undefined ? {} : { reason }),
      });
      expect(onUpload).not.toHaveBeenCalled();
    },
  );
});

describe("personal music volume", () => {
  it("keeps effect-only audio out of the music picker and uploads explicit MUSIC", async () => {
    const effects = { ...audioAsset, id: "effect-only", name: "Footsteps", audioPurpose: "SOUND_EFFECT" as const };
    const both = { ...audioAsset, id: "both-audio", name: "Both", audioPurpose: "BOTH" as const };
    const onUpload = vi.fn().mockResolvedValue({ ...audioAsset, id: "new-music" });
    const view = renderComponent(createElement(MusicBar, {
      audio: playingAudio, assets: [audioAsset, effects, both], role: "GM", socket: null, onUpload,
    }));
    fireEvent.click(screen.getByLabelText("Плейлист"));
    const menu = view.container.querySelector(".music-overflow__menu")!;
    expect(menu.firstElementChild).toHaveClass("music-overflow__library");
    expect(menu.firstElementChild?.querySelector(".lucide-list-music")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Quiet track" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Footsteps" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Both" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть библиотеку" }));
    const file = new File(["synthetic music"], "music.mp3", { type: "audio/mpeg" });
    fireEvent.change(screen.getByLabelText("Аудиофайл"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить и выбрать" }));
    await vi.waitFor(() => expect(onUpload).toHaveBeenCalledWith(file, "AUDIO", { audioPurpose: "MUSIC" }));
    view.unmount();
  });

  it("shows Pause from the canonical active-track state when the legacy audio projection is stale", () => {
    const canonicalTrack = { ...trackFromAudio(playingAudio), playing: true };
    renderComponent(createElement(MusicBar, {
      audio: { ...playingAudio, playing: false },
      audioTracks: [canonicalTrack],
      assets: [audioAsset],
      role: "GM",
      socket: null,
      onUpload: vi.fn(),
    }));
    const toggle = screen.getByRole("button", { name: "Пауза" });
    expect(toggle.querySelector(".lucide-pause")).not.toBeNull();
  });

  it("plays two canonical tracks while player master remains local-only and gain does not restart them", () => {
    const secondAsset = { ...audioAsset, id: "audio-second", name: "Second track" };
    const tracks = [trackFromAudio(playingAudio), { ...trackFromAudio(playingAudio), id: "track-second", assetId: secondAsset.id, slotOrder: 1 }];
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const emit = vi.fn();
    const view = renderComponent(createElement(MusicBar, {
      audio: playingAudio, audioTracks: tracks, assets: [audioAsset, secondAsset],
      role: "PLAYER", socket: { emit } as unknown as GameSocket, onUpload: vi.fn(),
    }));
    expect(view.container.querySelectorAll("audio")).toHaveLength(2);
    expect(play).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText("Громкость"));
    fireEvent.change(screen.getByRole("slider", { name: "Личная громкость" }), { target: { value: "0.25" } });
    expect(play).toHaveBeenCalledTimes(2);
    expect(emit).not.toHaveBeenCalled();
  });

  it("disposes an audio element when its authoritative track disappears", () => {
    const track = trackFromAudio(playingAudio);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const props = { audio: playingAudio, audioTracks: [track], assets: [audioAsset], role: "PLAYER" as const, socket: null, onUpload: vi.fn() };
    const view = renderComponent(createElement(MusicBar, props));
    expect(view.container.querySelectorAll("audio")).toHaveLength(1);
    view.rerender(createElement(MusicBar, { ...props, audioTracks: [] }));
    expect(view.container.querySelectorAll("audio")).toHaveLength(0);
    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
  });

  it("tries shared playback on a fresh profile without saving consent as a mute", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );
    expect(play).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("arken.audio.enabled")).toBeNull();
  });

  it("respects an explicit personal opt-out on later visits", () => {
    localStorage.setItem("arken.audio.enabled", "false");
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );
    expect(play).not.toHaveBeenCalled();
    expect(localStorage.getItem("arken.audio.enabled")).toBe("false");
  });

  it("keeps zero personal volume alongside the explicit opt-out", () => {
    localStorage.setItem("arken.audio.enabled", "false");
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container } = renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );
    fireEvent.click(container.querySelector(".music-volume-control summary")!);
    fireEvent.change(screen.getByRole("slider", { name: "Личная громкость" }), {
      target: { value: "0" },
    });
    expect(container.querySelector("audio")!.volume).toBe(0);
    expect(document.querySelector(".music-enable-button")).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("retries after autoplay denial through an ordinary gesture", async () => {
    vi.mocked(notify).mockClear();
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
      .mockResolvedValue();
    renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".music-enable-button")).toBeNull();
    expect(localStorage.getItem("arken.audio.enabled")).toBeNull();
    fireEvent.pointerDown(document.body);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(play).toHaveBeenCalledTimes(2);
    expect(notify).not.toHaveBeenCalled();
  });

  it("unlocks blocked playback on the next ordinary pointer gesture", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
      .mockResolvedValue();
    const { container } = renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".music-enable-button")).toBeNull();
    fireEvent.pointerDown(container);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem("arken.audio.enabled")).toBeNull();
  });

  it("treats a synchronous media-policy throw like a rejected play promise", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => {
      throw new DOMException("blocked", "NotAllowedError");
    });
    renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".music-enable-button")).toBeNull();
    expect(localStorage.getItem("arken.audio.enabled")).toBeNull();
  });
  it("keeps the first slider step quiet instead of jumping to 5% gain", () => {
    expect(volumeSliderToGain(0)).toBe(0);
    expect(volumeSliderToGain(0.05)).toBeCloseTo(0.0025);
  });

  it("preserves the endpoints and clamps corrupted stored values", () => {
    expect(volumeSliderToGain(1)).toBe(1);
    expect(volumeSliderToGain(-1)).toBe(0);
    expect(volumeSliderToGain(2)).toBe(1);
  });

  it("applies stored personal gain before the initial play call", () => {
    localStorage.setItem("arken.audio.enabled", "true");
    localStorage.setItem("arken.audio.volume", "0.05");
    const gainsAtPlay: number[] = [];
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(function (this: HTMLMediaElement) {
        gainsAtPlay.push(this.volume);
        return Promise.resolve();
      });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );

    expect(play).toHaveBeenCalledTimes(1);
    expect(gainsAtPlay).toHaveLength(1);
    expect(gainsAtPlay[0]).toBeCloseTo(0.0025);
  });

  it("uses the midpoint when no personal volume has been saved", () => {
    localStorage.setItem("arken.audio.enabled", "true");
    const gainsAtPlay: number[] = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      gainsAtPlay.push(this.volume);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );

    expect(
      screen.getByRole("slider", { name: "Личная громкость" }),
    ).toHaveValue("0.5");
    expect(gainsAtPlay[0]).toBeCloseTo(0.25);
  });

  it("updates gain without reconciling playback or shared state again", () => {
    localStorage.setItem("arken.audio.enabled", "true");
    localStorage.setItem("arken.audio.volume", "0.05");
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const emit = vi.fn();
    const { container } = renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: { emit } as unknown as GameSocket,
        onUpload: vi.fn(),
      }),
    );
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    audio!.currentTime = 17;

    fireEvent.change(screen.getByRole("slider", { name: "Личная громкость" }), {
      target: { value: "0.5" },
    });

    expect(play).toHaveBeenCalledTimes(1);
    expect(audio!.currentTime).toBe(17);
    expect(audio!.volume).toBe(0.25);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("music playback recovery", () => {
  it("keeps one audio element and local volume while controls move between slots", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const firstSlot = document.createElement("div");
    const nextSlot = document.createElement("div");
    document.body.append(firstSlot, nextSlot);
    const view = renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
        controlsTarget: firstSlot,
      }),
    );
    const audio = view.container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(firstSlot.querySelector('[aria-label="Музыка"]')).not.toBeNull();
    fireEvent.change(
      firstSlot.querySelector<HTMLInputElement>(
        '[aria-label="Личная громкость"]',
      )!,
      { target: { value: "0.7" } },
    );

    view.rerender(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
        controlsTarget: nextSlot,
      }),
    );

    expect(view.container.querySelector("audio")).toBe(audio);
    expect(firstSlot.querySelector('[aria-label="Музыка"]')).toBeNull();
    expect(nextSlot.querySelector('[aria-label="Музыка"]')).not.toBeNull();
    expect(
      nextSlot.querySelector<HTMLInputElement>(
        '[aria-label="Личная громкость"]',
      )!.value,
    ).toBe("0.7");
    firstSlot.remove();
    nextSlot.remove();
  });

  it("treats browser consent failures as actionable", () => {
    expect(
      isAudioConsentError(new DOMException("blocked", "NotAllowedError")),
    ).toBe(true);
    expect(
      isAudioConsentError(new DOMException("blocked", "SecurityError")),
    ).toBe(true);
  });

  it("keeps local consent after transient scene-refresh races", () => {
    expect(
      isAudioConsentError(new DOMException("interrupted", "AbortError")),
    ).toBe(false);
    expect(isAudioConsentError(new Error("media is still loading"))).toBe(
      false,
    );
  });
});

describe("resolvePlaybackAction (UIX-380 regression)", () => {
  it("does nothing when already in the right state, so a re-run from an unrelated volume change is a no-op", () => {
    expect(resolvePlaybackAction(true, false)).toBe("none");
    expect(resolvePlaybackAction(false, true)).toBe("none");
  });

  it("only starts playback when the element is unexpectedly paused", () => {
    expect(resolvePlaybackAction(true, true)).toBe("play");
  });

  it("only pauses when the element is unexpectedly playing", () => {
    expect(resolvePlaybackAction(false, false)).toBe("pause");
  });

  it("never toggles across repeated calls while state is unchanged, matching the volume-slider-drag scenario", () => {
    // Simulates the effect re-running on every slider tick while audio.playing
    // stays true and the element is already playing: previously this called
    // pause() unconditionally, flipping play/paused on each successive tick.
    let playerPaused = false;
    for (let tick = 0; tick < 5; tick++) {
      const action = resolvePlaybackAction(true, playerPaused);
      expect(action).toBe("none");
      if (action === "play") playerPaused = false;
      if (action === "pause") playerPaused = true;
    }
  });
});

describe("resolveTrackPosition (UIX-505 track transport)", () => {
  it("wraps looping positions and clamps non-looping positions", () => {
    expect(resolveTrackPosition(125, 60, true)).toBe(5);
    expect(resolveTrackPosition(125, 60, false)).toBe(60);
    expect(resolveTrackPosition(-5, 60, false)).toBe(0);
    expect(resolveTrackPosition(Number.NaN, 0, false)).toBe(0);
  });
});

describe("topbar popovers dismiss like every other details popover", () => {
  // Regression: both topbar popovers are `position: absolute; z-index: 40`
  // and hang down over the sidebar. While one stayed open it swallowed the
  // pointer events aimed at the chat tabs underneath, which is exactly how
  // the GM + 6 multiplayer gate hung on `#chat-tab-activity`.
  const renderBar = (role: "GM" | "PLAYER") =>
    renderComponent(
      createElement(MusicBar, {
        audio: playingAudio,
        assets: [audioAsset],
        role,
        socket: null,
        onUpload: vi.fn(),
      }),
    );
  // jsdom does not implement the native summary-click toggle, so the open
  // state is set directly; the dismissal path under test is the same.
  const openPopover = (selector: string) => {
    const details = document.querySelector<HTMLDetailsElement>(selector);
    expect(details).not.toBeNull();
    details!.open = true;
    return details!;
  };

  it("closes the volume popover on an outside pointer so chat tabs stay clickable", () => {
    renderBar("PLAYER");
    const volume = openPopover("details.music-volume-control");
    const outside = document.createElement("button");
    document.body.append(outside);

    fireEvent.pointerDown(outside);

    expect(volume.open).toBe(false);
  });

  it("closes the volume popover on Escape", () => {
    renderBar("PLAYER");
    const volume = openPopover("details.music-volume-control");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(volume.open).toBe(false);
  });

  it("keeps the volume popover open while the pointer stays inside it", () => {
    renderBar("PLAYER");
    const volume = openPopover("details.music-volume-control");

    fireEvent.pointerDown(
      volume.querySelector("input") ?? volume.querySelector("summary")!,
    );

    expect(volume.open).toBe(true);
  });

  it("puts an accessible icon-only mute beside the labelled volume slider", () => {
    renderBar("PLAYER");
    const volume = openPopover("details.music-volume-control");
    expect(
      volume.querySelector(".music-volume-popover")?.children,
    ).toHaveLength(2);
    expect(
      screen.getByRole("slider", { name: "Личная громкость" }),
    ).toBeTruthy();
    const mute = volume.querySelector<HTMLButtonElement>(
      ".music-volume-popover__mute",
    );
    expect(mute).not.toBeNull();
    expect(mute!.getAttribute("aria-label")).toMatch(/звук/);
    expect(mute!.querySelector("svg.arken-icon")).not.toBeNull();
    expect(volume.querySelector(".music-volume-popover label span")).toBeNull();
  });

  it("closes the GM music menu on an outside pointer", () => {
    renderBar("GM");
    const overflow = openPopover("details.music-overflow");
    const outside = document.createElement("button");
    document.body.append(outside);

    fireEvent.pointerDown(outside);

    expect(overflow.open).toBe(false);
  });

  it("UIX645_MUSIC_TOPBAR_LUCIDE keeps named controls and decorative SVG", () => {
    const view = renderBar("GM");
    const { container } = view;
    for (const name of ["Пауза", "Громкость", "Плейлист"]) {
      const control = screen.getByLabelText(name, {
        exact: true,
        selector: name === "Пауза" ? "button" : "summary",
      });
      const icons = control.querySelectorAll("svg.arken-icon");
      expect(icons, `${name} Lucide icon`).toHaveLength(1);
      expect(icons[0]).toHaveAttribute("aria-hidden", "true");
    }
    const pauseIcon = screen
      .getByRole("button", { name: "Пауза" })
      .querySelector("svg.arken-icon")?.innerHTML;
    expect(container.textContent).not.toContain("⏸");
    expect(container.textContent).not.toContain("▶");
    expect(container.textContent).not.toContain("⋯");

    view.rerender(
      createElement(MusicBar, {
        audio: { ...playingAudio, playing: false },
        assets: [audioAsset],
        role: "GM",
        socket: null,
        onUpload: vi.fn(),
      }),
    );
    const play = screen.getByRole("button", { name: "Играть" });
    expect(play.querySelectorAll("svg.arken-icon")).toHaveLength(1);
    expect(play.querySelector("svg.arken-icon")?.innerHTML).not.toBe(pauseIcon);
    expect(play.textContent).not.toContain("▶");
  });
});

describe("LOCAL-9802: audio continuity across unrelated snapshot updates and looping", () => {
  it("does not re-seek or restart audio when receiving an unrelated snapshot with the same revision", () => {
    localStorage.setItem("arken.audio.enabled", "true");
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    const view = renderComponent(
      createElement(MusicBar, {
        audio: {
          ...playingAudio,
          revision: 42,
          startedAt: new Date(Date.now() - 30000).toISOString(),
        },
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );

    const audio = view.container.querySelector("audio");
    expect(audio).not.toBeNull();
    // Simulate player advancing locally to 30.5 seconds
    audio!.currentTime = 30.5;
    expect(play).toHaveBeenCalledTimes(1);

    // Simulate an unrelated snapshot arriving (e.g. token deleted on canvas)
    // with a new object reference but identical audio revision and parameters
    view.rerender(
      createElement(MusicBar, {
        audio: {
          ...playingAudio,
          revision: 42,
          startedAt: new Date(Date.now() - 30000).toISOString(),
        },
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );

    // currentTime must NOT be re-seeked, and play() must NOT be called again
    expect(audio!.currentTime).toBe(30.5);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("wraps expected position around duration for looping audio", () => {
    localStorage.setItem("arken.audio.enabled", "true");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    // Audio duration is 120s (from audioAsset.durationSeconds).
    // Started 250s ago. 250 % 120 = 10s.
    const startedAt = new Date(Date.now() - 250000).toISOString();
    const view = renderComponent(
      createElement(MusicBar, {
        audio: {
          ...playingAudio,
          loop: true,
          startedAt,
          positionSeconds: 0,
          revision: 10,
        },
        assets: [audioAsset],
        role: "PLAYER",
        socket: null,
        onUpload: vi.fn(),
      }),
    );

    const audio = view.container.querySelector("audio");
    expect(audio).not.toBeNull();
    // Instead of seeking to 250 (which exceeds 120s duration), it must wrap around to ~10s
    expect(audio!.currentTime).toBeGreaterThanOrEqual(9.5);
    expect(audio!.currentTime).toBeLessThanOrEqual(11.5);
  });
});
