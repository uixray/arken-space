import { describe, expect, it } from "vitest";
import { audioClipIntentHash, estimatePcmWavBytes, quantizeAudioClipRange } from "./audio-clip-lifecycle.js";

describe("audio clip lifecycle limits", () => {
  const profile = { sampleRate: 48_000, channels: 2, frames: 480_000, durationMs: 10_000, sampleFormat: "s16" as const };

  it("estimates bounded PCM output after sample-frame quantization", () => {
    expect(estimatePcmWavBytes(profile, 100, 1_100)).toBe(192_080);
    expect(() => estimatePcmWavBytes(profile, 0, 10_001)).toThrow("INVALID_RANGE");
  });

  it("reserves the documented maximum RIFF/fmt/fact/data header overhead", () => {
    const mono = { sampleRate: 48_000, channels: 1, frames: 144_000, durationMs: 3_000, sampleFormat: "s16" as const };
    expect(estimatePcmWavBytes(mono, 300, 1_300)).toBe(96_080);
  });

  it("rejects PCM payloads whose bounded RIFF size plus header would overflow 32-bit WAV sizes", () => {
    const nearLimit = { sampleRate: 429_496_723, channels: 1, frames: 4_294_967_230, durationMs: 10_000, sampleFormat: "u8" as const };
    expect(() => estimatePcmWavBytes(nearLimit, 0, 10_000)).toThrow("UNSUPPORTED_AUDIO");
  });

  it("hashes exact source/range intent deterministically", () => {
    const intent = { sourceAssetId: "a", sourceVersion: "v1", startMs: 100, endMs: 500 };
    expect(audioClipIntentHash(intent)).toBe(audioClipIntentHash(intent));
    expect(audioClipIntentHash(intent)).not.toBe(audioClipIntentHash({ ...intent, endMs: 501 }));
  });

  it("preserves exact sample endpoints instead of rounding milliseconds at 44.1 kHz", () => {
    const profile44100 = { ...profile, sampleRate: 44_100, frames: 441_000 };
    const range = quantizeAudioClipRange(profile44100, 1, 1_001);
    expect(range.startFrame).toBe(44);
    expect(range.endFrame).toBe(44_144);
    expect(range.actualStartMs).toBeCloseTo(44 * 1000 / 44_100, 12);
    expect(range.actualStartMs).not.toBe(1);
  });
});
