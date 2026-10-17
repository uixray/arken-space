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
 * UIX-412 stage 3: token conditions and colours travel as `token:updated`
 * to exactly the sockets whose snapshot has the token — GM layer, hidden
 * flag, fog and scene visibility included — with no full snapshot.
 */
let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = {
  campaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  controller: crypto.randomUUID(),
  stranger: crypto.randomUUID(),
  stage: crypto.randomUUID(),
  backstage: crypto.randomUUID(),
  definition: crypto.randomUUID(),
  token: crypto.randomUUID(),
};
const secrets = { gm: "g".repeat(40), controller: "c".repeat(40) };
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const grid = {
  enabled: true,
  size: 64,
  offsetX: 0,
  offsetY: 0,
  color: "#ffffff",
  opacity: 0.2,
};

type Sent = { event: string; payload: { data: Record<string, unknown> } };
function fakeSocket(
  role: "GM" | "PLAYER",
  membershipId: string,
  viewedSceneId: string | null = null,
) {
  const sent: Sent[] = [];
  return {
    sent,
    data: {
      auth: { campaignId: ids.campaign, role, membershipId },
      viewedSceneId,
    },
    emit(event: string, payload: Sent["payload"]) {
      sent.push({ event, payload });
    },
  };
}
let sockets: Record<
  "gm" | "gmBackstage" | "controller" | "stranger",
  ReturnType<typeof fakeSocket>
>;
const updates = (socket: ReturnType<typeof fakeSocket>) =>
  socket.sent.filter(({ event }) => event === "token:updated");

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await db
    .insert(schema.campaigns)
    .values({ id: ids.campaign, name: "A", activeSceneId: ids.stage });
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    ...(["controller", "stranger"] as const).map((key) => ({
      id: ids[key],
      campaignId: ids.campaign,
      role: "PLAYER" as const,
      displayName: key,
    })),
  ]);
  await db.insert(schema.sessions).values(
    (["gm", "controller"] as const).map((key) => ({
      membershipId: ids[key],
      tokenHash: hashToken(secrets[key]),
      expiresAt: new Date(Date.now() + 60_000),
    })),
  );
  await db.insert(schema.scenes).values(
    [ids.stage, ids.backstage].map((id) => ({
      id,
      campaignId: ids.campaign,
      name: id === ids.stage ? "Stage" : "Backstage",
      grid,
    })),
  );
  await db.insert(schema.tokenDefinitions).values({
    id: ids.definition,
    campaignId: ids.campaign,
    name: "Hero",
  });
  await db.insert(schema.tokenControllers).values({
    tokenDefinitionId: ids.definition,
    membershipId: ids.controller,
  });
  sockets = {
    gm: fakeSocket("GM", ids.gm),
    gmBackstage: fakeSocket("GM", ids.gm, ids.backstage),
    controller: fakeSocket("PLAYER", ids.controller),
    stranger: fakeSocket("PLAYER", ids.stranger),
  };
  app = Fastify();
  await app.register(cookie);
  const io = {
    in: () => ({ fetchSockets: async () => Object.values(sockets) }),
    to: () => ({ emit() {} }),
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await database.close();
});

async function placeToken(
  values: Partial<typeof schema.tokens.$inferInsert> = {},
) {
  await db.insert(schema.tokens).values({
    id: ids.token,
    definitionId: ids.definition,
    sceneId: ids.stage,
    name: "Hero",
    x: 100,
    y: 100,
    ...values,
  });
}
async function revealAll(sceneId = ids.stage) {
  await db.insert(schema.fogReveals).values({
    sceneId,
    createdByMembershipId: ids.gm,
    x: 0,
    y: 0,
    width: 10_000,
    height: 10_000,
    geometry: { type: "RECT", x: 0, y: 0, width: 10_000, height: 10_000 },
    bbox: { x: 0, y: 0, width: 10_000, height: 10_000 },
  } as typeof schema.fogReveals.$inferInsert);
}
const setConditions = (secret = secrets.gm) =>
  app.inject({
    method: "PATCH",
    url: `/api/tokens/${ids.token}/conditions`,
    headers: headers(secret),
    payload: {
      actionId: crypto.randomUUID(),
      revision: 0,
      conditions: ["POISONED"],
    },
  });

describe("UIX-412 token point events", () => {
  it("sends a revealed stage token to everyone who sees the stage, with no snapshot", async () => {
    await placeToken();
    await revealAll();
    const response = await setConditions();
    expect(response.statusCode, response.body).toBe(200);
    for (const key of ["gm", "gmBackstage", "controller", "stranger"] as const)
      expect(updates(sockets[key])[0]?.payload.data).toMatchObject({
        id: ids.token,
        revision: 1,
        conditions: ["POISONED"],
      });
    expect(
      updates(sockets.stranger)[0]?.payload.data.controllerMembershipIds,
    ).toEqual([]);
    expect(
      updates(sockets.gm)[0]?.payload.data.controllerMembershipIds,
    ).toEqual([ids.controller]);
    for (const socket of Object.values(sockets))
      expect(
        socket.sent.filter(({ event }) => event === "game:snapshot"),
      ).toEqual([]);
  });

  it("keeps a GM-layer or hidden token to the GM", async () => {
    await placeToken({ layer: "GM" });
    await revealAll();
    await setConditions();
    expect(updates(sockets.gm)).toHaveLength(1);
    expect(sockets.controller.sent).toEqual([]);
    expect(sockets.stranger.sent).toEqual([]);
  });

  it("hides a fogged token from players who do not control it", async () => {
    await placeToken();
    const response = await setConditions(secrets.controller);
    expect(response.statusCode, response.body).toBe(200);
    expect(updates(sockets.gm)).toHaveLength(1);
    expect(updates(sockets.controller)).toHaveLength(1);
    expect(sockets.stranger.sent).toEqual([]);
  });

  it("keeps a backstage token to the GM viewing that scene", async () => {
    await placeToken({ sceneId: ids.backstage });
    await revealAll(ids.backstage);
    await setConditions();
    expect(updates(sockets.gmBackstage)).toHaveLength(1);
    expect(sockets.gm.sent).toEqual([]);
    expect(sockets.controller.sent).toEqual([]);
    expect(sockets.stranger.sent).toEqual([]);
  });

  it("matches the token a fresh snapshot projects for the same viewer", async () => {
    await placeToken();
    await revealAll();
    await app.inject({
      method: "PATCH",
      url: `/api/tokens/${ids.token}/appearance`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        baseColor: "#112233",
        frameColor: null,
      },
    });
    const bootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.controller),
    });
    const projected = (bootstrap.json().tokens as Array<{ id: string }>).find(
      ({ id }) => id === ids.token,
    );
    expect(updates(sockets.controller)[0]?.payload.data).toEqual(projected);
  });
});
