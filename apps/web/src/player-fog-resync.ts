// A fog delta has the mask, not the recipient's newly visible placements/assets.
// Any covering canonical snapshot is an ACK, regardless of what requested it.
export function createPlayerFogResync(send: (sequence: number) => void) {
  let pending: { scene: string; sequence: number } | null = null;
  let sent: number | null = null;
  let retried = false;
  let batch: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const reset = () => {
    clearTimeout(batch);
    clearTimeout(deadline);
    batch = deadline = undefined;
    pending = null;
    sent = null;
    retried = false;
  };
  const arm = () => {
    if (!pending || sent !== null || batch !== undefined) return;
    // Non-sliding: a rapid stream cannot starve the first refresh.
    batch = setTimeout(() => {
      batch = undefined;
      if (!pending) return;
      const sequence = pending.sequence;
      sent = sequence;
      // The server logs snapshot/DB errors without necessarily disconnecting.
      // Retry a quiet revision only once. New edits still get their own turn.
      deadline = setTimeout(() => {
        deadline = undefined;
        sent = null;
        if (!pending) return;
        if (pending.sequence === sequence) {
          if (retried) {
            reset();
            return;
          }
          retried = true;
        }
        arm();
      }, 5000);
      send(sequence);
    }, 125);
  };
  return {
    request(scene: string, sequence: number) {
      if (!scene) return;
      if (pending && pending.scene !== scene) reset();
      if (!pending || sequence > pending.sequence) retried = false;
      pending = { scene, sequence: Math.max(pending?.sequence ?? 0, sequence) };
      arm();
    },
    snapshot(scene: string | undefined, version: number) {
      if (!pending || pending.scene !== scene) return;
      if (version >= pending.sequence) {
        reset();
      } else if (sent !== null && version >= sent) {
        clearTimeout(deadline);
        deadline = undefined;
        sent = null;
        arm();
      }
    },
    scope(scene: string | undefined) {
      if (pending && pending.scene !== scene) reset();
    },
    reset,
  };
}
