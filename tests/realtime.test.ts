import { createServer, type Server as HttpServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Server } from "socket.io";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ClientToServerEvents,
  CommandAck,
  ServerToClientEvents,
  TokenDto,
} from "../packages/contracts/src/index.js";
import * as schema from "../packages/db/src/schema.js";
import { registerRealtime } from "../apps/server/src/realtime.js";
import { hashToken } from "../apps/server/src/security.js";

const ids = {
  campaign: "10000000-0000-4000-8000-000000000001",
  gm: "10000000-0000-4000-8000-000000000002",
  player: "10000000-0000-4000-8000-000000000003",
  otherPlayer: "10000000-0000-4000-8000-000000000006",
  scene: "10000000-0000-4000-8000-000000000004",
  token: "10000000-0000-4000-8000-000000000005",
  otherToken: "10000000-0000-4000-8000-000000000007",
  extraOwnedToken: "10000000-0000-4000-8000-000000000008",
  enemyToken: "10000000-0000-4000-8000-000000000009",
};

const sessionToken = "realtime-test-session-token";
const otherSessionToken = "realtime-other-session-token";
let database: PGlite;
let httpServer: HttpServer;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
let client: Socket<ServerToClientEvents, ClientToServerEvents>;
let otherClient: Socket<ServerToClientEvents, ClientToServerEvents>;

async function migrate(database: PGlite) {
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = (
      await readFile(new URL(file, migrationsUrl), "utf8")
    ).replaceAll("--> statement-breakpoint", "");
    await database.exec(sql);
  }
}

function waitForConnection(socket: typeof client) {
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function move(
  socket: typeof client,
  input: {
    actionId: string;
    revision: number;
    x: number;
    y: number;
    tokenId?: string;
  },
) {
  return new Promise<CommandAck<TokenDto>>((resolve) => {
    socket.emit(
      "token:moved",
      {
        ...input,
        tokenId: input.tokenId ?? ids.token,
        z: 0,
        levelId: null,
      },
      resolve,
    );
  });
}

beforeEach(async () => {
  database = new PGlite();
  await migrate(database);
  await database.exec(`
    insert into campaigns (id, name) values ('${ids.campaign}', 'Realtime');
    insert into memberships (id, campaign_id, role, display_name) values
      ('${ids.gm}', '${ids.campaign}', 'GM', 'GM'),
      ('${ids.player}', '${ids.campaign}', 'PLAYER', 'Player'),
      ('${ids.otherPlayer}', '${ids.campaign}', 'PLAYER', 'Other player');
    insert into scenes (id, campaign_id, name, grid) values
      ('${ids.scene}', '${ids.campaign}', 'Active', '{"enabled":true,"size":64,"offsetX":0,"offsetY":0,"color":"#fff","opacity":0.2}');
    update campaigns set active_scene_id = '${ids.scene}' where id = '${ids.campaign}';
    insert into tokens (id, scene_id, owner_membership_id, name, x, y, visible) values
      ('${ids.token}', '${ids.scene}', '${ids.player}', 'Player token', 0, 0, true),
      ('${ids.otherToken}', '${ids.scene}', '${ids.otherPlayer}', 'Other token', 128, 128, true),
      ('${ids.extraOwnedToken}', '${ids.scene}', '${ids.player}', 'Extra owned token', 192, 192, true),
      ('${ids.enemyToken}', '${ids.scene}', null, 'Enemy token', 256, 256, true);
    insert into sessions (membership_id, token_hash, expires_at) values
      ('${ids.player}', '${hashToken(sessionToken)}', now() + interval '1 day'),
      ('${ids.otherPlayer}', '${hashToken(otherSessionToken)}', now() + interval '1 day');
  `);

  const db = drizzle(database, { schema });
  httpServer = createServer();
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerRealtime(
    ioServer,
    db as never,
    { info() {}, warn() {}, error() {}, debug() {} } as never,
  );
  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", resolve),
  );
  const address = httpServer.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_SERVER_ADDRESS");
  client = createClient(`http://127.0.0.1:${address.port}`, {
    transports: ["websocket"],
    extraHeaders: { Cookie: `arken_session=${sessionToken}` },
  });
  otherClient = createClient(`http://127.0.0.1:${address.port}`, {
    transports: ["websocket"],
    extraHeaders: { Cookie: `arken_session=${otherSessionToken}` },
  });
  await Promise.all([
    waitForConnection(client),
    waitForConnection(otherClient),
  ]);
});

afterEach(async () => {
  client.disconnect();
  otherClient.disconnect();
  await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  await new Promise<void>((resolve, reject) =>
    httpServer.close((error) => (error ? reject(error) : resolve())),
  ).catch(() => undefined);
  await database.close();
});

describe("durable realtime token commands", () => {
  it("accepts once, acknowledges a retry and rejects a stale new command", async () => {
    const actionId = crypto.randomUUID();
    const accepted = await move(client, {
      actionId,
      revision: 0,
      x: 64,
      y: 128,
    });
    expect(accepted).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { x: 64, y: 128, revision: 1 },
    });

    const duplicate = await move(client, {
      actionId,
      revision: 0,
      x: 999,
      y: 999,
    });
    expect(duplicate).toMatchObject({
      ok: true,
      status: "DUPLICATE",
      sequence: accepted.sequence,
      data: { x: 64, y: 128, revision: 1 },
    });

    const conflict = await move(client, {
      actionId: crypto.randomUUID(),
      revision: 0,
      x: 256,
      y: 256,
    });
    expect(conflict).toMatchObject({
      ok: false,
      status: "CONFLICT",
      reason: "STALE_REVISION",
      data: { x: 64, y: 128, revision: 1 },
    });

    const rows = await database.query<{
      x: number;
      y: number;
      revision: number;
    }>(`select x, y, revision from tokens where id = '${ids.token}'`);
    expect(rows.rows).toEqual([{ x: 64, y: 128, revision: 1 }]);
    const events = await database.query<{ count: number }>(
      `select count(*)::int as count from game_events where entity_id = '${ids.token}'`,
    );
    expect(events.rows[0]?.count).toBe(1);
  });

  it("rejects direct movement after the token becomes hidden", async () => {
    await database.exec(
      `update tokens set visible = false where id = '${ids.token}'`,
    );
    const result = await move(client, {
      actionId: crypto.randomUUID(),
      revision: 0,
      x: 64,
      y: 64,
    });
    expect(result).toMatchObject({
      ok: false,
      status: "FORBIDDEN",
      reason: "TOKEN_FORBIDDEN",
    });
  });

  it("rejects durable and ephemeral movement of another player's token", async () => {
    let leakedPreview = false;
    client.on("token:moving", (movement) => {
      if (movement.tokenId === ids.token) leakedPreview = true;
    });
    otherClient.emit("token:moving", {
      actionId: crypto.randomUUID(),
      tokenId: ids.token,
      x: 512,
      y: 512,
      z: 0,
      levelId: null,
      revision: 0,
    });

    const result = await move(otherClient, {
      actionId: crypto.randomUUID(),
      tokenId: ids.token,
      revision: 0,
      x: 512,
      y: 512,
    });
    expect(result).toMatchObject({
      ok: false,
      status: "FORBIDDEN",
      reason: "TOKEN_FORBIDDEN",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(leakedPreview).toBe(false);

    const rows = await database.query<{
      x: number;
      y: number;
      revision: number;
    }>(`select x, y, revision from tokens where id = '${ids.token}'`);
    expect(rows.rows).toEqual([{ x: 0, y: 0, revision: 0 }]);
  });

  it("allows multiple owned tokens but keeps an ownerless enemy GM-only", async () => {
    const extraOwned = await move(client, {
      actionId: crypto.randomUUID(),
      tokenId: ids.extraOwnedToken,
      revision: 0,
      x: 320,
      y: 320,
    });
    expect(extraOwned).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { id: ids.extraOwnedToken, x: 320, y: 320, revision: 1 },
    });

    const enemy = await move(client, {
      actionId: crypto.randomUUID(),
      tokenId: ids.enemyToken,
      revision: 0,
      x: 384,
      y: 384,
    });
    expect(enemy).toMatchObject({
      ok: false,
      status: "FORBIDDEN",
      reason: "TOKEN_FORBIDDEN",
    });
  });
});
