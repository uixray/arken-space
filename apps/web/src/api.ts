import { rememberApiFailure } from "./feedback-diagnostics";
import {
  enqueueErrorReport,
  loadReports,
  removeReport,
  saveReports,
  toWirePayload,
  type BufferedErrorReport,
  type ErrorReportInput,
  type ReportContext,
} from "./error-report-buffer";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public actionId?: string,
    /**
     * Тело отказа как его прислал сервер.
     *
     * Нужно там, где отказ несёт данные, а не только повод: UIX-424 отвечает на
     * попытку удалить характеристику списком навыков и способностей, которые
     * на неё ссылаются, и без этого поля список пришлось бы собирать на клиенте
     * второй раз — то есть завести вторую копию правила «что считается
     * ссылкой».
     *
     * Не логируется и не отправляется в телеметрию: туда идут только код,
     * статус и идентификаторы запроса (см. `rememberApiFailure` ниже).
     */
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const safeCorrelationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Formats an API failure for UI without exposing request bodies, URLs or stacks. */
export function formatApiError(
  reason: unknown,
  fallback = "Операция не выполнена",
): string {
  if (!(reason instanceof ApiError))
    return reason instanceof Error ? reason.message : fallback;
  const correlation = [
    safeCorrelationIdPattern.test(reason.requestId ?? "")
      ? `requestId: ${reason.requestId}`
      : null,
    safeCorrelationIdPattern.test(reason.actionId ?? "")
      ? `actionId: ${reason.actionId}`
      : null,
  ].filter(Boolean);
  return correlation.length > 0
    ? `${reason.message} (${correlation.join(", ")})`
    : reason.message;
}

type ApiResponseError = {
  error?: string;
  message?: string;
  requestId?: string;
  resource?: "physical" | "magic";
  required?: number;
  available?: number;
};

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function createActionId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `action-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function mutationOperation(path: string, method: string): string | undefined {
  if (!mutationMethods.has(method)) return undefined;
  const pathname = path.split("?", 1)[0] ?? path;

  if (pathname === "/api/dice") return "roll.submit";
  if (/^\/api\/characters\/[^/]+\/catalog\/[^/]+\/roll$/.test(pathname))
    return "roll.submit";
  if (pathname === "/api/assets") return "upload.asset";
  if (/^\/api\/characters\/[^/]+\/counters$/.test(pathname))
    return "wallet.mutate";
  if (/^\/api\/scenes\/[^/]+\/canvas$/.test(pathname)) return "toolbar.mutate";
  if (pathname.startsWith("/api/scenes")) return "scene.mutate";
  if (pathname.startsWith("/api/characters/")) return "character.mutate";
  if (
    pathname.startsWith("/api/canvas") ||
    pathname.startsWith("/api/fog-reveals") ||
    pathname.startsWith("/api/tokens") ||
    pathname.startsWith("/api/token-definitions") ||
    pathname.startsWith("/api/drawings")
  )
    return "toolbar.mutate";
  return undefined;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = (init?.method ?? "GET").toUpperCase();
  if (init?.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (mutationMethods.has(method) && !headers.has("x-action-id"))
    headers.set("x-action-id", createActionId());

  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: "include",
  });
  const data = (await response
    .json()
    .catch(() => null)) as ApiResponseError | null;
  if (!response.ok) {
    const requestId =
      response.headers.get("x-request-id") ?? data?.requestId ?? undefined;
    const actionId =
      response.headers.get("x-action-id") ??
      headers.get("x-action-id") ??
      undefined;
    const code = data?.error ?? "REQUEST_FAILED";
    const message =
      code === "INSUFFICIENT_CHARACTER_RESOURCE"
        ? // UIX-424, шаг 9: «магической силы» и «физической силы» — имена, от
          // которых мастер отказался. Раскладки кампании здесь нет (это общий
          // разбор ответов, а не компонент), поэтому подставляются нейтральные
          // слова: сколько нужно и сколько есть — то, ради чего сообщение и
          // читают.
          `Не хватает ${data?.resource === "magic" ? "маны" : "выносливости"}. ` +
          `Нужно: ${data?.required ?? 0}, доступно: ${data?.available ?? 0}.`
        : (data?.message ?? "Не удалось выполнить запрос");
    const error = new ApiError(
      response.status,
      code,
      message,
      requestId,
      actionId,
      data ?? undefined,
    );
    rememberApiFailure({
      at: new Date().toISOString(),
      status: response.status,
      code: error.code,
      requestId,
      actionId,
    });
    const operation = mutationOperation(path, method);
    if (operation)
      reportClientEvent({
        level: response.status >= 500 ? "error" : "warn",
        event: "api.request_failed",
        message: "Authenticated API mutation failed",
        context: {
          operation,
          status: response.status,
          code: error.code,
          requestId,
          actionId,
        },
      });
    throw error;
  }
  return data as T;
}

// UIX-397: reports are buffered (localStorage-backed, bounded, deduped)
// instead of being fire-and-forget, so a failed send or a pre-auth error is
// not lost and a burst of identical errors does not exhaust the server's
// client-logs rate limit (120/hour).
let reportsCache: BufferedErrorReport[] | null = null;

function readReports(): BufferedErrorReport[] {
  if (!reportsCache) reportsCache = loadReports();
  return reportsCache;
}

function writeReports(next: BufferedErrorReport[]): void {
  reportsCache = next;
  saveReports(next);
}

export function reportClientEvent(input: ErrorReportInput) {
  writeReports(enqueueErrorReport(readReports(), input));
  void flushClientEventBuffer();
}

/**
 * UIX-407: sends one event immediately, without the durable buffer.
 *
 * Only for measurements, where the buffer's dedup would merge distinct
 * samples that happen to share a signature, and where losing one costs
 * nothing. Errors must keep going through `reportClientEvent`.
 */
export async function sendClientEventNow(payload: {
  level: "info" | "warn" | "error";
  event: string;
  context?: ReportContext;
}): Promise<boolean> {
  try {
    const response = await fetch("/api/client-logs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Test-only: clears the in-memory buffer cache so tests don't leak state. */
export function resetClientEventBufferForTest(): void {
  reportsCache = [];
  saveReports([]);
}

let flushing = false;

async function sendReport(report: BufferedErrorReport): Promise<boolean> {
  try {
    const response = await fetch("/api/client-logs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toWirePayload(report)),
      keepalive: true,
    });
    // 401 (not yet authenticated) is expected pre-login: keep the report
    // buffered and try again after auth instead of dropping it.
    return response.ok || response.status === 202;
  } catch {
    return false;
  }
}

/** Attempts to drain the buffer; stops at the first failure (assume offline). */
export async function flushClientEventBuffer(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const report of readReports()) {
      const sent = await sendReport(report);
      if (!sent) return;
      writeReports(removeReport(readReports(), report.id));
    }
  } finally {
    flushing = false;
  }
}
