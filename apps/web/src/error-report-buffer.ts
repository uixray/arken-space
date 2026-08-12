/**
 * UIX-397: durable, storm-safe buffering for client error reports.
 *
 * Stack traces describe *code* (file/line/function), never user content, so
 * they are safe to capture in full. Free-form `message` text is the one
 * field that can embed a character name, chat text, or a GM-only note — the
 * server has always discarded it when logging (`safeClientMessage`), and
 * this module preserves that: `message` rides along for schema parity but
 * is never used to compute the dedup signature and the server still never
 * persists it verbatim.
 */

export type StackFrame = {
  function?: string;
  file?: string;
  line?: number;
  column?: number;
};

export type ReportContextValue = string | number | boolean | null | undefined;
export type ReportContext = Record<string, ReportContextValue>;

export type ErrorReportInput = {
  level: "info" | "warn" | "error";
  event: string;
  message?: string;
  errorName?: string;
  stack?: string;
  context?: ReportContext;
};

export type BufferedErrorReport = {
  id: string;
  level: "info" | "warn" | "error";
  event: string;
  message?: string;
  errorName?: string;
  stackFrames: StackFrame[];
  context?: ReportContext;
  signature: string;
  occurrenceCount: number;
  firstAt: string;
  lastAt: string;
};

export const ERROR_REPORT_STORAGE_KEY = "arken.client-error-buffer.v1";
export const MAX_BUFFERED_REPORTS = 25;
export const MAX_BUFFER_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_STACK_FRAMES = 10;
export const MAX_FRAME_FIELD_LENGTH = 200;
const SIGNATURE_FRAME_COUNT = 3;

function clampField(value: string): string {
  return value.length > MAX_FRAME_FIELD_LENGTH
    ? value.slice(0, MAX_FRAME_FIELD_LENGTH)
    : value;
}

function parseStackLine(rawLine: string): StackFrame | null {
  const line = rawLine.trim();
  if (!line) return null;

  // V8 (Chrome/Node/Electron): "at fn (file:line:col)" or "at file:line:col".
  const v8Match = line.match(/^at\s+(?:(.+?)\s+\()?(.+):(\d+):(\d+)\)?$/);
  if (v8Match) {
    const [, fn, file, lineNo, col] = v8Match;
    return {
      function: fn ? clampField(fn) : undefined,
      file: file ? clampField(file) : undefined,
      line: Number(lineNo),
      column: Number(col),
    };
  }

  // Gecko/Safari (JavaScriptCore): "fn@file:line:col" or "@file:line:col".
  const geckoMatch = line.match(/^(.*)@(.+):(\d+):(\d+)$/);
  if (geckoMatch) {
    const [, fn, file, lineNo, col] = geckoMatch;
    return {
      function: fn ? clampField(fn) : undefined,
      file: file ? clampField(file) : undefined,
      line: Number(lineNo),
      column: Number(col),
    };
  }

  return null;
}

/** Extracts bounded, structural stack frames from a raw `Error.stack` string. */
export function parseStackFrames(
  stack: string | undefined,
  maxFrames = MAX_STACK_FRAMES,
): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const rawLine of stack.split("\n")) {
    if (frames.length >= maxFrames) break;
    const frame = parseStackLine(rawLine);
    if (frame) frames.push(frame);
  }
  return frames;
}

/**
 * Class + top stack frames identify "the same error" for dedup — never the
 * message, so a repeating error whose message text happens to vary (e.g.
 * embeds a loop counter) still collapses instead of defeating storm
 * protection. For events with no stack (api.request_failed,
 * realtime.disconnected), the already-allowlisted structural context
 * (`operation`, `code`) disambiguates distinct failures that would
 * otherwise share a signature.
 */
export function computeErrorSignature(input: {
  errorName?: string;
  event: string;
  stackFrames: StackFrame[];
  context?: ReportContext;
}): string {
  const topFrames = input.stackFrames
    .slice(0, SIGNATURE_FRAME_COUNT)
    .map(
      (frame) =>
        `${frame.file ?? ""}:${frame.line ?? ""}:${frame.column ?? ""}`,
    )
    .join("|");
  const structuralContext = [input.context?.operation, input.context?.code]
    .filter((value) => value !== undefined && value !== null)
    .join("|");
  return `${input.errorName ?? "Unknown"}::${input.event}::${topFrames}::${structuralContext}`;
}

function createReportId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `err-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function isBufferedErrorReport(value: unknown): value is BufferedErrorReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BufferedErrorReport>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.event === "string" &&
    typeof candidate.signature === "string" &&
    typeof candidate.occurrenceCount === "number" &&
    typeof candidate.firstAt === "string" &&
    typeof candidate.lastAt === "string" &&
    Array.isArray(candidate.stackFrames)
  );
}

/** Drops entries older than the age bound, then oldest-first past the count bound. */
export function pruneReports(
  reports: BufferedErrorReport[],
  now: string = new Date().toISOString(),
): BufferedErrorReport[] {
  const nowMs = Date.parse(now);
  const fresh = reports.filter(
    (report) => nowMs - Date.parse(report.lastAt) <= MAX_BUFFER_AGE_MS,
  );
  if (fresh.length <= MAX_BUFFERED_REPORTS) return fresh;
  return fresh
    .slice()
    .sort((a, b) => Date.parse(a.lastAt) - Date.parse(b.lastAt))
    .slice(fresh.length - MAX_BUFFERED_REPORTS);
}

/**
 * Adds a report to the buffer, collapsing repeats of the same error
 * (same signature) into a single record with an incremented occurrence
 * count instead of growing the buffer unbounded.
 */
export function enqueueErrorReport(
  reports: BufferedErrorReport[],
  input: ErrorReportInput,
  now: string = new Date().toISOString(),
): BufferedErrorReport[] {
  const stackFrames = parseStackFrames(input.stack);
  const signature = computeErrorSignature({
    errorName: input.errorName,
    event: input.event,
    stackFrames,
    context: input.context,
  });
  const existingIndex = reports.findIndex((r) => r.signature === signature);

  let next: BufferedErrorReport[];
  if (existingIndex >= 0) {
    const existing = reports[existingIndex]!;
    next = reports.slice();
    next[existingIndex] = {
      ...existing,
      lastAt: now,
      occurrenceCount: existing.occurrenceCount + 1,
      context: input.context ?? existing.context,
    };
  } else {
    next = [
      ...reports,
      {
        id: createReportId(),
        level: input.level,
        event: input.event,
        message: input.message,
        errorName: input.errorName,
        stackFrames,
        context: input.context,
        signature,
        occurrenceCount: 1,
        firstAt: now,
        lastAt: now,
      },
    ];
  }
  return pruneReports(next, now);
}

export function removeReport(
  reports: BufferedErrorReport[],
  id: string,
): BufferedErrorReport[] {
  return reports.filter((report) => report.id !== id);
}

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function memoryStorage(): StorageLike {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

function resolveStorage(storage?: StorageLike): StorageLike {
  if (storage) return storage;
  if (typeof window !== "undefined" && window.localStorage)
    return window.localStorage;
  return memoryStorage();
}

/** Reads the persisted buffer; corrupted or missing data yields an empty buffer. */
export function loadReports(storage?: StorageLike): BufferedErrorReport[] {
  try {
    const raw = resolveStorage(storage).getItem(ERROR_REPORT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isBufferedErrorReport) : [];
  } catch {
    return [];
  }
}

/** Persists the buffer; a full or unavailable storage quota is a soft failure. */
export function saveReports(
  reports: BufferedErrorReport[],
  storage?: StorageLike,
): void {
  try {
    resolveStorage(storage).setItem(
      ERROR_REPORT_STORAGE_KEY,
      JSON.stringify(reports),
    );
  } catch {
    // Best-effort persistence: an error buffer must never itself crash the app.
  }
}

/** Shapes a buffered report into the wire payload accepted by /api/client-logs. */
export function toWirePayload(report: BufferedErrorReport) {
  return {
    level: report.level,
    event: report.event,
    message: report.message,
    context: report.context,
    errorName: report.errorName,
    stack: report.stackFrames,
    occurrenceCount: report.occurrenceCount,
  };
}
