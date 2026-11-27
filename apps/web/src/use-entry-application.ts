import {useGameReadOnly} from "./game-read-only";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { entryRollRequestSchema, type GameSnapshot } from "@arken/contracts";
import { api, formatApiError } from "./api";
import { useLatestRef } from "./use-latest-ref";

const pendingSchema = z
  .object({
    format: z.literal(1),
    campaignId: z.string().uuid(),
    membershipId: z.string().uuid(),
    characterId: z.string().uuid(),
    entryId: z.string().uuid(),
    label: z.string().min(1).max(300),
    body: entryRollRequestSchema,
    cancellationRequested: z.literal(true).optional(),
  })
  .strict();
type Pending = z.infer<typeof pendingSchema>;
function read(key: string): Pending | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  const parsed = pendingSchema.safeParse(value);
  if (!parsed.success || parsed.data.body.mode === "SHARE")
    throw new Error(
      "Сохранённое применение повреждено. Не создавайте замену до сверки с мастером.",
    );
  return parsed.data;
}
const storageKey = (campaignId: string, membershipId: string) =>
  `arken.entry.pending.v1.${campaignId}.${membershipId}`;

/** One durable ordinary EXECUTE per member/campaign. Never auto-replay on mount,
 * discard an uncertain outcome, or infer success from a missing consumed entry. */
export function useEntryApplication(
  snapshot: GameSnapshot | null,
  load: () => Promise<void>,
) {
  const readOnly=useGameReadOnly();
  const latest = useLatestRef({ snapshot, load, readOnly });
  const key = snapshot
    ? storageKey(snapshot.campaign.id, snapshot.me.id)
    : null;
  const [view, setView] = useState<{
    key: string | null;
    pending: Pending | null;
    error: string;
  }>({ key: null, pending: null, error: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(
    null,
  );
  const flight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(() => {
    if (!key) {
      setView({ key, pending: null, error: "" });
      return;
    }
    try {
      setView({ key, pending: read(key), error: "" });
    } catch (e) {
      setView({ key, pending: null, error: formatApiError(e) });
    }
  }, [key]);
  useEffect(() => {
    refresh();
    const changed = (e: StorageEvent) => {
      if (e.key === key || e.key === null) refresh();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key, refresh]);
  const execute = useCallback(
    async (
      input?: {
        characterId: string;
        entryId: string;
        label: string;
        body: Record<string, unknown>;
      },
      cancel = false,
    ) => {
      if(latest.current.readOnly)throw new Error("Локальная копия доступна только для чтения.");
      const current = latest.current.snapshot;
      if (
        !current ||
        !key ||
        key !== storageKey(current.campaign.id, current.me.id)
      )
        throw new Error("Контекст применения изменился.");
      if (flight.current) throw new Error("Дождитесь результата применения.");
      flight.current = true;
      setBusy(true);
      setNotice(null);
      const sameScope = () =>
        !latest.current.readOnly &&
        latest.current.snapshot?.campaign.id === current.campaign.id &&
        latest.current.snapshot?.me.id === current.me.id;
      try {
        if (!navigator.locks)
          throw new Error(
            "Для безопасного восстановления нужен браузер с Web Locks и HTTPS или localhost.",
          );
        await navigator.locks.request(
          `arken-entry:${key}`,
          { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (!lock)
              throw new Error("Применение выполняется в другой вкладке.");
            if (!sameScope()) throw new Error("Контекст применения изменился.");
            let command = read(key);
            if (command && input)
              throw new Error(
                "Сначала восстановите результат сохранённого применения.",
              );
            if (!command && input) {
              command = pendingSchema.parse({
                format: 1,
                campaignId: current.campaign.id,
                membershipId: current.me.id,
                characterId: input.characterId,
                entryId: input.entryId,
                label: input.label,
                body: {
                  ...input.body,
                  mode: "EXECUTE",
                  actionId: crypto.randomUUID(),
                },
              });
              localStorage.setItem(key, JSON.stringify(command));
              if (JSON.stringify(read(key)) !== JSON.stringify(command))
                throw new Error(
                  "Не удалось сохранить применение. Запрос не отправлен.",
                );
            }
            if (!command) return;
            if (
              command.campaignId !== current.campaign.id ||
              command.membershipId !== current.me.id
            )
              throw new Error(
                "Сохранённое применение относится к другому участнику или кампании.",
              );
            // Cancellation is a durable, monotonic intent, not a transient button
            // argument. Recovery after a lost response must never switch to apply.
            if (cancel && !command.cancellationRequested) {
              command = pendingSchema.parse({
                ...command,
                cancellationRequested: true,
              });
              localStorage.setItem(key, JSON.stringify(command));
              if (JSON.stringify(read(key)) !== JSON.stringify(command))
                throw new Error(
                  "Не удалось сохранить отмену. Запрос не отправлен.",
                );
            }
            if (mounted.current && sameScope())
              setView({ key, pending: command, error: "" });
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 30_000);
            let result: unknown;
            try {
              result = await api(
                `/api/characters/${command.characterId}/catalog/${command.entryId}/roll${command.cancellationRequested ? "/cancel" : ""}`,
                {
                  method: "POST",
                  signal: controller.signal,
                  body: JSON.stringify(command.body),
                  headers: {
                    "x-entry-campaign": command.campaignId,
                    "x-entry-member": command.membershipId,
                    "x-action-id": command.body.actionId,
                  },
                },
              );
            } finally {
              window.clearTimeout(timeout);
            }
            const receipt = z
              .union([
                z.object({
                  actionId: z.string().uuid(),
                  messageId: z.string().uuid(),
                }),
                z.object({
                  actionId: z.string().uuid(),
                  cancelled: z.literal(true),
                  notApplied: z.literal(true),
                }),
              ])
              .safeParse(result);
            if (
              !receipt.success ||
              receipt.data.actionId !== command.body.actionId
            )
              throw new Error(
                "Ответ не подтверждает сохранённую команду. Восстановите результат тем же запросом.",
              );
            const stored = read(key);
            if (stored && JSON.stringify(stored) !== JSON.stringify(command))
              throw new Error(
                "Сохранённая команда изменилась в другой вкладке. Она не будет удалена.",
              );
            localStorage.removeItem(key);
            if (read(key) !== null)
              throw new Error(
                "Не удалось удалить подтверждённую команду. Повторите восстановление.",
              );
            if (mounted.current && sameScope()) {
              setView({ key, pending: null, error: "" });
              setNotice({
                key,
                text:
                  "cancelled" in receipt.data
                    ? "Команда отменена сервером без применения. Можно выбрать новое действие."
                    : "Применение подтверждено сервером. Повторного списания не было.",
              });
            }
            if (sameScope()) await latest.current.load();
          },
        );
      } catch (e) {
        if (mounted.current && sameScope()) {
          let saved: Pending | null = null;
          try {
            saved = read(key);
          } catch {
            /* Preserve corrupt storage; never replace it. */
          }
          setView({ key, pending: saved, error: formatApiError(e) });
        }
        throw e;
      } finally {
        flight.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [key, latest],
  );
  return {
    submit: execute,
    recover: () => execute(),
    cancel: () => execute(undefined, true),
    busy,
    notice: notice?.key === key ? notice.text : "",
    dismissNotice: () => setNotice(null),
    pending: view.key === key ? view.pending : null,
    error: view.key === key ? view.error : "",
  };
}
