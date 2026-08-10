/**
 * UIX-407: the arithmetic behind client performance reporting, kept apart
 * from the browser APIs that feed it so it can be tested directly.
 *
 * **Why long tasks and interactions, and not frame rate.** The complaint this
 * exists to answer was "тормозит любое действие, не получается совершить с
 * первого раза ничего" — during that session the socket's ping timeout fired,
 * which takes 20 seconds of a blocked main thread and cannot be explained by
 * render churn alone. A blocked main thread is exactly what the `longtask`
 * entry type reports, and "the action did not respond" is exactly what the
 * `event` entry type's duration measures. Frame rate would have told us the
 * page felt bad without saying why.
 *
 * **Why summaries and not individual samples.** `/api/client-logs` allows 120
 * requests an hour per client and the shared error buffer collapses identical
 * signatures. A long task can fire hundreds of times a minute; sending each
 * one would exhaust the budget that real errors need and drown the log. So a
 * window of samples is reduced to one record here, and only a window worth
 * looking at is sent at all — a session with nothing wrong reports nothing.
 *
 * Everything below is numbers plus a DOM event name from a fixed vocabulary
 * (`pointerdown`, `keydown`, ...). No user content can reach it by
 * construction, which is what keeps this safe to log verbatim.
 */

/** Anything past this is a long task by the spec's definition. */
export const LONG_TASK_THRESHOLD_MS = 50;

/**
 * An interaction slower than this reads as "it did not respond". The web
 * vitals "needs improvement" boundary for INP is 200ms, and it matches the
 * report: the actions felt like they had to be repeated.
 */
export const SLOW_INTERACTION_MS = 200;

/**
 * A window has to clear this much blocking time before it is worth a request.
 * Roughly four long tasks back to back — below that the page is doing ordinary
 * work and nobody is complaining.
 */
export const REPORTABLE_BLOCKING_MS = 200;

export interface PerformanceSummary {
  /** Number of tasks over the 50ms threshold. */
  longTasks: number;
  /** Sum of the excess over the threshold: the standard "total blocking time". */
  blockingMs: number;
  /** The single worst task, which is what a stalled client actually feels. */
  longestTaskMs: number;
  interactions: number;
  slowInteractions: number;
  slowestInteractionMs: number;
  /** DOM event type of the slowest interaction, or undefined if none. */
  slowestInteraction?: string;
  /** Length of the observation window, so rates can be derived server-side. */
  windowMs: number;
}

export interface PerformanceAggregator {
  addLongTask: (durationMs: number) => void;
  addInteraction: (name: string, durationMs: number) => void;
  /**
   * Returns the window's summary and starts a new window. Returns null when
   * the window is not worth reporting, so callers can simply skip sending.
   */
  take: (nowMs: number) => PerformanceSummary | null;
}

export function createPerformanceAggregator(
  startedAtMs: number,
): PerformanceAggregator {
  let windowStartMs = startedAtMs;
  let longTasks = 0;
  let blockingMs = 0;
  let longestTaskMs = 0;
  let interactions = 0;
  let slowInteractions = 0;
  let slowestInteractionMs = 0;
  let slowestInteraction: string | undefined;

  const reset = (nowMs: number) => {
    windowStartMs = nowMs;
    longTasks = 0;
    blockingMs = 0;
    longestTaskMs = 0;
    interactions = 0;
    slowInteractions = 0;
    slowestInteractionMs = 0;
    slowestInteraction = undefined;
  };

  return {
    addLongTask: (durationMs) => {
      if (!Number.isFinite(durationMs) || durationMs <= LONG_TASK_THRESHOLD_MS)
        return;
      longTasks += 1;
      blockingMs += durationMs - LONG_TASK_THRESHOLD_MS;
      if (durationMs > longestTaskMs) longestTaskMs = durationMs;
    },

    addInteraction: (name, durationMs) => {
      if (!Number.isFinite(durationMs) || durationMs < 0) return;
      interactions += 1;
      if (durationMs >= SLOW_INTERACTION_MS) slowInteractions += 1;
      if (durationMs > slowestInteractionMs) {
        slowestInteractionMs = durationMs;
        slowestInteraction = name;
      }
    },

    take: (nowMs) => {
      const windowMs = Math.max(0, Math.round(nowMs - windowStartMs));
      // A window is worth a request if the main thread was blocked enough to
      // notice, or if any single interaction was slow. The second clause
      // matters on its own: one 3-second interaction is the whole complaint,
      // even when total blocking time stays modest.
      const notable =
        blockingMs >= REPORTABLE_BLOCKING_MS || slowInteractions > 0;
      if (!notable) {
        reset(nowMs);
        return null;
      }
      const summary: PerformanceSummary = {
        longTasks,
        blockingMs: Math.round(blockingMs),
        longestTaskMs: Math.round(longestTaskMs),
        interactions,
        slowInteractions,
        slowestInteractionMs: Math.round(slowestInteractionMs),
        ...(slowestInteraction ? { slowestInteraction } : {}),
        windowMs,
      };
      reset(nowMs);
      return summary;
    },
  };
}
