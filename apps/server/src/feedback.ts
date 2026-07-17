import { z } from "zod";

const text = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

export const publicSuggestionSchema = z
  .object({
    description: text(3, 4000),
    contact: z.string().trim().max(200).optional(),
    website: z.string().max(2000).optional(),
  })
  .strict();

export const authenticatedFeedbackFieldsSchema = z
  .object({
    kind: z.enum(["BUG", "IDEA"]),
    title: text(1, 160),
    description: text(3, 8000),
    diagnostics: z.string().max(5000).optional(),
    website: z.string().max(2000).optional(),
  })
  .strict();

const allowedDiagnosticKeys = new Set([
  "actionId",
  "browser",
  "canvasTool",
  "lastErrorCode",
  "operation",
  "requestId",
  "route",
  "sceneId",
  "screenHeight",
  "screenWidth",
  "viewportHeight",
  "viewportWidth",
]);
const sensitiveKey =
  /authorization|cookie|description|email|log|message|password|secret|token/i;

export function sanitizeFeedbackDiagnostics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === "recentFailures" && Array.isArray(raw)) {
      const failures = raw
        .slice(-10)
        .map(sanitizeRecentFailure)
        .filter((failure): failure is NonNullable<typeof failure> => !!failure);
      if (failures.length) safe.recentFailures = failures;
      continue;
    }
    if (!allowedDiagnosticKeys.has(key) || sensitiveKey.test(key)) continue;
    if (raw === null || typeof raw === "boolean") safe[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) safe[key] = raw;
    else if (
      typeof raw === "string" &&
      raw.length <= 200 &&
      !/[\r\n]/.test(raw)
    )
      safe[key] = raw;
  }
  return safe;
}

function sanitizeRecentFailure(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const at =
    typeof candidate.at === "string" &&
    candidate.at.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(candidate.at)
      ? candidate.at
      : null;
  const status =
    typeof candidate.status === "number" &&
    Number.isInteger(candidate.status) &&
    candidate.status >= 100 &&
    candidate.status <= 599
      ? candidate.status
      : null;
  const code =
    typeof candidate.code === "string" &&
    /^[A-Z0-9_.:-]{1,80}$/.test(candidate.code)
      ? candidate.code
      : null;
  if (!at || status === null || !code) return null;
  const failure: Record<string, string | number> = { at, status, code };
  for (const key of ["requestId", "actionId"] as const) {
    const scalar = candidate[key];
    if (typeof scalar === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(scalar))
      failure[key] = scalar;
  }
  return failure;
}

export function parseFeedbackDiagnostics(serialized: string | undefined) {
  if (!serialized) return {};
  try {
    return sanitizeFeedbackDiagnostics(JSON.parse(serialized));
  } catch {
    throw new Error("INVALID_FEEDBACK_DIAGNOSTICS");
  }
}
