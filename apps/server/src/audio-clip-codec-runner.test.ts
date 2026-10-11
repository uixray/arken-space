import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeChildControl = vi.hoisted(() => ({
  spawnImpl: undefined as ((...args: unknown[]) => unknown) | undefined,
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => fakeChildControl.spawnImpl?.(...args),
}));

import { inspectAudioSource } from "./audio-clip-codec.js";

type FakeScenario = "epipe-success" | "epipe-failure" | "other-stdin-error" | "stall-after-epipe" | "output-limit-after-epipe";

const validProbe = Buffer.from(JSON.stringify({
  streams: [{ codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "44100", channels: 2, sample_fmt: "s16" }],
  format: { format_name: "wav" },
}));

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private closeScheduled = false;
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.close(1));
    return true;
  });

  constructor(readonly scenario: FakeScenario) {
    super();
    queueMicrotask(() => this.runScenario());
  }

  private close(exitCode: number) {
    if (this.closeScheduled) return;
    this.closeScheduled = true;
    this.stdout.once("end", () => this.emit("close", exitCode, null));
    this.stdout.end(this.scenario === "output-limit-after-epipe" ? Buffer.alloc(256 * 1024 + 1) : validProbe);
    this.stderr.end();
  }

  private runScenario() {
    const error = Object.assign(new Error("fake stdin failure"), {
      code: this.scenario === "other-stdin-error" ? "EIO" : "EPIPE",
    });
    this.stdin.destroy(error);
    if (this.scenario === "stall-after-epipe" || this.scenario === "other-stdin-error") return;
    this.close(this.scenario === "epipe-failure" ? 1 : 0);
  }
}

let lastChild: FakeChild | undefined;

describe("codec child stdin error lifecycle", () => {
  beforeEach(() => {
    lastChild = undefined;
    fakeChildControl.spawnImpl = () => {
      lastChild = new FakeChild(currentScenario);
      return lastChild;
    };
  });

  afterEach(() => {
    fakeChildControl.spawnImpl = undefined;
    vi.useRealTimers();
  });

  let currentScenario: FakeScenario = "epipe-success";
  const source = () => Buffer.alloc(16, 1);

  it("accepts EPIPE only when the child closes successfully and probe output validates", async () => {
    currentScenario = "epipe-success";
    const profile = await inspectAudioSource(Readable.from(source()), "audio/wav");
    expect(profile).toEqual({ sampleRate: 44_100, channels: 2, durationMs: 0, frames: 0, sampleFormat: "s16" });
    expect(lastChild?.kill).not.toHaveBeenCalled();
  });

  it("rejects EPIPE when the child exits nonzero", async () => {
    currentScenario = "epipe-failure";
    await expect(inspectAudioSource(Readable.from(source()), "audio/wav"))
      .rejects.toThrow("CODEC_FAILED");
  });

  it("aborts non-EPIPE stdin errors", async () => {
    currentScenario = "other-stdin-error";
    const pending = inspectAudioSource(Readable.from(source()), "audio/wav");
    await expect(pending).rejects.toThrow("CODEC_FAILED");
    expect(lastChild?.kill).toHaveBeenCalledOnce();
  });

  it("keeps the timeout active after EPIPE", async () => {
    currentScenario = "stall-after-epipe";
    vi.useFakeTimers();
    const pending = inspectAudioSource(Readable.from(source()), "audio/wav");
    const rejection = expect(pending).rejects.toThrow("PROCESSING_TIMEOUT");
    await vi.advanceTimersByTimeAsync(60_001);
    await rejection;
    expect(lastChild?.kill).toHaveBeenCalledOnce();
  });

  it("keeps the output limit active after EPIPE", async () => {
    currentScenario = "output-limit-after-epipe";
    await expect(inspectAudioSource(Readable.from(source()), "audio/wav"))
      .rejects.toThrow("PROCESSING_OUTPUT_LIMIT");
    expect(lastChild?.kill).toHaveBeenCalledOnce();
  });
});
