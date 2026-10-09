import { randomUUID } from "node:crypto";
import type { MailAdapter, MailKeyring } from "./account-mail.js";
import {
  drainAccountMailOutboxOnce,
  type DrainResult,
} from "./account-mail-outbox.js";

type DrainOptions = Parameters<typeof drainAccountMailOutboxOnce>[1];
type MailDatabase = Parameters<typeof drainAccountMailOutboxOnce>[0];
type Drain = (db: MailDatabase, options: DrainOptions) => Promise<DrainResult>;
type TimerHandle = ReturnType<typeof setTimeout>;
export type MailRuntimeLogger = Pick<Console, "info" | "error">;

export type AccountMailRuntimeOptions = {
  /** Explicit opt-in; default false. The unconfigured production adapter is never ready. */
  enabled?: boolean;
  db: MailDatabase;
  keyring: MailKeyring | null;
  adapter: MailAdapter;
  workerId?: string;
  pollIntervalMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  logger?: MailRuntimeLogger;
  drain?: Drain;
  timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
};

const IDLE_POLL_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
// A one-message sequential batch and short transport deadline reduce graceful
// shutdown work. DB claim/ack calls have no hard deadline; the server's existing
// 8s process exit is the final bound, not a guarantee that DB settlement fits.
const RUNTIME_BATCH_SIZE = 1;
const RUNTIME_TRANSPORT_TIMEOUT_MS = 3_000;
const RUNTIME_LEASE_MS = 8_000;

function hasActiveMailKey(keyring: MailKeyring | null) {
  const key = keyring?.keys.get(keyring.activeKeyId);
  return Boolean(keyring?.activeKeyId && key && key.length === 32);
}

/**
 * Link the scheduler's stop signal and the drain's per-send timeout signal.
 * If the adapter honors AbortSignal, shutdown cancels its underlying IO. If it
 * does not, the drain's own short timeout still fences the DB ack; delivery may
 * nevertheless have an ambiguous outcome, so mail remains at-least-once.
 */
function withAbort(adapter: MailAdapter, stopSignal: AbortSignal): MailAdapter {
  return {
    ready: adapter.ready,
    async send(message, options) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const signals = [stopSignal, options?.signal].filter(
        (signal): signal is AbortSignal => Boolean(signal),
      );
      for (const signal of signals) {
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
      const onAbort = () => rejectOnAbort();
      let rejectOnAbort: () => void = () => {};
      try {
        if (controller.signal.aborted) throw new Error("MAIL_SEND_ABORTED");
        await new Promise<void>((resolve, reject) => {
          rejectOnAbort = () => reject(new Error("MAIL_SEND_ABORTED"));
          controller.signal.addEventListener("abort", onAbort, { once: true });
          // Attach both handlers even if abort wins so a late adapter rejection
          // is observed and cannot become an unhandled rejection.
          if (!options?.messageId) throw new Error("MAIL_MESSAGE_ID_REQUIRED");
          Promise.resolve(adapter.send(message, {
            messageId: options.messageId,
            signal: controller.signal,
          })).then(resolve, reject);
        });
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
        for (const signal of signals) signal.removeEventListener("abort", abort);
      }
    },
  };
}

/** Single-process, non-overlapping and explicitly opt-in account outbox runner. */
export function createAccountMailRuntime(options: AccountMailRuntimeOptions) {
  const enabled = options.enabled === true;
  const keyring = options.keyring;
  const adapter = options.adapter;
  const pollIntervalMs = options.pollIntervalMs ?? IDLE_POLL_MS;
  const initialBackoffMs = options.initialBackoffMs ?? INITIAL_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
  const workerId = options.workerId ?? `account-mail-${randomUUID()}`;
  const timers = options.timers ?? globalThis;
  const drain = options.drain ?? drainAccountMailOutboxOnce;
  const logger = options.logger;

  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 3_600_000
    || !Number.isInteger(initialBackoffMs) || initialBackoffMs < 50 || initialBackoffMs > 60_000
    || !Number.isInteger(maxBackoffMs) || maxBackoffMs < initialBackoffMs || maxBackoffMs > 3_600_000
    || !workerId || workerId.length > 100) {
    throw new Error("MAIL_RUNTIME_OPTIONS_INVALID");
  }

  const ready = enabled && adapter.ready && hasActiveMailKey(keyring);
  let started = false;
  let timer: TimerHandle | null = null;
  let activeTick: Promise<void> | null = null;
  let activeController: AbortController | null = null;
  let consecutiveFailures = 0;
  let stopPromise: Promise<void> | null = null;

  const schedule = (delayMs: number) => {
    if (!started || timer) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void tick();
    }, delayMs);
    // The HTTP server owns process liveness; the poll timer must not prevent exit.
    (timer as TimerHandle & { unref?: () => void }).unref?.();
  };

  const tick = async () => {
    if (!started || activeTick || !keyring) return;
    const controller = new AbortController();
    activeController = controller;
    const tickAdapter = withAbort(adapter, controller.signal);
    const work = Promise.resolve().then(() => drain(options.db, {
      keyring,
      adapter: tickAdapter,
      workerId,
      batchSize: RUNTIME_BATCH_SIZE,
      leaseMs: RUNTIME_LEASE_MS,
      transportTimeoutMs: RUNTIME_TRANSPORT_TIMEOUT_MS,
    }));
    activeTick = work.then((result) => {
      consecutiveFailures = 0;
      logger?.info({
        accepted: result.accepted,
        retried: result.retried,
        cancelled: result.cancelled,
        blocked: result.blocked,
      }, "account.mail.runtime.tick");
    }).catch(() => {
      consecutiveFailures = Math.min(consecutiveFailures + 1, 31);
      const backoffMs = Math.min(maxBackoffMs, initialBackoffMs * (2 ** (consecutiveFailures - 1)));
      // Never pass the error or its message: transport/DB errors can contain secrets.
      logger?.error({ category: "DRAIN_FAILED", backoffMs }, "account.mail.runtime.failure");
    }).finally(() => {
      activeTick = null;
      activeController = null;
      if (started) {
        const delay = consecutiveFailures
          ? Math.min(maxBackoffMs, initialBackoffMs * (2 ** (consecutiveFailures - 1)))
          : pollIntervalMs;
        schedule(delay);
      }
    });
    await activeTick;
  };

  return {
    /** Returns false and schedules nothing unless explicit opt-in and dependencies are ready. */
    start() {
      if (!ready || stopPromise || started) return false;
      started = true;
      schedule(0);
      return true;
    },
    /** Stop future work, abort the active adapter signal, and await drain settlement before DB close. */
    stop() {
      if (stopPromise) return stopPromise;
      started = false;
      if (timer) {
        timers.clearTimeout(timer);
        timer = null;
      }
      activeController?.abort();
      stopPromise = activeTick ?? Promise.resolve();
      return stopPromise;
    },
    status() {
      return {
        enabled,
        ready,
        started,
        active: activeTick !== null,
        consecutiveFailures,
      } as const;
    },
  };
}
