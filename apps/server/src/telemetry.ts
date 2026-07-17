import { z } from "zod";

const clientEventNames = [
  "window.error",
  "window.unhandled_rejection",
  "realtime.disconnected",
  "api.request_failed",
] as const;

const allowedContextKeys = new Set([
  "actionId",
  "code",
  "filename",
  "line",
  "operation",
  "requestId",
  "status",
]);

const sensitiveKey = /authorization|cookie|password|secret|token/i;

export const clientEventSchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  event: z.enum(clientEventNames),
  message: z.string().trim().max(500).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

function safeContextValue(key: string, value: unknown) {
  if (["line", "status"].includes(key))
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  if (typeof value !== "string") return undefined;
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

export function safeClientMessage(event: (typeof clientEventNames)[number]) {
  const labels: Record<(typeof clientEventNames)[number], string> = {
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
