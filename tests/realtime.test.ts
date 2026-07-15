import { createServer, type Server as HttpServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Server } from "socket.io";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AudioStateDto,
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
  audioAsset: "20000000-0000-4000-8000-000000000001",
  tokenAsset: "20000000-0000-4000-8000-000000000002",
  mapAsset: "20000000-0000-4000-8000-000000000003",
  foreignAudioAsset: "20000000-0000-4000-8000-000000000004",
  foreignCampaign: "20000000-0000-4000-8000-000000000005",
  foreignGm: "20000000-0000-4000-8000-000000000006",
};

const sessionToken = "realtime-test-session-token";
const otherSessionToken = "realtime-other-session-token";
const gmSessionToken = "realtime-gm-session-token";
const extraPlayers = [
  [
    "10000000-0000-4000-8000-000000000010",
    "10000000-0000-4000-8000-000000000011",
    "realtime-session-3",
  ],
  [
    "10000000-0000-4000-8000-000000000012",
    "10000000-0000-4000-8000-000000000013",
    "realtime-session-4",
  ],
  [
    "10000000-0000-4000-8000-000000000014",
    "10000000-0000-4000-8000-000000000015",
    "realtime-session-5",
  ],
  [
    "10000000-0000-4000-8000-000000000016",
    "10000000-0000-4000-8000-000000000017",
    "realtime-session-6",
  ],
].map(([membershipId, tokenId, session]) => ({
  membershipId: membershipId!,
  tokenId: tokenId!,
  session: session!,
}));
let database: PGlite;
let httpServer: HttpServer;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
let client: Socket<ServerToClientEvents, ClientToServerEvents>;
let otherClient: Socket<ServerToClientEvents, ClientToServerEvents>;
let gmClient: Socket<ServerToClientEvents, ClientToServerEvents>;
let extraClients: Array<Socket<ServerToClientEvents, ClientToServerEvents>>;

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

function waitForPresence(
  socket: typeof gmClient,
  membershipId: string,
  online: boolean,
) {
  return new Promise<Parameters<ServerToClientEvents["presence:updated"]>[0]>(
    (resolve) => {
      const listener: ServerToClientEvents["presence:updated"] = (presence) => {
        if (
          presence.some(
            (member) =>
              member.membershipId === membershipId && member.online === online,
          )
        ) {
          socket.off("presence:updated", listener);
          resolve(presence);
        }
      };
      socket.on("presence:updated", listener);
    },
  );
}

function newPlayerClient(token = sessionToken) {
  const address = httpServer.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_SERVER_ADDRESS");
  return createClient<ServerToClientEvents, ClientToServerEvents>(
    `http://127.0.0.1:${address.port}`,
    {
      transports: ["websocket"],
      extraHeaders: { Cookie: `arken_session=${token}` },
    },
  );
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

function setAudio(
  socket: typeof gmClient,
  assetId: string | null,
  actionId = crypto.randomUUID(),
) {
  return new Promise<CommandAck<AudioStateDto>>((resolve) => {
    socket.emit(
      "audio:set",
      {
        actionId,
        assetId,
        playing: assetId !== null,
        positionSeconds: 0,
        loop: false,
        startedAt: null,
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
      ('${ids.otherPlayer}', '${hashToken(otherSessionToken)}', now() + interval '1 day'),
      ('${ids.gm}', '${hashToken(gmSessionToken)}', now() + interval '1 day');
  `);
  for (const [index, player] of extraPlayers.entries()) {
    await database.exec(`
      insert into memberships (id, campaign_id, role, display_name)
      values ('${player.membershipId}', '${ids.campaign}', 'PLAYER', 'Player ${index + 3}');
      insert into tokens (id, scene_id, owner_membership_id, name, x, y, visible)
      values ('${player.tokenId}', '${ids.scene}', '${player.membershipId}', 'Token ${index + 3}', ${320 + index * 64}, 128, true);
      insert into sessions (membership_id, token_hash, expires_at)
      values ('${player.membershipId}', '${hashToken(player.session)}', now() + interval '1 day');
    `);
  }

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
  gmClient = createClient(`http://127.0.0.1:${address.port}`, {
    transports: ["websocket"],
    extraHeaders: { Cookie: `arken_session=${gmSessionToken}` },
  });
  extraClients = extraPlayers.map((player) =>
    createClient(`http://127.0.0.1:${address.port}`, {
      transports: ["websocket"],
      extraHeaders: { Cookie: `arken_session=${player.session}` },
    }),
  );
  await Promise.all([
    waitForConnection(client),
    waitForConnection(otherClient),
    waitForConnection(gmClient),
    ...extraClients.map(waitForConnection),
  ]);
});

afterEach(async () => {
  client.disconnect();
  otherClient.disconnect();
  gmClient.disconnect();
  for (const socket of extraClients) socket.disconnect();
  await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  await new Promise<void>((resolve, reject) =>
    httpServer.close((error) => (error ? reject(error) : resolve())),
  ).catch(() => undefined);
  await database.close();
});

describe("GM presence", () => {
  it("emits the campaign presence matrix only to GM sockets", async () => {
    let playerEvents = 0;
    client.on("presence:updated", () => playerEvents++);
    const gmUpdate = waitForPresence(gmClient, ids.player, true);
    const duplicate = newPlayerClient();
    await waitForConnection(duplicate);
    const presence = await gmUpdate;

    expect(
      presence.find((member) => member.membershipId === ids.player),
    ).toEqual({ membershipId: ids.player, online: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(playerEvents).toBe(0);
    duplicate.disconnect();
  });

  it("keeps a member online while any socket remains connected", async () => {
    const duplicate = newPlayerClient();
    await waitForConnection(duplicate);

    client.disconnect();
    const stillOnline = await waitForPresence(gmClient, ids.player, true);
    expect(
      stillOnline.find((member) => member.membershipId === ids.player),
    ).toEqual({ membershipId: ids.player, online: true });

    const offline = waitForPresence(gmClient, ids.player, false);
    duplicate.disconnect();
    await expect(offline).resolves.toEqual(
      expect.arrayContaining([{ membershipId: ids.player, online: false }]),
    );
  });

  it("cancels a pending offline transition when the member reconnects", async () => {
    let offlineEvents = 0;
    gmClient.on("presence:updated", (presence) => {
      if (
        presence.some(
          (member) => member.membershipId === ids.player && !member.online,
        )
      )
        offlineEvents++;
    });

    client.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const reconnected = waitForConnection(client);
    client.connect();
    await reconnected;
    await new Promise((resolve) => setTimeout(resolve, 850));

    expect(offlineEvents).toBe(0);
  });
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

  it("keeps GM-layer preview, commits and conflict DTOs out of player rooms", async () => {
    await database.exec(
      `update tokens set layer = 'GM' where id = '${ids.token}'`,
    );
    let leakedPreview = false;
    let leakedCommit = false;
    client.on("token:moving", (movement) => {
      if (movement.tokenId === ids.token) leakedPreview = true;
    });
    client.on("token:moved", (event) => {
      if (event.data.id === ids.token) leakedCommit = true;
    });
    gmClient.emit("token:moving", {
      actionId: crypto.randomUUID(),
      tokenId: ids.token,
      x: 40,
      y: 40,
      z: 0,
      levelId: null,
      revision: 0,
    });
    const playerAttempt = await move(client, {
      actionId: crypto.randomUUID(),
      revision: 99,
      x: 50,
      y: 50,
    });
    expect(playerAttempt).toMatchObject({
      ok: false,
      status: "FORBIDDEN",
      reason: "TOKEN_FORBIDDEN",
    });
    expect(playerAttempt).not.toHaveProperty("data");
    const gmCommit = await move(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 0,
      x: 60,
      y: 60,
    });
    expect(gmCommit).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { layer: "GM" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect({ leakedPreview, leakedCommit }).toEqual({
      leakedPreview: false,
      leakedCommit: false,
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

  it("keeps six simultaneous players authoritative through reconnect and resync", async () => {
    const players = [
      { socket: client, tokenId: ids.token },
      { socket: otherClient, tokenId: ids.otherToken },
      ...extraPlayers.map((player, index) => ({
        socket: extraClients[index]!,
        tokenId: player.tokenId,
      })),
    ];
    const accepted = await Promise.all([
      ...players.map(({ socket, tokenId }, index) =>
        move(socket, {
          actionId: crypto.randomUUID(),
          tokenId,
          revision: 0,
          x: 640 + index * 64,
          y: 384,
        }),
      ),
      move(gmClient, {
        actionId: crypto.randomUUID(),
        tokenId: ids.enemyToken,
        revision: 0,
        x: 1024,
        y: 512,
      }),
    ]);
    expect(accepted.every((result) => result.status === "ACCEPTED")).toBe(true);

    const forbidden = await move(extraClients[0]!, {
      actionId: crypto.randomUUID(),
      tokenId: ids.otherToken,
      revision: 1,
      x: 999,
      y: 999,
    });
    expect(forbidden).toMatchObject({ ok: false, status: "FORBIDDEN" });

    const reconnecting = extraClients[1]!;
    reconnecting.disconnect();
    const snapshotAfterReconnect = new Promise<
      Parameters<ServerToClientEvents["game:snapshot"]>[0]
    >((resolve) => reconnecting.once("game:snapshot", resolve));
    const reconnected = waitForConnection(reconnecting);
    reconnecting.connect();
    await reconnected;
    const snapshot = await snapshotAfterReconnect;
    expect(
      snapshot.tokens.find((token) => token.id === extraPlayers[1]!.tokenId),
    ).toMatchObject({ y: 384, revision: 1 });

    const resynced = new Promise<
      Parameters<ServerToClientEvents["game:snapshot"]>[0]
    >((resolve) => reconnecting.once("game:snapshot", resolve));
    reconnecting.emit("game:resync", 0);
    const fullSnapshot = await resynced;
    expect(fullSnapshot.snapshotVersion).toBeGreaterThanOrEqual(7);

    const rows = await database.query<{ count: number }>(
      "select count(*)::int as count from game_events where type = 'TOKEN_MOVED'",
    );
    expect(rows.rows[0]?.count).toBe(7);
  });

  it("validates audio assets transactionally without leaking rejected state", async () => {
    await database.exec(`
      insert into campaigns (id, name) values ('${ids.foreignCampaign}', 'Foreign');
      insert into memberships (id, campaign_id, role, display_name)
      values ('${ids.foreignGm}', '${ids.foreignCampaign}', 'GM', 'Foreign GM');
      insert into assets
        (id, campaign_id, uploaded_by_membership_id, kind, name, storage_key, mime_type, size_bytes)
      values
        ('${ids.audioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Track', 'test/audio', 'audio/mpeg', 10),
        ('${ids.tokenAsset}', '${ids.campaign}', '${ids.gm}', 'TOKEN', 'Token', 'test/token', 'image/png', 10),
        ('${ids.mapAsset}', '${ids.campaign}', '${ids.gm}', 'MAP', 'Map', 'test/map', 'image/png', 10),
        ('${ids.foreignAudioAsset}', '${ids.foreignCampaign}', '${ids.foreignGm}', 'AUDIO', 'Foreign', 'test/foreign-audio', 'audio/mpeg', 10);
    `);

    let broadcasts = 0;
    client.on("audio:state", () => broadcasts++);

    expect(await setAudio(gmClient, ids.foreignAudioAsset)).toMatchObject({
      ok: false,
      status: "INVALID",
      reason: "ASSET_NOT_FOUND",
    });
    for (const id of [ids.tokenAsset, ids.mapAsset]) {
      expect(await setAudio(gmClient, id)).toMatchObject({
        ok: false,
        status: "INVALID",
        reason: "ASSET_NOT_FOUND",
      });
    }

    const rejectedRows = await database.query<{ count: number }>(`
      select (
        (select count(*) from audio_states) +
        (select count(*) from game_events where type = 'AUDIO_STATE_SET')
      )::int as count
    `);
    expect(rejectedRows.rows[0]?.count).toBe(0);
    expect(broadcasts).toBe(0);

    expect(await setAudio(gmClient, ids.audioAsset)).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { assetId: ids.audioAsset, playing: true },
    });
    expect(await setAudio(gmClient, null)).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { assetId: null, playing: false },
    });

    const snapshotPromise = new Promise<
      Parameters<ServerToClientEvents["game:snapshot"]>[0]
    >((resolve) => client.once("game:snapshot", resolve));
    client.emit("game:resync", 0);
    const snapshot = await snapshotPromise;
    expect(snapshot.audio?.assetId).toBeNull();
    expect(
      snapshot.assets.some((asset) => asset.id === ids.foreignAudioAsset),
    ).toBe(false);
  });
});
