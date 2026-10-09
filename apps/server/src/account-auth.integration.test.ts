import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { accountActionTokens, accountSessions, campaigns, memberships, sessions, users } from "@arken/db";
import { createTestMailOutbox } from "./account-mail.js";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";
import { authFromSessionToken, sessionIsActive } from "./auth.js";
import { hashToken } from "./security.js";

const origin = "http://localhost:5173";
const password = "correct horse battery staple";
const email = "person@example.invalid";
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: ReturnType<typeof Fastify>;
let outbox: ReturnType<typeof createTestMailOutbox>;

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  outbox = createTestMailOutbox();
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
    mail: outbox.adapter,
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
    const verify = tokenFromDelivery();
    expect((await post("/api/account/password/reset/confirm", { token: verify, password: "another sufficiently long password" })).statusCode).toBe(400);
    await post("/api/account/verification/confirm", { token: verify });
    const login = await post("/api/account/login", { email, password });
    const auth = sessionCookies(login);
    expect((await post("/api/account/password/reset/request", { email })).statusCode).toBe(200);
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

  it("returns delivery failure rather than claiming registration/reset mail was sent", async () => {
    const workingSend = outbox.adapter.send;
    outbox.adapter.send = async () => { throw new Error("transport unavailable"); };
    const registration = await post("/api/account/register", { email, password });
    expect(registration.statusCode).toBe(503);
    expect(registration.json()).toEqual({ error: "ACCOUNT_DELIVERY_UNAVAILABLE" });
    const [created] = await db.select().from(users);
    expect(created?.verifiedAt).toBeNull();
    const originalHash = created?.passwordHash;
    outbox.adapter.send = workingSend;
    const retry = await post("/api/account/register", { email, password: "different passphrase never adopted" });
    expect(retry.json()).toEqual({ accepted: true });
    expect(retry.statusCode).toBe(202);
    expect(outbox.read()).toHaveLength(1);
    const [afterRetry] = await db.select().from(users);
    expect(afterRetry?.passwordHash).toBe(originalHash);
    expect((await post("/api/account/verification/confirm", { token: tokenFromDelivery() })).statusCode).toBe(200);
    expect((await post("/api/account/login", { email, password })).statusCode).toBe(200);

    outbox.adapter.send = async () => { throw new Error("transport unavailable"); };
    await db.update(users).set({ verifiedAt: new Date() }).where(eq(users.emailNormalized, email));
    const reset = await post("/api/account/password/reset/request", { email });
    expect(reset.statusCode).toBe(503);
    expect(reset.json()).toEqual({ error: "ACCOUNT_DELIVERY_UNAVAILABLE" });
  });

  it("rejects expired action tokens and does not trust forwarded IP headers for throttling", async () => {
    await post("/api/account/register", { email, password });
    const verify = tokenFromDelivery();
    await db.update(accountActionTokens).set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(accountActionTokens.tokenHash, hashToken(verify)));
    expect((await post("/api/account/verification/confirm", { token: verify })).statusCode).toBe(400);

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
      const laterMigrations = ["0049_account_auth.sql", "0050_cuddly_nightshade.sql", "0051_thick_saracen.sql"];
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
