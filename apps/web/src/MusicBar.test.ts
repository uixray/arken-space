// @vitest-environment jsdom
import { createElement } from "react";
import type { AssetDto, AudioStateDto, CommandAck } from "@arken/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAudioConsentError } from "./audio-playback";
import { volumeSliderToGain } from "./audio-volume";
import { resolvePlaybackAction } from "./music-playback";
import type { GameSocket } from "./realtime";
import { notify } from "./ui/notifications";
import { fireEvent, renderComponent, screen } from "./test-support/render";

vi.mock("@gravity-ui/uikit", () => ({
  Button: () => null,
  Checkbox: () => null,
  Loader: () => null,
}));
vi.mock("./ui/ArkenDialog", () => ({ ArkenDialog: () => null }));
vi.mock("./ui/notifications", () => ({ notify: vi.fn() }));

const { MusicBar } = await import("./MusicBar");

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
        "audio:set",
        {
          command: "PLAY",
          revision: playingAudio.revision,
          actionId: expect.any(String),
        },
        expect.any(Function),
      );
      expect(notify).toHaveBeenCalledExactlyOnceWith({
        title: "Не удалось изменить музыку",
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

  it("closes the GM music menu on an outside pointer", () => {
    renderBar("GM");
    const overflow = openPopover("details.music-overflow");
    const outside = document.createElement("button");
    document.body.append(outside);

    fireEvent.pointerDown(outside);

    expect(overflow.open).toBe(false);
  });
});
