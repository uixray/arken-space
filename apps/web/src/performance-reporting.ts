/**
 * UIX-407: installs the browser observers that feed `performance-samples.ts`
 * and sends each notable window to `/api/client-logs`.
 *
 * **Why these summaries bypass the error buffer.** `reportClientEvent` dedups
 * by signature and collapses repeats into an occurrence count — right for
 * errors, wrong here: every performance window has the same signature and
 * different numbers, so buffering would merge distinct measurements into one
 * and silently discard the rest. A dropped sample also costs nothing, unlike
 * a dropped crash: the next window is a minute away. So these are sent
 * directly and forgotten if the send fails.
 *
 * **Degradation.** `longtask` is not implemented in Safari or Firefox, and
 * `event` timing is Chromium-only. Each observer is registered independently
 * and failures are swallowed, so a browser that supports one still reports
 * that one, and a browser that supports neither costs nothing but an idle
 * timer.
 */
import { sendClientEventNow } from "./api";
import { getErrorReportContext } from "./error-report-context";
import {
  createPerformanceAggregator,
  type PerformanceAggregator,
} from "./performance-samples";

/**
 * One report a minute at the very worst, against the endpoint's budget of 120
 * an hour. Half the budget is left for errors, which matter more — and a
 * healthy session sends nothing at all, because a window with nothing wrong
 * produces no summary.
 */
export const REPORT_WINDOW_MS = 60_000;

/**
 * Below the 104ms the INP guidance suggests, because 200ms is the threshold
 * we count against and entries have to be observed before they can be
 * counted. Chromium clamps this to a minimum of 16ms.
 */
const INTERACTION_THRESHOLD_MS = 100;

function observe(
  type: string,
  callback: (entries: PerformanceEntryList) => void,
  options: Record<string, unknown> = {},
): (() => void) | undefined {
  if (typeof PerformanceObserver === "undefined") return undefined;
  // `supportedEntryTypes` is the only reliable feature test: an unsupported
  // type throws from `observe()` in some browsers and is silently ignored in
  // others, and neither tells the caller anything useful.
  if (!PerformanceObserver.supportedEntryTypes?.includes(type))
    return undefined;
  try {
    const observer = new PerformanceObserver((list) =>
      callback(list.getEntries()),
    );
    observer.observe({ type, buffered: true, ...options });
    return () => observer.disconnect();
  } catch {
    return undefined;
  }
}

async function sendSummary(aggregator: PerformanceAggregator, nowMs: number) {
  const summary = aggregator.take(nowMs);
  if (!summary) return;
  const { sceneId, role } = getErrorReportContext();
  await sendClientEventNow({
    level: "info",
    event: "client.performance",
    context: {
      ...summary,
      ...(sceneId ? { sceneId } : {}),
      ...(role ? { role } : {}),
    },
  });
}

export function installPerformanceReporting(
  options: {
    now?: () => number;
    windowMs?: number;
  } = {},
) {
  const now = options.now ?? (() => performance.now());
  const windowMs = options.windowMs ?? REPORT_WINDOW_MS;
  const aggregator = createPerformanceAggregator(now());

  const disconnectLongTasks = observe("longtask", (entries) => {
    for (const entry of entries) aggregator.addLongTask(entry.duration);
  });

  const disconnectInteractions = observe(
    "event",
    (entries) => {
      for (const entry of entries)
        aggregator.addInteraction(entry.name, entry.duration);
    },
    { durationThreshold: INTERACTION_THRESHOLD_MS },
  );

  const timer = setInterval(
    () => void sendSummary(aggregator, now()),
    windowMs,
  );

  return () => {
    disconnectLongTasks?.();
    disconnectInteractions?.();
    clearInterval(timer);
  };
}
