import { readFile, readdir } from "node:fs/promises";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@arken/db";
import { accountMailOutbox } from "@arken/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestMailOutbox, createTestMailKeyring } from "./account-mail.js";
import { createAccountMailRuntime } from "./account-mail-runtime.js";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";

const origin = "http://localhost:5173";
const password = "correct horse battery staple";
const email = "runtime@example.invalid";
const emptyResult = { accepted: 0, retried: 0, cancelled: 0, blocked: 0 } as const;

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: ReturnType<typeof Fastify>;
let mail: ReturnType<typeof createTestMailOutbox>;
let keyring: ReturnType<typeof createTestMailKeyring>;
let runtime: ReturnType<typeof createAccountMailRuntime> | null = null;

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  mail = createTestMailOutbox();
  keyring = createTestMailKeyring();
  app = Fastify({ logger: false });
  await app.register(cookie);
  registerAccountAuthRoutes(app as never, db as never, { in: () => ({ disconnectSockets() {} }) }, {
    enabled: true,
    registrationEnabled: true,
    legacyDevEnabled: false,
    campaignLinkAccessEnabled: false,
    campaignCreationEnabled: false,
    sessionTtlDays: 3,
    cookieSecure: false,
    accountCookieName: "arken_account",
    gameCookieName: "arken_session",
    csrfCookieName: "arken_account_csrf",
    webOrigin: origin,
    publicUrl: origin,
    mailRuntimeEnabled: true,
    mail: mail.adapter,
    mailKeyring: keyring,
  });
  app.get("/api/account/forced-error", async () => { throw new Error("synthetic route failure"); });
  app.get("/api/public/cache-check", async (_request: FastifyRequest, reply: FastifyReply) => reply.header("Cache-Control", "public, max-age=60").send({ ok: true }));
  await app.ready();
});

afterEach(async () => {
  if (runtime) await runtime.stop();
  runtime = null;
  await app.close();
  await database.close();
  vi.useRealTimers();
});

describe("account mail runtime", () => {
  it("stays off unless explicitly enabled and both the adapter and active key are ready", () => {
    const drain = vi.fn(async () => emptyResult);
    const disabled = createAccountMailRuntime({ db: db as never, keyring, adapter: mail.adapter, drain });
    expect(disabled.start()).toBe(false);
    expect(disabled.status()).toMatchObject({ enabled: false, ready: false, started: false });

    const missingAdapter = createAccountMailRuntime({ enabled: true, db: db as never, keyring, adapter: { ready: false, async send() { throw new Error("unused"); } }, drain });
    expect(missingAdapter.start()).toBe(false);
    const missingKey = createAccountMailRuntime({ enabled: true, db: db as never, keyring: null, adapter: mail.adapter, drain });
    expect(missingKey.start()).toBe(false);
    expect(drain).not.toHaveBeenCalled();
  });

  it("drains a committed registration later through one coordinator tick and a test-only sink", async () => {
    const queued = await app.inject({
      method: "POST",
      url: "/api/account/register",
      headers: { origin },
      payload: { email, password },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toEqual({ accepted: true });
    expect(mail.read()).toHaveLength(0);
    expect(await db.select().from(accountMailOutbox)).toHaveLength(1);

    let tickFinished!: () => void;
    const finished = new Promise<void>((resolve) => { tickFinished = resolve; });
    runtime = createAccountMailRuntime({
      enabled: true,
      db: db as never,
      keyring,
      adapter: mail.adapter,
      workerId: "runtime-test-worker",
      pollIntervalMs: 60_000,
      logger: { info: (_details: unknown, event?: string) => { if (event === "account.mail.runtime.tick") tickFinished(); }, error: vi.fn() } as never,
    });
    expect(runtime.start()).toBe(true);
    await Promise.race([finished, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("RUNTIME_TICK_TIMEOUT")), 5_000))]);
    await runtime.stop();
    expect(mail.read()).toHaveLength(1);
    expect(await db.select().from(accountMailOutbox)).toMatchObject([{ status: "ACCEPTED" }]);
    // The test adapter accepted locally; this is not SMTP acceptance or inbox delivery.
  });

  it("backs off failed drains without logging thrown error content", async () => {
    vi.useFakeTimers();
    const secretMarker = "SYNTHETIC-ERROR-NOT-FOR-LOGS";
    let calls = 0;
    const logger = { info: vi.fn(), error: vi.fn() };
    runtime = createAccountMailRuntime({
      enabled: true, db: db as never, keyring, adapter: mail.adapter,
      pollIntervalMs: 10_000, initialBackoffMs: 200, maxBackoffMs: 400, logger,
      drain: async () => { calls += 1; if (calls === 1) throw new Error(secretMarker); return emptyResult; },
    });
    expect(runtime.start()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(runtime.status().consecutiveFailures).toBe(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secretMarker);
    await vi.advanceTimersByTimeAsync(199);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await runtime.stop();
  });

  it("never overlaps a long tick and waits for it to settle before caller closes the DB", async () => {
    vi.useFakeTimers();
    let finish!: (value: typeof emptyResult) => void;
    let began!: () => void;
    const entered = new Promise<void>((resolve) => { began = resolve; });
    const pending = new Promise<typeof emptyResult>((resolve) => { finish = resolve; });
    let calls = 0;
    let dbClosed = false;
    runtime = createAccountMailRuntime({
      enabled: true, db: db as never, keyring, adapter: mail.adapter,
      pollIntervalMs: 100, drain: async () => { if (dbClosed) throw new Error("DB_CLOSED_EARLY"); calls += 1; began(); return pending; },
    });
    expect(runtime.start()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    await entered;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(1);
    const stopping = runtime.stop().then(() => { dbClosed = true; });
    await Promise.resolve();
    expect(dbClosed).toBe(false);
    finish(emptyResult);
    await stopping;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
    expect(dbClosed).toBe(true);
  });

  it("aborts an active adapter send on stop and settles before DB close", async () => {
    vi.useFakeTimers();
    let sendStarted!: () => void;
    const started = new Promise<void>((resolve) => { sendStarted = resolve; });
    let aborted = false;
    const adapter = {
      ready: true,
      async send(_message: unknown, options?: { signal?: AbortSignal }) {
        sendStarted();
        return new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("SYNTHETIC-TRANSPORT-DETAIL")); }, { once: true });
        });
      },
    };
    let dbClosed = false;
    const logger = { info: vi.fn(), error: vi.fn() };
    runtime = createAccountMailRuntime({
      enabled: true, db: db as never, keyring, adapter,
      logger,
      drain: async (_database, options) => {
        await options.adapter.send({ to: "synthetic@example.invalid", subject: "test", text: "synthetic" }, { messageId: "synthetic-message-id", signal: new AbortController().signal });
        return emptyResult;
      },
    });
    expect(runtime.start()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    await started;
    await runtime.stop().then(() => { dbClosed = true; });
    expect(aborted).toBe(true);
    expect(dbClosed).toBe(true);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("SYNTHETIC-TRANSPORT-DETAIL");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtime.status().active).toBe(false);
  });
});

describe("account response cache policy", () => {
  it("does not advertise registration or enqueue when a ready adapter is behind a disabled runtime", async () => {
    const gated = Fastify({ logger: false });
    await gated.register(cookie);
    registerAccountAuthRoutes(gated as never, db as never, { in: () => ({ disconnectSockets() {} }) }, {
      enabled: true,
      registrationEnabled: true,
      legacyDevEnabled: false,
      campaignLinkAccessEnabled: false,
      campaignCreationEnabled: false,
      sessionTtlDays: 3,
      cookieSecure: false,
      accountCookieName: "runtime_off_account",
      gameCookieName: "runtime_off_game",
      csrfCookieName: "runtime_off_csrf",
      webOrigin: origin,
      publicUrl: origin,
      mailRuntimeEnabled: false,
      mail: mail.adapter,
      mailKeyring: keyring,
    });
    await gated.ready();
    try {
      const capabilities = await gated.inject({ url: "/api/account/capabilities" });
      expect(capabilities.json()).toMatchObject({ registrationEnabled: false });
      expect(capabilities.headers["cache-control"]).toBe("no-store");
      const response = await gated.inject({
        method: "POST", url: "/api/account/register", headers: { origin },
        payload: { email: "runtime-off@example.invalid", password },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "ACCOUNT_DELIVERY_UNAVAILABLE" });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(await db.select().from(accountMailOutbox)).toHaveLength(0);
    } finally { await gated.close(); }
  });

  it("sets no-store on account/auth success, anonymous, error, and not-found responses only", async () => {
    for (const response of [
      await app.inject({ url: "/api/account/capabilities" }),
      await app.inject({ url: "/api/account/session" }),
      await app.inject({ method: "POST", url: "/api/account/register", headers: { origin }, payload: { invalid: true } }),
      await app.inject({ url: "/api/account/forced-error" }),
      await app.inject({ url: "/api/auth/unknown" }),
    ]) expect(response.headers["cache-control"]).toBe("no-store");

    const publicResponse = await app.inject({ url: "/api/public/cache-check" });
    expect(publicResponse.headers["cache-control"]).toBe("public, max-age=60");
  });
});
