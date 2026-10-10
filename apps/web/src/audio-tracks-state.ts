import type { AudioTrackDto } from "@arken/contracts";

/** Per-track event ordering: global campaign events can interleave with audio,
 * so a newer event for a different entity must not hide this track's update. */
export type AudioTrackEventCursor = Map<string, { sequence: number; revision: number; removed?: boolean }>;

export function seedAudioTrackCursor(
  snapshotTracks: AudioTrackDto[],
  snapshotVersion: number,
  previousTracks: AudioTrackDto[],
  cursor: AudioTrackEventCursor,
) {
  const present = new Set(snapshotTracks.map((track) => track.id));
  for (const track of snapshotTracks) {
    const seen = cursor.get(track.id);
    if (!seen || seen.sequence <= snapshotVersion)
      cursor.set(track.id, { sequence: snapshotVersion, revision: track.revision, removed: false });
  }
  for (const previous of previousTracks)
    if (!present.has(previous.id))
      cursor.set(previous.id, { sequence: snapshotVersion, revision: Number.MAX_SAFE_INTEGER, removed: true });
}

export function applyAudioTrackState(
  tracks: AudioTrackDto[],
  next: AudioTrackDto,
  sequence: number,
  cursor: AudioTrackEventCursor,
  canonicalFloor = 0,
): AudioTrackDto[] {
  if (sequence <= canonicalFloor) return tracks;
  const seen = cursor.get(next.id);
  const existing = tracks.find((track) => track.id === next.id);
  if (seen?.removed || (seen && sequence <= seen.sequence)) return tracks;
  if (existing && next.revision <= existing.revision) return tracks;
  cursor.set(next.id, { sequence, revision: next.revision, removed: false });
  return [...tracks.filter((track) => track.id !== next.id), next].sort(
    (a, b) => a.slotOrder - b.slotOrder,
  );
}

export function applyAudioTrackRemoved(
  tracks: AudioTrackDto[],
  trackId: string,
  sequence: number,
  cursor: AudioTrackEventCursor,
  canonicalFloor = 0,
): AudioTrackDto[] {
  if (sequence <= canonicalFloor) return tracks;
  const seen = cursor.get(trackId);
  if (seen && sequence <= seen.sequence) return tracks;
  cursor.set(trackId, { sequence, revision: Number.MAX_SAFE_INTEGER, removed: true });
  return tracks.filter((track) => track.id !== trackId);
}
