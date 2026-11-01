/** Active authenticated, visible game tabs only. No gameplay content or stable user ID. */
import { sendClientEventNow } from "./api";
import { createPerformanceAggregator } from "./performance-samples";
import {
  getPerformanceSession,
  subscribePerformanceSession,
} from "./performance-session";

declare const __ARKEN_CLIENT_REVISION__: string;
export const REPORT_WINDOW_MS = 60_000;
export const HEARTBEAT_WINDOW_MS = 5 * 60_000;
type ObserverStatus = "active" | "unsupported" | "failed";

function observe(
  type: string,
  callback: (entries: PerformanceEntryList) => void,
) {
  let status: ObserverStatus = "unsupported";
  let disconnect = () => {};
  if (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes(type)
  ) {
    try {
      const observer = new PerformanceObserver((list) =>
        callback(list.getEntries()),
      );
      // Old buffered entries may belong to a hidden tab or another authenticated session.
      observer.observe({
        type,
        buffered: false,
        ...(type === "event" ? { durationThreshold: 100 } : {}),
      });
      status = "active";
      disconnect = () => observer.disconnect();
    } catch {
      status = "failed";
    }
  }
  return { status, disconnect };
}

export function installPerformanceReporting(
  options: { now?: () => number; windowMs?: number } = {},
) {
  const now = options.now ?? (() => performance.now());
  const clientRevision =
    typeof __ARKEN_CLIENT_REVISION__ === "undefined"
      ? "unknown"
      : __ARKEN_CLIENT_REVISION__;
  let identity: string | undefined;
  let sessionId = "";
  let sequence = 0;
  let sendFailures = 0;
  let inFlight = false;
  let stopped = false;
  let active = false;
  let lastHeartbeat = -Infinity;
  let minute = createPerformanceAggregator(now());
  let heartbeat = createPerformanceAggregator(now());
  let observers: ReturnType<typeof observe>[] = [];

  const sync = () => {
    const key = getPerformanceSession();
    const visible = document.visibilityState === "visible" && Boolean(key);
    if (key === identity && visible === active) return;
    for (const observer of observers) observer.disconnect();
    observers = [];
    if (key !== identity) {
      identity = key;
      sessionId = key ? crypto.randomUUID() : "";
      sequence = 0;
      sendFailures = 0;
      lastHeartbeat = -Infinity;
    }
    active = visible;
    minute = createPerformanceAggregator(now());
    heartbeat = createPerformanceAggregator(now());
    if (!active) return;
    // Capture the generation so queued callbacks from a disconnected observer cannot cross sessions.
    const target = heartbeat;
    observers = [
      observe("longtask", (entries) => {
        if (stopped || !active || heartbeat !== target) return;
        for (const entry of entries) {
          minute.addLongTask(entry.duration);
          target.addLongTask(entry.duration);
        }
      }),
      observe("event", (entries) => {
        if (stopped || !active || heartbeat !== target) return;
        for (const entry of entries) {
          minute.addInteraction(entry.name, entry.duration);
          target.addInteraction(entry.name, entry.duration);
        }
      }),
    ];
  };
  const tick = async () => {
    sync();
    if (!active || inFlight || stopped) return;
    const time = now();
    const notable = minute.take(time);
    const due = time - lastHeartbeat >= HEARTBEAT_WINDOW_MS;
    const summary = due ? heartbeat.take(time, true) : notable;
    if (!summary) return;
    if (due) lastHeartbeat = time;
    const sentSession = sessionId;
    const context = {
      ...summary,
      sessionId,
      clientRevision,
      ...(due
        ? {
            longTaskObserver: observers[0]?.status ?? "failed",
            interactionObserver: observers[1]?.status ?? "failed",
            sequence: (sequence = Math.min(sequence + 1, 1_000_000)),
            sendFailures,
          }
        : {}),
    };
    inFlight = true;
    try {
      const ok = await sendClientEventNow({
        level: "info",
        event: due ? "client.performance.heartbeat" : "client.performance",
        context,
      });
      if (!ok && sessionId === sentSession)
        sendFailures = Math.min(sendFailures + 1, 1_000_000);
    } finally {
      inFlight = false;
    }
  };
  const unsubscribe = subscribePerformanceSession(sync);
  document.addEventListener("visibilitychange", sync);
  sync();
  // At most one request per minute: heartbeat replaces the minute report when due.
  const timer = setInterval(() => {
    void tick();
  }, options.windowMs ?? REPORT_WINDOW_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    document.removeEventListener("visibilitychange", sync);
    for (const observer of observers) observer.disconnect();
  };
}
