import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

let routes = "";
let realtime = "";
let encounters = "";

beforeAll(async () => {
  [routes, realtime, encounters] = await Promise.all([
    readFile(new URL("../apps/server/src/routes.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../apps/server/src/realtime.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../apps/server/src/encounters.ts", import.meta.url),
      "utf8",
    ),
  ]);
});

function between(source: string, start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing inventory marker: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  expect(endAt, `missing inventory boundary: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe("UIX-583 Canvas guard inventory", () => {
  it.each([
    ['app.patch("/api/scenes/:id",', 'app.post("/api/scenes/activate",'],
    ['app.post("/api/scenes/activate",', 'app.post("/api/tokens",'],
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
      'app.post("/api/fog-reveals",',
    ],
    ['app.post("/api/fog-reveals",', 'app.delete("/api/fog-reveals/latest",'],
    ['app.patch("/api/tokens/:id/layer",', 'app.post("/api/drawings",'],
    ['app.post("/api/drawings",', 'app.patch("/api/drawings/:id",'],
    ['app.patch("/api/drawings/:id",', 'app.post("/api/drawings/:id/copy",'],
    ['app.post("/api/drawings/:id/copy",', 'app.delete("/api/drawings/:id",'],
    ['app.delete("/api/drawings/:id",', 'app.post("/api/canvas/bulk",'],
    ['app.post("/api/canvas/bulk",', 'app.get("/api/canvas/history",'],
    [
      'for (const direction of ["undo", "redo"] as const)',
      'app.patch("/api/scenes/:id/canvas",',
    ],
    ['app.patch("/api/scenes/:id/canvas",', "const stickerPackInputSchema"],
  ])("keeps %s inside the common durable guard", (start, end) => {
    expect(between(routes, start, end)).toContain("canvasTx(");
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
        routes,
        'app.post("/api/scenes",',
        'app.patch("/api/scenes/:id",',
      ),
    ).not.toContain("canvasTx(");
    expect(
      between(
        routes,
        'app.post("/api/token-definitions",',
        'app.post("/api/token-definitions/:id/placements",',
      ),
    ).not.toContain("canvasTx(");
    expect(
      between(
        routes,
        'app.put("/api/token-definitions/:id/controllers",',
        'app.patch("/api/token-definitions/:id",',
      ),
    ).not.toContain("canvasTx(");
  });
});
