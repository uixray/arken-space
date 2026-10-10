import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { accountActionTokens, accountMailOutbox, accountSessions, campaigns, memberships, sessions, users } from "@arken/db";
import { createTestMailOutbox, createTestMailKeyring, decryptMailEnvelope, unconfiguredMailAdapter } from "./account-mail.js";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";
import { drainAccountMailOutboxOnce } from "./account-mail-outbox.js";
import { authFromSessionToken, sessionIsActive } from "./auth.js";
import { hashToken } from "./security.js";

const origin = "http://localhost:5173";
const password = "correct horse battery staple";
const email = "person@example.invalid";
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: ReturnType<typeof Fastify>;
let outbox: ReturnType<typeof createTestMailOutbox>;
let mailKeyring: ReturnType<typeof createTestMailKeyring>;

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  outbox = createTestMailOutbox();
  mailKeyring = createTestMailKeyring();
  app = Fastify();
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
    mail: outbox.adapter,
    mailKeyring,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

function post(url: string, body: unknown, extra: Record<string, string> = {}) {
  return app.inject({ method: "POST", url, payload: body, headers: { origin, ...extra } });
}

function tokenFromDelivery(index = 0) {
  const text = outbox.read()[index]?.text ?? "";
  const token = /#token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
  if (!token) throw new Error("test mail token was not present in the isolated outbox");
  return token;
}

async function deliverQueuedMail() {
  return drainAccountMailOutboxOnce(db as never, { keyring: mailKeyring, adapter: outbox.adapter, workerId: "test-worker" });
}

function sessionCookies(response: Awaited<ReturnType<typeof app.inject>>) {
  const values = response.headers["set-cookie"];
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const pairs = list.map((value) => value.split(";")[0]!).filter(Boolean);
  const csrf = pairs.find((value) => value.startsWith("arken_account_csrf="))?.split("=")[1];
  return { cookie: pairs.join("; "), csrf };
}

describe("account authentication HTTP lifecycle", () => {
  it("reports real capability state and completes register, verify, login, session, logout", async () => {
    const capabilities = await app.inject({ url: "/api/account/capabilities" });
    expect(capabilities.json()).toEqual({ accountAuthEnabled: true, registrationEnabled: true, legacyDevEnabled: false, campaignLinkAccessEnabled: false, campaignCreationEnabled: false });
    expect((await post("/api/account/register", { email, password })).statusCode).toBe(202);
    expect(outbox.read()).toHaveLength(0); // queued is not yet transport acceptance
    expect(await db.select().from(accountMailOutbox)).toHaveLength(1);
    await deliverQueuedMail();
    expect(outbox.read()).toHaveLength(1);
    expect(outbox.read()[0]?.text).toContain("/account/verify#token=");
    expect((await post("/api/account/login", { email, password })).statusCode).toBe(401);
    const [stored] = await db.select().from(users);
    expect(stored?.passwordHash).toMatch(/^\$scrypt\$/);
    expect(stored?.passwordHash).not.toContain(password);
    expect((await post("/api/account/verification/confirm", { token: tokenFromDelivery() })).statusCode).toBe(200);
    expect((await post("/api/account/verification/confirm", { token: tokenFromDelivery() })).statusCode).toBe(400);

    const login = await post("/api/account/login", { email: "  PERSON@example.invalid ", password });
    expect(login.statusCode).toBe(200);
    const auth = sessionCookies(login);
    expect(auth.csrf).toBeTruthy();
    expect(login.json()).toMatchObject({ authenticated: true, account: { email, verified: true } });
    const rawSessionToken = auth.cookie.match(/arken_account=([^;]+)/)?.[1];
    expect(rawSessionToken).toBeTruthy();
    const sessions = await db.select().from(accountSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).not.toBe(rawSessionToken);

    const session = await app.inject({ url: "/api/account/session", headers: { cookie: auth.cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ authenticated: true, account: { verified: true } });
    const noCsrf = await post("/api/account/logout", {}, { cookie: auth.cookie });
    expect(noCsrf.statusCode).toBe(403);
    const logout = await post("/api/account/logout", {}, { cookie: auth.cookie, "x-csrf-token": auth.csrf! });
    expect(logout.statusCode).toBe(200);
    expect((await app.inject({ url: "/api/account/session", headers: { cookie: auth.cookie } })).json()).toEqual({ authenticated: false });
  });

  it("resets a password with a purpose-bound one-time token and revokes existing sessions", async () => {
    await post("/api/account/register", { email, password });
    await deliverQueuedMail();
    const verify = tokenFromDelivery();
    expect((await post("/api/account/password/reset/confirm", { token: verify, password: "another sufficiently long password" })).statusCode).toBe(400);
    await post("/api/account/verification/confirm", { token: verify });
    const login = await post("/api/account/login", { email, password });
    const auth = sessionCookies(login);
    expect((await post("/api/account/password/reset/request", { email })).statusCode).toBe(200);
    await deliverQueuedMail();
    const reset = tokenFromDelivery(1);
    const result = await post("/api/account/password/reset/confirm", { token: reset, password: "another sufficiently long password" });
    expect(result.statusCode).toBe(200);
    expect((await post("/api/account/password/reset/confirm", { token: reset, password: "another sufficiently long password" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/account/session", headers: { cookie: auth.cookie } })).json()).toEqual({ authenticated: false });
    expect((await post("/api/account/login", { email, password })).statusCode).toBe(401);
    expect((await post("/api/account/login", { email, password: "another sufficiently long password" })).statusCode).toBe(200);
  });

  it("rejects write requests without the configured origin and enforces password policy", async () => {
    expect((await app.inject({ method: "POST", url: "/api/account/register", payload: { email, password }, headers: { origin: "https://attacker.invalid" } })).statusCode).toBe(403);
    expect((await post("/api/account/register", { email, password: "short" })).statusCode).toBe(400);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("fails closed without an active key and ready transport before account lookup", async () => {
    const guarded = Fastify();
    await guarded.register(cookie);
    registerAccountAuthRoutes(guarded as never, db as never, { in: () => ({ disconnectSockets() {} }) }, {
      enabled: true, registrationEnabled: true, legacyDevEnabled: false,
      campaignLinkAccessEnabled: false, campaignCreationEnabled: false,
      sessionTtlDays: 3, cookieSecure: false, accountCookieName: "guard_account",
      gameCookieName: "guard_game", csrfCookieName: "guard_csrf", webOrigin: origin,
      publicUrl: origin, mailRuntimeEnabled: true, mail: unconfiguredMailAdapter, mailKeyring: null,
    });
    await guarded.ready();
    try {
      await db.insert(users).values({ emailNormalized: email, emailDisplay: email, passwordHash: "not-a-login-hash", verifiedAt: new Date() });
      expect((await guarded.inject({ url: "/api/account/capabilities" })).json()).toMatchObject({ registrationEnabled: false });
      const unknown = await guarded.inject({ method: "POST", url: "/api/account/password/reset/request", payload: { email: "absent@example.invalid" }, headers: { origin } });
      const existing = await guarded.inject({ method: "POST", url: "/api/account/password/reset/request", payload: { email }, headers: { origin } });
      expect(unknown.statusCode).toBe(503);
      expect(existing.statusCode).toBe(503);
      expect(existing.json()).toEqual(unknown.json());
      expect(await db.select().from(accountActionTokens)).toHaveLength(0);
    } finally { await guarded.close(); }
  });

  it("stores only ciphertext, accepts to the durable queue, and rolls back registration if enqueue fails", async () => {
    const response = await post("/api/account/register", { email, password });
    expect(response.statusCode).toBe(202);
    const [queued] = await db.select().from(accountMailOutbox);
    expect(queued?.status).toBe("PENDING");
    expect(queued?.payloadCiphertext).toBeTruthy();
    expect(queued?.payloadCiphertext).not.toContain(email);
    expect(queued?.payloadCiphertext).not.toContain(password);
    expect(outbox.read()).toHaveLength(0);
    await deliverQueuedMail();
    expect((await db.select().from(accountMailOutbox))[0]?.status).toBe("ACCEPTED");
    expect((await db.select().from(accountMailOutbox))[0]?.payloadCiphertext).toBeNull();

    await database.exec("ALTER TABLE account_mail_outbox ADD CONSTRAINT test_force_mail_queue_failure CHECK (status <> 'PENDING')");
    const failed = await post("/api/account/register", { email: "rollback@example.invalid", password });
    expect(failed.statusCode).toBe(503);
    expect(await db.select().from(users).where(eq(users.emailNormalized, "rollback@example.invalid"))).toHaveLength(0);
    expect(await db.select().from(accountActionTokens)).toHaveLength(1);
  });

  it("fences concurrent drainers and recovers an expired lease", async () => {
    await post("/api/account/register", { email, password });
    let enterSend!: () => void, releaseSend!: () => void;
    const entered = new Promise<void>((resolve) => { enterSend = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseSend = resolve; });
    let sends = 0;
    const adapter = { ready: true, async send() { sends++; enterSend(); await blocked; } };
    const first = drainAccountMailOutboxOnce(db as never, { keyring: mailKeyring, adapter, workerId: "worker-one" });
    await entered;
    const second = await drainAccountMailOutboxOnce(db as never, { keyring: mailKeyring, adapter, workerId: "worker-two" });
    expect(second.accepted).toBe(0);
    releaseSend();
    expect((await first).accepted).toBe(1);
    expect(sends).toBe(1);

    await post("/api/account/verification/request", { email });
    await db.update(accountMailOutbox).set({ status: "LEASED", leaseOwner: "crashed-worker", leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1) }).where(eq(accountMailOutbox.status, "PENDING"));
    const recovered = createTestMailOutbox();
    expect(await drainAccountMailOutboxOnce(db as never, { keyring: mailKeyring, adapter: recovered.adapter, workerId: "recovery" })).toMatchObject({ accepted: 1 });
  });

  it("applies bounded retry attempts and wipes ciphertext on terminal failure", async () => {
    await post("/api/account/register", { email, password });
    const failing = { ready: true, async send() { throw new Error("provider secret must not be persisted"); } };
    expect(await drainAccountMailOutboxOnce(db as never, { keyring: mailKeyring, adapter: failing, workerId: "retry-worker", maxAttempts: 2 })).toMatchObject({ retried: 1 });
    await db.update(accountMailOutbox).set({ nextAttemptAt: new Date(Date.now() - 1) }).where(eq(accountMailOutbox.status, "PENDING"));
    expect(await drainAccountMailOutboxOnce(db as never, { keyring: mailKeyring, adapter: failing, workerId: "retry-worker", maxAttempts: 2 })).toMatchObject({ retried: 1 });
    const [row] = await db.select().from(accountMailOutbox);
    expect(row?.status).toBe("DEAD");
    expect(row?.lastErrorCategory).toBe("RETRY_EXHAUSTED");
    expect(row?.payloadCiphertext).toBeNull();
  });

  it("rejects a lease shorter than its transport timeout contract", async () => {
    await expect(drainAccountMailOutboxOnce(db as never, { keyring: mailKeyring, adapter: outbox.adapter, workerId: "bad-lease", leaseMs: 5_000, transportTimeoutMs: 10_000 })).rejects.toThrow("MAIL_DRAIN_OPTIONS_INVALID");
  });

  it("aborts a stalled transport at its bounded deadline", async () => {
    await post("/api/account/register", { email: "stalled@example.invalid", password });
    let aborted = false;
    const stalled = { ready: true, async send(_message: unknown, options?: { signal?: AbortSignal }) {
      options?.signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
      return new Promise<void>(() => {});
    } };
    const result = await drainAccountMailOutboxOnce(db as never, { keyring: mailKeyring, adapter: stalled, workerId: "timeout-worker", leaseMs: 5_100, transportTimeoutMs: 100 });
    expect(result.retried).toBe(1);
    expect(aborted).toBe(true);
  });

  it("does not let unknown historical keys starve a deliverable row", async () => {
    for (const suffix of ["old-a", "old-b", "active"]) expect((await post("/api/account/register", { email: `${suffix}@example.invalid`, password })).statusCode).toBe(202);
    await db.update(accountMailOutbox).set({ keyId: "retired-key" }).where(eq(accountMailOutbox.id, (await db.select().from(accountMailOutbox))[0]!.id));
    const all = await db.select().from(accountMailOutbox);
    await db.update(accountMailOutbox).set({ keyId: "retired-key" }).where(eq(accountMailOutbox.id, all[1]!.id));
    const result = await drainAccountMailOutboxOnce(db as never, { keyring: mailKeyring, adapter: outbox.adapter, workerId: "rotation-worker", batchSize: 1 });
    expect({ result, rows: (await db.select().from(accountMailOutbox)).map((row) => ({ status: row.status, keyId: row.keyId, next: row.nextAttemptAt })) }).toMatchObject({ result: { accepted: 1 } });
    const pending = await db.select().from(accountMailOutbox).where(eq(accountMailOutbox.keyId, "retired-key"));
    expect(pending.every((row) => row.status === "PENDING" && row.payloadCiphertext)).toBe(true);
  });

  it("commits generic queued acceptance before transport and retries failures without claiming delivery", async () => {
    const workingSend = outbox.adapter.send;
    outbox.adapter.send = async () => { throw new Error("transport unavailable"); };
    const registration = await post("/api/account/register", { email, password });
    expect(registration.statusCode).toBe(202);
    expect(registration.json()).toEqual({ accepted: true });
    const [created] = await db.select().from(users);
    expect(created?.verifiedAt).toBeNull();
    expect(await deliverQueuedMail()).toMatchObject({ retried: 1 });
    const originalHash = created?.passwordHash;
    outbox.adapter.send = workingSend;
    const retry = await post("/api/account/register", { email, password: "different passphrase never adopted" });
    expect(retry.json()).toEqual({ accepted: true });
    expect(retry.statusCode).toBe(202);
    expect(await db.select().from(accountMailOutbox)).toHaveLength(2);
    expect(await deliverQueuedMail()).toMatchObject({ accepted: 1 });
    const [afterRetry] = await db.select().from(users);
    expect(afterRetry?.passwordHash).toBe(originalHash);
    expect(originalHash).toBeTruthy();
    expect(outbox.read()).toHaveLength(1);
    const messages = await db.select().from(accountMailOutbox);
    expect(messages.map((row) => row.status)).toEqual(["CANCELLED", "ACCEPTED"]);
    const bearer = tokenFromDelivery();
    expect((await db.select().from(accountActionTokens)).every((row) => row.tokenHash !== bearer)).toBe(true);
    expect((await post("/api/account/verification/confirm", { token: bearer })).statusCode).toBe(200);
  });

  it("rejects expired action tokens and does not trust forwarded IP headers for throttling", async () => {
    const expiredEmail = "expired-token@example.invalid";
    expect((await post("/api/account/register", { email: expiredEmail, password })).statusCode).toBe(202);
    const [queued] = await db.select().from(accountMailOutbox);
    const decoded = decryptMailEnvelope(mailKeyring, { messageId: queued!.id, actionTokenId: queued!.actionTokenId, purpose: "VERIFY_EMAIL", formatVersion: 1, keyId: queued!.keyId }, { keyId: queued!.keyId, nonce: queued!.payloadNonce!, ciphertext: queued!.payloadCiphertext!, authTag: queued!.payloadAuthTag! });
    const verify = /#token=([A-Za-z0-9_-]+)/.exec(decoded.text)?.[1];
    if (!verify) throw new Error("Expected verification token in queued mail");
    await db.update(accountActionTokens).set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(accountActionTokens.tokenHash, hashToken(verify)));
    expect((await post("/api/account/verification/confirm", { token: verify })).statusCode).toBe(400);
    expect(await deliverQueuedMail()).toMatchObject({ cancelled: 1 });
    const expiredMessage = (await db.select().from(accountMailOutbox))[0];
    expect(expiredMessage?.status).toBe("CANCELLED");
    expect(expiredMessage?.payloadCiphertext).toBeNull();

    let rateLimited = false;
    for (let index = 0; index < 36; index += 1) {
      const response = await post("/api/account/verification/request", {
        email: `unknown-${index}@example.invalid`,
      }, { "x-forwarded-for": `198.51.100.${index + 1}` });
      if (response.statusCode === 429) {
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });

  it("rejects account-backed game sessions when the membership belongs to another account", async () => {
    const [owner] = await db.insert(users).values({
      emailNormalized: email,
      emailDisplay: email,
      passwordHash: "$scrypt$test$unusable",
      verifiedAt: new Date(),
    }).returning();
    const [other] = await db.insert(users).values({
      emailNormalized: "other@example.invalid",
      emailDisplay: "other@example.invalid",
      passwordHash: "$scrypt$test$unusable",
      verifiedAt: new Date(),
    }).returning();
    const [campaign] = await db.insert(campaigns).values({ name: "Account test" }).returning();
    const [membership] = await db.insert(memberships).values({
      campaignId: campaign!.id,
      role: "PLAYER",
      displayName: "Fixture",
      userId: other!.id,
    }).returning();
    const [parent] = await db.insert(accountSessions).values({
      userId: owner!.id,
      tokenHash: hashToken("opaque parent session token"),
      csrfHash: hashToken("opaque csrf value"),
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    const gameToken = "opaque game session token";
    const [gameSession] = await db.insert(sessions).values({
      membershipId: membership!.id,
      accountSessionId: parent!.id,
      authSource: "ACCOUNT",
      tokenHash: hashToken(gameToken),
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    expect(await authFromSessionToken(db as never, gameToken)).toBeNull();
    expect(await sessionIsActive(db as never, gameSession!.id)).toBe(false);

    await db.update(memberships).set({ userId: owner!.id }).where(eq(memberships.id, membership!.id));
    expect(await authFromSessionToken(db as never, gameToken)).toMatchObject({ membershipId: membership!.id });
    expect(await sessionIsActive(db as never, gameSession!.id)).toBe(true);
    await db.update(accountSessions).set({ revokedAt: new Date() }).where(eq(accountSessions.id, parent!.id));
    expect(await authFromSessionToken(db as never, gameToken)).toBeNull();
    expect(await sessionIsActive(db as never, gameSession!.id)).toBe(false);
  });
});

describe("additive account migration", () => {
  it("preserves legacy campaign membership and game session identities", async () => {
    const legacyDatabase = new PGlite();
    try {
      const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
      const files = (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort();
      const laterMigrations = ["0049_account_auth.sql", "0050_cuddly_nightshade.sql", "0051_thick_saracen.sql", "0053_pretty_giant_girl.sql"];
      for (const file of files.filter((name) => !laterMigrations.includes(name)))
        await legacyDatabase.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
      const legacyDb = drizzle(legacyDatabase, { schema });
      const campaignId = crypto.randomUUID();
      const membershipId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      await legacyDb.insert(campaigns).values({ id: campaignId, name: "Retained legacy" });
      await legacyDatabase.query("INSERT INTO memberships (id,campaign_id,role,display_name) VALUES ($1,$2,'PLAYER','Legacy name')", [membershipId, campaignId]);
      await legacyDatabase.query("INSERT INTO sessions (id,membership_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)", [
        sessionId,
        membershipId,
        hashToken("legacy session fixture"),
        new Date(Date.now() + 60_000),
      ]);
      for (const file of laterMigrations)
        await legacyDatabase.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
      const retained = await legacyDatabase.query("SELECT c.name, m.display_name, m.user_id, s.account_session_id FROM campaigns c JOIN memberships m ON m.campaign_id=c.id JOIN sessions s ON s.membership_id=m.id WHERE c.id=$1", [campaignId]);
      expect(retained.rows).toEqual([{ name: "Retained legacy", display_name: "Legacy name", user_id: null, account_session_id: null }]);
      expect((await legacyDatabase.query("SELECT count(*)::int AS count FROM users")).rows).toEqual([{ count: 0 }]);
    } finally {
      await legacyDatabase.close();
    }
  });
});
