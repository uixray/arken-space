import { rememberApiFailure } from "./feedback-diagnostics";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public actionId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiResponseError = {
  error?: string;
  message?: string;
  requestId?: string;
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
    const error = new ApiError(
      response.status,
      data?.error ?? "REQUEST_FAILED",
      data?.message ?? "Не удалось выполнить запрос",
      requestId,
      actionId,
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

export function reportClientEvent(input: {
  level: "info" | "warn" | "error";
  event: string;
  message?: string;
  context?: Record<string, unknown>;
}) {
  void fetch("/api/client-logs", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  }).catch(() => undefined);
}
