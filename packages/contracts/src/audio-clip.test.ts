import { describe, expect, it } from "vitest";
import { audioClipPreviewRequestSchema, audioClipSaveRequestSchema } from "./audio-clip.js";

describe("audio clip contracts", () => {
  it("accepts integer millisecond ranges and rejects inverted or fractional ranges", () => {
    const actionId = "a78a59c2-f608-4bcc-b6dc-a712af58f49f";
    const sourceVersion = "sha256:abc";
    expect(audioClipPreviewRequestSchema.safeParse({ actionId, sourceVersion, startMs: 0, endMs: 1 }).success).toBe(true);
    expect(audioClipPreviewRequestSchema.safeParse({ actionId, sourceVersion, startMs: 2, endMs: 1 }).success).toBe(false);
    expect(audioClipPreviewRequestSchema.safeParse({ actionId, sourceVersion, startMs: 0.1, endMs: 1 }).success).toBe(false);
    expect(audioClipPreviewRequestSchema.safeParse({ actionId, sourceVersion, startMs: 0, endMs: 10001 }).success).toBe(false);
  });

  it("rejects extra save fields and applies explicit sound defaults", () => {
    const parsed = audioClipSaveRequestSchema.parse({
      actionId: "a78a59c2-f608-4bcc-b6dc-a712af58f49f",
      candidateId: "15519682-b53b-4908-a29e-8dc39d3d7868",
      label: "Door",
    });
    expect(parsed.audience).toBe("ALL_MEMBERS");
    expect(audioClipSaveRequestSchema.safeParse({ ...parsed, storagePath: "x" }).success).toBe(false);
  });
});
