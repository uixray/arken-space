import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { decodeWaveform, inspectAudioSource, renderPcmClip } from "./audio-clip-codec.js";
import { estimatePcmWavBytes } from "./audio-clip-lifecycle.js";

const profile = { sampleRate: 48_000, channels: 2, frames: 480_000, durationMs: 10_000, sampleFormat: "s16" as const };

describe("PCM clip range validation", () => {
  it("rejects overlong and out-of-source requests before starting a codec process", async () => {
    await expect(renderPcmClip(Readable.from([]), profile, 0, 10_001)).rejects.toThrow("INVALID_RANGE");
    await expect(renderPcmClip(Readable.from([]), profile, 9_999, 10_001)).rejects.toThrow("INVALID_RANGE");
  });

  it("rejects a range that quantizes to no sample frames", async () => {
    const highRate = { ...profile, sampleRate: 8_000, durationMs: 10_000, frames: 80_000 };
    await expect(renderPcmClip(Readable.from([]), highRate, 1, 1)).rejects.toThrow("INVALID_RANGE");
  });
});

function pcmWaveFixture(sampleRate = 44_100, frames = 44_100) {
  const dataBytes = frames * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame++) wav.writeInt16LE(frame % 64 < 32 ? 8_000 : -8_000, 44 + frame * 2);
  return wav;
}

function wavDataBytes(wav: Buffer) {
  for (let offset = 12; offset + 8 <= wav.length;) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const declaredSize = wav.readUInt32LE(offset + 4);
    if (chunkId === "data") return declaredSize === 0xffff_ffff ? wav.length - offset - 8 : declaredSize;
    offset += 8 + declaredSize + (declaredSize & 1);
  }
  throw new Error("WAV data chunk missing");
}

function wavHeaderBytes(wav: Buffer) {
  for (let offset = 12; offset + 8 <= wav.length;) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const declaredSize = wav.readUInt32LE(offset + 4);
    if (chunkId === "data") return offset + 8;
    offset += 8 + declaredSize + (declaredSize & 1);
  }
  throw new Error("WAV data chunk missing");
}

describe.skipIf(process.env.AUDIO_CLIP_CODEC_INTEGRATION !== "1")("native audio codec integration", () => {
  it("decodes actual PCM frame count, waveform and immutable 44.1kHz preview endpoints", async () => {
    const source = pcmWaveFixture();
    const profile = await inspectAudioSource(Readable.from(source), "audio/wav");
    const decoded = await decodeWaveform(Readable.from(source), profile, 64);
    expect(decoded.frames).toBe(44_100);
    expect(decoded.durationMs).toBe(1_000);
    expect(decoded.peaks.some((peak) => peak > 0.2)).toBe(true);

    const rendered = await renderPcmClip(Readable.from(source), { ...profile, ...decoded }, 1, 101);
    expect(rendered.range.actualStartFrame).toBe(44);
    expect(rendered.range.actualEndFrame).toBe(4_454);
    expect(rendered.buffer.subarray(0, 4).toString()).toBe("RIFF");
    expect(wavDataBytes(rendered.buffer)).toBe((4_454 - 44) * 2);
    const renderedProfile = await inspectAudioSource(Readable.from(rendered.buffer), "audio/wav");
    const renderedDecoded = await decodeWaveform(Readable.from(rendered.buffer), renderedProfile, 64);
    expect(renderedDecoded.frames).toBe(4_410);
  });

  it("reserves enough for the exact 48kHz 3-second source 1-second preview output", async () => {
    const source = pcmWaveFixture(48_000, 144_000);
    const profile = await inspectAudioSource(Readable.from(source), "audio/wav");
    const decoded = await decodeWaveform(Readable.from(source), profile, 64);
    const exactProfile = { ...profile, ...decoded };
    const reservation = estimatePcmWavBytes(exactProfile, 300, 1_300);
    const rendered = await renderPcmClip(Readable.from(source), exactProfile, 300, 1_300);

    expect(source.length).toBe(288_044);
    expect(rendered.range.frames).toBe(48_000);
    expect(wavDataBytes(rendered.buffer)).toBe(96_000);
    expect(wavHeaderBytes(rendered.buffer)).toBe(44);
    expect(rendered.buffer.length).toBeLessThanOrEqual(reservation);
    expect(reservation).toBe(96_080);
  });
});
