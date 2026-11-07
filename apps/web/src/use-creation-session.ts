import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { creationCommandDefinitions, creationCancellationReceiptSchema } from "@arken/contracts";
import { formatApiError } from "./api";
import { creationApi, creationPath, creationRequest, type CreationContext, type Page } from "./creation-client";

const commandSchemas = Object.fromEntries(Object.entries(creationCommandDefinitions).map(([key, value]) => [key, value.schema]));
type Pending = { actionId: string; path: string; method: "POST" | "PUT"; body: Record<string, unknown>; label: string;
  cancellationRequested?: true };
const savedSchema = z.object({ actionId: z.string().uuid(), path: z.string().max(80), method: z.enum(["POST", "PUT"]),
  body: z.record(z.string(), z.unknown()), label: z.string().min(1).max(300), cancellationRequested: z.literal(true).optional() }).strict();
function parseCommand(input: unknown): Pending {
  const parsed = savedSchema.safeParse(input);
  if (!parsed.success) throw new Error("Сохранённое действие повреждено. Сначала проверьте историю с мастером.");
  const value = parsed.data, schema = commandSchemas[`${value.method} ${value.path}`];
  const body = schema?.safeParse(value.body);
  if (!body?.success || value.actionId !== value.body.actionId)
    throw new Error("Сохранённая команда не распознана. Она не будет заменена новым списанием.");
  // Validate but do not rewrite a saved request using today's schema defaults.
  // The server's original request hash belongs to the originally stored body.
  return value;
}
function savedCommand(key: string): Pending | null {
  const raw = localStorage.getItem(key); if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { value = null; }
  return parseCommand(value); // Empty/corrupt values are not an empty queue.
}
function sameCommand(left: Pending, right: Pending) {
  const canonical = (command: Pending) => JSON.stringify(parseCommand(command), (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
  // Ignore object-key order, not method/path/body differences or new defaults.
  return canonical(left) === canonical(right);
}
/** HTTP success alone is not evidence of a committed matching command. */
function confirmedReceipt(command: Pending, value: unknown): asserts value is Record<string, unknown> {
  const invalid = () => { throw new Error("Квитанция не подтверждает сохранённое действие. Сохраните прежний код и восстановите результат."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const receipt = value as Record<string, unknown>;
  if (receipt.outcome === "CANCELLED") {
    const cancelled = creationCancellationReceiptSchema.safeParse(value);
    if (!cancelled.success || cancelled.data.actionId !== command.actionId ||
        cancelled.data.type !== creationCommandDefinitions[`${command.method} ${command.path}`]?.type) return invalid();
    return;
  }
  const identity: Record<string, string> = {
    "rules/versions": "packId", "rules/enabled": "packId", "templates/versions": "templateId",
    "templates/fork": "templateId", "reviews": "versionId", "recipes/versions": "recipeId",
    "recipes/enabled": "recipeId", "objects/transfer": "objectId", "store/listings": "listingId",
    "store/listings/enabled": "listingId", "operations/commit": "quoteId", "store/commit": "quoteId",
  };
  const field = identity[command.path];
  if (field && (typeof receipt[field] !== "string" || receipt[field] !== command.body[field])) return invalid();
  if (["operations/commit", "store/commit", "objects/transfer"].includes(command.path)) {
    if (receipt.actionId !== command.actionId) return invalid();
  }
  if (!["operations/commit", "store/commit"].includes(command.path) &&
      (typeof receipt.revision !== "number" || !Number.isInteger(receipt.revision) || receipt.revision < 0)) return invalid();
  if (["rules/versions", "templates/versions", "templates/fork", "recipes/versions", "store/listings"].includes(command.path) &&
      (typeof receipt.versionId !== "string" || !z.string().uuid().safeParse(receipt.versionId).success)) return invalid();
  if (command.path === "store/policy" && !receipt.policy) return invalid();
}
/** One durable action per campaign/member; closing a workspace or changing a
 * character must not discard an uncertain command. No optimistic money/items. */
export function useCreationSession(context: CreationContext) {
  const key = `arken.creation.pending.v1.${context.campaignId}.${context.membershipId}`;
  const [pending, setPending] = useState<Pending | null>(null), [storageBlocked, setStorageBlocked] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [epoch, setEpoch] = useState(0);
  const [completed, setCompleted] = useState<{ path: string; body: Record<string, unknown>; receipt: Record<string, unknown> } | null>(null);
  const alive = useRef(false), flight = useRef(false);
  useEffect(() => {
    alive.current = true;
    const update = () => { try { setPending(savedCommand(key)); setStorageBlocked(false); setStorageError(""); }
      catch (e) { setStorageBlocked(true); setStorageError(formatApiError(e)); } };
    update(); setReady(true);
    const changed = (e: StorageEvent) => { if (e.key === key || e.key === null) { update(); setEpoch(v => v + 1); } };
    window.addEventListener("storage", changed);
    return () => { alive.current = false; window.removeEventListener("storage", changed); };
  }, [key]);
  const read = useCallback(<T,>(path: string, init?: RequestInit) => creationApi<T>(context, path, init), [context]);
  const refresh = useCallback(() => setEpoch(v => v + 1), []);
  const inspect = async <T,>(job: () => Promise<T>): Promise<T | undefined> => {
    if (flight.current || !alive.current) return;
    flight.current = true; setBusy(true); setError("");
    try { return await job(); }
    catch (e) { if (alive.current) setError(formatApiError(e)); return undefined; }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  };
  const clear = (command: Pending) => {
    // If removal fails keep the saved action: reopening can safely replay it.
    let current: Pending | null;
    try { current = savedCommand(key); }
    catch (e) { setStorageBlocked(true); setStorageError(formatApiError(e)); throw e; }
    if (!current || !sameCommand(current, command)) {
      setStorageBlocked(true);
      const message = "Сохранённая команда исчезла или изменилась до подтверждения. Проверьте результат с мастером.";
      setStorageError(message);
      throw new Error(message);
    }
    localStorage.removeItem(key);
    if (localStorage.getItem(key) !== null) throw new Error("Не удалось подтвердить очистку очереди. Восстановите прежнее действие.");
    if (alive.current) setPending(null);
  };
  const execute = async (path?: string, body?: Record<string, unknown>, label?: string, method: "POST" | "PUT" = "POST",
    cancelPending = false) => inspect(async () => {
    if (!navigator.locks) throw new Error("Нужен браузер с Web Locks и HTTPS или localhost для безопасного восстановления действий.");
    if (storageBlocked || !ready) return;
    // Storage may become unavailable/corrupt after initial mounting. Preserve it
    // and fail closed rather than offering another action with a fresh ID.
    try { savedCommand(key); }
    catch (e) { setStorageBlocked(true); setStorageError(formatApiError(e)); throw e; }
    return navigator.locks.request(`arken-creation:${key}`, { ifAvailable: true, mode: "exclusive" }, async lease => {
      if (!lease) throw new Error("Действие выполняется в другой вкладке. Дождитесь результата.");
      if (!alive.current) return;
      let command = savedCommand(key);
      if (path && command) { setPending(command); throw new Error("Сначала восстановите ранее сохранённое действие."); }
      if (!command && path && body && label) {
        const schema = commandSchemas[`${method} ${path}`];
        if (!schema) throw new Error("Неизвестный путь изменения мастерской.");
        const actionId = crypto.randomUUID(), parsed = schema.safeParse({ ...body, actionId });
        if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(" · "));
        command = parseCommand({ actionId, path, method, body: parsed.data, label });
        localStorage.setItem(key, JSON.stringify(command)); setPending(command);
      }
      if (!command) return;
      if (cancelPending && !command.cancellationRequested) {
        // Persist the user's chosen terminal intent BEFORE sending cancellation.
        // Recovery after reload must not accidentally apply the original request
        // merely because the cancellation response was lost.
        command = parseCommand({ ...command, cancellationRequested: true });
        localStorage.setItem(key, JSON.stringify(command)); setPending(command);
      }
      const requireSaved = () => {
        const saved = savedCommand(key);
        if (!saved || !sameCommand(saved, command!)) {
          setStorageBlocked(true);
          const message = "Сохранённая команда исчезла или изменилась. Отправка остановлена; результат прежнего действия не считается отменённым.";
          setStorageError(message);
          throw new Error(message);
        }
      };
      // Do not send before confirming the durable round trip. A successful
      // setItem alone is not our proof that the queued command remains intact.
      requireSaved();
      // Replay itself validates the stored type/body hash behind the original
      // action lock; an actionId-only GET cannot prove this request's identity.
      // Cancellation uses exactly that same body/lock and returns prior applied
      // receipt if application won. Any HTTP error leaves the command retained.
      const receipt = command.cancellationRequested
        ? await creationRequest<Record<string, unknown>>(context, creationPath("actions/cancel"),
            { method: command.method, path: command.path, body: command.body })
        : await creationRequest<Record<string, unknown>>(context, creationPath(command.path), command.body, command.method);
      confirmedReceipt(command, receipt);
      clear(command);
      if (alive.current) {
        if (receipt.outcome !== "CANCELLED") setCompleted({ path: command.path, body: command.body, receipt });
        setNotice(`${command.label}: ${receipt.outcome === "CANCELLED" ? "отменено до выполнения" : "сохранено"}. Код ${command.actionId}`);
        refresh();
      }
      return receipt.outcome === "CANCELLED" ? undefined : receipt;
    });
  });
  return { context, key, read, refresh, epoch, inspect, submit: execute, recover: () => execute(),
    cancelPending: () => execute(undefined, undefined, undefined, "POST", true),
    busy, pending, completed, error: storageError || error, notice, locked: busy || !!pending || storageBlocked || !ready };
}
export type CreationSession = ReturnType<typeof useCreationSession>;
export function useCreationQuery<T>(s: CreationSession, path: string | null) {
  const [state, setState] = useState<{ path: string | null; epoch: number; data: T | null; error: string; loading: boolean }>(
    { path, epoch: s.epoch, data: null, error: "", loading: !!path });
  useEffect(() => {
    const abort = new AbortController();
    if (!path) { setState({ path, epoch: s.epoch, data: null, error: "", loading: false }); return; }
    setState({ path, epoch: s.epoch, data: null, error: "", loading: true });
    void s.read<T>(path, { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted) setState({ path, epoch: s.epoch, data, error: "", loading: false });
    }).catch(e => { if (!abort.signal.aborted) setState({ path, epoch: s.epoch, data: null, error: formatApiError(e), loading: false }); });
    return () => abort.abort();
  }, [path, s.epoch, s.read]);
  return state.path === path && state.epoch === s.epoch ? state : { path, data: null, error: "", loading: !!path };
}
/** Explicit page navigation, not a silent arbitrary cap or a full inventory crawl. */
export function useCreationPage<T>(s: CreationSession, path: string | null) {
  const [cursor, setCursor] = useState<string | undefined>();
  const identity = useRef(path);
  if (identity.current !== path) { identity.current = path; if (cursor) setCursor(undefined); }
  const target = path && cursor ? `${path}${path.includes("?") ? "&" : "?"}after=${cursor}` : path;
  const query = useCreationQuery<Page<T>>(s, target);
  return { ...query, first: () => setCursor(undefined), next: () => setCursor(query.data?.nextAfter ?? undefined), hasPrevious: !!cursor };
}
