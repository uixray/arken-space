import { describe, expect, it } from "vitest";
import {
  audioClipPreviewRequestSchema,
  audioClipSaveRequestSchema,
} from "../../../packages/contracts/src/audio-clip.js";

describe("frozen audio clip API contracts", () => {
  const base = {
    actionId: "a78a59c2-f608-4bcc-b6dc-a712af58f49f",
    sourceVersion: '"opaque-version"',
  };
  it("accepts integral bounded ranges and rejects fractional, inverted, and over-ten-second intents", () => {
    expect(
      audioClipPreviewRequestSchema.safeParse({
        ...base,
        startMs: 0,
        endMs: 10_000,
      }).success,
    ).toBe(true);
    expect(
      audioClipPreviewRequestSchema.safeParse({
        ...base,
        startMs: 1.25,
        endMs: 100,
      }).success,
    ).toBe(false);
    expect(
      audioClipPreviewRequestSchema.safeParse({
        ...base,
        startMs: 100,
        endMs: 99,
      }).success,
    ).toBe(false);
    expect(
      audioClipPreviewRequestSchema.safeParse({
        ...base,
        startMs: 0,
        endMs: 10_001,
      }).success,
    ).toBe(false);
  });

  it("rejects path injection in save command", () => {
    const request = {
      actionId: base.actionId,
      candidateId: "15519682-b53b-4908-a29e-8dc39d3d7868",
      label: "Door",
      storagePath: "../../outside.wav",
    };
    expect(audioClipSaveRequestSchema.safeParse(request).success).toBe(false);
  });
});
