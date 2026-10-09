import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer, type TLSSocket } from "node:tls";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@arken/db";
import { accountActionTokens, memberships, users } from "@arken/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAccountMailContext } from "./account-mail-context.js";
import { createAccountMailRuntime } from "./account-mail-runtime.js";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";
import { registerAccountCampaignRoutes } from "./account-campaigns.js";
import { hashToken } from "./security.js";

const openssl = process.env.OPENSSL_BIN ?? (process.platform === "win32"
  ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
  : "openssl");
const temp = mkdtempSync(join(tmpdir(), "arken-account-smtp-lifecycle-"));
const keyPath = join(temp, "tls-key.pem");
const certPath = join(temp, "tls-cert.pem");
const syntheticEmail = `signup-${crypto.randomUUID()}@example.invalid`;
const syntheticPassword = "synthetic-only-passphrase-2026";
const runtimeWorkerId = `lifecycle-${crypto.randomUUID()}`;
const emptyDrain = { accepted: 0, retried: 0, cancelled: 0, blocked: 0 } as const;

function fakeSmtp() {
  const accepted: string[] = [];
  const sockets = new Set<TLSSocket>();
  let resolveAccepted!: () => void;
  const acceptedOnce = new Promise<void>((resolve) => { resolveAccepted = resolve; });
  const server = createTlsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffer = "";
    let state: "command" | "auth-user" | "auth-pass" | "data" = "command";
    let message = "";
    socket.write("220 local synthetic SMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (state === "data") {
          if (line === ".") {
            accepted.push(message);
            message = "";
            state = "command";
            socket.write("250 synthetic DATA accepted\r\n");
            resolveAccepted();
          } else message += `${line.startsWith("..") ? line.slice(1) : line}\r\n`;
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith("EHLO ") || command.startsWith("HELO ")) socket.write("250-local.test\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (command.startsWith("AUTH PLAIN ")) socket.write("235 synthetic auth ok\r\n");
        else if (command === "AUTH PLAIN") socket.write("334 \r\n");
        else if (command === "AUTH LOGIN") { state = "auth-user"; socket.write("334 VXNlcm5hbWU6\r\n"); }
        else if (state === "auth-user") { state = "auth-pass"; socket.write("334 UGFzc3dvcmQ6\r\n"); }
        else if (state === "auth-pass") { state = "command"; socket.write("235 synthetic auth ok\r\n"); }
        else if (command.startsWith("MAIL FROM:")) socket.write("250 sender ok\r\n");
        else if (command.startsWith("RCPT TO:")) socket.write("250 recipient ok\r\n");
        else if (command === "DATA") { state = "data"; socket.write("354 send synthetic message\r\n"); }
        else if (command === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
        else if (command.startsWith("RSET")) socket.write("250 reset\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  return {
    server,
    accepted,
    acceptedOnce,
    async listen() {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return (server.address() as { port: number }).port;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) {
        server.close();
        await once(server, "close");
      }
    },
  };
}

function extractToken(message: string) {
  const bodyStart = message.indexOf("\r\n\r\n");
  let body = bodyStart >= 0 ? message.slice(bodyStart + 4) : message;
  if (/Content-Transfer-Encoding:\s*base64/i.test(message.slice(0, bodyStart))) {
    body = Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
  } else {
    body = body.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
  const match = /\/account\/verify#token=([A-Za-z0-9_-]{43})/.exec(body.replace(/\r\n[ \t]?/g, ""));
  if (!match?.[1]) throw new Error("SYNTHETIC_VERIFY_LINK_MISSING_FROM_ACCEPTED_MAIL");
  return match[1];
}

function cookies(response: Response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  return setCookies.map((value) => value.split(";")[0]!).filter(Boolean).join("; ");
}

describe("connected open-signup SMTP lifecycle (synthetic loopback only)", () => {
  beforeAll(() => {
    execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath,
      "-out", certPath, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"],
    { stdio: "ignore" });
  }, 20_000);

  afterAll(() => rmSync(temp, { recursive: true, force: true }));

  it("queues a public signup, delivers through the real scheduler/SMTP adapter, then verifies and logs in", async () => {
    const smtp = fakeSmtp();
    const smtpPort = await smtp.listen();
    const database = new PGlite();
    const migrationDirectory = new URL("../../../packages/db/drizzle/", import.meta.url);
    for (const file of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort()) {
      await database.exec(readFileSync(new URL(file, migrationDirectory), "utf8").replaceAll("--> statement-breakpoint", ""));
    }
    const db = drizzle(database, { schema });
    const app = Fastify({ logger: false });
    await app.register(cookie);
    const webOrigin = "http://localhost:5173";
    const accountCookieName = "arken_account";
    const csrfCookieName = "arken_account_csrf";
    const gameCookieName = "arken_session";
    const encodedKey = randomBytes(32).toString("base64url");
    const context = createAccountMailContext({
      ACCOUNT_MAIL_RUNTIME_ENABLED: true,
      ACCOUNT_MAIL_ACTIVE_KEY_ID: "loopback-test-v1",
      ACCOUNT_MAIL_KEYRING: `loopback-test-v1=${encodedKey}`,
      ACCOUNT_MAIL_SMTP_HOST: "localhost",
      ACCOUNT_MAIL_SMTP_PORT: String(smtpPort),
      ACCOUNT_MAIL_SMTP_USERNAME: "synthetic-user",
      ACCOUNT_MAIL_SMTP_PASSWORD: "synthetic-password",
      ACCOUNT_MAIL_SMTP_FROM: "noreply@example.test",
      ACCOUNT_MAIL_SMTP_CONNECT_TIMEOUT_MS: "800",
      ACCOUNT_MAIL_SMTP_GREETING_TIMEOUT_MS: "800",
      ACCOUNT_MAIL_SMTP_SOCKET_TIMEOUT_MS: "1200",
    }, { tlsCa: readFileSync(certPath, "utf8") });
    registerAccountAuthRoutes(app as never, db as never, { in: () => ({ disconnectSockets() {} }) }, {
      enabled: true,
      registrationEnabled: true,
      legacyDevEnabled: false,
      campaignLinkAccessEnabled: false,
      campaignCreationEnabled: false,
      sessionTtlDays: 3,
      cookieSecure: false,
      accountCookieName,
      gameCookieName,
      csrfCookieName,
      webOrigin,
      publicUrl: "https://example.invalid",
      mailRuntimeEnabled: context.runtimeEnabled,
      mail: context.adapter,
      mailKeyring: context.keyring,
    });
    registerAccountCampaignRoutes(app as never, db as never, { in: () => ({ disconnectSockets() {} }) } as never, {
      enabled: true,
      creationEnabled: false,
      creationLimit: 1,
      sessionTtlDays: 3,
      cookieSecure: false,
      accountCookieName,
      gameCookieName,
      csrfCookieName,
      webOrigin,
    });
    const runtime = createAccountMailRuntime({
      enabled: context.runtimeEnabled,
      db: db as never,
      keyring: context.keyring,
      adapter: context.adapter,
      workerId: runtimeWorkerId,
      pollIntervalMs: 200,
      initialBackoffMs: 100,
      maxBackoffMs: 500,
    });

    let baseUrl = "";
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("LOCAL_HTTP_LISTENER_NOT_READY");
      baseUrl = `http://127.0.0.1:${address.port}`;
      expect(runtime.start()).toBe(true); // same context as routes; starts only after listener

      const capabilities = await fetch(`${baseUrl}/api/account/capabilities`);
      expect(capabilities.status).toBe(200);
      expect(await capabilities.json()).toMatchObject({ accountAuthEnabled: true, registrationEnabled: true, campaignCreationEnabled: false });
      expect(capabilities.headers.get("cache-control")).toBe("no-store");

      const request = async (path: string, payload: unknown, cookieHeader?: string) => fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { origin: webOrigin, "content-type": "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
        body: JSON.stringify(payload),
      });
      const registration = await request("/api/account/register", { email: syntheticEmail, password: syntheticPassword });
      expect(registration.status).toBe(202);
      expect(await registration.json()).toEqual({ accepted: true });
      expect(registration.headers.get("cache-control")).toBe("no-store");
      expect(await db.select().from(users)).toHaveLength(1);
      expect(await db.select().from(memberships)).toHaveLength(0);
      expect((await request("/api/account/login", { email: syntheticEmail, password: syntheticPassword })).status).toBe(401);

      await Promise.race([smtp.acceptedOnce, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SYNTHETIC_SMTP_ACCEPT_TIMEOUT")), 10_000))]);
      expect(smtp.accepted).toHaveLength(1);
      const verificationToken = extractToken(smtp.accepted[0]!);
      const persistedTokenHashes = await db.select({ tokenHash: accountActionTokens.tokenHash }).from(accountActionTokens);
      expect(persistedTokenHashes.some((row) => row.tokenHash === hashToken(verificationToken))).toBe(true);
      const confirmed = await request("/api/account/verification/confirm", { token: verificationToken });
      expect(confirmed.status).toBe(200);
      expect(await confirmed.json()).toEqual({ ok: true });
      expect((await request("/api/account/verification/confirm", { token: verificationToken })).status).toBe(400);

      const login = await request("/api/account/login", { email: syntheticEmail, password: syntheticPassword });
      expect(login.status).toBe(200);
      const accountCookies = cookies(login);
      expect(accountCookies).toContain(`${accountCookieName}=`);
      const campaigns = await fetch(`${baseUrl}/api/account/campaigns`, { headers: { cookie: accountCookies } });
      expect(campaigns.status).toBe(200);
      expect(await campaigns.json()).toEqual({ campaigns: [] });
      expect(await db.select().from(memberships)).toHaveLength(0);
      expect(smtp.accepted[0]).not.toContain(syntheticPassword);
    } finally {
      await runtime.stop();
      if (app.server.listening) await app.close();
      await database.close();
      await smtp.close();
    }
  }, 30_000);
});
