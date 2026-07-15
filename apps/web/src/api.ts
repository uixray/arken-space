export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const data = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  if (!response.ok)
    throw new ApiError(
      response.status,
      data?.error ?? "REQUEST_FAILED",
      data?.message ?? "Не удалось выполнить запрос",
    );
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
