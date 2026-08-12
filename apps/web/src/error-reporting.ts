/**
 * UIX-397: global client error capture, installed at module init so it is
 * active during startup, the login screen, and bootstrap failures — not
 * only after a campaign has loaded. The ingest endpoint requires auth, so
 * pre-auth reports simply sit in the durable buffer (see api.ts /
 * error-report-buffer.ts) until the next successful flush.
 */
import { reportClientEvent, flushClientEventBuffer } from "./api";
import { getErrorReportContext } from "./error-report-context";

const FLUSH_INTERVAL_MS = 60_000;

function errorNameOf(reason: unknown): string | undefined {
  return reason instanceof Error ? reason.name : undefined;
}

function stackOf(reason: unknown): string | undefined {
  return reason instanceof Error ? reason.stack : undefined;
}

export function installGlobalErrorReporting(
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
) {
  const onError = (event: ErrorEvent) => {
    const reason = event.error;
    reportClientEvent({
      level: "error",
      event: "window.error",
      message: event.message,
      errorName: errorNameOf(reason) ?? "Error",
      stack: stackOf(reason),
      context: {
        filename: event.filename,
        line: event.lineno,
        ...getErrorReportContext(),
      },
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    reportClientEvent({
      level: "error",
      event: "window.unhandled_rejection",
      message: reason instanceof Error ? reason.message : String(reason),
      errorName: errorNameOf(reason) ?? "Error",
      stack: stackOf(reason),
      context: { ...getErrorReportContext() },
    });
  };

  target.addEventListener("error", onError as EventListener);
  target.addEventListener("unhandledrejection", onRejection as EventListener);

  return () => {
    target.removeEventListener("error", onError as EventListener);
    target.removeEventListener(
      "unhandledrejection",
      onRejection as EventListener,
    );
  };
}

/** Retries the buffer on network recovery and on a low-frequency timer. */
export function installClientEventFlushTriggers(
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
) {
  const onOnline = () => void flushClientEventBuffer();
  target.addEventListener("online", onOnline);
  const timer = setInterval(
    () => void flushClientEventBuffer(),
    FLUSH_INTERVAL_MS,
  );
  void flushClientEventBuffer();

  return () => {
    target.removeEventListener("online", onOnline);
    clearInterval(timer);
  };
}
