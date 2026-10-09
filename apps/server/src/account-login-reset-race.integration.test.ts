import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@arken/db";
import { accountActionTokens, accountSessions, users } from "@arken/db";
import { createTestMailOutbox, createTestMailKeyring } from "./account-mail.js";

const loginBarrier = vi.hoisted(() => ({
  enabled: false,
  entered: null as null | (() => void),
  release: null as null | (() => void),
}));

vi.mock("./password-security.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./password-security.js")>();
  return {
    ...actual,
    verifyPassword: async (password: string, encoded: string) => {
      const valid = await actual.verifyPassword(password, encoded);
      if (valid && loginBarrier.enabled) {
        loginBarrier.entered?.();
        await new Promise<void>((resolve) => { loginBarrier.release = resolve; });
      }
      return valid;
    },
  };
});

import { hashPassword } from "./password-security.js";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";
import { hashToken } from "./security.js";

const origin = "http://localhost:5173";
const oldPassword = "old account passphrase 2026";
const newPassword = "new account passphrase 2026";
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  loginBarrier.enabled = false;
  loginBarrier.entered = null;
  loginBarrier.release = null;
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  app = Fastify();
  await app.register(cookie);
  const outbox = createTestMailOutbox();
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
    mailKeyring: createTestMailKeyring(),
  });
  await app.ready();
});

afterEach(async () => {
  loginBarrier.enabled = false;
  await app.close();
  await database.close();
});

describe("login and reset serialization", () => {
  it("does not mint an old-password login session after reset commits", async () => {
    const email = "race@example.invalid";
    const [user] = await db.insert(users).values({
      emailNormalized: email,
      emailDisplay: email,
      passwordHash: await hashPassword(oldPassword),
      verifiedAt: new Date(),
    }).returning();
    const resetToken = `reset-${crypto.randomUUID()}`;
    await db.insert(accountActionTokens).values({
      userId: user!.id,
      purpose: "RESET_PASSWORD",
      tokenHash: hashToken(resetToken),
      expiresAt: new Date(Date.now() + 60_000),
    });

    let entered!: () => void;
    const verified = new Promise<void>((resolve) => { entered = resolve; });
    loginBarrier.entered = entered;
    loginBarrier.enabled = true;
    const loginPromise = app.inject({
      method: "POST",
      url: "/api/account/login",
      payload: { email, password: oldPassword },
      headers: { origin },
    });
    await verified;

    const reset = await app.inject({
      method: "POST",
      url: "/api/account/password/reset/confirm",
      payload: { token: resetToken, password: newPassword },
      headers: { origin },
    });
    expect(reset.statusCode).toBe(200);

    loginBarrier.release?.();
    const login = await loginPromise;
    expect(login.statusCode).toBe(401);
    expect(login.json()).toEqual({ error: "INVALID_CREDENTIALS" });
    expect(await db.select().from(accountSessions)).toHaveLength(0);
  });

  it("rejects a reset token that expires while waiting on the locked user row", async () => {
    const email = "expiry-race@example.invalid";
    const originalHash = await hashPassword(oldPassword);
    const [user] = await db.insert(users).values({
      emailNormalized: email,
      emailDisplay: email,
      passwordHash: originalHash,
      verifiedAt: new Date(),
    }).returning();
    const resetToken = `reset-${crypto.randomUUID()}`;
    const [action] = await db.insert(accountActionTokens).values({
      userId: user!.id,
      purpose: "RESET_PASSWORD",
      tokenHash: hashToken(resetToken),
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();

    let locked!: () => void;
    let release!: () => void;
    const lockReady = new Promise<void>((resolve) => { locked = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, user!.id)).for("update");
      locked();
      await hold;
      await tx.update(accountActionTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(accountActionTokens.id, action!.id));
    });
    await lockReady;
    let settled = false;
    const resetRequest = app.inject({
      method: "POST",
      url: "/api/account/password/reset/confirm",
      payload: { token: resetToken, password: newPassword },
      headers: { origin },
    }).then((response: { statusCode: number }) => { settled = true; return response; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    release();
    await blocker;
    const response = await resetRequest;
    expect(response.statusCode).toBe(400);
    expect((await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user!.id)))[0]?.passwordHash).toBe(originalHash);
    expect((await db.select({ usedAt: accountActionTokens.usedAt }).from(accountActionTokens).where(eq(accountActionTokens.id, action!.id)))[0]?.usedAt).toBeNull();
  });
});
