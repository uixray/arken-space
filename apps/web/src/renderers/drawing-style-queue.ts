export type DrawingStylePatch = { color?: string; strokeWidth?: number };

type Entry = {
  id: string;
  revision: number;
  pending: DrawingStylePatch;
  sending: DrawingStylePatch | null;
  timer: ReturnType<typeof setTimeout> | null;
};

/** One debouncer and one in-flight mutation per drawing, not per style field. */
export function createDrawingStyleQueue(options: {
  save: (
    id: string,
    revision: number,
    patch: DrawingStylePatch,
  ) => Promise<void>;
  onPending: (id: string, patch: DrawingStylePatch | null) => void;
  onError: (error: unknown) => void;
  delay?: number;
}) {
  const entries = new Map<string, Entry>();
  let disposed = false;
  const hasPending = (entry: Entry) => Object.keys(entry.pending).length > 0;
  const publish = (entry: Entry) => {
    if (!disposed)
      options.onPending(
        entry.id,
        entry.sending || hasPending(entry)
          ? { ...entry.sending, ...entry.pending }
          : null,
      );
  };

  const flush = async (entry: Entry) => {
    if (disposed || entry.sending || !hasPending(entry)) return;
    const patch = entry.pending;
    entry.pending = {};
    entry.sending = patch;
    try {
      await options.save(entry.id, entry.revision, patch);
      // The server increments this revision exactly once on a successful PATCH.
      // Do not wait for a React render before accepting a subsequent gesture.
      entry.revision += 1;
      entry.sending = null;
      if (disposed) return;
      publish(entry);
      if (entry.timer === null && hasPending(entry)) void flush(entry);
    } catch (error) {
      entry.sending = null;
      entry.pending = {};
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = null;
      entries.delete(entry.id);
      if (disposed) return;
      publish(entry);
      // A genuine conflict/ACL/network failure is NOT silently rebased/retried.
      options.onError(error);
    }
  };

  return {
    enqueue(id: string, revision: number, patch: DrawingStylePatch) {
      if (disposed || Object.keys(patch).length === 0) return;
      let entry = entries.get(id);
      if (!entry) {
        entry = { id, revision, pending: {}, sending: null, timer: null };
        entries.set(id, entry);
      } else if (!entry.sending && !hasPending(entry)) {
        // A new gesture may start from a newer, explicitly displayed revision.
        entry.revision = Math.max(entry.revision, revision);
      }
      entry.pending = { ...entry.pending, ...patch };
      publish(entry);
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void flush(entry);
      }, options.delay ?? 200);
    },
    dispose() {
      disposed = true;
      for (const entry of entries.values())
        if (entry.timer !== null) clearTimeout(entry.timer);
      entries.clear();
    },
  };
}
