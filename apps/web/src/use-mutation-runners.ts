import { useCallback } from "react";
import { ApiError, formatApiError } from "./api";

/**
 * UIX-398 step A0 — the shared mutation runners, extracted from `App.tsx`.
 *
 * These four back 45 call sites between them. In `App.tsx` they were plain
 * function declarations, so every render produced fresh identities, and any
 * handler closing over one inherited that instability — which is why
 * `React.memo` below the sidebar could not hold (UIX-395 had to stabilise a
 * single `onClose` by hand for exactly this reason).
 *
 * Extracted rather than merely wrapped in `useCallback` in place, so the
 * stability guarantee is directly testable: rendering `App` to assert it
 * would mean standing up sockets and fetches, and a guarantee nobody can
 * test is one that quietly regresses.
 *
 * They close over only `load` and `setError`, both required to be stable by
 * the caller, so the identities here are stable for the component's lifetime.
 */
export interface MutationRunners {
  /** Runs an action, surfacing failures; optionally refetches the snapshot. */
  run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>;
  /** Runs an action and returns its result, surfacing failures. */
  runResult: <T>(action: () => Promise<T>) => Promise<T>;
  /**
   * World-map commands always reconcile the authoritative snapshot. A conflict
   * means another GM changed a revision, so reload before exposing retry UI.
   */
  runWorldMapMutation: (action: () => Promise<unknown>) => Promise<void>;
  /**
   * UIX-396 stage 1: recovery for the fast spatial entities (token geometry,
   * drawings). A 409 means someone else's write won, and that write was
   * already broadcast to this client, so refetching everything to learn what
   * we are about to be told anyway is pure cost — and it lands exactly when
   * the user is working quickly. Only other failures (5xx, dropped
   * connection) can leave local state arbitrarily wrong and still rebuild.
   */
  recoverFromCanvasMutation: (reason: unknown) => Promise<void>;
}

export function useMutationRunners(dependencies: {
  /** Must be stable (e.g. `useCallback` with an empty dependency list). */
  load: () => Promise<void>;
  /** A `useState` setter, stable by React's contract. */
  setError: (message: string) => void;
}): MutationRunners {
  const { load, setError } = dependencies;

  const run = useCallback(
    async (action: () => Promise<unknown>, refresh = false) => {
      try {
        setError("");
        await action();
        if (refresh) await load();
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "Операция не выполнена",
        );
        throw reason;
      }
    },
    [load, setError],
  );

  const runResult = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        setError("");
        return await action();
      } catch (reason) {
        setError(formatApiError(reason));
        throw reason;
      }
    },
    [setError],
  );

  const runWorldMapMutation = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await run(action, true);
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 409) await load();
        throw reason;
      }
    },
    [run, load],
  );

  const recoverFromCanvasMutation = useCallback(
    async (reason: unknown) => {
      const conflict = reason instanceof ApiError && reason.status === 409;
      if (!conflict) await load();
      setError(formatApiError(reason));
    },
    [load, setError],
  );

  return { run, runResult, runWorldMapMutation, recoverFromCanvasMutation };
}
