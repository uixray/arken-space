import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";
import { createMigratedPglite } from "./helpers/pglite-template.js";

/**
 * UIX-245 step 5 (owner decision 22.10.2026: a discovered entity is fully
 * visible): a DRAFT canon entity appears to a campaign's players once the GM
 * marks one of its instances in that campaign as discovered. GM-only text and
 * notes never reach players; other campaigns and ARCHIVED canon stay hidden.
 */
let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = {
  campaign: crypto.randomUUID(),
  other: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  otherPlayer: crypto.randomUUID(),
  draft: crypto.randomUUID(),
  archived: crypto.randomUUID(),
  instance: crypto.randomUUID(),
  cover: crypto.randomUUID(),
  portrait: crypto.randomUUID(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  otherPlayer: "o".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "Discovery campaign" },
    { id: ids.other, name: "Other campaign" },
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
      id: ids.otherPlayer,
      campaignId: ids.other,
      role: "PLAYER",
      displayName: "Other",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.player, secrets.player],
    [ids.otherPlayer, secrets.otherPlayer],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  for (const [id, name] of [
    [ids.cover, "cover"],
    [ids.portrait, "portrait"],
  ] as const)
    await db.insert(schema.assets).values({
      id,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "IMAGE",
      name,
      storageKey: `test/${id}`,
      mimeType: "image/png",
      sizeBytes: 1,
    });
  await db.insert(schema.worldContent).values([
    {
      id: ids.draft,
      slug: "hidden-order",
      type: "FACTION",
      name: "Скрытый орден",
      publicText: "Публичный текст ордена",
      gmOnlyText: "Тайна мастера",
      lifecycle: "DRAFT",
      coverAssetId: ids.cover,
    },
    {
      id: ids.archived,
      slug: "lost-city",
      type: "LOCATION",
      name: "Забытый город",
      lifecycle: "ARCHIVED",
    },
  ]);
  await db.insert(schema.worldContentInstances).values([
    {
      id: ids.instance,
      campaignId: ids.campaign,
      worldContentId: ids.draft,
      displayNameOverride: "Орден у переправы",
      currentState: "Ищет отряд",
      gmNotes: "Заметка мастера",
      portraitAssetId: ids.portrait,
      discovered: false,
    },
    {
      campaignId: ids.campaign,
      worldContentId: ids.archived,
      discovered: true,
    },
  ]);
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

const get = (url: string, secret: string) =>
  app.inject({ method: "GET", url, headers: headers(secret) });

const discover = () =>
  db
    .update(schema.worldContentInstances)
    .set({ discovered: true })
    .where(eq(schema.worldContentInstances.id, ids.instance));

describe("UIX-245 campaign discovery", () => {
  it("keeps an undiscovered draft hidden from players", async () => {
    const list = await get("/api/world-content", secrets.player);
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain("Скрытый орден");
    expect(
      (await get(`/api/world-content/${ids.draft}`, secrets.player)).statusCode,
    ).toBe(404);
    const instances = await get(
      `/api/world-content-instances?worldContentId=${ids.draft}`,
      secrets.player,
    );
    expect(instances.statusCode).toBe(200);
    expect(instances.json()).toEqual([]);
    const boot = await get("/api/bootstrap", secrets.player);
    expect(boot.body).not.toContain(ids.cover);
    expect(boot.body).not.toContain(ids.portrait);
  });

  it("shows a discovered draft and its instance to that campaign's players only", async () => {
    await discover();
    const list = await get("/api/world-content", secrets.player);
    expect(list.body).toContain("Скрытый орден");
    const detail = await get(`/api/world-content/${ids.draft}`, secrets.player);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      publicText: "Публичный текст ордена",
    });
    expect(detail.body).not.toContain("Тайна мастера");

    const instances = await get(
      `/api/world-content-instances?worldContentId=${ids.draft}`,
      secrets.player,
    );
    expect(instances.json()).toEqual([
      expect.objectContaining({
        id: ids.instance,
        displayNameOverride: "Орден у переправы",
        currentState: "Ищет отряд",
        portraitAssetId: ids.portrait,
        discovered: true,
      }),
    ]);
    expect(instances.body).not.toContain("Заметка мастера");
    expect(instances.json()[0]).not.toHaveProperty("currentLocationId");

    const boot = await get("/api/bootstrap", secrets.player);
    const assetIds = (
      boot.json() as { assets: Array<{ id: string }> }
    ).assets.map((asset) => asset.id);
    expect(assetIds).toEqual(expect.arrayContaining([ids.cover, ids.portrait]));

    const other = await get("/api/world-content", secrets.otherPlayer);
    expect(other.body).not.toContain("Скрытый орден");
    expect(
      (await get(`/api/world-content/${ids.draft}`, secrets.otherPlayer))
        .statusCode,
    ).toBe(404);
  });

  it("never reveals ARCHIVED canon, even when discovered", async () => {
    const list = await get("/api/world-content", secrets.player);
    expect(list.body).not.toContain("Забытый город");
    expect(
      (await get(`/api/world-content/${ids.archived}`, secrets.player))
        .statusCode,
    ).toBe(404);
  });

  it("marks story links to a discovered draft as player-visible", async () => {
    const create = () =>
      app.inject({
        method: "POST",
        url: "/api/story/posts",
        headers: headers(secrets.gm),
        payload: {
          actionId: crypto.randomUUID(),
          body: "Запись",
          entityLinks: [{ kind: "WORLD_ENTITY", entityId: ids.draft }],
        },
      });
    const before = await create();
    expect(before.statusCode, before.body).toBe(201);
    expect(before.json().linkTargets[0]).toMatchObject({
      playerVisible: false,
    });
    await discover();
    const after = await create();
    expect(after.json().linkTargets[0]).toMatchObject({
      label: "Скрытый орден",
      playerVisible: true,
    });
  });
});
