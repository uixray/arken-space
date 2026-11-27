import type { GameSnapshot, SnapshotDelta } from "@arken/contracts";

/** Separate from live React state, which point events and previews can change.
 * A delta must reconstruct the exact canonical image the server compared with,
 * not overlay stale/omitted fields onto a locally modified game state.
 */
export function createSnapshotDelivery(campaignId: string) {
  let baseline: { id: string; snapshot: GameSnapshot } | null = null;
  return {
    reset() { baseline = null; },
    full(snapshot: GameSnapshot, id?: string) {
      if (snapshot.campaign.id !== campaignId) return null;
      baseline = id ? { id, snapshot } : null;
      return snapshot;
    },
    delta(event: SnapshotDelta): GameSnapshot | null {
      if (!baseline || baseline.id !== event.baseId) return null;
      const next: GameSnapshot = { ...baseline.snapshot, ...event.changes };
      for (const key of event.removed) Reflect.deleteProperty(next, key);
      if (next.campaign?.id !== campaignId ||
          next.me?.id !== baseline.snapshot.me.id ||
          next.me?.role !== baseline.snapshot.me.role) {
        baseline = null;
        return null;
      }
      baseline = { id: event.id, snapshot: next };
      return next;
    },
  };
}
