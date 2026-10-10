import { describe, expect, it } from "vitest";
import type { AudioTrackDto } from "@arken/contracts";
import { applyAudioTrackRemoved, applyAudioTrackState, seedAudioTrackCursor } from "./audio-tracks-state";

const track = (id: string, revision = 0, slotOrder = 0): AudioTrackDto => ({
  id, assetId: `asset-${id}`, mixVolume: 1, playing: false,
  positionSeconds: 0, loop: false, startedAt: null, slotOrder, revision,
  updatedAt: "2026-10-09T00:00:00.000Z",
});

describe("audio track realtime reconciliation", () => {
  it("applies interleaved tracks independently and keeps slot order", () => {
    const cursor = new Map();
    const a = track("a");
    const b = track("b", 0, 1);
    const first = applyAudioTrackState([], a, 12, cursor);
    const second = applyAudioTrackState(first, b, 11, cursor);
    expect(second.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("rejects stale revisions and events after a remove tombstone", () => {
    const cursor = new Map();
    const current = applyAudioTrackState([], track("a", 2), 20, cursor);
    const removed = applyAudioTrackRemoved(current, "a", 21, cursor);
    expect(applyAudioTrackState(removed, track("a", 1), 19, cursor)).toBe(removed);
    expect(applyAudioTrackState(removed, track("a", 3), 22, cursor)).toBe(removed);
  });

  it("keeps authoritative empty state empty; no legacy migration is inferred", () => {
    const cursor = new Map();
    const tracks: AudioTrackDto[] = [];
    seedAudioTrackCursor(tracks, 100, [track("removed"), track("legacy")], cursor);
    expect(applyAudioTrackState(tracks, track("removed"), 99, cursor, 100)).toBe(tracks);
    // An unrelated entity may have advanced the global snapshotVersion to 200;
    // that is not the audio floor, so this legitimate seq 101 track still applies.
    expect(applyAudioTrackState(tracks, track("new"), 101, cursor, 100).map((item) => item.id)).toEqual(["new"]);
  });
});
