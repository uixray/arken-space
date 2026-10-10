import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  accountActionTokens,
  accountSessions,
  sessions,
  users,
} from "@arken/db";
import {
  accountActionAcceptedSchema,
  accountCapabilitiesSchema,
  accountActionTokenSchema,
  accountEmailInputSchema,
  accountLoginSchema,
  accountPasswordChangeSchema,
  accountPasswordResetSchema,
  accountRegistrationSchema,
  accountSessionSchema,
} from "@arken/contracts";
import type { MailAdapter, MailKeyring } from "./account-mail.js";
import { enqueueAccountAction, cancelActionMessages } from "./account-mail-outbox.js";
import { hashPassword, PasswordPolicyError, verifyPassword } from "./password-security.js";
import { hashToken, randomToken, safeEqual } from "./security.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeSessions = {
  in: (room: string) => { disconnectSockets: (close?: boolean) => unknown };
};
export type AccountAuthOptions = {
  enabled: boolean;
  registrationEnabled: boolean;
  legacyDevEnabled: boolean;
  campaignLinkAccessEnabled: boolean;
  campaignCreationEnabled: boolean;
  sessionTtlDays: number;
  cookieSecure: boolean;
  accountCookieName: string;
  gameCookieName: string;
  csrfCookieName: string;
  webOrigin: string;
  publicUrl: string;
  mailRuntimeEnabled: boolean;
  mail: MailAdapter;
  mailKeyring: MailKeyring | null;
};
type AccountUser = typeof users.$inferSelect;

const VERIFY = "VERIFY_EMAIL";
const RESET = "RESET_PASSWORD";
const RATE_WINDOW_MS = 15 * 60_000;
const IP_LIMIT = 30;
const IDENTIFIER_LIMIT = 8;
const MAX_RATE_KEYS = 10_000;
const sessionRoom = (id: string) => `session:${id}`;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let dummyVerifier: Promise<string> | null = null;

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function parse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, body: unknown): T | null {
  const result = schema.safeParse(body);
  return result.success ? result.data : null;
}

function emailLimiter(request: FastifyRequest, purpose: string, email?: string) {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets)
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  if (rateBuckets.size >= MAX_RATE_KEYS) return false;
  // Use the direct TCP peer rather than any forwarded header. Reverse-proxy
  // deployments intentionally get a coarse shared limit until trusted peers
  // can be individually configured; arbitrary X-Forwarded-For is never trusted.
  const peer = request.socket.remoteAddress ?? "unknown-peer";
  const keys = [`ip:${peer}:${purpose}`];
  if (email) keys.push(`email:${email}:${purpose}`);
  for (const key of keys) {
    const current = rateBuckets.get(key);
    if (current && current.resetAt > now && current.count >= (key.startsWith("ip:") ? IP_LIMIT : IDENTIFIER_LIMIT)) return false;
  }
  for (const key of keys) {
    const current = rateBuckets.get(key);
    if (current && current.resetAt > now) current.count += 1;
    else rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
  }
  return true;
}

function cookieOptions(options: AccountAuthOptions) {
  return { httpOnly: true, secure: options.cookieSecure, sameSite: "strict" as const, path: "/" };
}

function mailReady(options: AccountAuthOptions) { return options.mailRuntimeEnabled && options.mail.ready && Boolean(options.mailKeyring?.keys.get(options.mailKeyring.activeKeyId)); }

async function getDummyVerifier() {
  dummyVerifier ??= hashPassword(randomToken(48));
  return dummyVerifier;
}

async function invalidateGameSessions(
  db: Database,
  io: RealtimeSessions,
  accountSessionIds: string[],
) {
  if (accountSessionIds.length === 0) return;
  const linked = await db.select({ id: sessions.id }).from(sessions)
    .where(inArray(sessions.accountSessionId, accountSessionIds));
  await db.update(sessions).set({ expiresAt: new Date(0) })
    .where(inArray(sessions.accountSessionId, accountSessionIds));
  for (const session of linked) io.in(sessionRoom(session.id)).disconnectSockets(true);
}

async function revokeCurrentAccountSession(
  db: Database,
  io: RealtimeSessions,
  token: string | undefined,
) {
  if (!token) return;
  const [row] = await db.select({ id: accountSessions.id }).from(accountSessions)
    .where(eq(accountSessions.tokenHash, hashToken(token))).limit(1);
  if (!row) return;
  await db.update(accountSessions).set({ revokedAt: new Date() }).where(eq(accountSessions.id, row.id));
  await invalidateGameSessions(db, io, [row.id]);
}

async function findActiveAccountSession(db: Database, token?: string) {
  if (!token) return null;
  const [row] = await db.select({
    id: accountSessions.id,
    userId: users.id,
    email: users.emailDisplay,
    verifiedAt: users.verifiedAt,
    disabledAt: users.disabledAt,
    csrfHash: accountSessions.csrfHash,
    expiresAt: accountSessions.expiresAt,
    revokedAt: accountSessions.revokedAt,
  }).from(accountSessions)
    .innerJoin(users, eq(accountSessions.userId, users.id))
    .where(eq(accountSessions.tokenHash, hashToken(token))).limit(1);
  if (!row || row.revokedAt || row.disabledAt || !row.verifiedAt || row.expiresAt <= new Date()) return null;
  return row;
}

async function requireOrigin(request: FastifyRequest, expectedOrigin: string) {
  return request.headers.origin === expectedOrigin;
}

function clearCookies(reply: import("fastify").FastifyReply, options: AccountAuthOptions) {
  reply.clearCookie(options.accountCookieName, cookieOptions(options));
  reply.clearCookie(options.csrfCookieName, { httpOnly: false, secure: options.cookieSecure, sameSite: "strict", path: "/" });
}

async function setSessionCookies(
  db: Database,
  reply: import("fastify").FastifyReply,
  options: AccountAuthOptions,
  userId: string,
  expectedPasswordHash: string,
  expiresAt: Date,
) {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const created = await db.transaction(async (tx) => {
    const [current] = await tx.select({
      id: users.id,
      passwordHash: users.passwordHash,
      verifiedAt: users.verifiedAt,
      disabledAt: users.disabledAt,
    }).from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!current || current.passwordHash !== expectedPasswordHash || !current.verifiedAt || current.disabledAt) return false;
    const [row] = await tx.insert(accountSessions).values({
      userId, tokenHash: hashToken(token), csrfHash: hashToken(csrf), expiresAt,
    }).returning({ id: accountSessions.id });
    return Boolean(row);
  });
  if (!created) return null;
  reply.setCookie(options.accountCookieName, token, { ...cookieOptions(options), expires: expiresAt });
  reply.setCookie(options.csrfCookieName, csrf, { httpOnly: false, secure: options.cookieSecure, sameSite: "strict", path: "/", expires: expiresAt });
  return csrf;
}

async function ensureCsrfCookie(
  db: Database,
  reply: import("fastify").FastifyReply,
  options: AccountAuthOptions,
  account: { id: string; csrfHash: string; expiresAt: Date },
  existing?: string,
) {
  if (existing && safeEqual(hashToken(existing), account.csrfHash)) return existing;
  const csrf = randomToken(32);
  await db.update(accountSessions).set({ csrfHash: hashToken(csrf) }).where(eq(accountSessions.id, account.id));
  reply.setCookie(options.csrfCookieName, csrf, { httpOnly: false, secure: options.cookieSecure, sameSite: "strict", path: "/", expires: account.expiresAt });
  return csrf;
}

async function requireAccountCsrf(
  request: FastifyRequest,
  reply: import("fastify").FastifyReply,
  db: Database,
  options: AccountAuthOptions,
) {
  const account = await findActiveAccountSession(db, request.cookies[options.accountCookieName]);
  if (!account) {
    await reply.code(401).send({ error: "ACCOUNT_AUTH_REQUIRED" });
    return null;
  }
  const header = request.headers["x-csrf-token"];
  const cookie = request.cookies[options.csrfCookieName];
  if (typeof header !== "string" || !cookie || !safeEqual(header, cookie) || !safeEqual(hashToken(header), account.csrfHash)) {
    await reply.code(403).send({ error: "CSRF_REJECTED" });
    return null;
  }
  return account;
}

function isDuplicateEmail(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && (current as { code?: string }).code === "23505") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : null;
  }
  return false;
}

export function registerAccountAuthRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeSessions,
  options: AccountAuthOptions,
) {
  // Account/session/token responses must never enter a browser or intermediary
  // cache. onSend also covers validation, 404, and error-handler responses.
  app.addHook("onSend", async (request, reply, payload) => {
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    if (/^\/api\/(?:account|auth)(?:\/|$)/.test(pathname))
      reply.header("Cache-Control", "no-store");
    return payload;
  });

  const unavailable = (reply: import("fastify").FastifyReply) => reply.code(404).send({ error: "ACCOUNT_AUTH_DISABLED" });
  const requireEnabled = () => options.enabled;
  const requireWriteOrigin = async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (!(await requireOrigin(request, options.webOrigin))) {
      await reply.code(403).send({ error: "ORIGIN_FORBIDDEN" });
      return false;
    }
    return true;
  };

  app.get("/api/account/capabilities", async (_request, reply) => {
    return reply.send(accountCapabilitiesSchema.parse({
      accountAuthEnabled: options.enabled,
      registrationEnabled: options.enabled && options.registrationEnabled && mailReady(options),
      legacyDevEnabled: options.legacyDevEnabled,
      campaignLinkAccessEnabled: options.campaignLinkAccessEnabled,
      campaignCreationEnabled: options.enabled && options.campaignCreationEnabled,
    }));
  });

  app.post("/api/account/register", { bodyLimit: 8192 }, async (request, reply) => {
    if (!requireEnabled()) return unavailable(reply);
    if (!(await requireWriteOrigin(request, reply))) return;
    const body = parse(accountRegistrationSchema, request.body);
    if (!body) return reply.code(400).send({ error: "INVALID_ACCOUNT_INPUT" });
    const email = normalizedEmail(body.email);
    if (!emailLimiter(request, "register", email)) return reply.code(429).send({ error: "ACCOUNT_RATE_LIMITED" });
    try {
      if (!options.registrationEnabled) return reply.code(403).send({ error: "ACCOUNT_REGISTRATION_DISABLED" });
      if (!mailReady(options)) return reply.code(503).send({ error: "ACCOUNT_DELIVERY_UNAVAILABLE" });
      const passwordHash = await hashPassword(body.password);
      let account: AccountUser | undefined;
      let isNew = false;
      try {
        await db.transaction(async (tx) => {
          [account] = await tx.insert(users).values({ emailNormalized: email, emailDisplay: body.email.trim(), passwordHash }).returning();
          isNew = Boolean(account);
          if (account) await enqueueAccountAction(tx, { keyring: options.mailKeyring!, publicUrl: options.publicUrl, email: account.emailDisplay, userId: account.id, purpose: VERIFY });
        });
      } catch (error) {
        if (!isDuplicateEmail(error)) throw error;
        // A previous send may have failed after account creation. Resend only
        // for an existing unverified account without changing its password;
        // verified/disabled accounts retain the same generic public response.
        [account] = await db.select().from(users)
          .where(and(eq(users.emailNormalized, email), isNull(users.verifiedAt), isNull(users.disabledAt)))
          .limit(1);
      }
      if (account && !isNew && !account.verifiedAt && !account.disabledAt) {
        await db.transaction(async (tx) => {
          const [locked] = await tx.select().from(users).where(eq(users.id, account!.id)).for("update").limit(1);
          // A duplicate insert path is the only path reaching this block. The
          // already-unverified account keeps its original password hash.
          if (!locked || locked.verifiedAt || locked.disabledAt) return;
          await enqueueAccountAction(tx, { keyring: options.mailKeyring!, publicUrl: options.publicUrl, email: locked.emailDisplay, userId: locked.id, purpose: VERIFY });
        });
      }
      return reply.code(202).send(accountActionAcceptedSchema.parse({ accepted: true }));
    } catch (error) {
      if (error instanceof PasswordPolicyError) return reply.code(400).send({ error: "PASSWORD_POLICY_REJECTED" });
      return reply.code(503).send({ error: "ACCOUNT_DELIVERY_UNAVAILABLE" });
    }
  });

  app.post("/api/account/login", { bodyLimit: 8192 }, async (request, reply) => {
    if (!requireEnabled()) return unavailable(reply);
    if (!(await requireWriteOrigin(request, reply))) return;
    const body = parse(accountLoginSchema, request.body);
    if (!body) return reply.code(400).send({ error: "INVALID_ACCOUNT_INPUT" });
    const email = normalizedEmail(body.email);
    if (!emailLimiter(request, "login", email)) return reply.code(429).send({ error: "ACCOUNT_RATE_LIMITED" });
    try {
      const [account] = await db.select().from(users).where(eq(users.emailNormalized, email)).limit(1);
      const valid = account && !account.disabledAt
        ? await verifyPassword(body.password, account.passwordHash)
        : await verifyPassword(body.password, await getDummyVerifier());
      if (!account || account.disabledAt || !valid || !account.verifiedAt)
        return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      await revokeCurrentAccountSession(db, io, request.cookies[options.accountCookieName]);
      const expiresAt = new Date(Date.now() + options.sessionTtlDays * 86_400_000);
      const csrfToken = await setSessionCookies(db, reply, options, account.id, account.passwordHash, expiresAt);
      if (!csrfToken) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      return reply.send(accountSessionSchema.parse({
        authenticated: true,
        account: { id: account.id, email: account.emailDisplay, verified: true },
        csrfToken,
      }));
    } catch {
      return reply.code(503).send({ error: "ACCOUNT_SERVICE_UNAVAILABLE" });
    }
  });

  app.get("/api/account/session", async (request, reply) => {
    if (!requireEnabled()) return unavailable(reply);
    try {
      const account = await findActiveAccountSession(db, request.cookies[options.accountCookieName]);
      if (!account) return reply.send({ authenticated: false });
      const csrfToken = await ensureCsrfCookie(db, reply, options, account, request.cookies[options.csrfCookieName]);
      return reply.send(accountSessionSchema.parse({ authenticated: true, account: { id: account.userId, email: account.email, verified: true }, csrfToken }));
    } catch {
      return reply.code(503).send({ error: "ACCOUNT_SERVICE_UNAVAILABLE" });
    }
  });

  app.post("/api/account/logout", { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireEnabled()) return unavailable(reply);
    if (!(await requireWriteOrigin(request, reply))) return;
    const account = await findActiveAccountSession(db, request.cookies[options.accountCookieName]);
    if (account) {
      const auth = await requireAccountCsrf(request, reply, db, options);
      if (!auth) return;
      await db.update(accountSessions).set({ revokedAt: new Date() }).where(eq(accountSessions.id, account.id));
      await invalidateGameSessions(db, io, [account.id]);
    }
    clearCookies(reply, options);
    return reply.send({ ok: true });
  });

  app.post("/api/account/verification/request", { bodyLimit: 8192 }, async (request, reply) => {
    if (!requireEnabled()) return unavailable(reply);
    if (!(await requireWriteOrigin(request, reply))) return;
    const body = parse(accountEmailInputSchema, request.body);
    if (!body) return reply.code(400).send({ error: "INVALID_ACCOUNT_INPUT" });
    const email = normalizedEmail(body.email);
    if (!emailLimiter(request, "verify", email)) return reply.code(429).send({ error: "ACCOUNT_RATE_LIMITED" });
    try {
      if (!mailReady(options)) return reply.code(503).send({ error: "ACCOUNT_DELIVERY_UNAVAILABLE" });
      const [account] = await db.select().from(users).where(and(eq(users.emailNormalized, email), isNull(users.verifiedAt), isNull(users.disabledAt))).limit(1);
      if (account) {
        await db.transaction(async (tx) => {
          const [locked] = await tx.select().from(users).where(eq(users.id, account.id)).for("update").limit(1);
          if (locked && !locked.verifiedAt && !locked.disabledAt) await enqueueAccountAction(tx, { keyring: options.mailKeyring!, publicUrl: options.publicUrl, email: locked.emailDisplay, userId: locked.id, purpose: VERIFY });
        });
      }
      return reply.send(accountActionAcceptedSchema.parse({ accepted: true }));
    } catch {
      return reply.code(503).send({ error: "ACCOUNT_DELIVERY_UNAVAILABLE" });
    }
  });

  app.post("/api/account/verification/confirm", { bodyLimit: 2048 }, async (request, reply) => {
    if (!requireEnabled()) return unavailable(reply);
    if (!(await requireWriteOrigin(request, reply))) return;
    const body = parse(accountActionTokenSchema, request.body);
    if (!body) return reply.code(400).send({ error: "INVALID_ACCOUNT_TOKEN" });
    try {
      const result = await db.transaction(async (tx) => {
        const [candidate] = await tx.select({ id: accountActionTokens.id, userId: accountActionTokens.userId }).from(accountActionTokens).where(and(
          eq(accountActionTokens.tokenHash, hashToken(body.token)), eq(accountActionTokens.purpose, VERIFY),
          isNull(accountActionTokens.usedAt), sql`${accountActionTokens.expiresAt} > clock_timestamp()`,
        )).limit(1);
        if (!candidate) return false;
        const [user] = await tx.select({ id: users.id, verifiedAt: users.verifiedAt, disabledAt: users.disabledAt }).from(users).where(eq(users.id, candidate.userId)).for("update").limit(1);
        if (!user || user.verifiedAt || user.disabledAt) return false;
        const now = new Date();
        const [action] = await tx.update(accountActionTokens).set({ usedAt: now }).where(and(
          eq(accountActionTokens.id, candidate.id), eq(accountActionTokens.userId, user.id), eq(accountActionTokens.purpose, VERIFY),
          isNull(accountActionTokens.usedAt), sql`${accountActionTokens.expiresAt} > clock_timestamp()`,
        )).returning({ id: accountActionTokens.id });
        if (!action) return false;
        const [verified] = await tx.update(users).set({ verifiedAt: now, updatedAt: now })
          .where(and(eq(users.id, user.id), isNull(users.verifiedAt), isNull(users.disabledAt)))
          .returning({ id: users.id });
        await cancelActionMessages(tx, [action.id], "TOKEN_USED");
        return Boolean(verified);
      });
      if (!result) return reply.code(400).send({ error: "INVALID_OR_EXPIRED_ACCOUNT_TOKEN" });
      return reply.send({ ok: true });
    } catch {
      return reply.code(503).send({ error: "ACCOUNT_SERVICE_UNAVAILABLE" });
    }
  });

  app.post("/api/account/password/reset/request", { bodyLimit: 8192 }, async (request, reply) => {
    if (!requireEnabled()) return unavailable(reply);
    if (!(await requireWriteOrigin(request, reply))) return;
    const body = parse(accountEmailInputSchema, request.body);
    if (!body) return reply.code(400).send({ error: "INVALID_ACCOUNT_INPUT" });
    const email = normalizedEmail(body.email);
    if (!emailLimiter(request, "reset", email)) return reply.code(429).send({ error: "ACCOUNT_RATE_LIMITED" });
    try {
      if (!mailReady(options)) return reply.code(503).send({ error: "ACCOUNT_DELIVERY_UNAVAILABLE" });
      const [account] = await db.select().from(users).where(and(eq(users.emailNormalized, email), isNotNull(users.verifiedAt), isNull(users.disabledAt))).limit(1);
      if (account) {
        await db.transaction(async (tx) => {
          const [locked] = await tx.select().from(users).where(eq(users.id, account.id)).for("update").limit(1);
          if (locked && locked.verifiedAt && !locked.disabledAt) await enqueueAccountAction(tx, { keyring: options.mailKeyring!, publicUrl: options.publicUrl, email: locked.emailDisplay, userId: locked.id, purpose: RESET });
        });
      }
      return reply.send(accountActionAcceptedSchema.parse({ accepted: true }));
    } catch {
      return reply.code(503).send({ error: "ACCOUNT_DELIVERY_UNAVAILABLE" });
    }
  });

  app.post("/api/account/password/reset/confirm", { bodyLimit: 8192 }, async (request, reply) => {
    if (!requireEnabled()) return unavailable(reply);
    if (!(await requireWriteOrigin(request, reply))) return;
    const body = parse(accountPasswordResetSchema, request.body);
    if (!body) return reply.code(400).send({ error: "INVALID_ACCOUNT_INPUT" });
    if (!emailLimiter(request, "reset-confirm")) return reply.code(429).send({ error: "ACCOUNT_RATE_LIMITED" });
    try {
      const passwordHash = await hashPassword(body.password);
      const result = await db.transaction(async (tx) => {
        const [candidate] = await tx.select({ userId: accountActionTokens.userId }).from(accountActionTokens).where(and(
          eq(accountActionTokens.tokenHash, hashToken(body.token)), eq(accountActionTokens.purpose, RESET),
          isNull(accountActionTokens.usedAt), sql`${accountActionTokens.expiresAt} > clock_timestamp()`,
        )).limit(1);
        if (!candidate) return null;
        const [lockedUser] = await tx.select({ id: users.id, disabledAt: users.disabledAt }).from(users)
          .where(eq(users.id, candidate.userId)).for("update").limit(1);
        if (!lockedUser || lockedUser.disabledAt) return null;
        const now = new Date();
        const [action] = await tx.update(accountActionTokens).set({ usedAt: now }).where(and(
          eq(accountActionTokens.tokenHash, hashToken(body.token)), eq(accountActionTokens.userId, lockedUser.id),
          eq(accountActionTokens.purpose, RESET), isNull(accountActionTokens.usedAt),
          sql`${accountActionTokens.expiresAt} > clock_timestamp()`,
        )).returning({ id: accountActionTokens.id, userId: accountActionTokens.userId });
        if (!action) return null;
        const resetTokens = await tx.select({ id: accountActionTokens.id }).from(accountActionTokens).where(and(eq(accountActionTokens.userId, lockedUser.id), eq(accountActionTokens.purpose, RESET)));
        await cancelActionMessages(tx, resetTokens.map((item) => item.id), "TOKEN_USED");
        const [account] = await tx.update(users).set({ passwordHash, updatedAt: now }).where(and(eq(users.id, action.userId), isNull(users.disabledAt))).returning({ id: users.id });
        if (!account) return null;
        await tx.update(accountActionTokens).set({ usedAt: now }).where(and(
          eq(accountActionTokens.userId, account.id),
          eq(accountActionTokens.purpose, RESET),
          isNull(accountActionTokens.usedAt),
        ));
        const active = await tx.select({ id: accountSessions.id }).from(accountSessions).where(and(eq(accountSessions.userId, account.id), isNull(accountSessions.revokedAt)));
        const ids = active.map((row) => row.id);
        if (ids.length) await tx.update(accountSessions).set({ revokedAt: now }).where(inArray(accountSessions.id, ids));
        return { userId: account.id, sessionIds: ids };
      });
      if (!result) return reply.code(400).send({ error: "INVALID_OR_EXPIRED_ACCOUNT_TOKEN" });
      await invalidateGameSessions(db, io, result.sessionIds);
      clearCookies(reply, options);
      reply.clearCookie(options.gameCookieName, cookieOptions(options));
      return reply.send({ ok: true });
    } catch (error) {
      if (error instanceof PasswordPolicyError) return reply.code(400).send({ error: "PASSWORD_POLICY_REJECTED" });
      return reply.code(503).send({ error: "ACCOUNT_SERVICE_UNAVAILABLE" });
    }
  });

  app.post("/api/account/password/change", { bodyLimit: 8192 }, async (request, reply) => {
    if (!requireEnabled()) return unavailable(reply);
    if (!(await requireWriteOrigin(request, reply))) return;
    const accountSession = await requireAccountCsrf(request, reply, db, options);
    if (!accountSession) return;
    const body = parse(accountPasswordChangeSchema, request.body);
    if (!body) return reply.code(400).send({ error: "INVALID_ACCOUNT_INPUT" });
    if (!emailLimiter(request, "password-change")) return reply.code(429).send({ error: "ACCOUNT_RATE_LIMITED" });
    try {
      const [account] = await db.select().from(users).where(eq(users.id, accountSession.userId)).limit(1);
      if (!account || !(await verifyPassword(body.currentPassword, account.passwordHash)))
        return reply.code(401).send({ error: "CURRENT_PASSWORD_INVALID" });
      const passwordHash = await hashPassword(body.newPassword);
      const now = new Date();
      const revoked = await db.transaction(async (tx) => {
        const [locked] = await tx.select({ passwordHash: users.passwordHash, disabledAt: users.disabledAt }).from(users)
          .where(eq(users.id, account.id)).for("update").limit(1);
        if (!locked || locked.disabledAt || locked.passwordHash !== account.passwordHash) return null;
        const [changed] = await tx.update(users).set({ passwordHash, updatedAt: now })
          .where(and(eq(users.id, account.id), eq(users.passwordHash, account.passwordHash)))
          .returning({ id: users.id });
        if (!changed) return null;
        const resetTokens = await tx.select({ id: accountActionTokens.id }).from(accountActionTokens).where(and(
          eq(accountActionTokens.userId, changed.id), eq(accountActionTokens.purpose, RESET), isNull(accountActionTokens.usedAt),
        ));
        await tx.update(accountActionTokens).set({ usedAt: now }).where(and(
          eq(accountActionTokens.userId, changed.id),
          eq(accountActionTokens.purpose, RESET),
          isNull(accountActionTokens.usedAt),
        ));
        await cancelActionMessages(tx, resetTokens.map((item) => item.id), "TOKEN_USED");
        const active = await tx.select({ id: accountSessions.id }).from(accountSessions)
          .where(and(eq(accountSessions.userId, changed.id), isNull(accountSessions.revokedAt)));
        const ids = active.map((row) => row.id);
        if (ids.length) await tx.update(accountSessions).set({ revokedAt: now }).where(inArray(accountSessions.id, ids));
        return ids;
      });
      if (!revoked) return reply.code(409).send({ error: "ACCOUNT_CREDENTIAL_CONFLICT" });
      await invalidateGameSessions(db, io, revoked);
      clearCookies(reply, options);
      reply.clearCookie(options.gameCookieName, cookieOptions(options));
      return reply.send({ ok: true, revokedSessions: revoked.length });
    } catch (error) {
      if (error instanceof PasswordPolicyError) return reply.code(400).send({ error: "PASSWORD_POLICY_REJECTED" });
      return reply.code(503).send({ error: "ACCOUNT_SERVICE_UNAVAILABLE" });
    }
  });
}

