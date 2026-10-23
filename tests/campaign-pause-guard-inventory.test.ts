import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

let routes = "";
let realtime = "";
let encounters = "";
let drawingRoutes = "";
let tokenRoutes = "";
let sceneRoutes = "";
let canvasRoutes = "";

beforeAll(async () => {
  [
    routes,
    realtime,
    encounters,
    drawingRoutes,
    tokenRoutes,
    sceneRoutes,
    canvasRoutes,
  ] = await Promise.all([
    readFile(new URL("../apps/server/src/routes.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../apps/server/src/realtime.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../apps/server/src/encounters.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../apps/server/src/drawing-routes.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../apps/server/src/token-routes.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../apps/server/src/scene-routes.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../apps/server/src/canvas-routes.ts", import.meta.url),
      "utf8",
    ),
  ]);
});

function between(source: string, start: string, end: string) {
  // Git's Windows checkout may materialize LF blobs as CRLF. Match markers
  // against a stable representation without changing the checked boundaries.
  source = source.replace(/\r\n/g, "\n");
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing inventory marker: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  expect(endAt, `missing inventory boundary: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

function expectDurableGuard(source: string, start: string, end: string) {
  expect(between(source, start, end)).toContain("canvasTx(");
}

const inventorySources = () => [
  routes,
  realtime,
  encounters,
  drawingRoutes,
  tokenRoutes,
  sceneRoutes,
  canvasRoutes,
];

describe("UIX-583 Canvas guard inventory", () => {
  it("extracts identical route regions from LF and CRLF source text", () => {
    const ranges: Array<[string, string, string]> = [
      [canvasRoutes, 'app.patch("/api/scenes/:id/canvas",', "\n}\n"],
      [tokenRoutes, 'app.patch("/api/tokens/:id/layer",', "\n}\n"],
      [drawingRoutes, 'app.delete("/api/drawings/:id",', "\n}\n"],
    ];
    for (const [index, source] of inventorySources().entries()) {
      const lf = source.replace(/\r\n/g, "\n");
      const crlf = lf.replace(/\n/g, "\r\n");
      const start = `inventory-start-${index}`;
      const end = `inventory-end-${index}`;
      const wrappedLf = `${start}\n${lf}\n${end}`;
      const wrappedCrlf = `${start}\r\n${crlf}\r\n${end}`;
      expect(between(wrappedCrlf, start, end)).toBe(lf);
      expect(between(wrappedLf, start, end)).toBe(lf);
    }
    for (const [source, start, end] of ranges) {
      const lf = source.replace(/\r\n/g, "\n");
      const crlf = lf.replace(/\n/g, "\r\n");
      expect(between(crlf, start, end)).toBe(between(lf, start, end));
    }
  });

  it.each(["\n", "\r\n"])(
    "keeps missing boundaries and missing guards failing for %s input",
    (newline) => {
      const guarded = `route${newline}canvasTx(() => save())${newline}end`;
      expect(() => between(guarded, "missing start", "end")).toThrow();
      expect(() => between(guarded, "route", "missing end")).toThrow();

      const unguarded = `route${newline}save()${newline}end`;
      expect(() => expectDurableGuard(unguarded, "route", "end")).toThrow();
    },
  );

  // Scene and fog routes live in scene-routes.ts, canvas operations in
  // canvas-routes.ts; both receive the same canvasTx from routes.ts.
  it.each([
    ['app.patch("/api/scenes/:id",', 'app.post("/api/scenes/activate",'],
    ['app.post("/api/scenes/activate",', 'app.post("/api/fog-reveals",'],
    ['app.post("/api/fog-reveals",', 'app.delete("/api/fog-reveals/latest",'],
  ])("keeps scene route %s inside the common durable guard", (start, end) => {
    expect(between(sceneRoutes, start, end)).toContain("canvasTx(");
  });

  it.each([
    ['app.post("/api/canvas/bulk",', 'app.get("/api/canvas/history",'],
    [
      'for (const direction of ["undo", "redo"] as const)',
      'app.patch("/api/scenes/:id/canvas",',
    ],
    ['app.patch("/api/scenes/:id/canvas",', "\n}\n"],
  ])("keeps canvas route %s inside the common durable guard", (start, end) => {
    expect(between(canvasRoutes, start, end)).toContain("canvasTx(");
  });

  it.each([
    "registerSceneRoutes(app, db, io, {",
    "registerCanvasRoutes(app, db, {",
  ])("hands %s the shared campaign canvas guard", (start) => {
    expect(between(routes, start, "});")).toContain("canvasTx,");
  });

  // Token routes live in token-routes.ts and receive the same canvasTx.
  it.each([
    ['app.post("/api/tokens",', 'app.post("/api/token-definitions",'],
    [
      'app.post("/api/token-definitions/:id/placements",',
      'app.patch("/api/tokens/:id/size",',
    ],
    [
      'app.patch("/api/tokens/:id/size",',
      'app.patch("/api/tokens/:id/appearance",',
    ],
    [
      'app.patch("/api/tokens/:id/appearance",',
      'app.patch("/api/tokens/:id/conditions",',
    ],
    [
      'app.patch("/api/tokens/:id/conditions",',
      'app.delete("/api/tokens/:id",',
    ],
    [
      'app.delete("/api/tokens/:id",',
      'app.put("/api/token-definitions/:id/controllers",',
    ],
    [
      'app.patch("/api/token-definitions/:id",',
      'app.delete("/api/token-definitions/:id",',
    ],
    [
      'app.delete("/api/token-definitions/:id",',
      'app.patch("/api/tokens/:id/layer",',
    ],
    ['app.patch("/api/tokens/:id/layer",', "\n}\n"],
  ])("keeps token route %s inside the common durable guard", (start, end) => {
    expect(between(tokenRoutes, start, end)).toContain("canvasTx(");
  });

  it("hands token routes the shared campaign canvas guard", () => {
    expect(between(routes, "registerTokenRoutes(app, db, {", "});")).toContain(
      "canvasTx,",
    );
  });

  // Drawing routes live in drawing-routes.ts and receive the same canvasTx.
  it.each([
    ['app.post("/api/drawings",', 'app.patch("/api/drawings/:id",'],
    ['app.patch("/api/drawings/:id",', 'app.post("/api/drawings/:id/copy",'],
    ['app.post("/api/drawings/:id/copy",', 'app.delete("/api/drawings/:id",'],
    ['app.delete("/api/drawings/:id",', "\n}\n"],
  ])("keeps drawing route %s inside the common durable guard", (start, end) => {
    expect(between(drawingRoutes, start, end)).toContain("canvasTx(");
  });

  it("hands drawing routes the shared campaign canvas guard", () => {
    expect(
      between(routes, "registerDrawingRoutes(app, db, {", "});"),
    ).toContain("canvasTx,");
    expect(routes).toContain("campaignCanvasDatabase(db, campaignId)");
  });

  it.each([
    ['socket.on("token:moving",', 'socket.on("token:moved",'],
    ['socket.on("ruler:update",', 'socket.on("ruler:clear",'],
    ['socket.on("ruler:clear",', 'socket.on("map:ping",'],
    ['socket.on("map:ping",', 'socket.on("cursor:move",'],
    ['socket.on("cursor:move",', 'socket.on("cursor:gone",'],
    ['socket.on("cursor:gone",', 'socket.on("disconnect",'],
  ])("keeps %s inside the shared relay guard", (start, end) => {
    expect(between(realtime, start, end)).toContain("runCampaignCanvasRelay(");
  });

  it.each([
    [
      'socket.on("token:moving",',
      'socket.on("token:moved",',
      "const delivery = await tokenDelivery",
      'socket.to(delivery.rooms).emit("token:moving"',
    ],
    [
      'socket.on("ruler:update",',
      'socket.on("ruler:clear",',
      ".limit(1);",
      "canvasEphemera.rulerSceneId = scene.id",
    ],
    [
      'socket.on("cursor:move",',
      'socket.on("cursor:gone",',
      ".limit(1);",
      "const shared = parsed.data.shared === true",
    ],
  ])(
    "drops %s after an async read if the originating socket disconnected",
    (start, end, awaited, emitted) => {
      const handler = between(realtime, start, end);
      const awaitAt = handler.indexOf(awaited);
      const connectedAt = handler.indexOf(
        "if (!socket.connected) return",
        awaitAt,
      );
      const emitAt = handler.indexOf(emitted, connectedAt);
      expect(awaitAt).toBeGreaterThanOrEqual(0);
      expect(connectedAt).toBeGreaterThan(awaitAt);
      expect(emitAt).toBeGreaterThan(connectedAt);
    },
  );

  it("keeps durable socket movement and linked-scene encounters guarded", () => {
    expect(
      between(realtime, 'socket.on("token:moved",', 'socket.on("audio:set",'),
    ).toContain("runCampaignCanvasMutation(");
    expect(
      between(
        encounters,
        'app.post("/api/encounters/start",',
        'app.post("/api/encounters/:id/end",',
      ),
    ).toContain("runCampaignCanvasMutation(");
  });

  it("locks the campaign before every encounter mode claims the ACTIVE slot", () => {
    const start = between(
      encounters,
      'app.post("/api/encounters/start",',
      'app.post("/api/encounters/:id/end",',
    );
    const lock = start.indexOf('.for("update")');
    const activeEncounter = start.indexOf(".insert(encounters)");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(activeEncounter).toBeGreaterThan(lock);
  });

  it("keeps explicit non-Canvas preparation outside the pause guard", () => {
    expect(
      between(
        sceneRoutes,
        'app.post("/api/scenes",',
        'app.patch("/api/scenes/:id",',
      ),
    ).not.toContain("canvasTx(");
    expect(
      between(
        tokenRoutes,
        'app.post("/api/token-definitions",',
        'app.post("/api/token-definitions/:id/placements",',
      ),
    ).not.toContain("canvasTx(");
    expect(
      between(
        tokenRoutes,
        'app.put("/api/token-definitions/:id/controllers",',
        'app.patch("/api/token-definitions/:id",',
      ),
    ).not.toContain("canvasTx(");
  });
});
