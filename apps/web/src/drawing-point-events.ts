import type { DrawingDto, GameSnapshot } from "@arken/contracts";

/**
 * UIX-412: drawing point events patch the snapshot in place.
 *
 * Unlike fog or token events they are not gated on `snapshotVersion`: the
 * server sends a drawing event only after any snapshot already in flight has
 * gone out, and every later snapshot was read after the commit, so delivery
 * order alone is correct. A version gate would drop the event whenever an
 * earlier snapshot happened to read the new sequence but not yet the row.
 */
export function applyDrawingUpserted(
  current: GameSnapshot,
  event: { sequence: number; data: DrawingDto },
): GameSnapshot {
  const drawings = current.drawings ?? [];
  const index = drawings.findIndex((drawing) => drawing.id === event.data.id);
  return {
    ...current,
    snapshotVersion: Math.max(current.snapshotVersion, event.sequence),
    drawings:
      index === -1
        ? [...drawings, event.data]
        : drawings.map((drawing, at) => (at === index ? event.data : drawing)),
  };
}

export function applyDrawingRemoved(
  current: GameSnapshot,
  event: { sequence: number; data: { drawingId: string } },
): GameSnapshot {
  return {
    ...current,
    snapshotVersion: Math.max(current.snapshotVersion, event.sequence),
    drawings: (current.drawings ?? []).filter(
      (drawing) => drawing.id !== event.data.drawingId,
    ),
  };
}
