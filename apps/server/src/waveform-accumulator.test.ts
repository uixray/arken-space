import { describe, expect, it } from "vitest";
import { createWaveformAccumulator } from "./waveform-accumulator.js";

describe("bounded streaming waveform", () => {
  it("is independent of stdout chunk/frame boundaries and retains channel transients", () => {
    const pcm = Buffer.alloc(1000 * 8);
    pcm.writeFloatLE(-0.75, 500 * 8 + 4);
    const whole = createWaveformAccumulator(2, 64);
    whole.push(pcm);
    const split = createWaveformAccumulator(2, 64);
    for (let offset = 0; offset < pcm.length; offset += 13)
      split.push(pcm.subarray(offset, offset + 13));
    expect(split.finish()).toEqual(whole.finish());
    expect(split.finish().frames).toBe(1000);
    expect(Math.max(...split.finish().peaks)).toBe(0.75);
  });

  it("analyzes 120s 44.1kHz stereo beyond the old 32MiB limit without buffering PCM", () => {
    const accumulator = createWaveformAccumulator(2, 2048);
    const chunk = Buffer.alloc(44100 * 8);
    chunk.writeFloatLE(0.5, chunk.length - 4);
    for (let second = 0; second < 120; second++) accumulator.push(chunk);
    const result = accumulator.finish();
    expect(result.frames).toBe(44100 * 120);
    expect(result.peaks).toHaveLength(2048);
    expect(Math.max(...result.peaks)).toBe(0.5);
  });

  it("fails closed for empty/incomplete PCM and invalid channel/bin settings", () => {
    expect(() => createWaveformAccumulator(0, 64)).toThrow("INVALID_RANGE");
    expect(() => createWaveformAccumulator(2, 2049)).toThrow("INVALID_RANGE");
    expect(() => createWaveformAccumulator(2, 64).finish()).toThrow(
      "CODEC_FAILED",
    );
    const partial = createWaveformAccumulator(2, 64);
    partial.push(Buffer.alloc(9));
    expect(() => partial.finish()).toThrow("CODEC_FAILED");
  });
});
