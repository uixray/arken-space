import { api } from "./api";
export type EconomyContext = { campaignId: string; membershipId: string };
export async function economyApi<T>(context: EconomyContext, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("x-economy-campaign", context.campaignId);
  headers.set("x-economy-membership", context.membershipId);
  const controller = new AbortController();
  // Ending the wait does not cancel a transaction. Callers retain the exact
  // command and may only replay it until the result is known.
  const mutation = (init?.method ?? "GET").toUpperCase() !== "GET";
  const timeout = window.setTimeout(() => controller.abort(new Error(
    mutation ? "Ответ не подтверждён за 30 секунд. Повторите тот же запрос; операция на сервере могла завершиться."
      : "Магазин не ответил за 30 секунд. Обновите раздел.",
  )), 30_000);
  const cancel = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) cancel();
  else init?.signal?.addEventListener("abort", cancel, { once: true });
  try { return await api<T>(path, { ...init, headers, signal: controller.signal }); }
  finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", cancel);
  }
}
export function economyRequest<T>(context: EconomyContext, path: string, body: unknown, method = "POST") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (body && typeof body === "object" && "actionId" in body && typeof body.actionId === "string")
    headers.set("x-action-id", body.actionId);
  return economyApi<T>(context, path, {
    method, headers, body: JSON.stringify(body),
  });
}
export const copperLabel = (value: number) => `${value.toLocaleString("ru-RU")} медных`;
