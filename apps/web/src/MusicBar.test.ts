import { describe, expect, it } from "vitest";
import { isAudioConsentError } from "./audio-playback";

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
