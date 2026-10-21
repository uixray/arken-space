import { createServer, type Server as HttpServer } from "node:http";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Server, type ServerOptions } from "socket.io";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../packages/contracts/src/index.js";
import * as schema from "../packages/db/src/schema.js";
import { registerRealtime } from "../apps/server/src/realtime.js";
import { hashToken } from "../apps/server/src/security.js";
import { createMigratedPglite } from "./helpers/pglite-template.js";

/**
 * UIX-682 C20: «призрак» линейки — ruler:updated после ruler:cleared.
 *
 * tests/realtime.test.ts уже проверяет одиночный update→clear. Здесь — то, что
 * делает настоящий клиент: пачка update за drag, двойной clear на отпускании
 * (Stage + window pointerup), окно тишины на ОБОИХ аутентифицированных
 * клиентах и разрыв транспорта у зрителя. Сервер поднимается в двух профилях:
 * как общий harness (без восстановления) и как production
 * (`apps/server/src/index.ts`: connectionStateRecovery 120 s).
 */

const ids = {
  campaign: "40000000-0000-4000-8000-000000000001",
  gm: "40000000-0000-4000-8000-000000000002",
  author: "40000000-0000-4000-8000-000000000003",
  viewer: "40000000-0000-4000-8000-000000000004",
  scene: "40000000-0000-4000-8000-000000000005",
};
const authorSession = "ruler-lifecycle-author-session";
const viewerSession = "ruler-lifecycle-viewer-session";

type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type RulerEvent =
  | { kind: "updated"; membershipId: string; at: number }
  | { kind: "cleared"; membershipId: string; at: number };

const productionRecovery: Partial<ServerOptions> = {
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: false,
  },
};

let database: PGlite | undefined;
let httpServer: HttpServer | undefined;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents> | undefined;
const clients: GameClient[] = [];

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  if (ioServer)
    await new Promise<void>((resolve) => ioServer!.close(() => resolve()));
  if (httpServer)
    await new Promise<void>((resolve) =>
      httpServer!.close(() => resolve()),
    ).catch(() => undefined);
  await database?.close();
  database = undefined;
  httpServer = undefined;
  ioServer = undefined;
});

async function startServer(options: Partial<ServerOptions> = {}) {
  database = await createMigratedPglite();
  await database.exec(`
    insert into campaigns (id, name) values ('${ids.campaign}', 'Ruler lifecycle');
    insert into memberships (id, campaign_id, role, display_name) values
      ('${ids.gm}', '${ids.campaign}', 'GM', 'GM'),
      ('${ids.author}', '${ids.campaign}', 'PLAYER', 'Author'),
      ('${ids.viewer}', '${ids.campaign}', 'PLAYER', 'Viewer');
    insert into scenes (id, campaign_id, name, grid) values
      ('${ids.scene}', '${ids.campaign}', 'Active', '{"enabled":true,"size":64,"offsetX":0,"offsetY":0,"color":"#fff","opacity":0.2}');
    update campaigns set active_scene_id = '${ids.scene}' where id = '${ids.campaign}';
    insert into sessions (membership_id, token_hash, expires_at) values
      ('${ids.author}', '${hashToken(authorSession)}', now() + interval '1 day'),
      ('${ids.viewer}', '${hashToken(viewerSession)}', now() + interval '1 day');
  `);
  httpServer = createServer();
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    options,
  );
  registerRealtime(
    ioServer,
    drizzle(database, { schema }) as never,
    { info() {}, warn() {}, error() {}, debug() {} } as never,
  );
  await new Promise<void>((resolve) =>
    httpServer!.listen(0, "127.0.0.1", resolve),
  );
}

async function connect(session: string) {
  const address = httpServer!.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_SERVER_ADDRESS");
  const socket: GameClient = createClient(`http://127.0.0.1:${address.port}`, {
    transports: ["websocket"],
    extraHeaders: { Cookie: `arken_session=${session}` },
    reconnectionDelay: 50,
    reconnectionDelayMax: 50,
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("game:snapshot", () => resolve());
    socket.once("connect_error", reject);
  });
  return socket;
}

function record(socket: GameClient) {
  const events: RulerEvent[] = [];
  socket.on("ruler:updated", (ruler) =>
    events.push({
      kind: "updated",
      membershipId: ruler.membershipId,
      at: Date.now(),
    }),
  );
  socket.on("ruler:cleared", (ruler) =>
    events.push({
      kind: "cleared",
      membershipId: ruler.membershipId,
      at: Date.now(),
    }),
  );
  return events;
}

/** Same replace/filter semantics as use-game-socket-subscriptions.ts. */
function visibleRulers(events: RulerEvent[]) {
  const visible = new Set<string>();
  for (const event of events)
    if (event.kind === "updated") visible.add(event.membershipId);
    else visible.delete(event.membershipId);
  return [...visible];
}

function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs)
        return reject(new Error("WAIT_TIMEOUT"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function drag(author: GameClient, moves: number) {
  for (let step = 1; step <= moves; step++)
    author.emit("ruler:update", {
      sceneId: ids.scene,
      points: [
        { x: 0, y: 0 },
        { x: step * 16, y: step * 8 },
      ],
    });
}

/** Real renderer emits clear from both Stage and window pointerup. */
function release(author: GameClient) {
  author.emit("ruler:clear", { sceneId: ids.scene });
  author.emit("ruler:clear", { sceneId: ids.scene });
}

function dropTransport(socket: GameClient) {
  const reconnected = new Promise<void>((resolve) =>
    socket.io.once("reconnect", () => resolve()),
  );
  socket.io.engine.close();
  return reconnected;
}

describe.each([
  ["shared harness profile", {}],
  ["production recovery profile", productionRecovery],
] as const)("UIX-682 C20 ruler lifecycle — %s", (_profile, options) => {
  it("a burst drag and double clear leave no late ruler on either authenticated client for 3 s", async () => {
    await startServer(options);
    const author = await connect(authorSession);
    const viewer = await connect(viewerSession);
    const authorEvents = record(author);
    const viewerEvents = record(viewer);

    drag(author, 40);
    release(author);
    await waitFor(() =>
      [authorEvents, viewerEvents].every(
        (events) => events.at(-1)?.kind === "cleared",
      ),
    );
    const clearedAt = Date.now();
    await sleep(3_000);

    for (const events of [authorEvents, viewerEvents]) {
      // Server FIFO relays every accepted update; none may follow the clear.
      expect(events.filter((event) => event.kind === "updated")).toHaveLength(
        40,
      );
      expect(events.filter((event) => event.kind === "cleared")).toHaveLength(
        1,
      );
      expect(events.at(-1)?.kind).toBe("cleared");
      expect(events.filter((event) => event.at > clearedAt)).toEqual([]);
      expect(visibleRulers(events)).toEqual([]);
    }
  }, 15_000);

  it("a viewer reconnect after the clear receives no stale ruler replay", async () => {
    await startServer(options);
    const author = await connect(authorSession);
    const viewer = await connect(viewerSession);
    const viewerEvents = record(viewer);

    drag(author, 5);
    release(author);
    await waitFor(() => viewerEvents.at(-1)?.kind === "cleared");
    const before = viewerEvents.length;

    await dropTransport(viewer);
    await sleep(1_000);

    expect(viewerEvents.slice(before)).toEqual([]);
    expect(visibleRulers(viewerEvents)).toEqual([]);
  }, 15_000);

  it("an author transport drop mid-drag clears the ruler for the viewer and nothing redraws it", async () => {
    await startServer(options);
    const author = await connect(authorSession);
    const viewer = await connect(viewerSession);
    const viewerEvents = record(viewer);

    drag(author, 5);
    await waitFor(
      () =>
        viewerEvents.filter((event) => event.kind === "updated").length === 5,
    );
    await dropTransport(author);
    await waitFor(() => viewerEvents.at(-1)?.kind === "cleared");
    const clearedAt = Date.now();
    await sleep(1_000);

    expect(viewerEvents.filter((event) => event.at > clearedAt)).toEqual([]);
    expect(visibleRulers(viewerEvents)).toEqual([]);
  }, 15_000);
});

describe("UIX-682 C20 ruler clear missed during a viewer outage", () => {
  // Records the protocol fact the client has to handle; the client-side
  // assertion lives in apps/web/src/use-game-socket-subscriptions.rulers.test.tsx.
  it.each([
    ["shared harness profile", {}, false],
    ["production recovery profile", productionRecovery, true],
  ] as const)(
    "%s: replays the missed clear only when the session is recovered",
    async (_profile, options, recovers) => {
      await startServer(options);
      const author = await connect(authorSession);
      const viewer = await connect(viewerSession);
      const viewerEvents = record(viewer);

      drag(author, 3);
      await waitFor(
        () =>
          viewerEvents.filter((event) => event.kind === "updated").length === 3,
      );
      expect(visibleRulers(viewerEvents)).toEqual([ids.author]);

      // The viewer's transport is down while the author releases the ruler.
      viewer.io.reconnection(false);
      const down = new Promise<void>((resolve) =>
        viewer.once("disconnect", () => resolve()),
      );
      viewer.io.engine.close();
      await down;
      release(author);
      await sleep(200);
      viewer.io.reconnection(true);
      const back = new Promise<void>((resolve) =>
        viewer.once("connect", () => resolve()),
      );
      viewer.connect();
      await back;
      await sleep(500);

      // socket.io-client leaves `recovered` undefined without server support.
      expect(viewer.recovered === true).toBe(recovers);
      expect(visibleRulers(viewerEvents)).toEqual(recovers ? [] : [ids.author]);
    },
    15_000,
  );
});
