import { z } from "zod";

type ClientEventName =
  | "app.render_failed"
  | "window.error"
  | "window.unhandled_rejection"
  | "realtime.disconnected"
  | "api.request_failed";

const allowedContextKeys = new Set([
  "actionId",
  "buildRevision",
  "code",
  "errorName",
  "filename",
  "line",
  "operation",
  "requestId",
  "role",
  "sceneId",
  "status",
  "tool",
]);

const sensitiveKey = /authorization|cookie|password|secret|token/i;
const allowedErrorNames = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

const nativeErrorNameSchema = z.enum([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

// UIX-397: a stack trace describes *code* (file/line/column/function names),
// never user data, so it can be captured in full — bounded by frame count
// and per-field length so a pathological stack cannot blow past the body
// limit or the log.
const stackFrameSchema = z
  .object({
    function: z.string().max(120).optional(),
    file: z.string().max(200).optional(),
    line: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional(),
  })
  .strict();

// Broader than nativeErrorNameSchema: covers app-defined Error subclasses
// (ApiError, EntityConflictError, ...) too. Still just a class identifier,
// never free text, so it stays safe to log verbatim.
const errorClassNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]{0,29}$/)
  .optional();

const structuralExtrasSchema = z.object({
  errorName: errorClassNameSchema,
  stack: z.array(stackFrameSchema).max(20).optional(),
  // How many times this deduplicated signature occurred client-side before
  // being sent as a single record (see error-report-buffer.ts).
  occurrenceCount: z.number().int().positive().max(1_000_000).optional(),
});

const renderFailureEventSchema = z
  .object({
    level: z.literal("error"),
    event: z.literal("app.render_failed"),
    context: z
      .object({
        code: z.string().regex(/^UI-[0-9A-F]{8}$/),
        errorName: nativeErrorNameSchema,
      })
      .strict(),
  })
  .merge(structuralExtrasSchema)
  .strict();

const standardClientEventSchema = z
  .object({
    level: z.enum(["info", "warn", "error"]),
    event: z.enum([
      "window.error",
      "window.unhandled_rejection",
      "realtime.disconnected",
      "api.request_failed",
    ]),
    message: z.string().trim().max(500).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .merge(structuralExtrasSchema)
  .strict();

export const clientEventSchema = z.union([
  renderFailureEventSchema,
  standardClientEventSchema,
]);

function safeContextValue(key: string, value: unknown) {
  if (["line", "status"].includes(key))
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  if (typeof value !== "string") return undefined;
  if (key === "errorName")
    return allowedErrorNames.has(value) ? value : undefined;
  const normalized =
    key === "filename" ? (value.split(/[?#]/, 1)[0] ?? "") : value;
  if (!/^[a-zA-Z0-9_./:-]{1,160}$/.test(normalized)) return undefined;
  return normalized;
}

export function sanitizeClientContext(context: Record<string, unknown> = {}) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!allowedContextKeys.has(key) || sensitiveKey.test(key)) continue;
    const scalar = safeContextValue(key, value);
    if (scalar !== undefined) safe[key] = scalar;
  }
  return safe;
}

export function safeClientMessage(event: ClientEventName) {
  const labels: Record<ClientEventName, string> = {
    "app.render_failed": "Application interface render failed",
    "window.error": "Browser runtime error",
    "window.unhandled_rejection": "Unhandled browser rejection",
    "realtime.disconnected": "Realtime connection interrupted",
    "api.request_failed": "API request failed",
  };
  return labels[event];
}

export function requestActionId(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header;
  return value && z.string().uuid().safeParse(value).success
    ? value
    : undefined;
}

export function publicUploadError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const allowed = new Set([
    "AUDIO_TOO_LARGE",
    "IMAGE_DIMENSIONS_TOO_LARGE",
    "IMAGE_TOO_LARGE",
    "INVALID_AUDIO_DURATION",
    "LOW_DISK_SPACE",
    "MEDIA_QUOTA_EXCEEDED",
    "UNSUPPORTED_AUDIO_TYPE",
    "UNSUPPORTED_FILE_TYPE",
    "UNSUPPORTED_IMAGE_TYPE",
  ]);
  return allowed.has(code) ? code : "UPLOAD_FAILED";
}
