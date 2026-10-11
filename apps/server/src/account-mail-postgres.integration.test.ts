import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { createDatabase } from "@arken/db";
import { accountActionTokens, accountMailOutbox, users } from "@arken/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";
import { createTestMailKeyring, createTestMailOutbox, decryptMailEnvelope } from "./account-mail.js";
import { drainAccountMailOutboxOnce } from "./account-mail-outbox.js";
import { hashToken } from "./security.js";

const dbUrl = process.env.ACCOUNT_MAIL_PG_URL;
const pgDescribe = dbUrl ? describe : describe.skip;
const origin = "http://localhost:5173";
let resources: ReturnType<typeof createDatabase>;
let client: ReturnType<typeof createDatabase>["client"];
let db: ReturnType<typeof createDatabase>["db"];
let app: ReturnType<typeof Fastify>;
let keyring: ReturnType<typeof createTestMailKeyring>;
let testMail: ReturnType<typeof createTestMailOutbox>;

async function applyFreshMigrations() {
  const folder = new URL("../../../packages/db/drizzle/", import.meta.url);
  const files = (await readdir(folder)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const contents = await readFile(new URL(file, folder), "utf8");
    for (const statement of contents.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean))
      await client.unsafe(statement);
  }
}

function requireDisposableLoopbackTarget(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("ACCOUNT_MAIL_PG_URL must target a dedicated local QA database"); }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (!loopback || !dbName.startsWith("arken_auth_mail_qa_") || !parsed.username.startsWith("authqa"))
    throw new Error("ACCOUNT_MAIL_PG_URL must target a loopback host and dedicated arken_auth_mail_qa_ database using a synthetic authqa role");
  return value;
}

function post(url: string, payload: unknown) {
  return app.inject({ method: "POST", url, payload, headers: { origin } });
}

async function verificationTokenFor(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.emailNormalized, email));
  if (!user) throw new Error("fixture user missing");
  const [token] = await db.select().from(accountActionTokens).where(eq(accountActionTokens.userId, user.id));
  const [message] = await db.select().from(accountMailOutbox).where(eq(accountMailOutbox.actionTokenId, token!.id));
  if (!message?.payloadNonce || !message.payloadCiphertext || !message.payloadAuthTag) throw new Error("fixture envelope unavailable");
  const mail = decryptMailEnvelope(keyring, { messageId: message.id, actionTokenId: token!.id, purpose: "VERIFY_EMAIL", formatVersion: message.formatVersion, keyId: message.keyId }, { keyId: message.keyId, nonce: message.payloadNonce, ciphertext: message.payloadCiphertext, authTag: message.payloadAuthTag });
  const found = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  if (!found) throw new Error("fixture token unavailable");
  return found;
}

pgDescribe("account mail outbox — real PostgreSQL two-connection gates", () => {
  beforeAll(async () => {
    resources = createDatabase(requireDisposableLoopbackTarget(dbUrl!));
    client = resources.client;
    await applyFreshMigrations();
    db = resources.db;
  }, 60_000);

  beforeEach(async () => {
    await client.unsafe("TRUNCATE TABLE users CASCADE");
    keyring = createTestMailKeyring();
    testMail = createTestMailOutbox();
    app = Fastify({ logger: false });
    await app.register(cookie);
    registerAccountAuthRoutes(app as never, db as never, { in: () => ({ disconnectSockets() {} }) }, {
      enabled: true, registrationEnabled: true, legacyDevEnabled: false,
      campaignLinkAccessEnabled: false, campaignCreationEnabled: false,
      sessionTtlDays: 3, cookieSecure: false, accountCookieName: "test_account",
      gameCookieName: "test_game", csrfCookieName: "test_csrf", webOrigin: origin,
      publicUrl: origin, mailRuntimeEnabled: true, mail: testMail.adapter, mailKeyring: keyring,
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await client?.end({ timeout: 2 });
  });

  it("refuses non-loopback or non-dedicated targets before migration or fixture mutation", () => {
    expect(() => requireDisposableLoopbackTarget("postgres://authqa:synthetic@db.example.invalid/arken_auth_mail_qa_test")).toThrow("loopback host");
    expect(() => requireDisposableLoopbackTarget("postgres://authqa:synthetic@127.0.0.1/production")).toThrow("dedicated arken_auth_mail_qa_");
  });

  it("serializes concurrent verify confirmation and resend in canonical user→token→outbox order", async () => {
    const email = "pg-lock-order@example.invalid";
    expect((await post("/api/account/register", { email, password: "postgres integration passphrase" })).statusCode).toBe(202);
    const token = await verificationTokenFor(email);
    await client.unsafe(`CREATE OR REPLACE FUNCTION test_sleep_on_verify_consume() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.used_at IS DISTINCT FROM OLD.used_at AND OLD.purpose = 'VERIFY_EMAIL' THEN PERFORM pg_sleep(0.7); END IF; RETURN NEW; END $$`);
    await client.unsafe("CREATE TRIGGER test_sleep_on_verify_consume BEFORE UPDATE ON account_action_tokens FOR EACH ROW EXECUTE FUNCTION test_sleep_on_verify_consume()");
    try {
      const confirmation = post("/api/account/verification/confirm", { token });
      let sleeping = false;
      const deadline = Date.now() + 4_000;
      while (!sleeping && Date.now() < deadline) {
        const rows = await client.unsafe<{ sleeping: boolean }[]>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'arken-auth-outbox-disposable-gate' AND state = 'active' AND wait_event = 'PgSleep' AND query ILIKE '%UPDATE%account_action_tokens%') AS sleeping");
        sleeping = rows[0]?.sleeping ?? false;
        if (!sleeping) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(sleeping).toBe(true);
      const resend = post("/api/account/verification/request", { email });
      const [confirmResult, resendResult] = await Promise.all([confirmation, resend]);
      expect(confirmResult.statusCode).toBe(200);
      expect(resendResult.statusCode).toBe(200);
      const [user] = await db.select().from(users).where(eq(users.emailNormalized, email));
      expect(user?.verifiedAt).toBeTruthy();
      const activeTokens = await db.select().from(accountActionTokens).where(eq(accountActionTokens.userId, user!.id));
      expect(activeTokens.filter((row) => row.usedAt === null)).toHaveLength(0);
    } finally {
      await client.unsafe("DROP TRIGGER IF EXISTS test_sleep_on_verify_consume ON account_action_tokens");
      await client.unsafe("DROP FUNCTION IF EXISTS test_sleep_on_verify_consume()");
    }
  }, 20_000);

  it("excludes competing drainers and fences stale acknowledgements after lease replacement", async () => {
    const email = "pg-lease@example.invalid";
    expect((await post("/api/account/register", { email, password: "postgres integration passphrase" })).statusCode).toBe(202);
    let entered!: () => void, release!: () => void;
    const inSend = new Promise<void>((resolve) => { entered = resolve; });
    const waitSend = new Promise<void>((resolve) => { release = resolve; });
    const slowAdapter = { ready: true, async send() { entered(); await waitSend; } };
    const worker1 = drainAccountMailOutboxOnce(db as never, { keyring, adapter: slowAdapter, workerId: "pg-worker-one" });
    await inSend;
    const competing = await drainAccountMailOutboxOnce(db as never, { keyring, adapter: testMail.adapter, workerId: "pg-worker-two" });
    expect(competing.accepted).toBe(0);
    release();
    expect((await worker1).accepted).toBe(1);

    const staleEmail = "pg-stale-ack@example.invalid";
    expect((await post("/api/account/register", { email: staleEmail, password: "postgres integration passphrase" })).statusCode).toBe(202);
    let staleEntered!: () => void, staleRelease!: () => void;
    const staleInSend = new Promise<void>((resolve) => { staleEntered = resolve; });
    const staleWait = new Promise<void>((resolve) => { staleRelease = resolve; });
    const slowSecondAdapter = { ready: true, async send() { staleEntered(); await staleWait; } };
    const staleWorker = drainAccountMailOutboxOnce(db as never, { keyring, adapter: slowSecondAdapter, workerId: "pg-stale-worker" });
    await staleInSend;
    const [message] = await db.select().from(accountMailOutbox).where(eq(accountMailOutbox.status, "LEASED"));
    const replacementLease = crypto.randomUUID();
    await db.update(accountMailOutbox).set({ leaseOwner: "replacement-worker", leaseToken: replacementLease, leaseExpiresAt: new Date(Date.now() + 60_000) }).where(eq(accountMailOutbox.id, message!.id));
    staleRelease();
    expect((await staleWorker).accepted).toBe(0);
    const [stillLeased] = await db.select().from(accountMailOutbox).where(eq(accountMailOutbox.id, message!.id));
    expect(stillLeased?.status).toBe("LEASED");
    expect(stillLeased?.leaseToken).toBe(replacementLease);
    await db.update(accountMailOutbox).set({ leaseExpiresAt: new Date(Date.now() - 1) }).where(eq(accountMailOutbox.id, message!.id));
    expect((await drainAccountMailOutboxOnce(db as never, { keyring, adapter: testMail.adapter, workerId: "replacement-worker" })).accepted).toBe(1);
    const [accepted] = await db.select().from(accountMailOutbox).where(eq(accountMailOutbox.id, message!.id));
    expect(accepted?.status).toBe("ACCEPTED");
  }, 20_000);

  it("rolls back invalidation/cancellation of an existing usable token when replacement enqueue fails", async () => {
    const email = "pg-rollback@example.invalid";
    const password = "postgres integration passphrase";
    expect((await post("/api/account/register", { email, password })).statusCode).toBe(202);
    const originalBearer = await verificationTokenFor(email);
    expect((await drainAccountMailOutboxOnce(db as never, { keyring, adapter: testMail.adapter, workerId: "rollback-setup" })).accepted).toBe(1);
    await client.unsafe("ALTER TABLE account_mail_outbox ADD CONSTRAINT test_replacement_queue_failure CHECK (status <> 'PENDING' OR created_at < TIMESTAMPTZ '2000-01-01 00:00:00+00')");
    try {
      const retry = await post("/api/account/register", { email, password: "must not replace original passphrase" });
      expect(retry.statusCode).toBe(503);
      const [action] = await db.select().from(accountActionTokens).where(eq(accountActionTokens.tokenHash, hashToken(originalBearer)));
      expect(action?.usedAt).toBeNull();
      const [message] = await db.select().from(accountMailOutbox).where(eq(accountMailOutbox.actionTokenId, action!.id));
      expect(message?.status).toBe("ACCEPTED");
      expect((await post("/api/account/verification/confirm", { token: originalBearer })).statusCode).toBe(200);
    } finally {
      await client.unsafe("ALTER TABLE account_mail_outbox DROP CONSTRAINT IF EXISTS test_replacement_queue_failure");
    }
  }, 20_000);
});
