export type SafeApiFailure = {
  at: string;
  status: number;
  code: string;
  requestId?: string;
  actionId?: string;
};

const MAX_FAILURES = 10;
const failures: SafeApiFailure[] = [];

export function rememberApiFailure(failure: SafeApiFailure) {
  failures.push({ ...failure });
  if (failures.length > MAX_FAILURES)
    failures.splice(0, failures.length - MAX_FAILURES);
}

export function recentApiFailures(): SafeApiFailure[] {
  return failures.map((failure) => ({ ...failure }));
}

export function clearApiFailuresForTest() {
  failures.splice(0);
}

export function createFeedbackDiagnostics(input: {
  buildVersion: string;
  buildRevision?: string;
  connection: string;
}) {
  const viewport =
    typeof window === "undefined"
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight };
  const latestFailure = recentApiFailures().at(-1);
  return {
    browser: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    operation: `feedback.${input.connection.toLowerCase()}`,
    lastErrorCode: latestFailure?.code,
    requestId: latestFailure?.requestId,
    actionId: latestFailure?.actionId,
    recentFailures: recentApiFailures(),
  };
}
