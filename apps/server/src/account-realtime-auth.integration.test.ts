import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { Server } from "socket.io";
import { io as socketClient, type Socket } from "socket.io-client";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { accountSessions, campaigns, memberships, sessions, users } from "@arken/db";
import { createTestMailOutbox, createTestMailKeyring } from "./account-mail.js";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";
import { registerRealtime } from "./realtime.js";
import { hashToken } from "./security.js";

const origin = "http://localhost:5173";
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: ReturnType<typeof Fastify>;
let realtime: Server;
let sockets: Socket[];

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  app = Fastify({ logger: false });
  await app.register(cookie);
  realtime = new Server(app.server);
  sockets = [];
  registerRealtime(realtime as never, db as never, app.log, { buildSnapshot: async () => ({}) as never });
  const outbox = createTestMailOutbox();
  registerAccountAuthRoutes(app as never, db as never, realtime as never, {
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
  await app.listen({ host: "127.0.0.1", port: 0 });
});

afterEach(async () => {
  for (const socket of sockets) socket.disconnect();
  await realtime.close();
  await app.close();
  await database.close();
});

async function connectGame(token: string) {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("HTTP_SERVER_NOT_LISTENING");
  const socket = socketClient(`http://127.0.0.1:${address.port}`, {
    transports: ["websocket"],
    extraHeaders: { cookie: `arken_session=${token}` },
    reconnection: false,
    timeout: 2500,
  });
  sockets.push(socket);
  return socket;
}

async function waitFor<T>(socket: Socket, event: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 3000);
    socket.once(event, (value: T) => { clearTimeout(timeout); resolve(value); });
    socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
  });
}

describe("account-backed realtime authorization", () => {
  it("disconnects an already-authenticated game socket when account logout revokes its parent", async () => {
    const [user] = await db.insert(users).values({
      emailNormalized: "owner@example.invalid", emailDisplay: "owner@example.invalid",
      passwordHash: "$scrypt$test$non-login-fixture", verifiedAt: new Date(),
    }).returning();
    const [campaign] = await db.insert(campaigns).values({ name: "Socket gate" }).returning();
    const [membership] = await db.insert(memberships).values({ campaignId: campaign!.id, userId: user!.id, role: "GM", displayName: "Owner" }).returning();
    const accountToken = `account-${crypto.randomUUID()}`;
    const csrf = `csrf-${crypto.randomUUID()}`;
    const [parent] = await db.insert(accountSessions).values({
      userId: user!.id, tokenHash: hashToken(accountToken), csrfHash: hashToken(csrf),
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    const gameToken = `game-${crypto.randomUUID()}`;
    const [gameSession] = await db.insert(sessions).values({
      membershipId: membership!.id, accountSessionId: parent!.id, authSource: "ACCOUNT",
      tokenHash: hashToken(gameToken), expiresAt: new Date(Date.now() + 60_000),
    }).returning();

    const socket = await connectGame(gameToken);
    await waitFor(socket, "connect");
    const disconnected = waitFor<string>(socket, "disconnect");
    const response = await fetch(`http://127.0.0.1:${(app.server.address() as import("node:net").AddressInfo).port}/api/account/logout`, {
      method: "POST",
      headers: { origin, cookie: `arken_account=${accountToken}; arken_account_csrf=${csrf}`, "x-csrf-token": csrf },
    });
    expect(response.status).toBe(200);
    await disconnected;
    expect(await db.select().from(sessions).where(and(eq(sessions.id, gameSession!.id), eq(sessions.expiresAt, new Date(0))))).toHaveLength(1);
  });

  it("rejects a foreign-account membership before websocket connection", async () => {
    const [owner] = await db.insert(users).values({ emailNormalized: "owner2@example.invalid", emailDisplay: "owner2@example.invalid", passwordHash: "$scrypt$test$unused", verifiedAt: new Date() }).returning();
    const [other] = await db.insert(users).values({ emailNormalized: "other2@example.invalid", emailDisplay: "other2@example.invalid", passwordHash: "$scrypt$test$unused", verifiedAt: new Date() }).returning();
    const [campaign] = await db.insert(campaigns).values({ name: "Foreign socket" }).returning();
    const [membership] = await db.insert(memberships).values({ campaignId: campaign!.id, userId: other!.id, role: "PLAYER", displayName: "Other" }).returning();
    const [parent] = await db.insert(accountSessions).values({ userId: owner!.id, tokenHash: hashToken("foreign parent"), csrfHash: hashToken("foreign csrf"), expiresAt: new Date(Date.now() + 60_000) }).returning();
    const gameToken = `foreign-game-${crypto.randomUUID()}`;
    await db.insert(sessions).values({ membershipId: membership!.id, accountSessionId: parent!.id, authSource: "ACCOUNT", tokenHash: hashToken(gameToken), expiresAt: new Date(Date.now() + 60_000) });
    const socket = await connectGame(gameToken);
    const error = await new Promise<Error>((resolve) => socket.once("connect_error", resolve));
    expect(error.message).toBe("AUTH_REQUIRED");
    expect(socket.connected).toBe(false);
  });
});
