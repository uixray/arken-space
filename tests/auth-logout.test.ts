import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../packages/contracts/src/index.js";
import * as schema from "../packages/db/src/schema.js";
import { env } from "../apps/server/src/env.js";
import { registerRealtime } from "../apps/server/src/realtime.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import { ensureSeed } from "../apps/server/src/seed.js";

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
let baseUrl: string;
const sockets: Array<Socket<ServerToClientEvents, ClientToServerEvents>> = [];

function connectSession(token: string) {
  const socket = createClient<ServerToClientEvents, ClientToServerEvents>(
    baseUrl,
    {
      transports: ["websocket"],
      extraHeaders: { Cookie: `${env.SESSION_COOKIE_NAME}=${token}` },
      reconnection: false,
    },
  );
  sockets.push(socket);
  return new Promise<typeof socket>((resolve, reject) => {
    socket.once("game:snapshot", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

beforeEach(async () => {
  database = new PGlite();
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  db = drizzle(database, { schema });
  await ensureSeed(db as never);
  app = Fastify();
  await app.register(cookie);
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(app.server);
  registerRealtime(
    ioServer,
    db as never,
    { info() {}, warn() {}, error() {}, debug() {} } as never,
  );
  registerRoutes(app, db as never, ioServer);
  await app.ready();
  baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  ioServer.close();
  await app.close();
  await database.close();
});

describe("logout session invalidation", () => {
  it("cannot complete a socket setup that races with deletion of its exact session", async () => {
    const [campaign] = await db.select().from(schema.campaigns).limit(1);
    if (!campaign) throw new Error("SEED_CAMPAIGN_MISSING");
    const [player] = await db
      .insert(schema.memberships)
      .values({
        campaignId: campaign.id,
        role: "PLAYER",
        displayName: "Connection race player",
      })
      .returning();
    if (!player) throw new Error("PLAYER_CREATE_FAILED");

    const token = "c".repeat(40);
    const [session] = await db
      .insert(schema.sessions)
      .values({
        membershipId: player.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!session) throw new Error("SESSION_CREATE_FAILED");

    const adapter = ioServer.of("/").adapter;
    const originalAddAll = adapter.addAll.bind(adapter);
    let sessionJoinStarted!: () => void;
    const sessionJoinAttempted = new Promise<void>((resolve) => {
      sessionJoinStarted = resolve;
    });
    let releaseSessionJoin!: () => void;
    const releaseSessionJoinPromise = new Promise<void>((resolve) => {
      releaseSessionJoin = resolve;
    });
    adapter.addAll = ((socketId, rooms) => {
      if (rooms.has(`session:${session.id}`)) {
        sessionJoinStarted();
        return releaseSessionJoinPromise.then(() =>
          originalAddAll(socketId, rooms),
        );
      }
      return originalAddAll(socketId, rooms);
    }) as typeof adapter.addAll;

    const socket = createClient<ServerToClientEvents, ClientToServerEvents>(
      baseUrl,
      {
        transports: ["websocket"],
        extraHeaders: { Cookie: `${env.SESSION_COOKIE_NAME}=${token}` },
        reconnection: false,
      },
    );
    sockets.push(socket);
    let snapshotCount = 0;
    socket.on("game:snapshot", () => {
      snapshotCount += 1;
    });
    const disconnected = new Promise<void>((resolve) =>
      socket.once("disconnect", () => resolve()),
    );

    await sessionJoinAttempted;
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${token}` },
    });
    releaseSessionJoin();

    expect(response.statusCode, response.body).toBe(200);
    await expect(disconnected).resolves.toBeUndefined();
    expect(snapshotCount).toBe(0);
    expect(
      await db
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, session.id)),
    ).toEqual([]);
  });

  it("disconnects a socket before it can handle an event from a deleted session", async () => {
    const [campaign] = await db.select().from(schema.campaigns).limit(1);
    if (!campaign?.activeSceneId) throw new Error("SEED_SCENE_MISSING");
    const [player] = await db
      .insert(schema.memberships)
      .values({
        campaignId: campaign.id,
        role: "PLAYER",
        displayName: "Stale event player",
      })
      .returning();
    if (!player) throw new Error("PLAYER_CREATE_FAILED");

    const token = "e".repeat(40);
    const [session] = await db
      .insert(schema.sessions)
      .values({
        membershipId: player.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!session) throw new Error("SESSION_CREATE_FAILED");

    const socket = await connectSession(token);
    const disconnected = new Promise<void>((resolve) =>
      socket.once("disconnect", () => resolve()),
    );
    await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));

    socket.emit("ruler:clear", { sceneId: campaign.activeSceneId });

    await expect(disconnected).resolves.toBeUndefined();
  });

  it("disconnects only sockets bound to the exact deleted session", async () => {
    const [campaign] = await db.select().from(schema.campaigns).limit(1);
    if (!campaign) throw new Error("SEED_CAMPAIGN_MISSING");
    const [player] = await db
      .insert(schema.memberships)
      .values({
        campaignId: campaign.id,
        role: "PLAYER",
        displayName: "Shared device player",
      })
      .returning();
    if (!player) throw new Error("PLAYER_CREATE_FAILED");

    const loggedOutToken = "l".repeat(40);
    const retainedToken = "r".repeat(40);
    const [loggedOutSession, retainedSession] = await db
      .insert(schema.sessions)
      .values([
        {
          membershipId: player.id,
          tokenHash: hashToken(loggedOutToken),
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          membershipId: player.id,
          tokenHash: hashToken(retainedToken),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ])
      .returning();
    if (!loggedOutSession || !retainedSession)
      throw new Error("SESSION_CREATE_FAILED");

    const [loggedOutSocket, secondLoggedOutSocket, retainedSocket] =
      await Promise.all([
        connectSession(loggedOutToken),
        connectSession(loggedOutToken),
        connectSession(retainedToken),
      ]);
    const firstDisconnected = new Promise<void>((resolve) =>
      loggedOutSocket.once("disconnect", () => resolve()),
    );
    const secondDisconnected = new Promise<void>((resolve) =>
      secondLoggedOutSocket.once("disconnect", () => resolve()),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: `${env.SESSION_COOKIE_NAME}=${loggedOutToken}`,
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await expect(
      Promise.all([firstDisconnected, secondDisconnected]),
    ).resolves.toEqual([undefined, undefined]);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(retainedSocket.connected).toBe(true);

    const remaining = await db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.membershipId, player.id));
    expect(remaining).toEqual([{ id: retainedSession.id }]);

    const deletedSessionBootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: {
        cookie: `${env.SESSION_COOKIE_NAME}=${loggedOutToken}`,
      },
    });
    expect(deletedSessionBootstrap.statusCode).toBe(401);
    const retainedSessionBootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: {
        cookie: `${env.SESSION_COOKIE_NAME}=${retainedToken}`,
      },
    });
    expect(retainedSessionBootstrap.statusCode).toBe(200);
  });
});
