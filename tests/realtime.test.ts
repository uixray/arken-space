import { createServer, type Server as HttpServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Server } from "socket.io";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AudioStateDto,
  AudioTrackDto,
  ClientToServerEvents,
  CommandAck,
  ServerToClientEvents,
  TokenDto,
} from "../packages/contracts/src/index.js";
import * as schema from "../packages/db/src/schema.js";
import { registerRealtime } from "../apps/server/src/realtime.js";
import { sessionIsActive as realSessionIsActive } from "../apps/server/src/auth.js";
import { buildSnapshot as realBuildSnapshot } from "../apps/server/src/snapshot.js";
import { hashToken } from "../apps/server/src/security.js";

const ids = {
  campaign: "10000000-0000-4000-8000-000000000001",
  gm: "10000000-0000-4000-8000-000000000002",
  player: "10000000-0000-4000-8000-000000000003",
  otherPlayer: "10000000-0000-4000-8000-000000000006",
  scene: "10000000-0000-4000-8000-000000000004",
  inactiveScene: "10000000-0000-4000-8000-000000000018",
  inactiveScene2: "10000000-0000-4000-8000-000000000019",
  token: "10000000-0000-4000-8000-000000000005",
  otherToken: "10000000-0000-4000-8000-000000000007",
  extraOwnedToken: "10000000-0000-4000-8000-000000000008",
  enemyToken: "10000000-0000-4000-8000-000000000009",
  audioAsset: "20000000-0000-4000-8000-000000000001",
  secondAudioAsset: "20000000-0000-4000-8000-000000000007",
  tokenAsset: "20000000-0000-4000-8000-000000000002",
  mapAsset: "20000000-0000-4000-8000-000000000003",
  foreignAudioAsset: "20000000-0000-4000-8000-000000000004",
  foreignCampaign: "20000000-0000-4000-8000-000000000005",
  foreignGm: "20000000-0000-4000-8000-000000000006",
  foreignScene: "20000000-0000-4000-8000-000000000008",
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
let sessionCheckOverride: typeof realSessionIsActive | undefined;
let snapshotOverride: typeof realBuildSnapshot | undefined;
let realtimeWarnings: Array<{ details: unknown; message?: string }>;

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

function newPlayerClient(token = sessionToken, autoConnect = true) {
  const address = httpServer.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_SERVER_ADDRESS");
  return createClient<ServerToClientEvents, ClientToServerEvents>(
    `http://127.0.0.1:${address.port}`,
    {
      transports: ["websocket"],
      extraHeaders: { Cookie: `arken_session=${token}` },
      autoConnect,
    },
  );
}

type SnapshotPayload = Parameters<ServerToClientEvents["game:snapshot"]>[0];

function waitForSnapshot(
  socket: typeof client,
  predicate: (snapshot: SnapshotPayload) => boolean = () => true,
  timeoutMs = 5_000,
) {
  return new Promise<SnapshotPayload>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("game:snapshot", listener);
      reject(new Error("SNAPSHOT_TIMEOUT"));
    }, timeoutMs);
    const listener: ServerToClientEvents["game:snapshot"] = (snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timeout);
      socket.off("game:snapshot", listener);
      resolve(snapshot);
    };
    socket.on("game:snapshot", listener);
  });
}

function emitRawSceneView(socket: typeof client, view: unknown) {
  (
    socket as unknown as {
      emit(event: "scene:view", payload: unknown): void;
    }
  ).emit("scene:view", view);
}

async function settleSnapshots(socket: typeof client) {
  const snapshot = waitForSnapshot(socket);
  socket.emit("game:resync", 0);
  await snapshot;
  // If the promise observed a still-pending connection snapshot, give the
  // explicit resync time to arrive before a silence assertion starts.
  await new Promise((resolve) => setTimeout(resolve, 40));
}

async function expectSceneViewSilence(
  socket: typeof client,
  view: unknown,
  waitMs = 100,
) {
  let snapshots = 0;
  let errors = 0;
  const onSnapshot = () => snapshots++;
  const onError = () => errors++;
  socket.on("game:snapshot", onSnapshot);
  socket.on("server:error", onError);
  emitRawSceneView(socket, view);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  socket.off("game:snapshot", onSnapshot);
  socket.off("server:error", onError);
  expect({ snapshots, errors }).toEqual({ snapshots: 0, errors: 0 });
  expect(socket.connected).toBe(true);
}

async function waitForRealtimeWarning(message: string, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const warning = realtimeWarnings.find((item) => item.message === message);
    if (warning) return warning;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`REALTIME_WARNING_TIMEOUT:${message}`);
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

const WHOLE_ACTIVE_SCENE = {
  x: -4096,
  y: -4096,
  width: 16384,
  height: 16384,
};

async function appendWholeSceneFog(operation: "REVEAL" | "COVER") {
  const geometry = JSON.stringify({ type: "RECT", ...WHOLE_ACTIVE_SCENE });
  const bbox = JSON.stringify(WHOLE_ACTIVE_SCENE);
  await database.exec(`
    insert into fog_reveals
      (scene_id, x, y, width, height, operation, shape, geometry, bbox)
    values
      ('${ids.scene}', ${WHOLE_ACTIVE_SCENE.x}, ${WHOLE_ACTIVE_SCENE.y},
       ${WHOLE_ACTIVE_SCENE.width}, ${WHOLE_ACTIVE_SCENE.height}, '${operation}',
       'RECT', '${geometry}'::jsonb, '${bbox}'::jsonb);
  `);
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

function ping(socket: typeof gmClient, sceneId: string) {
  return new Promise<{ ok: boolean; reason?: string }>((resolve) => {
    socket.emit("map:ping", { sceneId, x: 32, y: 48 }, resolve);
  });
}

function audioCommand(
  socket: typeof gmClient,
  input:
    | {
        actionId: string;
        revision: number;
        command: "SELECT";
        assetId: string | null;
      }
    | { actionId: string; revision: number; command: "PLAY" | "PAUSE" | "END" }
    | {
        actionId: string;
        revision: number;
        command: "SEEK";
        positionSeconds: number;
      }
    | {
        actionId: string;
        revision: number;
        command: "SET_LOOP";
        loop: boolean;
      },
) {
  return new Promise<CommandAck<AudioStateDto>>((resolve) => {
    socket.emit("audio:set", input, resolve);
  });
}

function audioTrackCommand(
  socket: typeof gmClient,
  input:
    | { actionId: string; command: "ADD_TRACK"; assetId: string | null }
    | {
        actionId: string;
        revision: number;
        command: "REMOVE_TRACK";
        trackId: string;
      }
    | {
        actionId: string;
        revision: number;
        command: "SELECT";
        trackId: string;
        assetId: string | null;
      }
    | {
        actionId: string;
        revision: number;
        command: "PLAY" | "PAUSE" | "END";
        trackId: string;
      }
    | {
        actionId: string;
        revision: number;
        command: "SEEK";
        trackId: string;
        positionSeconds: number;
      }
    | {
        actionId: string;
        revision: number;
        command: "SET_LOOP";
        trackId: string;
        loop: boolean;
      }
    | {
        actionId: string;
        revision: number;
        command: "SET_MIX_VOLUME";
        trackId: string;
        mixVolume: number;
      },
) {
  return new Promise<CommandAck<AudioTrackDto>>((resolve) => {
    socket.emit("audio:track:set", input, resolve);
  });
}

beforeEach(async () => {
  sessionCheckOverride = undefined;
  snapshotOverride = undefined;
  realtimeWarnings = [];
  database = new PGlite();
  await migrate(database);
  await database.exec(`
    insert into campaigns (id, name) values ('${ids.campaign}', 'Realtime');
    insert into memberships (id, campaign_id, role, display_name) values
      ('${ids.gm}', '${ids.campaign}', 'GM', 'GM'),
      ('${ids.player}', '${ids.campaign}', 'PLAYER', 'Player'),
      ('${ids.otherPlayer}', '${ids.campaign}', 'PLAYER', 'Other player');
    insert into scenes (id, campaign_id, name, grid) values
      ('${ids.scene}', '${ids.campaign}', 'Active', '{"enabled":true,"size":64,"offsetX":0,"offsetY":0,"color":"#fff","opacity":0.2}'),
      ('${ids.inactiveScene}', '${ids.campaign}', 'GM draft', '{"enabled":true,"size":64,"offsetX":0,"offsetY":0,"color":"#fff","opacity":0.2}');
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
  // Realtime tests historically model an open tabletop. Keep that explicit so
  // campaign-broadcast expectations do not accidentally rely on bypassing the
  // canonical default fog (no reveal means fully covered).
  await appendWholeSceneFog("REVEAL");
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
    {
      info() {},
      warn(details: unknown, message?: string) {
        realtimeWarnings.push({ details, message });
      },
      error() {},
      debug() {},
    } as never,
    {
      sessionIsActive: (...args) =>
        (sessionCheckOverride ?? realSessionIsActive)(...args),
      buildSnapshot: (...args) =>
        (snapshotOverride ?? realBuildSnapshot)(...args),
    },
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
  const initialSnapshots = [client, otherClient, gmClient, ...extraClients].map(
    (socket) => waitForSnapshot(socket),
  );
  await Promise.all([
    waitForConnection(client),
    waitForConnection(otherClient),
    waitForConnection(gmClient),
    ...extraClients.map(waitForConnection),
    ...initialSnapshots,
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

describe("scene:view lifecycle", () => {
  const activeDrawing = "30000000-0000-4000-8000-000000000001";
  const inactiveDrawing = "30000000-0000-4000-8000-000000000002";
  const secondInactiveDrawing = "30000000-0000-4000-8000-000000000003";
  const inactiveFog = "30000000-0000-4000-8000-000000000004";
  const secondInactiveFog = "30000000-0000-4000-8000-000000000005";

  beforeEach(async () => {
    await database.exec(`
      insert into drawings (id, scene_id, author_membership_id, points) values
        ('${activeDrawing}', '${ids.scene}', '${ids.gm}', '[0,0,10,10]'),
        ('${inactiveDrawing}', '${ids.inactiveScene}', '${ids.gm}', '[20,20,30,30]');
      insert into fog_reveals
        (id, scene_id, x, y, width, height, geometry, bbox)
      values
        ('${inactiveFog}', '${ids.inactiveScene}', 0, 0, 10, 10,
         '{"type":"RECT","x":0,"y":0,"width":10,"height":10}',
         '{"x":0,"y":0,"width":10,"height":10}');
    `);
  });

  it("keeps the initial active canvas, then restores the GM view on resync and reconnect", async () => {
    const freshGm = newPlayerClient(gmSessionToken, false);
    try {
      const initialSnapshot = waitForSnapshot(freshGm);
      const connected = waitForConnection(freshGm);
      freshGm.connect();
      await connected;

      const initial = await initialSnapshot;
      expect(initial.drawings.map((drawing) => drawing.id)).toContain(
        activeDrawing,
      );
      expect(initial.drawings.map((drawing) => drawing.id)).not.toContain(
        inactiveDrawing,
      );
      expect(initial.fogReveals.map((fog) => fog.id)).not.toContain(
        inactiveFog,
      );

      const viewedSnapshot = waitForSnapshot(freshGm, (snapshot) =>
        snapshot.drawings.some((drawing) => drawing.id === inactiveDrawing),
      );
      freshGm.emit("scene:view", { sceneId: ids.inactiveScene });
      const viewed = await viewedSnapshot;
      expect(viewed.drawings.map((drawing) => drawing.id)).toEqual(
        expect.arrayContaining([activeDrawing, inactiveDrawing]),
      );
      expect(viewed.fogReveals.map((fog) => fog.id)).toContain(inactiveFog);

      const resyncedSnapshot = waitForSnapshot(freshGm, (snapshot) =>
        snapshot.drawings.some((drawing) => drawing.id === inactiveDrawing),
      );
      freshGm.emit("game:resync", viewed.snapshotVersion);
      const resynced = await resyncedSnapshot;
      expect(resynced.fogReveals.map((fog) => fog.id)).toContain(inactiveFog);

      // This is the same lifecycle used by App.tsx: one current-view emit on
      // every Socket.IO connect, including a transport reconnect where the
      // server-side socket data starts empty again.
      const restoreView = () =>
        freshGm.emit("scene:view", { sceneId: ids.inactiveScene });
      freshGm.on("connect", restoreView);
      freshGm.disconnect();
      const reconnected = waitForConnection(freshGm);
      const restoredSnapshot = waitForSnapshot(freshGm, (snapshot) =>
        snapshot.drawings.some((drawing) => drawing.id === inactiveDrawing),
      );
      freshGm.connect();
      await reconnected;
      const restored = await restoredSnapshot;
      expect(restored.fogReveals.map((fog) => fog.id)).toContain(inactiveFog);
      freshGm.off("connect", restoreView);
    } finally {
      freshGm.disconnect();
    }
  });

  it("rejects malformed, foreign and player view requests without an existence oracle", async () => {
    await database.exec(`
      insert into campaigns (id, name)
      values ('${ids.foreignCampaign}', 'Foreign scene campaign');
      insert into scenes (id, campaign_id, name, grid)
      values ('${ids.foreignScene}', '${ids.foreignCampaign}', 'Foreign',
        '{"enabled":true,"size":64,"offsetX":0,"offsetY":0,"color":"#fff","opacity":0.2}');
    `);
    await Promise.all([settleSnapshots(gmClient), settleSnapshots(client)]);

    await expectSceneViewSilence(gmClient, { sceneId: "not-a-uuid" });
    await expectSceneViewSilence(gmClient, {
      sceneId: ids.inactiveScene,
      extra: true,
    });
    // An existing foreign UUID and an unknown UUID deliberately have exactly
    // the same wire outcome: no snapshot, error, acknowledgement or disconnect.
    await expectSceneViewSilence(gmClient, { sceneId: ids.foreignScene });
    await expectSceneViewSilence(gmClient, {
      sceneId: "90000000-0000-4000-8000-000000000099",
    });
    await expectSceneViewSilence(client, { sceneId: ids.inactiveScene });

    const gmResync = waitForSnapshot(gmClient);
    gmClient.emit("game:resync", 0);
    const gmSnapshot = await gmResync;
    expect(gmSnapshot.drawings.map((drawing) => drawing.id)).not.toContain(
      inactiveDrawing,
    );
  });

  it("catches post-setup snapshot failures and keeps the last delivered view authoritative", async () => {
    await settleSnapshots(gmClient);
    let emittedSnapshots = 0;
    const countSnapshot = () => emittedSnapshots++;
    gmClient.on("game:snapshot", countSnapshot);

    const rejectNextSnapshot = () => {
      let observeAttempt!: () => void;
      const attempted = new Promise<void>((resolve) => {
        observeAttempt = resolve;
      });
      snapshotOverride = async () => {
        observeAttempt();
        throw new Error(`private scene ${ids.inactiveScene}`);
      };
      return attempted;
    };

    const sceneAttempted = rejectNextSnapshot();
    gmClient.emit("scene:view", { sceneId: ids.inactiveScene });
    await sceneAttempted;
    const sceneWarning = await waitForRealtimeWarning(
      "realtime.scene_view_failed",
    );
    snapshotOverride = undefined;
    expect(emittedSnapshots).toBe(0);
    expect(JSON.stringify(sceneWarning.details)).not.toContain(
      ids.inactiveScene,
    );
    expect(gmClient.connected).toBe(true);

    // The failed view was rolled back to the broadcast scene. A healthy
    // resync must not inherit its inactive canvas.
    gmClient.off("game:snapshot", countSnapshot);
    const rolledBackSnapshot = waitForSnapshot(gmClient);
    gmClient.emit("game:resync", 0);
    const rolledBack = await rolledBackSnapshot;
    expect(rolledBack.drawings.map((drawing) => drawing.id)).not.toContain(
      inactiveDrawing,
    );

    const viewedSnapshot = waitForSnapshot(gmClient, (snapshot) =>
      snapshot.drawings.some((drawing) => drawing.id === inactiveDrawing),
    );
    gmClient.emit("scene:view", { sceneId: ids.inactiveScene });
    await viewedSnapshot;

    realtimeWarnings = [];
    emittedSnapshots = 0;
    gmClient.on("game:snapshot", countSnapshot);
    const resyncAttempted = rejectNextSnapshot();
    gmClient.emit("game:resync", 0);
    await resyncAttempted;
    const resyncWarning = await waitForRealtimeWarning(
      "realtime.resync_failed",
    );
    snapshotOverride = undefined;
    gmClient.off("game:snapshot", countSnapshot);
    expect(emittedSnapshots).toBe(0);
    expect(JSON.stringify(resyncWarning.details)).not.toContain(
      ids.inactiveScene,
    );
    expect(gmClient.connected).toBe(true);

    // Resync failure does not mutate viewedSceneId: the next healthy resync
    // still carries the previously delivered inactive canvas.
    const recoveredSnapshot = waitForSnapshot(gmClient, (snapshot) =>
      snapshot.drawings.some((drawing) => drawing.id === inactiveDrawing),
    );
    gmClient.emit("game:resync", 0);
    await recoveredSnapshot;
  });

  it("uses the last rapid scene:view intent and never emits the stale canvas", async () => {
    await database.exec(`
      insert into scenes (id, campaign_id, name, grid)
      values ('${ids.inactiveScene2}', '${ids.campaign}', 'Second GM draft',
        '{"enabled":true,"size":64,"offsetX":0,"offsetY":0,"color":"#fff","opacity":0.2}');
      insert into drawings (id, scene_id, author_membership_id, points)
      values ('${secondInactiveDrawing}', '${ids.inactiveScene2}', '${ids.gm}', '[40,40,50,50]');
      insert into fog_reveals
        (id, scene_id, x, y, width, height, geometry, bbox)
      values
        ('${secondInactiveFog}', '${ids.inactiveScene2}', 0, 0, 10, 10,
         '{"type":"RECT","x":0,"y":0,"width":10,"height":10}',
         '{"x":0,"y":0,"width":10,"height":10}');
    `);
    await settleSnapshots(gmClient);

    let releaseFirstSessionCheck!: () => void;
    const firstSessionCheck = new Promise<void>((resolve) => {
      releaseFirstSessionCheck = resolve;
    });
    let observeSecondSessionCheck!: () => void;
    const secondSessionCheck = new Promise<void>((resolve) => {
      observeSecondSessionCheck = resolve;
    });
    let sessionChecks = 0;
    sessionCheckOverride = async (...args) => {
      const order = ++sessionChecks;
      if (order === 1) await firstSessionCheck;
      if (order === 2) observeSecondSessionCheck();
      return realSessionIsActive(...args);
    };

    const observed: SnapshotPayload[] = [];
    const record: ServerToClientEvents["game:snapshot"] = (snapshot) =>
      observed.push(snapshot);
    gmClient.on("game:snapshot", record);
    const finalSnapshot = waitForSnapshot(gmClient, (snapshot) =>
      snapshot.drawings.some((drawing) => drawing.id === secondInactiveDrawing),
    );
    gmClient.emit("scene:view", { sceneId: ids.inactiveScene });
    gmClient.emit("scene:view", { sceneId: ids.inactiveScene2 });

    let final: SnapshotPayload;
    try {
      // The first packet is now blocked inside async session middleware while
      // the later packet completes. Intent order must still follow ingress,
      // not middleware completion order.
      await secondSessionCheck;
      final = await finalSnapshot;
    } finally {
      releaseFirstSessionCheck();
      sessionCheckOverride = undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    gmClient.off("game:snapshot", record);
    expect(final.drawings.map((drawing) => drawing.id)).toContain(
      secondInactiveDrawing,
    );
    expect(final.fogReveals.map((fog) => fog.id)).toContain(secondInactiveFog);
    expect(final.drawings.map((drawing) => drawing.id)).not.toContain(
      inactiveDrawing,
    );
    expect(
      observed.some((snapshot) =>
        snapshot.drawings.some((drawing) => drawing.id === inactiveDrawing),
      ),
    ).toBe(false);
  });

  it("fails closed and releases queued scene intents when connection setup rejects", async () => {
    await settleSnapshots(gmClient);
    gmClient.disconnect();

    let snapshotAttempts = 0;
    snapshotOverride = async () => {
      snapshotAttempts++;
      throw new Error("TEST_INITIAL_SNAPSHOT_FAILURE");
    };
    let snapshots = 0;
    const onSnapshot = () => snapshots++;
    gmClient.on("game:snapshot", onSnapshot);
    const disconnected = new Promise<string>((resolve) =>
      gmClient.once("disconnect", resolve),
    );
    const connected = waitForConnection(gmClient);
    gmClient.once("connect", () =>
      gmClient.emit("scene:view", { sceneId: ids.inactiveScene }),
    );

    try {
      gmClient.connect();
      await connected;
      await disconnected;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      snapshotOverride = undefined;
      gmClient.off("game:snapshot", onSnapshot);
    }

    expect(snapshotAttempts).toBe(1);
    expect(snapshots).toBe(0);
    expect(gmClient.connected).toBe(false);
  });
});

describe("GM presence", () => {
  it("delivers active-scene pings and reports a GM-only scene without recipients", async () => {
    const activePing = new Promise<
      Parameters<ServerToClientEvents["map:ping"]>[0]
    >((resolve) => client.once("map:ping", resolve));
    await expect(ping(gmClient, ids.scene)).resolves.toEqual({ ok: true });
    await expect(activePing).resolves.toMatchObject({ sceneId: ids.scene });

    let leakedToPlayer = false;
    client.on("map:ping", (event) => {
      if (event.sceneId === ids.inactiveScene) leakedToPlayer = true;
    });
    const gmOnlyPing = new Promise<
      Parameters<ServerToClientEvents["map:ping"]>[0]
    >((resolve) => gmClient.once("map:ping", resolve));
    await expect(ping(gmClient, ids.inactiveScene)).resolves.toEqual({
      ok: false,
      reason: "NO_VISIBLE_PLAYERS",
    });
    await expect(gmOnlyPing).resolves.toMatchObject({
      sceneId: ids.inactiveScene,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(leakedToPlayer).toBe(false);
  });

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

  it("keeps a covered token out of foreign player rooms and replay ACKs", async () => {
    await appendWholeSceneFog("COVER");

    let foreignPreview = false;
    let foreignCommit = false;
    otherClient.on("token:moving", (movement) => {
      if (movement.tokenId === ids.token) foreignPreview = true;
    });
    otherClient.on("token:moved", (event) => {
      if (event.data.id === ids.token) foreignCommit = true;
    });

    const controllerPreview = new Promise<
      Parameters<ServerToClientEvents["token:moving"]>[0]
    >((resolve) => client.once("token:moving", resolve));
    gmClient.emit("token:moving", {
      actionId: crypto.randomUUID(),
      tokenId: ids.token,
      x: 64,
      y: 64,
      z: 0,
      levelId: null,
      revision: 0,
    });
    await expect(controllerPreview).resolves.toMatchObject({
      tokenId: ids.token,
      x: 64,
      y: 64,
    });

    const actionId = crypto.randomUUID();
    const controllerCommit = new Promise<
      Parameters<ServerToClientEvents["token:moved"]>[0]
    >((resolve) => client.once("token:moved", resolve));
    const gmAck = await move(gmClient, {
      actionId,
      tokenId: ids.token,
      revision: 0,
      x: 64,
      y: 64,
    });
    expect(gmAck).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { id: ids.token, x: 64, y: 64, revision: 1 },
    });
    await expect(controllerCommit).resolves.toMatchObject({
      actionId,
      data: { id: ids.token, x: 64, y: 64, revision: 1 },
    });

    // An unrelated player can know/replay the public action id, but must not
    // turn the idempotency ACK into a token projection oracle.
    const foreignReplay = await move(otherClient, {
      actionId,
      tokenId: ids.token,
      revision: 0,
      x: 64,
      y: 64,
    });
    expect(foreignReplay).toMatchObject({
      ok: true,
      status: "DUPLICATE",
      sequence: gmAck.sequence,
    });
    expect(foreignReplay).not.toHaveProperty("data");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect({ foreignPreview, foreignCommit }).toEqual({
      foreignPreview: false,
      foreignCommit: false,
    });
  });

  it("keeps an owned token movable through cover, reveal and cover", async () => {
    await appendWholeSceneFog("COVER");

    let foreignCommits = 0;
    otherClient.on("token:moved", (event) => {
      if (event.data.id === ids.token) foreignCommits++;
    });

    const gmPreview = new Promise<
      Parameters<ServerToClientEvents["token:moving"]>[0]
    >((resolve) => gmClient.once("token:moving", resolve));
    client.emit("token:moving", {
      actionId: crypto.randomUUID(),
      tokenId: ids.token,
      x: 64,
      y: 64,
      z: 0,
      levelId: null,
      revision: 0,
    });
    await expect(gmPreview).resolves.toMatchObject({
      tokenId: ids.token,
      x: 64,
      y: 64,
    });

    const covered = await move(client, {
      actionId: crypto.randomUUID(),
      revision: 0,
      x: 64,
      y: 64,
    });
    expect(covered).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { id: ids.token, x: 64, y: 64, revision: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(foreignCommits).toBe(0);

    await appendWholeSceneFog("REVEAL");
    const revealedBroadcast = new Promise<
      Parameters<ServerToClientEvents["token:moved"]>[0]
    >((resolve) => otherClient.once("token:moved", resolve));
    const revealedActionId = crypto.randomUUID();
    const revealed = await move(client, {
      actionId: revealedActionId,
      revision: 1,
      x: 128,
      y: 128,
    });
    expect(revealed).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { id: ids.token, x: 128, y: 128, revision: 2 },
    });
    await expect(revealedBroadcast).resolves.toMatchObject({
      actionId: revealedActionId,
      data: { id: ids.token, x: 128, y: 128, revision: 2 },
    });
    expect(foreignCommits).toBe(1);

    await appendWholeSceneFog("COVER");
    const coveredAgain = await move(client, {
      actionId: crypto.randomUUID(),
      revision: 2,
      x: 192,
      y: 192,
    });
    expect(coveredAgain).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { id: ids.token, x: 192, y: 192, revision: 3 },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(foreignCommits).toBe(1);
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
        (select count(*) from campaign_audio_tracks) +
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

  it("applies server-authoritative audio commands with CAS and idempotency", async () => {
    await database.exec(`
      insert into assets
        (id, campaign_id, uploaded_by_membership_id, kind, name, storage_key, mime_type, size_bytes, duration_seconds)
      values
        ('${ids.audioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Track', 'test/audio-command', 'audio/mpeg', 10, 60),
        ('${ids.secondAudioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Track 2', 'test/audio-command-2', 'audio/mpeg', 10, 60);
    `);

    const selectActionId = crypto.randomUUID();
    const selected = await audioCommand(gmClient, {
      actionId: selectActionId,
      revision: 0,
      command: "SELECT",
      assetId: ids.audioAsset,
    });
    expect(selected).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: {
        assetId: ids.audioAsset,
        playing: false,
        positionSeconds: 0,
        revision: 1,
      },
    });

    expect(
      await audioCommand(gmClient, {
        actionId: crypto.randomUUID(),
        revision: 0,
        command: "PLAY",
      }),
    ).toMatchObject({
      ok: false,
      status: "CONFLICT",
      reason: "REVISION_CONFLICT",
      data: { revision: 1 },
    });

    const playActionId = crypto.randomUUID();
    const played = await audioCommand(gmClient, {
      actionId: playActionId,
      revision: 1,
      command: "PLAY",
    });
    expect(played).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { playing: true, revision: 2 },
    });
    expect(played.data?.startedAt).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 25));
    const paused = await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 2,
      command: "PAUSE",
    });
    expect(paused).toMatchObject({
      ok: true,
      data: { playing: false, revision: 3, startedAt: null },
    });
    expect(paused.data?.positionSeconds).toBeGreaterThan(0);

    const sought = await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 3,
      command: "SEEK",
      positionSeconds: 12.5,
    });
    expect(sought).toMatchObject({
      ok: true,
      data: { positionSeconds: 12.5, revision: 4 },
    });

    const looped = await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 4,
      command: "SET_LOOP",
      loop: true,
    });
    expect(looped).toMatchObject({
      ok: true,
      data: { loop: true, revision: 5 },
    });
    await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 5,
      command: "PLAY",
    });
    expect(
      await audioCommand(gmClient, {
        actionId: crypto.randomUUID(),
        revision: 6,
        command: "END",
      }),
    ).toMatchObject({
      ok: false,
      status: "INVALID",
      reason: "AUDIO_END_NOT_APPLICABLE",
    });

    await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 6,
      command: "SET_LOOP",
      loop: false,
    });
    expect(
      await audioCommand(gmClient, {
        actionId: crypto.randomUUID(),
        revision: 7,
        command: "END",
      }),
    ).toMatchObject({ ok: true, data: { playing: false, revision: 8 } });

    const duplicate = await audioCommand(gmClient, {
      actionId: selectActionId,
      revision: 0,
      command: "SELECT",
      assetId: ids.audioAsset,
    });
    expect(duplicate).toMatchObject({
      ok: true,
      status: "DUPLICATE",
      data: { playing: false, positionSeconds: 0, revision: 1 },
    });

    expect(
      await audioCommand(client as typeof gmClient, {
        actionId: crypto.randomUUID(),
        revision: 8,
        command: "PLAY",
      }),
    ).toMatchObject({ ok: false, status: "FORBIDDEN", reason: "GM_REQUIRED" });
  });

  it("keeps playback active when selecting another track", async () => {
    await database.exec(`
      insert into assets
        (id, campaign_id, uploaded_by_membership_id, kind, name, storage_key, mime_type, size_bytes, duration_seconds)
      values
        ('${ids.audioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Track', 'test/switch-1', 'audio/mpeg', 10, 60),
        ('${ids.secondAudioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Track 2', 'test/switch-2', 'audio/mpeg', 10, 60);
    `);
    await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 0,
      command: "SELECT",
      assetId: ids.audioAsset,
    });
    await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 1,
      command: "PLAY",
    });
    const switched = await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 2,
      command: "SELECT",
      assetId: ids.secondAudioAsset,
    });
    expect(switched).toMatchObject({
      ok: true,
      data: {
        assetId: ids.secondAudioAsset,
        playing: true,
        positionSeconds: 0,
        revision: 3,
      },
    });
    expect(switched.data?.startedAt).not.toBeNull();
  });

  it("ignores client startedAt on the temporary legacy audio path", async () => {
    await database.exec(`
      insert into assets
        (id, campaign_id, uploaded_by_membership_id, kind, name, storage_key, mime_type, size_bytes)
      values
        ('${ids.audioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Track', 'test/audio-legacy', 'audio/mpeg', 10);
    `);
    const before = Date.now();
    const result = await new Promise<CommandAck<AudioStateDto>>((resolve) => {
      gmClient.emit(
        "audio:set",
        {
          actionId: crypto.randomUUID(),
          assetId: ids.audioAsset,
          playing: true,
          positionSeconds: 4,
          loop: false,
          startedAt: "2000-01-01T00:00:00.000Z",
        },
        resolve,
      );
    });
    expect(result).toMatchObject({
      ok: true,
      data: { playing: true, positionSeconds: 4, revision: 1 },
    });
    expect(
      new Date(result.data?.startedAt ?? 0).getTime(),
    ).toBeGreaterThanOrEqual(before);
  });

  it("materializes an expired non-loop deadline when a client reconnects", async () => {
    await database.exec(`
      insert into assets
        (id, campaign_id, uploaded_by_membership_id, kind, name, storage_key, mime_type, size_bytes, duration_seconds)
      values
        ('${ids.audioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Short', 'test/audio-deadline', 'audio/mpeg', 10, 3);
      insert into campaign_audio_tracks
        (campaign_id, asset_id, playing, position_seconds, loop, started_at, revision)
      values
        ('${ids.campaign}', '${ids.audioAsset}', true, 1, false, now() - interval '10 seconds', 4);
    `);

    const snapshotPromise = new Promise<
      Parameters<ServerToClientEvents["game:snapshot"]>[0]
    >((resolve) => client.once("game:snapshot", resolve));
    client.emit("game:resync", 0);
    const snapshot = await snapshotPromise;
    expect(snapshot.audio).toMatchObject({
      assetId: ids.audioAsset,
      playing: false,
      positionSeconds: 3,
      startedAt: null,
      revision: 5,
    });

    const rows = await database.query<{
      playing: boolean;
      position_seconds: number;
      revision: number;
    }>(
      `select playing, position_seconds, revision from campaign_audio_tracks where campaign_id = '${ids.campaign}'`,
    );
    expect(rows.rows[0]).toMatchObject({
      playing: false,
      position_seconds: 3,
      revision: 5,
    });
  });

  it("atomically applies the first command after a deadline and broadcasts it", async () => {
    await database.exec(`
      insert into assets
        (id, campaign_id, uploaded_by_membership_id, kind, name, storage_key, mime_type, size_bytes, duration_seconds)
      values
        ('${ids.audioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Short', 'test/audio-command-deadline', 'audio/mpeg', 10, 3);
      insert into campaign_audio_tracks
        (campaign_id, asset_id, playing, position_seconds, loop, started_at, revision)
      values
        ('${ids.campaign}', '${ids.audioAsset}', true, 1, false, now() - interval '10 seconds', 4);
    `);

    const actionId = crypto.randomUUID();
    const broadcast = new Promise<
      Parameters<ServerToClientEvents["audio:state"]>[0]
    >((resolve) => client.once("audio:state", resolve));
    const ended = await audioCommand(gmClient, {
      actionId,
      revision: 4,
      command: "END",
    });
    expect(ended).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: {
        playing: false,
        positionSeconds: 3,
        startedAt: null,
        revision: 5,
      },
    });
    await expect(broadcast).resolves.toMatchObject({
      actionId,
      sequence: ended.sequence,
      data: { playing: false, positionSeconds: 3, revision: 5 },
    });

    const duplicate = await audioCommand(gmClient, {
      actionId,
      revision: 4,
      command: "END",
    });
    expect(duplicate).toMatchObject({
      ok: true,
      status: "DUPLICATE",
      sequence: ended.sequence,
      data: { playing: false, revision: 5 },
    });

    await database.exec(`
      update campaign_audio_tracks
      set playing = true, position_seconds = 1,
          started_at = now() - interval '10 seconds'
      where campaign_id = '${ids.campaign}';
    `);
    const replayed = await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 5,
      command: "PLAY",
    });
    expect(replayed).toMatchObject({
      ok: true,
      data: { playing: true, positionSeconds: 0, revision: 6 },
    });

    await database.exec(`
      update campaign_audio_tracks
      set playing = true, position_seconds = 1,
          started_at = now() - interval '10 seconds'
      where campaign_id = '${ids.campaign}';
    `);
    const paused = await audioCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 6,
      command: "PAUSE",
    });
    expect(paused).toMatchObject({
      ok: true,
      data: {
        playing: false,
        positionSeconds: 3,
        startedAt: null,
        revision: 7,
      },
    });

    const events = await database.query<{ count: number }>(`
      select count(*)::int as count from game_events
      where campaign_id = '${ids.campaign}' and type = 'AUDIO_COMMAND'
    `);
    expect(events.rows[0]?.count).toBe(3);
  });

  it("UIX-382: caps concurrent tracks at 4 and rejects a 5th with TRACK_LIMIT_REACHED", async () => {
    const added: string[] = [];
    for (let i = 0; i < 4; i++) {
      const result = await audioTrackCommand(gmClient, {
        actionId: crypto.randomUUID(),
        command: "ADD_TRACK",
        assetId: null,
      });
      expect(result).toMatchObject({ ok: true, status: "ACCEPTED" });
      added.push(result.data!.id);
    }
    expect(new Set(added).size).toBe(4);

    const rejected = await audioTrackCommand(gmClient, {
      actionId: crypto.randomUUID(),
      command: "ADD_TRACK",
      assetId: null,
    });
    expect(rejected).toMatchObject({
      ok: false,
      status: "INVALID",
      reason: "TRACK_LIMIT_REACHED",
    });

    const count = await database.query<{ count: number }>(
      `select count(*)::int as count from campaign_audio_tracks where campaign_id = '${ids.campaign}'`,
    );
    expect(count.rows[0]?.count).toBe(4);

    // Removing a track frees up a cap slot.
    const removed = await audioTrackCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 0,
      command: "REMOVE_TRACK",
      trackId: added[0]!,
    });
    expect(removed).toMatchObject({ ok: true, status: "ACCEPTED" });
    const afterRemove = await audioTrackCommand(gmClient, {
      actionId: crypto.randomUUID(),
      command: "ADD_TRACK",
      assetId: null,
    });
    expect(afterRemove).toMatchObject({ ok: true, status: "ACCEPTED" });
  });

  it("UIX-382: gives each track an independent transport (play/pause/seek/loop don't leak across tracks)", async () => {
    await database.exec(`
      insert into assets
        (id, campaign_id, uploaded_by_membership_id, kind, name, storage_key, mime_type, size_bytes, duration_seconds)
      values
        ('${ids.audioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Track A', 'test/track-a', 'audio/mpeg', 10, 60),
        ('${ids.secondAudioAsset}', '${ids.campaign}', '${ids.gm}', 'AUDIO', 'Track B', 'test/track-b', 'audio/mpeg', 10, 60);
    `);
    const trackA = (
      await audioTrackCommand(gmClient, {
        actionId: crypto.randomUUID(),
        command: "ADD_TRACK",
        assetId: ids.audioAsset,
      })
    ).data!;
    const trackB = (
      await audioTrackCommand(gmClient, {
        actionId: crypto.randomUUID(),
        command: "ADD_TRACK",
        assetId: ids.secondAudioAsset,
      })
    ).data!;

    const playedA = await audioTrackCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: trackA.revision,
      command: "PLAY",
      trackId: trackA.id,
    });
    expect(playedA).toMatchObject({ ok: true, data: { playing: true } });

    const seekB = await audioTrackCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: trackB.revision,
      command: "SEEK",
      trackId: trackB.id,
      positionSeconds: 30,
    });
    expect(seekB).toMatchObject({
      ok: true,
      data: { playing: false, positionSeconds: 30 },
    });

    const loopB = await audioTrackCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: seekB.data!.revision,
      command: "SET_LOOP",
      trackId: trackB.id,
      loop: true,
    });
    expect(loopB).toMatchObject({ ok: true, data: { loop: true } });

    const rows = await database.query<{
      id: string;
      playing: boolean;
      position_seconds: number;
      loop: boolean;
    }>(
      `select id, playing, position_seconds, loop from campaign_audio_tracks where campaign_id = '${ids.campaign}' order by slot_order`,
    );
    const rowA = rows.rows.find((row) => row.id === trackA.id);
    const rowB = rows.rows.find((row) => row.id === trackB.id);
    expect(rowA).toMatchObject({ playing: true, loop: false });
    expect(rowB).toMatchObject({
      playing: false,
      position_seconds: 30,
      loop: true,
    });
  });

  it("UIX-382: sets and persists per-track mixVolume independently of transport", async () => {
    const track = (
      await audioTrackCommand(gmClient, {
        actionId: crypto.randomUUID(),
        command: "ADD_TRACK",
        assetId: null,
      })
    ).data!;
    expect(track.mixVolume).toBe(1);

    const volumeSet = await audioTrackCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: track.revision,
      command: "SET_MIX_VOLUME",
      trackId: track.id,
      mixVolume: 0.25,
    });
    expect(volumeSet).toMatchObject({
      ok: true,
      data: { mixVolume: 0.25, playing: false },
    });

    const row = await database.query<{ mix_volume: number }>(
      `select mix_volume from campaign_audio_tracks where id = '${track.id}'`,
    );
    expect(row.rows[0]?.mix_volume).toBeCloseTo(0.25);
  });

  it("UIX-382: rejects a stale-revision track command with CONFLICT and replays a duplicate actionId idempotently", async () => {
    const track = (
      await audioTrackCommand(gmClient, {
        actionId: crypto.randomUUID(),
        command: "ADD_TRACK",
        assetId: null,
      })
    ).data!;
    const setActionId = crypto.randomUUID();
    const first = await audioTrackCommand(gmClient, {
      actionId: setActionId,
      revision: track.revision,
      command: "SET_MIX_VOLUME",
      trackId: track.id,
      mixVolume: 0.5,
    });
    expect(first).toMatchObject({ ok: true, data: { revision: 1 } });

    const stale = await audioTrackCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: track.revision,
      command: "SET_MIX_VOLUME",
      trackId: track.id,
      mixVolume: 0.9,
    });
    expect(stale).toMatchObject({
      ok: false,
      status: "CONFLICT",
      reason: "REVISION_CONFLICT",
      data: { revision: 1 },
    });

    const duplicate = await audioTrackCommand(gmClient, {
      actionId: setActionId,
      revision: track.revision,
      command: "SET_MIX_VOLUME",
      trackId: track.id,
      mixVolume: 0.5,
    });
    expect(duplicate).toMatchObject({
      ok: true,
      status: "DUPLICATE",
      data: { mixVolume: 0.5, revision: 1 },
    });
  });

  it("UIX-382: forbids non-GM players from mutating tracks", async () => {
    const track = (
      await audioTrackCommand(gmClient, {
        actionId: crypto.randomUUID(),
        command: "ADD_TRACK",
        assetId: null,
      })
    ).data!;
    expect(
      await audioTrackCommand(client as typeof gmClient, {
        actionId: crypto.randomUUID(),
        command: "ADD_TRACK",
        assetId: null,
      }),
    ).toMatchObject({ ok: false, status: "FORBIDDEN", reason: "GM_REQUIRED" });
    expect(
      await audioTrackCommand(client as typeof gmClient, {
        actionId: crypto.randomUUID(),
        revision: track.revision,
        command: "PLAY",
        trackId: track.id,
      }),
    ).toMatchObject({ ok: false, status: "FORBIDDEN", reason: "GM_REQUIRED" });
  });

  it("UIX-382: isolates tracks across campaigns (a foreign trackId is TRACK_NOT_FOUND)", async () => {
    await database.exec(`
      insert into campaigns (id, name) values ('${ids.foreignCampaign}', 'Foreign');
      insert into memberships (id, campaign_id, role, display_name)
      values ('${ids.foreignGm}', '${ids.foreignCampaign}', 'GM', 'Foreign GM');
    `);
    const [foreignTrack] = (
      await database.query<{ id: string }>(
        `insert into campaign_audio_tracks (campaign_id) values ('${ids.foreignCampaign}') returning id`,
      )
    ).rows;

    const result = await audioTrackCommand(gmClient, {
      actionId: crypto.randomUUID(),
      revision: 0,
      command: "PLAY",
      trackId: foreignTrack!.id,
    });
    expect(result).toMatchObject({
      ok: false,
      status: "INVALID",
      reason: "TRACK_NOT_FOUND",
    });
  });

  it("broadcasts ruler updates and clear events across clients (single-segment back-compat)", async () => {
    const updated = new Promise<
      Parameters<ServerToClientEvents["ruler:updated"]>[0]
    >((resolve) => {
      otherClient.once("ruler:updated", resolve);
    });
    client.emit("ruler:update", {
      sceneId: ids.scene,
      points: [
        { x: 10, y: 20 },
        { x: 110, y: 120 },
      ],
    });
    const updatePayload = await updated;
    expect(updatePayload).toMatchObject({
      sceneId: ids.scene,
      membershipId: ids.player,
      points: [
        { x: 10, y: 20 },
        { x: 110, y: 120 },
      ],
    });
    // Grid enabled, size 64: hypot(100, 100) / 64.
    expect(updatePayload.distance).toBeCloseTo(Math.hypot(100, 100) / 64, 10);

    const cleared = new Promise<
      Parameters<ServerToClientEvents["ruler:cleared"]>[0]
    >((resolve) => {
      otherClient.once("ruler:cleared", resolve);
    });
    client.emit("ruler:clear", { sceneId: ids.scene });
    const clearPayload = await cleared;
    expect(clearPayload).toEqual({
      sceneId: ids.scene,
      membershipId: ids.player,
    });
  });

  it("UIX-381: broadcasts the server-computed total distance across every leg of a multi-segment ruler", async () => {
    const updated = new Promise<
      Parameters<ServerToClientEvents["ruler:updated"]>[0]
    >((resolve) => {
      otherClient.once("ruler:updated", resolve);
    });
    // Three legs of grid-unit distance 1, 2, and 3 respectively (each a
    // 3-4-5-style right triangle scaled so /64 lands on a whole number).
    client.emit("ruler:update", {
      sceneId: ids.scene,
      points: [
        { x: 0, y: 0 },
        { x: 0 + 192, y: 0 + 256 }, // hypot(192,256)=320 -> 320/64 = 5
        { x: 192, y: 256 + 384 }, // hypot(0,384)=384 -> /64 = 6
        { x: 192 + 448, y: 640 }, // hypot(448,0)=448 -> /64 = 7
      ],
    });
    const updatePayload = await updated;
    expect(updatePayload.distance).toBeCloseTo(5 + 6 + 7, 10);
    client.emit("ruler:clear", { sceneId: ids.scene });
  });

  it("UIX-381: rejects invalid ruler geometry (too few points, non-finite, over the point cap)", async () => {
    // rulerQueue is a strict FIFO (see the comment above it in realtime.ts),
    // so every one of these emits is fully processed -- and, if invalid,
    // dropped without broadcasting -- before the final valid emit is
    // processed. Asserting exactly one broadcast arrived, and that it's the
    // valid one, proves all five invalid payloads above it were rejected
    // rather than merely still in flight.
    const received: Array<
      Parameters<ServerToClientEvents["ruler:updated"]>[0]
    > = [];
    const onUpdated = (
      payload: Parameters<ServerToClientEvents["ruler:updated"]>[0],
    ) => received.push(payload);
    otherClient.on("ruler:updated", onUpdated);

    client.emit("ruler:update", {
      sceneId: ids.scene,
      points: [{ x: 0, y: 0 }], // too few points
    });
    client.emit("ruler:update", { sceneId: ids.scene, points: [] });
    client.emit("ruler:update", {
      sceneId: ids.scene,
      points: [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 1 },
      ],
    });
    client.emit("ruler:update", {
      sceneId: ids.scene,
      points: [
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 1 },
      ],
    });
    client.emit("ruler:update", {
      sceneId: ids.scene,
      points: Array.from({ length: 65 }, (_, i) => ({ x: i, y: i })), // over the RULER_MAX_POINTS cap
    });

    const validPoints = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    const updated = new Promise<void>((resolve) => {
      otherClient.once("ruler:updated", () => resolve());
    });
    client.emit("ruler:update", { sceneId: ids.scene, points: validPoints });
    await updated;

    otherClient.off("ruler:updated", onUpdated);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      sceneId: ids.scene,
      points: validPoints,
    });
    client.emit("ruler:clear", { sceneId: ids.scene });
  });

  it("UIX-381: preserves the rulerQueue ordering guarantee for a multi-segment update immediately followed by clear", async () => {
    // Regression coverage for the ordering comment above `rulerQueue` in
    // apps/server/src/realtime.ts: an update fired right before a clear (as
    // happens on the last pointermove of a drag immediately followed by
    // pointerup/Escape) must still broadcast update-then-clear in order, or
    // every client is left with a stale line nothing clears afterwards.
    const events: string[] = [];
    const updatedPromise = new Promise<void>((resolve) => {
      otherClient.once("ruler:updated", () => {
        events.push("updated");
        resolve();
      });
    });
    const clearedPromise = new Promise<void>((resolve) => {
      otherClient.once("ruler:cleared", () => {
        events.push("cleared");
        resolve();
      });
    });
    client.emit("ruler:update", {
      sceneId: ids.scene,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ],
    });
    client.emit("ruler:clear", { sceneId: ids.scene });
    await Promise.all([updatedPromise, clearedPromise]);
    expect(events).toEqual(["updated", "cleared"]);
  });
});

describe("cursor presence (UIX-392)", () => {
  it("broadcasts a GM cursor to the GM room only, never to a player socket", async () => {
    let leakedToPlayer = false;
    const onLeak = () => {
      leakedToPlayer = true;
    };
    client.on("cursor:moved", onLeak);
    otherClient.on("cursor:moved", onLeak);
    const gmSeen = new Promise<
      Parameters<ServerToClientEvents["cursor:moved"]>[0]
    >((resolve) => gmClient.once("cursor:moved", resolve));
    gmClient.emit("cursor:move", { sceneId: ids.scene, x: 40, y: 60 });
    await expect(gmSeen).resolves.toMatchObject({
      membershipId: ids.gm,
      role: "GM",
      sceneId: ids.scene,
      x: 40,
      y: 60,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(leakedToPlayer).toBe(false);
    client.off("cursor:moved", onLeak);
    otherClient.off("cursor:moved", onLeak);
  });

  /**
   * UIX-403: the GM can now choose to point at something in front of the
   * players. The default stays private — the interesting assertions are that
   * opting in actually reaches them, and that opting back out retracts the
   * last position instead of leaving it frozen on their screens.
   */
  it("broadcasts a shared GM cursor to the players", async () => {
    const playerSeen = new Promise<
      Parameters<ServerToClientEvents["cursor:moved"]>[0]
    >((resolve) => client.once("cursor:moved", resolve));
    gmClient.emit("cursor:move", {
      sceneId: ids.scene,
      x: 70,
      y: 80,
      shared: true,
    });
    await expect(playerSeen).resolves.toMatchObject({
      membershipId: ids.gm,
      role: "GM",
      x: 70,
      y: 80,
    });
  });

  it("retracts a shared GM cursor from the players when sharing stops", async () => {
    const playerSaw = new Promise<unknown>((resolve) =>
      client.once("cursor:moved", resolve),
    );
    gmClient.emit("cursor:move", {
      sceneId: ids.scene,
      x: 10,
      y: 10,
      shared: true,
    });
    await playerSaw;

    const playerGone = new Promise<{ membershipId: string }>((resolve) =>
      client.once("cursor:gone", resolve),
    );
    // The GM turns sharing off. Their client stops sending, but a position
    // already on screen has to be taken back — the server does that on the
    // first unshared message.
    //
    // The wait is required: the server drops cursor moves less than 40ms apart
    // as a floor under the client's rAF batching, and without it this second
    // emit from the same socket is discarded before it can retract anything.
    await new Promise((resolve) => setTimeout(resolve, 60));
    gmClient.emit("cursor:move", { sceneId: ids.scene, x: 11, y: 11 });
    await expect(playerGone).resolves.toMatchObject({ membershipId: ids.gm });
  });

  it("broadcasts a player cursor to both the GM and every player in the campaign", async () => {
    const gmSeen = new Promise<
      Parameters<ServerToClientEvents["cursor:moved"]>[0]
    >((resolve) => gmClient.once("cursor:moved", resolve));
    const otherPlayerSeen = new Promise<
      Parameters<ServerToClientEvents["cursor:moved"]>[0]
    >((resolve) => otherClient.once("cursor:moved", resolve));
    client.emit("cursor:move", { sceneId: ids.scene, x: 12, y: 24 });
    const expected = {
      membershipId: ids.player,
      role: "PLAYER",
      sceneId: ids.scene,
      x: 12,
      y: 24,
    };
    await expect(gmSeen).resolves.toMatchObject(expected);
    await expect(otherPlayerSeen).resolves.toMatchObject(expected);
  });

  it("rejects malformed or out-of-bounds coordinates without broadcasting", async () => {
    let received = false;
    gmClient.on("cursor:moved", () => {
      received = true;
    });
    client.emit("cursor:move", { sceneId: ids.scene, x: Number.NaN, y: 0 });
    client.emit("cursor:move", { sceneId: ids.scene, x: 999_999, y: 0 });
    client.emit("cursor:move", {
      sceneId: "not-a-uuid",
      x: 0,
      y: 0,
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received).toBe(false);
  });

  it("drops updates that arrive faster than the server-side rate floor", async () => {
    const received: number[] = [];
    gmClient.on("cursor:moved", (cursor) => received.push(cursor.x));
    client.emit("cursor:move", { sceneId: ids.scene, x: 1, y: 0 });
    client.emit("cursor:move", { sceneId: ids.scene, x: 2, y: 0 });
    client.emit("cursor:move", { sceneId: ids.scene, x: 3, y: 0 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received).toEqual([1]);
  });

  it("broadcasts cursor:gone when a socket that sent a cursor disconnects", async () => {
    const gone = new Promise<
      Parameters<ServerToClientEvents["cursor:gone"]>[0]
    >((resolve) => gmClient.once("cursor:gone", resolve));
    client.emit("cursor:move", { sceneId: ids.scene, x: 5, y: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.disconnect();
    await expect(gone).resolves.toEqual({ membershipId: ids.player });
  });

  it("does not broadcast cursor:gone for a socket that never sent a cursor", async () => {
    let received = false;
    gmClient.on("cursor:gone", () => {
      received = true;
    });
    otherClient.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received).toBe(false);
  });

  it("honors an explicit client-driven cursor:gone signal", async () => {
    const gone = new Promise<
      Parameters<ServerToClientEvents["cursor:gone"]>[0]
    >((resolve) => gmClient.once("cursor:gone", resolve));
    client.emit("cursor:move", { sceneId: ids.scene, x: 5, y: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.emit("cursor:gone");
    await expect(gone).resolves.toEqual({ membershipId: ids.player });
  });
});

/**
 * UIX-491 — изображение токена пропадает при перетаскивании.
 *
 * Из очереди отчётов «Сообщить», написали дважды за один вечер: «стоило мне
 * подвигать этот токен и картинка исчезает и становится обычным токеном с
 * названием».
 *
 * Причина — два источника одного поля. Снапшот отдаёт `assetId` из
 * **определения** (`definition.defaultAssetId`, живое значение), а рассылка
 * после перетаскивания собирает DTO из строки таблицы `tokens`, где `asset_id`
 * записан один раз при размещении и с тех пор не менялся. Пока они совпадают,
 * разницы не видно; стоит назначить картинку уже размещённому токену — и первое
 * же движение возвращает всем пустое значение.
 *
 * Через `/api/canvas/bulk` этого не видно: там ответ не пересобирает токен.
 * Поэтому проверка идёт именно по сокету — тем путём, которым таскают мышью.
 */
describe("UIX-491 — картинка переживает перетаскивание", () => {
  const assetId = "11111111-2222-3333-4444-555555555555";
  const refreshedAssetId = "11111111-2222-3333-4444-666666666666";
  const characterId = "11111111-2222-4333-8444-777777777777";

  beforeEach(async () => {
    await database.exec(`
      insert into characters (id, campaign_id, owner_membership_id, name)
      values ('${characterId}', '${ids.campaign}', '${ids.player}', 'Персонаж UIX-491');
      insert into assets (id, campaign_id, uploaded_by_membership_id, kind, name, storage_key, mime_type, size_bytes)
      values
        ('${assetId}', '${ids.campaign}', '${ids.gm}', 'TOKEN', 'Портрет', 'uix491-key', 'image/webp', 10),
        ('${refreshedAssetId}', '${ids.campaign}', '${ids.gm}', 'TOKEN', 'Новый портрет', 'uix491-new-key', 'image/webp', 10)
      on conflict (id) do nothing;
      update token_definitions set
        character_id = '${characterId}',
        default_asset_id = '${assetId}',
        name = null,
        revision = 7
      where id = (select definition_id from tokens where id = '${ids.token}');
    `);
  });

  it("рассылает другому клиенту всю проекцию определения, а не снимок размещения", async () => {
    const placement = await database.query<{ asset_id: string | null }>(
      `select asset_id from tokens where id = '${ids.token}'`,
    );
    // Условие бага: у размещения своего изображения нет, у определения — есть.
    expect(placement.rows[0]?.asset_id).toBeNull();

    const broadcast = new Promise<
      Parameters<ServerToClientEvents["token:moved"]>[0]
    >((resolve) => otherClient.once("token:moved", resolve));
    const ack = await move(client, {
      actionId: crypto.randomUUID(),
      revision: 0,
      x: 64,
      y: 64,
    });
    expect(ack.ok).toBe(true);
    expect(ack.ok && ack.data).toMatchObject({
      assetId,
      characterId,
      name: "Персонаж UIX-491",
      definitionRevision: 7,
    });
    await expect(broadcast).resolves.toMatchObject({
      data: {
        assetId,
        characterId,
        name: "Персонаж UIX-491",
        definitionRevision: 7,
      },
    });
  });

  it("перечитывает определение после commit движения", async () => {
    // Триггер воспроизводит важный порядок без таймеров: первое чтение move
    // видит assetId/revision 7, изменение placement обновляет definition, и
    // только post-commit projection может вернуть assetId/revision 8.
    await database.exec(`
      create function uix491_refresh_definition() returns trigger as $$
      begin
        update token_definitions
        set default_asset_id = '${refreshedAssetId}', revision = 8
        where id = new.definition_id;
        return new;
      end;
      $$ language plpgsql;
      create trigger uix491_refresh_definition_after_move
      after update on tokens
      for each row when (old.revision is distinct from new.revision)
      execute function uix491_refresh_definition();
    `);

    const broadcast = new Promise<
      Parameters<ServerToClientEvents["token:moved"]>[0]
    >((resolve) => otherClient.once("token:moved", resolve));
    const ack = await move(client, {
      actionId: crypto.randomUUID(),
      revision: 0,
      x: 96,
      y: 96,
    });

    expect(ack).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: {
        assetId: refreshedAssetId,
        definitionRevision: 8,
      },
    });
    await expect(broadcast).resolves.toMatchObject({
      data: {
        assetId: refreshedAssetId,
        definitionRevision: 8,
      },
    });
  });

  it("не подменяет sequence первого движения координатами более позднего", async () => {
    await database.exec(`
      create function uix491_followup_move() returns trigger as $$
      begin
        if new.revision = 1 then
          update tokens
          set x = 320, y = 384, revision = 2, updated_at = now()
          where id = new.id;
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger uix491_followup_move_after_move
      after update on tokens
      for each row when (old.revision is distinct from new.revision)
      execute function uix491_followup_move();
    `);

    const broadcast = new Promise<
      Parameters<ServerToClientEvents["token:moved"]>[0]
    >((resolve) => otherClient.once("token:moved", resolve));
    const ack = await move(client, {
      actionId: crypto.randomUUID(),
      revision: 0,
      x: 96,
      y: 96,
    });

    expect(ack).toMatchObject({
      ok: true,
      status: "ACCEPTED",
      data: { x: 96, y: 96, revision: 1, assetId },
    });
    await expect(broadcast).resolves.toMatchObject({
      data: { x: 96, y: 96, revision: 1, assetId },
    });
    const latest = await database.query<{
      x: number;
      y: number;
      revision: number;
    }>(`select x, y, revision from tokens where id = '${ids.token}'`);
    expect(latest.rows[0]).toMatchObject({ x: 320, y: 384, revision: 2 });
  });

  it("не возвращает игроку DTO после отзыва доступа во время commit", async () => {
    await appendWholeSceneFog("COVER");
    await database.exec(`
      create function uix491_revoke_player_access() returns trigger as $$
      begin
        if new.revision = 1 then
          delete from token_controllers where token_definition_id = new.definition_id;
        end if;
        return new;
      end;
      $$ language plpgsql;
      create trigger uix491_revoke_player_access_after_move
      after update on tokens
      for each row when (old.revision is distinct from new.revision)
      execute function uix491_revoke_player_access();
    `);

    let playerReceived = false;
    let otherPlayerReceived = false;
    client.on("token:moved", () => {
      playerReceived = true;
    });
    otherClient.on("token:moved", () => {
      otherPlayerReceived = true;
    });
    const gmBroadcast = new Promise<
      Parameters<ServerToClientEvents["token:moved"]>[0]
    >((resolve) => gmClient.once("token:moved", resolve));

    const ack = await move(client, {
      actionId: crypto.randomUUID(),
      revision: 0,
      x: 128,
      y: 128,
    });

    expect(ack).toMatchObject({ ok: true, status: "ACCEPTED" });
    expect(ack).not.toHaveProperty("data");
    await expect(gmBroadcast).resolves.toMatchObject({
      data: { x: 128, y: 128, revision: 1, assetId },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(playerReceived).toBe(false);
    expect(otherPlayerReceived).toBe(false);
  });
});
