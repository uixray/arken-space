import { createHash } from "node:crypto";
import type { AudioProfile } from "./audio-clip-codec.js";

const PCM_WAV_HEADER_RESERVE_BYTES = 80;

const bytesPerSample: Record<AudioProfile["sampleFormat"], number> = {
  u8: 1, s16: 2, s32: 4, flt: 4, dbl: 8, s64: 8,
};

export function audioClipIntentHash(input: {
  sourceAssetId: string;
  sourceVersion: string;
  startMs: number;
  endMs: number;
}) {
  return createHash("sha256").update(JSON.stringify([
    input.sourceAssetId, input.sourceVersion, input.startMs, input.endMs,
  ])).digest("hex");
}

export function quantizeAudioClipRange(profile: AudioProfile, startMs: number, endMs: number) {
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs || endMs - startMs > 10_000 || endMs > profile.durationMs)
    throw new Error("INVALID_RANGE");
  const startFrame = Math.floor(startMs * profile.sampleRate / 1000);
  const endFrame = Math.floor(endMs * profile.sampleRate / 1000);
  if (endFrame <= startFrame) throw new Error("INVALID_RANGE");
  return {
    startFrame,
    endFrame,
    actualStartMs: startFrame * 1000 / profile.sampleRate,
    actualEndMs: endFrame * 1000 / profile.sampleRate,
  };
}

/** Bounded FFmpeg PCM-WAV header reserve: RIFF/WAVE (12) + maximum extensible fmt chunk (48) + optional fact chunk (12) + data header (8). The encoder uses bitexact output to omit LIST metadata; actual output is still checked against this reservation. */
export function estimatePcmWavBytes(profile: AudioProfile, startMs: number, endMs: number) {
  const { startFrame, endFrame } = quantizeAudioClipRange(profile, startMs, endMs);
  const dataBytes = (endFrame - startFrame) * profile.channels * bytesPerSample[profile.sampleFormat];
  if (!Number.isSafeInteger(dataBytes) || dataBytes > 0xffff_ffff - PCM_WAV_HEADER_RESERVE_BYTES) throw new Error("UNSUPPORTED_AUDIO");
  return dataBytes + PCM_WAV_HEADER_RESERVE_BYTES;
}

export function isSameAudioIntent(existingHash: string, nextHash: string) {
  return existingHash === nextHash;
}
