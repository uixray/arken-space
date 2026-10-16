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
 * UIX-412 stage 2: a counter change (HP, wallet, rest) reaches the GM, owner
 * and controllers as `character:updated` and the campaign as `chat:created`,
 * with no full snapshot. Each case checks who does not receive it, too.
 */
let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = {
  campaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  owner: crypto.randomUUID(),
  controller: crypto.randomUUID(),
  stranger: crypto.randomUUID(),
  character: crypto.randomUUID(),
};
const secrets = { owner: "o".repeat(40), stranger: "s".repeat(40) };
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

type Sent = { event: string; payload: { data: Record<string, unknown> } };
function fakeSocket(role: "GM" | "PLAYER", membershipId: string) {
  const sent: Sent[] = [];
  return {
    sent,
    data: {
      auth: { campaignId: ids.campaign, role, membershipId },
      viewedSceneId: null,
    },
    emit(event: string, payload: Sent["payload"]) {
      sent.push({ event, payload });
    },
  };
}

let sockets: Record<
  "gm" | "owner" | "controller" | "stranger",
  ReturnType<typeof fakeSocket>
>;
let roomEmits: Array<{ room: string; event: string; payload: unknown }>;
const events = (socket: ReturnType<typeof fakeSocket>, name: string) =>
  socket.sent.filter(({ event }) => event === name);

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values({ id: ids.campaign, name: "A" });
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    ...(["owner", "controller", "stranger"] as const).map((key) => ({
      id: ids[key],
      campaignId: ids.campaign,
      role: "PLAYER" as const,
      displayName: key,
    })),
  ]);
  await db.insert(schema.sessions).values(
    (["owner", "stranger"] as const).map((key) => ({
      membershipId: ids[key],
      tokenHash: hashToken(secrets[key]),
      expiresAt: new Date(Date.now() + 60_000),
    })),
  );
  await db.insert(schema.characters).values({
    id: ids.character,
    campaignId: ids.campaign,
    ownerMembershipId: ids.owner,
    name: "Hero",
    stats: {
      strength: 0,
      agility: 0,
      endurance: 0,
      vitality: 0,
      knowledge: 0,
      intelligence: 0,
      willpower: 0,
      charisma: 0,
    },
  });
  await db
    .insert(schema.characterControllers)
    .values({ characterId: ids.character, membershipId: ids.controller });
  sockets = {
    gm: fakeSocket("GM", ids.gm),
    owner: fakeSocket("PLAYER", ids.owner),
    controller: fakeSocket("PLAYER", ids.controller),
    stranger: fakeSocket("PLAYER", ids.stranger),
  };
  roomEmits = [];
  app = Fastify();
  await app.register(cookie);
  const io = {
    in: () => ({ fetchSockets: async () => Object.values(sockets) }),
    to: (room: string) => ({
      emit(event: string, payload: unknown) {
        roomEmits.push({ room, event, payload });
      },
    }),
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await database.close();
});

const counters = (payload: Record<string, unknown>, secret = secrets.owner) =>
  app.inject({
    method: "PATCH",
    url: `/api/characters/${ids.character}/counters`,
    headers: headers(secret),
    payload: { actionId: crypto.randomUUID(), ...payload },
  });

describe("UIX-412 character counter point events", () => {
  it("sends the character to GM, owner and controller only, with no snapshot", async () => {
    const response = await counters({
      revision: 0,
      resources: { physicalPower: { current: 3, maximum: 8 } },
    });
    expect(response.statusCode, response.body).toBe(200);
    for (const key of ["gm", "owner", "controller"] as const) {
      const [updated] = events(sockets[key], "character:updated");
      expect(updated?.payload.data).toMatchObject({
        id: ids.character,
        revision: 1,
        resources: { physicalPower: { current: 3, maximum: 8 } },
      });
    }
    expect(sockets.stranger.sent).toEqual([]);
    for (const socket of Object.values(sockets))
      expect(events(socket, "game:snapshot")).toEqual([]);
  });

  it("shows a player only themself among the controllers, like the snapshot", async () => {
    const response = await counters({
      revision: 0,
      resources: { physicalPower: { current: 2, maximum: 8 } },
    });
    expect(response.statusCode, response.body).toBe(200);
    const controllers = (key: keyof typeof sockets) =>
      events(sockets[key], "character:updated")[0]?.payload.data
        .controllerMembershipIds;
    expect(controllers("gm")).toEqual([ids.controller]);
    expect(controllers("controller")).toEqual([ids.controller]);
    expect(controllers("owner")).toEqual([]);
  });

  it("posts the public table line once to the campaign room", async () => {
    await counters({
      revision: 0,
      wallet: { gold: 1, silver: 0, copper: 0, sp: 0 },
    });
    const chat = roomEmits.filter(({ event }) => event === "chat:created");
    expect(chat).toHaveLength(1);
    expect(chat[0]!.room).toContain(ids.campaign);
    expect(chat[0]!.payload).toMatchObject({
      data: {
        kind: "SYSTEM",
        visibility: "PUBLIC",
        characterId: ids.character,
      },
    });
  });

  it("keeps the full snapshot for a wallet line merged into the previous one", async () => {
    await counters({
      revision: 0,
      wallet: { gold: 1, silver: 0, copper: 0, sp: 0 },
    });
    for (const socket of Object.values(sockets)) socket.sent.length = 0;
    roomEmits.length = 0;
    const merged = await counters({
      revision: 1,
      wallet: { gold: 2, silver: 0, copper: 0, sp: 0 },
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(roomEmits.filter(({ event }) => event === "chat:created")).toEqual(
      [],
    );
    for (const key of ["gm", "owner", "controller", "stranger"] as const)
      expect(events(sockets[key], "game:snapshot")).toHaveLength(1);
  });

  it("sends nothing when a stranger is refused", async () => {
    const refused = await counters(
      { revision: 0, rest: "LONG" },
      secrets.stranger,
    );
    expect(refused.statusCode).toBe(403);
    for (const socket of Object.values(sockets))
      expect(socket.sent).toEqual([]);
    expect(roomEmits).toEqual([]);
  });
});
