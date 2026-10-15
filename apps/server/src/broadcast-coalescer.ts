/**
 * Coalesces snapshot broadcasts per key (a campaign).
 *
 * Every committed change used to rebuild and emit a full snapshot for every
 * socket of the campaign, so a burst of N writes cost N full rebuilds even
 * though only the last one is visible. Now at most one broadcast runs per
 * campaign and at most one more waits behind it: every caller that arrives
 * while one is running shares that single follow-up.
 *
 * Freshness is kept: the follow-up starts only after the running broadcast
 * settles, i.e. after every joined caller had committed its write, so each
 * caller's promise resolves after a snapshot that includes its change.
 */
export function createBroadcastCoalescer() {
  type Slot = { running: Promise<void>; queued: Promise<void> | null };
  const slots = new Map<string, Slot>();

  const start = (key: string, run: () => Promise<void>) => {
    const running: Promise<void> = run().finally(() => {
      const slot = slots.get(key);
      if (slot?.running === running && !slot.queued) slots.delete(key);
    });
    return running;
  };

  function coalesce(key: string, run: () => Promise<void>) {
    const slot = slots.get(key);
    if (!slot) {
      const running = start(key, run);
      slots.set(key, { running, queued: null });
      return running;
    }
    if (slot.queued) return slot.queued;
    const queued = slot.running
      .catch(() => undefined)
      .then(() => {
        slot.queued = null;
        slot.running = start(key, run);
        return slot.running;
      });
    slot.queued = queued;
    return queued;
  }

  /**
   * Resolves once the broadcast running for this key, if any, has emitted.
   * A queued follow-up is not awaited: it starts after this point and reads
   * whatever was committed before the caller asked.
   */
  coalesce.settled = (key: string): Promise<void> =>
    slots.get(key)?.running.catch(() => undefined) ?? Promise.resolve();

  return coalesce;
}
