import { describe, expect, it } from "vitest";
import { isAudioConsentError } from "./audio-playback";
import { resolvePlaybackAction } from "./music-playback";

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
