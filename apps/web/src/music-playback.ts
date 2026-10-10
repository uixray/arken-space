/**
 * Decides whether the local <audio> element needs a play()/pause() call to
 * match the authoritative `audio.playing` state. Must only ever act on an
 * actual mismatch: the caller's effect re-runs on every volume-slider tick
 * (`volume` is a dependency, so the local volume control stays in sync), and
 * calling pause() unconditionally whenever audio.playing is true -- instead
 * of only when the element is unexpectedly paused -- toggles playback on
 * every slider increment (UIX-380).
 */
export function resolvePlaybackAction(
  audioPlaying: boolean,
  playerPaused: boolean,
): "play" | "pause" | "none" {
  if (audioPlaying) return playerPaused ? "play" : "none";
  return playerPaused ? "none" : "pause";
}

/** Normalizes a server position against the active media element's duration. */
export function resolveTrackPosition(
  positionSeconds: number,
  durationSeconds: number,
  loop: boolean,
): number {
  const position = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
  const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  if (duration <= 0) return position;
  return loop ? position % duration : Math.min(position, duration);
}
