import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { quantizeAudioClipRange } from "./audio-clip-lifecycle.js";
import { createWaveformAccumulator } from "./waveform-accumulator.js";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const STDERR_LIMIT = 32 * 1024;
const JOB_TIMEOUT_MS = 30_000;
const ANALYSIS_TIMEOUT_MS = 60_000;
const MAX_PENDING_CODEC_JOBS = 2;
let activeCodecJobs = 0;
const codecQueue: Array<() => void> = [];

async function acquireCodecSlot() {
  if (activeCodecJobs < 1) {
    activeCodecJobs += 1;
    return;
  }
  if (codecQueue.length >= MAX_PENDING_CODEC_JOBS)
    throw new Error("PROCESSING_BUSY");
  await new Promise<void>((resolve) =>
    codecQueue.push(() => {
      activeCodecJobs += 1;
      resolve();
    }),
  );
}

function releaseCodecSlot() {
  activeCodecJobs = Math.max(0, activeCodecJobs - 1);
  codecQueue.shift()?.();
}

export interface AudioProfile {
  sampleRate: number;
  channels: number;
  frames: number;
  durationMs: number;
  sampleFormat: "u8" | "s16" | "s32" | "flt" | "dbl" | "s64";
}

function binary(name: "ffmpeg" | "ffprobe") {
  const configured =
    process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  return configured || name;
}

async function runCodec(
  args: string[],
  input: Readable,
  timeoutMs: number,
  outputLimit = MAX_OUTPUT_BYTES,
  consumeOutput?: (chunk: Buffer) => void,
): Promise<Buffer> {
  try {
    await acquireCodecSlot();
  } catch (error) {
    input.destroy();
    throw error;
  }
  return new Promise((resolve, reject) => {
    const tool = args[0] as "ffmpeg" | "ffprobe";
    const child = spawn(binary(tool), args.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let stderrBytes = 0;
    let stderr = "";
    let settled = false;
    let terminalError: Error | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      terminalError ??= error;
      settled = true;
      clearTimeout(timer);
      releaseCodecSlot();
      input.unpipe(child.stdin);
      if (terminalError) {
        input.destroy();
        reject(terminalError);
        return;
      }
      resolve(
        consumeOutput ? Buffer.alloc(0) : Buffer.concat(chunks, outputBytes),
      );
    };
    const abort = (error: Error) => {
      terminalError ??= error;
      input.unpipe(child.stdin);
      input.destroy();
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => abort(new Error("PROCESSING_TIMEOUT")),
      timeoutMs,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > outputLimit) {
        abort(new Error("PROCESSING_OUTPUT_LIMIT"));
        return;
      }
      if (consumeOutput) {
        try {
          consumeOutput(chunk);
        } catch {
          abort(new Error("CODEC_FAILED"));
        }
      } else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= STDERR_LIMIT) return;
      const retained = chunk.subarray(0, STDERR_LIMIT - stderrBytes);
      stderrBytes += retained.length;
      stderr += retained.toString("utf8");
    });
    child.on("error", () => abort(new Error("CODEC_UNAVAILABLE")));
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        // ffprobe may finish reading enough container metadata before a large
        // pipe source is fully written. Keep the child lifecycle authoritative:
        // only a successful close plus caller validation can accept its output.
        input.unpipe(child.stdin);
        input.destroy();
        return;
      }
      abort(new Error("CODEC_FAILED"));
    });
    child.on("close", (code) =>
      finish(
        code === 0
          ? undefined
          : (terminalError ??
              new Error(
                stderr.includes("Invalid data")
                  ? "UNSUPPORTED_AUDIO"
                  : "CODEC_FAILED",
              )),
      ),
    );
    input.on("error", () => abort(new Error("SOURCE_READ_FAILED")));
    input.pipe(child.stdin);
  });
}

function parseProbe(data: Buffer): AudioProfile {
  let parsed: {
    streams?: Array<{
      codec_type?: string;
      sample_rate?: string;
      channels?: number;
      sample_fmt?: string;
      disposition?: { attached_pic?: number };
      duration?: string;
      duration_ts?: string;
      time_base?: string;
    }>;
  };
  try {
    parsed = JSON.parse(data.toString("utf8")) as typeof parsed;
  } catch {
    throw new Error("UNSUPPORTED_AUDIO");
  }
  const streams = parsed.streams ?? [];
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  if (
    audio.length !== 1 ||
    streams.some(
      (stream) =>
        stream.codec_type !== "audio" && stream.disposition?.attached_pic !== 1,
    )
  )
    throw new Error("UNSUPPORTED_AUDIO");
  const stream = audio[0]!;
  const sampleRate = Number(stream.sample_rate);
  const channels = Number(stream.channels);
  const sampleFormat = (
    {
      u8: "u8",
      s16: "s16",
      s16p: "s16",
      s32: "s32",
      s32p: "s32",
      flt: "flt",
      fltp: "flt",
      dbl: "dbl",
      dblp: "dbl",
      s64: "s64",
      s64p: "s64",
    } as Record<string, AudioProfile["sampleFormat"]>
  )[stream.sample_fmt ?? ""];
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000 ||
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > 8 ||
    !sampleFormat ||
    !["u8", "s16", "s32", "flt", "dbl", "s64"].includes(sampleFormat)
  )
    throw new Error("UNSUPPORTED_AUDIO");
  // Duration and frame count come from a bounded full decode, never container metadata.
  return { sampleRate, channels, durationMs: 0, frames: 0, sampleFormat };
}

function probeArgs(): string[] {
  return [
    "ffprobe",
    "-v",
    "error",
    "-protocol_whitelist",
    "pipe",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    "-i",
    "pipe:0",
  ];
}

export async function inspectAudioSource(
  input: Readable,
  expectedMime?: "audio/mpeg" | "audio/ogg" | "audio/wav",
) {
  const probe = await runCodec(
    probeArgs(),
    input,
    ANALYSIS_TIMEOUT_MS,
    256 * 1024,
  );
  if (expectedMime) {
    let formatNames: string;
    try {
      formatNames =
        (
          JSON.parse(probe.toString("utf8")) as {
            format?: { format_name?: string };
          }
        ).format?.format_name ?? "";
    } catch {
      throw new Error("UNSUPPORTED_AUDIO");
    }
    const accepted =
      expectedMime === "audio/mpeg"
        ? /(?:^|,)mp3(?:,|$)/
        : expectedMime === "audio/ogg"
          ? /(?:^|,)ogg(?:,|$)/
          : /(?:^|,)wav(?:,|$)/;
    if (!accepted.test(formatNames)) throw new Error("UNSUPPORTED_AUDIO");
  }
  return parseProbe(probe);
}

export async function decodeWaveform(
  input: Readable,
  profile: AudioProfile,
  bins = 2048,
) {
  if (!Number.isInteger(bins) || bins < 1 || bins > 2048)
    throw new Error("INVALID_RANGE");
  const accumulator = createWaveformAccumulator(profile.channels, bins);
  // Retain the accepted 24h duration ceiling, timeout and codec concurrency
  // bounds, but never buffer the complete multichannel decoded PCM.
  await runCodec(
    [
      "ffmpeg",
      "-v",
      "error",
      "-protocol_whitelist",
      "pipe",
      "-i",
      "pipe:0",
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "pipe:1",
    ],
    input,
    ANALYSIS_TIMEOUT_MS,
    profile.sampleRate * profile.channels * 4 * 86400,
    (chunk) => accumulator.push(chunk),
  );
  const { frames, peaks } = accumulator.finish();
  return { frames, durationMs: (frames * 1000) / profile.sampleRate, peaks };
}

const pcmEncoder: Record<AudioProfile["sampleFormat"], string> = {
  u8: "pcm_u8",
  s16: "pcm_s16le",
  s32: "pcm_s32le",
  flt: "pcm_f32le",
  dbl: "pcm_f64le",
  s64: "pcm_s64le",
};

export async function renderPcmClip(
  input: Readable,
  profile: AudioProfile,
  startMs: number,
  endMs: number,
) {
  const { startFrame, endFrame, actualStartMs, actualEndMs } =
    quantizeAudioClipRange(profile, startMs, endMs);
  const raw = await runCodec(
    [
      "ffmpeg",
      "-v",
      "error",
      "-protocol_whitelist",
      "pipe",
      "-i",
      "pipe:0",
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-af",
      `atrim=start_sample=${startFrame}:end_sample=${endFrame},asetpts=PTS-STARTPTS`,
      "-ar",
      String(profile.sampleRate),
      "-ac",
      String(profile.channels),
      "-c:a",
      pcmEncoder[profile.sampleFormat],
      "-map_metadata",
      "-1",
      "-fflags",
      "+bitexact",
      "-f",
      "wav",
      "pipe:1",
    ],
    input,
    JOB_TIMEOUT_MS,
  );
  return {
    buffer: raw,
    range: {
      startMs,
      endMs,
      actualStartMs,
      actualEndMs,
      actualStartFrame: startFrame,
      actualEndFrame: endFrame,
      sampleRate: profile.sampleRate,
      channels: profile.channels,
      frames: endFrame - startFrame,
    },
  };
}
