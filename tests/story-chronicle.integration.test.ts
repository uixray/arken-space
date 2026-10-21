import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";
import { createMigratedPglite } from "./helpers/pglite-template.js";

/**
 * UIX-245: летопись идёт по времени игрового мира (день кампании + эпоха), а
 * черновик можно начать из технического события, не публикуя его payload.
 */
let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignGm: crypto.randomUUID(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  foreignGm: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const action = () => crypto.randomUUID();

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "Chronicle campaign", day: 7 },
    { id: ids.foreignCampaign, name: "Foreign campaign" },
  ]);
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
    },
    {
      id: ids.foreignGm,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Foreign GM",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.player, secrets.player],
    [ids.foreignGm, secrets.foreignGm],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  app = Fastify();
  await app.register(cookie);
  registerRoutes(
    app,
    db as never,
    {
      in: () => ({ fetchSockets: async () => [] }),
      to: () => ({ emit() {} }),
    } as never,
  );
  await app.ready();
});

afterEach(async () => {
  await app?.close();
  await database?.close();
});

async function createDraft(payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/story/posts",
    headers: headers(secrets.gm),
    payload: { actionId: action(), ...payload },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as {
    id: string;
    revision: number;
    worldDay: number | null;
    era: string | null;
  };
}

async function publish(post: { id: string; revision: number }) {
  const response = await app.inject({
    method: "POST",
    url: `/api/story/posts/${post.id}/publish`,
    headers: headers(secrets.gm),
    payload: { actionId: action(), revision: post.revision },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as { id: string; revision: number };
}

async function list(secret: string, query = "") {
  const response = await app.inject({
    method: "GET",
    url: `/api/story/posts${query}`,
    headers: headers(secret),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as {
    posts: Array<{ id: string; worldDay: number | null; era: string | null }>;
    nextCursor: string | null;
    eras: string[];
  };
}

async function insertEvent(
  campaignId: string,
  membershipId: string,
  type: string,
  payload: unknown,
) {
  const [event] = await db
    .insert(schema.gameEvents)
    .values({
      campaignId,
      actionId: crypto.randomUUID(),
      membershipId,
      type,
      entityType: "chat",
      payload,
    })
    .returning();
  return event!;
}

describe("UIX-245 chronicle world time", () => {
  it("defaults a new entry to the campaign clock day and keeps explicit values", async () => {
    const defaulted = await createDraft({ body: "Сегодняшняя сцена" });
    expect(defaulted).toMatchObject({ worldDay: 7, era: null });
    const explicit = await createDraft({
      body: "Давняя легенда",
      worldDay: 2,
      era: "  Эпоха пепла  ",
    });
    expect(explicit).toMatchObject({ worldDay: 2, era: "Эпоха пепла" });
    const outside = await createDraft({
      body: "Вне хронологии",
      worldDay: null,
      era: "",
    });
    expect(outside).toMatchObject({ worldDay: null, era: null });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/story/posts",
      headers: headers(secrets.gm),
      payload: { actionId: action(), body: "x", worldDay: 0 },
    });
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("orders by world day, then edit time, with undated entries last across cursor pages", async () => {
    const day3 = await createDraft({ body: "День 3", worldDay: 3 });
    const undated = await createDraft({ body: "Без дня", worldDay: null });
    const day9 = await createDraft({ body: "День 9", worldDay: 9 });
    const day3later = await createDraft({ body: "День 3 позже", worldDay: 3 });
    const all = await list(secrets.gm, "?limit=50");
    expect(all.posts.map((post) => post.id)).toEqual([
      day9.id,
      day3later.id,
      day3.id,
      undated.id,
    ]);
    // Постранично по одной записи: тот же порядок, без пропусков и повторов.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(
        secrets.gm,
        `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      seen.push(...page.posts.map((post) => post.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.posts.map((post) => post.id));
  });

  it("filters by era and exposes to players only eras of published entries", async () => {
    const ash = await createDraft({ body: "Пепел", worldDay: 1, era: "Пепел" });
    await createDraft({ body: "Тайна", worldDay: 2, era: "Тайная эпоха" });
    await publish(ash);
    const gm = await list(secrets.gm);
    expect(gm.eras).toEqual(["Пепел", "Тайная эпоха"]);
    const player = await list(secrets.player);
    expect(player.eras).toEqual(["Пепел"]);
    expect(player.posts.map((post) => post.id)).toEqual([ash.id]);
    const filtered = await list(
      secrets.gm,
      `?era=${encodeURIComponent("Пепел")}`,
    );
    expect(filtered.posts.map((post) => post.id)).toEqual([ash.id]);
    // Эпохи — по всей видимой летописи, а не только по отфильтрованной.
    expect(filtered.eras).toEqual(["Пепел", "Тайная эпоха"]);
  });

  it("edits world time through CAS and records it in the revision history", async () => {
    const draft = await createDraft({ body: "Запись", worldDay: 4 });
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/story/posts/${draft.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: action(),
        revision: draft.revision,
        worldDay: 5,
        era: "Новая эпоха",
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({ worldDay: 5, era: "Новая эпоха" });
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/story/posts/${draft.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: action(),
        revision: updated.json().revision,
        worldDay: null,
      },
    });
    expect(cleared.json()).toMatchObject({
      worldDay: null,
      era: "Новая эпоха",
    });
    const revisions = await db
      .select({
        revision: schema.storyPostRevisions.revision,
        worldDay: schema.storyPostRevisions.worldDay,
        era: schema.storyPostRevisions.era,
      })
      .from(schema.storyPostRevisions)
      .where(eq(schema.storyPostRevisions.postId, draft.id))
      .orderBy(schema.storyPostRevisions.revision);
    expect(revisions).toEqual([
      { revision: 0, worldDay: 4, era: null },
      { revision: 1, worldDay: 5, era: "Новая эпоха" },
      { revision: 2, worldDay: null, era: "Новая эпоха" },
    ]);
  });
});

describe("UIX-245 chronicle drafts from game events", () => {
  it("lists only story-worthy events without payloads and only to the GM", async () => {
    await insertEvent(ids.campaign, ids.gm, "dice.created", {
      secret: "СЫРОЙ-PAYLOAD",
    });
    await insertEvent(ids.campaign, ids.gm, "token.placed", {});
    await insertEvent(ids.campaign, ids.gm, "encounter.started", {});
    await insertEvent(ids.foreignCampaign, ids.foreignGm, "dice.created", {});
    const response = await app.inject({
      method: "GET",
      url: "/api/story/event-sources",
      headers: headers(secrets.gm),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("СЫРОЙ-PAYLOAD");
    const sources = response.json().sources as Array<{
      type: string;
      label: string;
    }>;
    expect(sources.map((source) => [source.type, source.label])).toEqual([
      ["encounter.started", "Столкновение"],
      ["dice.created", "Бросок кубиков"],
    ]);
    const denied = await app.inject({
      method: "GET",
      url: "/api/story/event-sources",
      headers: headers(secrets.player),
    });
    expect(denied.statusCode).toBe(403);
  });

  it("seeds a GM-only draft from an event without copying its payload, idempotently", async () => {
    const event = await insertEvent(ids.campaign, ids.gm, "dice.created", {
      formula: "1d20",
      secret: "СЫРОЙ-PAYLOAD",
    });
    const actionId = action();
    const create = () =>
      app.inject({
        method: "POST",
        url: "/api/story/posts/from-event",
        headers: headers(secrets.gm),
        payload: { actionId, eventSequence: event.sequence },
      });
    const first = await create();
    expect(first.statusCode, first.body).toBe(201);
    expect(first.body).not.toContain("СЫРОЙ-PAYLOAD");
    expect(first.body).not.toContain("1d20");
    expect(first.json()).toMatchObject({
      lifecycle: "DRAFT",
      title: "Бросок кубиков",
      worldDay: 7,
    });
    expect(first.json().gmNotes).toContain(`#${event.sequence}`);
    const replay = await create();
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
    // Черновик игроку не виден.
    expect((await list(secrets.player)).posts).toEqual([]);
    const [stored] = await db
      .select()
      .from(schema.storyPosts)
      .where(
        and(
          eq(schema.storyPosts.campaignId, ids.campaign),
          eq(schema.storyPosts.id, first.json().id),
        ),
      );
    expect(JSON.stringify(stored)).not.toContain("СЫРОЙ-PAYLOAD");
  });

  it("refuses technical, foreign and player-initiated seeds", async () => {
    const technical = await insertEvent(
      ids.campaign,
      ids.gm,
      "token.placed",
      {},
    );
    const foreign = await insertEvent(
      ids.foreignCampaign,
      ids.foreignGm,
      "dice.created",
      {},
    );
    for (const sequence of [technical.sequence, foreign.sequence, 999_999]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/story/posts/from-event",
        headers: headers(secrets.gm),
        payload: { actionId: action(), eventSequence: sequence },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "STORY_EVENT_NOT_FOUND" });
    }
    const dice = await insertEvent(ids.campaign, ids.gm, "dice.created", {});
    const player = await app.inject({
      method: "POST",
      url: "/api/story/posts/from-event",
      headers: headers(secrets.player),
      payload: { actionId: action(), eventSequence: dice.sequence },
    });
    expect(player.statusCode).toBe(403);
  });
});
