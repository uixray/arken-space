/**
 * UIX-396 stage 2 — applying a bulk MOVE result locally.
 *
 * Dragging tokens is the most frequent action in the app, and its response
 * used to be discarded: `/api/canvas/bulk` returns the new revision for every
 * moved entity, but the client kept the stale one until the broadcast landed.
 * Drag the same token twice in quick succession and the second request
 * carried a revision the server had already superseded, so it was rejected
 * with a 409 and the move was simply lost. The faster the user worked, the
 * more often it happened.
 *
 * The fix is the same one `onTokenResize` already uses: take the revision
 * from the response instead of waiting for the broadcast. Positions can be
 * applied locally too, because the server applies the delta verbatim
 * (`x: row.x + deltaX`, no clamping), so the client computing `x + deltaX`
 * lands on exactly the value the broadcast will later confirm — no
 * divergence, and nothing visibly jumps when it arrives.
 *
 * This is deliberately narrower than the general mutation log described in
 * docs/uix-396-optimistic-ui-proposal.md: it applies the same principle
 * (chain the revision from the response) to the hottest path with no new
 * machinery. Whether the full log is needed should be re-measured after this.
 */

export interface MovableCanvasItem {
  id: string;
  x: number;
  y: number;
  revision: number;
}

export interface CanvasDelta {
  x: number;
  y: number;
}

/**
 * Returns items with the delta and server-assigned revision applied to
 * everything named in `revisions`. The original array reference is returned
 * untouched when nothing matched, so an unrelated bulk move cannot trigger a
 * re-render of this collection.
 */
export function applyBulkMoveResult<T extends MovableCanvasItem>(
  items: readonly T[],
  revisions: Record<string, number> | undefined,
  delta: CanvasDelta,
): readonly T[] {
  if (!revisions) return items;
  const moved = Object.keys(revisions);
  if (moved.length === 0) return items;
  const movedIds = new Set(moved);
  if (!items.some((item) => movedIds.has(item.id))) return items;

  return items.map((item) => {
    const revision = revisions[item.id];
    if (revision === undefined) return item;
    return {
      ...item,
      x: item.x + delta.x,
      y: item.y + delta.y,
      // Trust the server's revision rather than incrementing locally: it is
      // the value the next mutation has to send, and guessing it would
      // reintroduce exactly the staleness this exists to remove.
      revision,
    };
  });
}
