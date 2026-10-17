import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import { env } from "../apps/server/src/env.js";
import { createMigratedPglite } from "./helpers/pglite-template.js";

/**
 * UIX-412: drawings travel as point events, not full snapshot broadcasts.
 * Every case checks who receives the event and, as much, who does not.
 */
let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = {
  campaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  scene: crypto.randomUUID(),
  backstage: crypto.randomUUID(),
  image: crypto.randomUUID(),
};
const secrets = { gm: "g".repeat(40), player: "p".repeat(40) };
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

type Sent = { event: string; payload: { data: unknown } };
function fakeSocket(role: "GM" | "PLAYER", viewedSceneId: string | null) {
  const sent: Sent[] = [];
  return {
    sent,
    data: {
      auth: {
        campaignId: ids.campaign,
        role,
        membershipId: role === "GM" ? ids.gm : ids.player,
      },
      viewedSceneId,
    },
    emit(event: string, payload: { data: unknown }) {
      sent.push({ event, payload });
    },
  };
}

let gmOnStage: ReturnType<typeof fakeSocket>;
let gmBackstage: ReturnType<typeof fakeSocket>;
let player: ReturnType<typeof fakeSocket>;
const drawingEvents = (socket: ReturnType<typeof fakeSocket>) =>
  socket.sent
    .filter(({ event }) => event.startsWith("drawing:"))
    .map(({ event, payload }) => ({
      event,
      id:
        (payload.data as { id?: string; drawingId?: string }).id ??
        (payload.data as { drawingId: string }).drawingId,
    }));
const snapshots = (socket: ReturnType<typeof fakeSocket>) =>
  socket.sent.filter(({ event }) => event === "game:snapshot").length;
const clear = () => {
  for (const socket of [gmOnStage, gmBackstage, player]) socket.sent.length = 0;
};

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await db
    .insert(schema.campaigns)
    .values({ id: ids.campaign, name: "A", activeSceneId: ids.scene });
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
    },
  ]);
  await db.insert(schema.sessions).values([
    {
      membershipId: ids.gm,
      tokenHash: hashToken(secrets.gm),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      membershipId: ids.player,
      tokenHash: hashToken(secrets.player),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  await db.insert(schema.scenes).values(
    [ids.scene, ids.backstage].map((id) => ({
      id,
      campaignId: ids.campaign,
      name: id === ids.scene ? "Stage" : "Backstage",
      grid: {
        enabled: true,
        size: 64,
        offsetX: 0,
        offsetY: 0,
        color: "#ffffff",
        opacity: 0.2,
      },
    })),
  );
  await db.insert(schema.assets).values({
    id: ids.image,
    campaignId: ids.campaign,
    uploadedByMembershipId: ids.gm,
    kind: "IMAGE",
    name: "Image",
    storageKey: crypto.randomUUID(),
    mimeType: "image/webp",
    sizeBytes: 1,
  });
  gmOnStage = fakeSocket("GM", null);
  gmBackstage = fakeSocket("GM", ids.backstage);
  player = fakeSocket("PLAYER", null);
  app = Fastify();
  await app.register(cookie);
  const io = {
    in: () => ({
      fetchSockets: async () => [gmOnStage, gmBackstage, player],
    }),
    to: () => ({ emit() {} }),
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await database.close();
});

async function stroke(secret: string, sceneId = ids.scene) {
  const response = await app.inject({
    method: "POST",
    url: "/api/drawings",
    headers: headers(secret),
    payload: {
      actionId: crypto.randomUUID(),
      sceneId,
      points: [1, 1, 10, 10],
      color: "#00ff00",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { id: string; revision: number };
}

async function stamp(
  layer: "PUBLIC" | "GM",
  source: { packId: string; assetKey: string } = {
    packId: "builtin-terrain-v1",
    assetKey: "forest",
  },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/drawings",
    headers: headers(secrets.gm),
    payload: {
      actionId: crypto.randomUUID(),
      sceneId: ids.scene,
      kind: "STAMP",
      ...source,
      x: 1,
      y: 2,
      size: 64,
      rotation: 0,
      layer,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { id: string; revision: number };
}

describe("UIX-412 drawing point events", () => {
  it("sends a stroke on the stage to everyone who sees the stage, with no snapshot", async () => {
    const drawing = await stroke(secrets.player);
    const upserted = [{ event: "drawing:upserted", id: drawing.id }];
    expect(drawingEvents(gmOnStage)).toEqual(upserted);
    expect(drawingEvents(gmBackstage)).toEqual(upserted);
    expect(drawingEvents(player)).toEqual(upserted);
    expect(player.sent[0]!.payload.data).toMatchObject({
      id: drawing.id,
      sceneId: ids.scene,
      kind: "FREEHAND",
      points: [1, 1, 10, 10],
      revision: 0,
    });
    // Before UIX-412 each stroke cost one full rebuild per socket.
    for (const socket of [gmOnStage, gmBackstage, player])
      expect(snapshots(socket)).toBe(0);
  });

  it("keeps a backstage stroke to the GM viewing that scene", async () => {
    await stroke(secrets.gm, ids.backstage);
    expect(drawingEvents(gmBackstage)).toHaveLength(1);
    expect(drawingEvents(gmOnStage)).toEqual([]);
    expect(drawingEvents(player)).toEqual([]);
  });

  it("never sends a GM-layer stamp to a player, through its whole life", async () => {
    const hidden = await stamp("GM");
    expect(drawingEvents(gmOnStage)).toEqual([
      { event: "drawing:upserted", id: hidden.id },
    ]);
    expect(player.sent).toEqual([]);

    clear();
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/drawings/${hidden.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), revision: 0, x: 40 },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(drawingEvents(gmOnStage)).toHaveLength(1);
    expect(player.sent).toEqual([]);

    clear();
    const copied = await app.inject({
      method: "POST",
      url: `/api/drawings/${hidden.id}/copy`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), revision: 1 },
    });
    expect(copied.statusCode, copied.body).toBe(201);
    expect(drawingEvents(gmOnStage)).toHaveLength(1);
    expect(player.sent).toEqual([]);

    clear();
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/drawings/${hidden.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), revision: 1 },
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect(drawingEvents(gmOnStage)).toEqual([
      { event: "drawing:removed", id: hidden.id },
    ]);
    expect(player.sent).toEqual([]);
  });

  it("reveals and hides a stamp for the player when its layer changes", async () => {
    const forest = await stamp("GM");
    clear();
    const revealed = await app.inject({
      method: "PATCH",
      url: `/api/drawings/${forest.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), revision: 0, layer: "PUBLIC" },
    });
    expect(revealed.statusCode, revealed.body).toBe(200);
    expect(drawingEvents(player)).toEqual([
      { event: "drawing:upserted", id: forest.id },
    ]);

    clear();
    const hidden = await app.inject({
      method: "PATCH",
      url: `/api/drawings/${forest.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), revision: 1, layer: "GM" },
    });
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect(drawingEvents(player)).toEqual([
      { event: "drawing:removed", id: forest.id },
    ]);
    expect(drawingEvents(gmOnStage)).toEqual([
      { event: "drawing:upserted", id: forest.id },
    ]);
  });

  it("falls back to the full snapshot for a campaign image stamp", async () => {
    // Its image must enter the player's snapshot.assets, which an event
    // cannot carry.
    await stamp("PUBLIC", { packId: "campaign-image", assetKey: ids.image });
    for (const socket of [gmOnStage, gmBackstage, player]) {
      expect(drawingEvents(socket)).toEqual([]);
      expect(snapshots(socket)).toBe(1);
    }
  });

  it("matches the drawing a fresh snapshot projects", async () => {
    const drawing = await stamp("PUBLIC");
    const bootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    const projected = (bootstrap.json().drawings as Array<{ id: string }>).find(
      ({ id }) => id === drawing.id,
    );
    expect(player.sent[0]!.payload.data).toEqual(projected);
  });
});
