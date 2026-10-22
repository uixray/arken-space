import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoryLinkTargetDto } from "@arken/contracts";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";
import { createMigratedPglite } from "./helpers/pglite-template.js";

/**
 * UIX-245: запись летописи ссылается на сущности мира, места, карты, сцены и
 * другие записи. Сервер принимает только существующие цели этой кампании, а
 * игрок получает лишь ссылки на то, что ему видно, — без подписи и id скрытых.
 */
let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  publishedEntity: crypto.randomUUID(),
  draftEntity: crypto.randomUUID(),
  publishedMap: crypto.randomUUID(),
  hiddenMap: crypto.randomUUID(),
  publicLocation: crypto.randomUUID(),
  gmLocation: crypto.randomUUID(),
  locationOnHiddenMap: crypto.randomUUID(),
  activeScene: crypto.randomUUID(),
  otherScene: crypto.randomUUID(),
  foreignScene: crypto.randomUUID(),
};
const secrets = { gm: "g".repeat(40), player: "p".repeat(40) };
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const action = () => crypto.randomUUID();
const link = (kind: StoryLinkTargetDto["kind"], entityId: string) => ({
  kind,
  entityId,
});

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "Links campaign" },
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
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.player, secrets.player],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  await db.insert(schema.worldContent).values([
    {
      id: ids.publishedEntity,
      slug: "ice-crossing",
      type: "LOCATION",
      name: "Ледяная переправа",
      lifecycle: "PUBLISHED",
    },
    {
      id: ids.draftEntity,
      slug: "secret-cult",
      type: "FACTION",
      name: "Тайный культ",
      lifecycle: "DRAFT",
    },
  ]);
  const backgroundId = crypto.randomUUID();
  await db.insert(schema.assets).values({
    id: backgroundId,
    campaignId: ids.campaign,
    uploadedByMembershipId: ids.gm,
    kind: "MAP",
    name: "Synthetic map",
    storageKey: `test/${backgroundId}`,
    mimeType: "image/png",
    sizeBytes: 1,
  });
  await db.insert(schema.worldMaps).values([
    {
      id: ids.publishedMap,
      campaignId: ids.campaign,
      name: "Северный край",
      lifecycle: "PUBLISHED",
      visibility: "CAMPAIGN",
      backgroundAssetId: backgroundId,
      backgroundAssetApprovedByMembershipId: ids.gm,
      backgroundAssetApprovedAt: new Date(),
      publishedAt: new Date(),
    },
    {
      id: ids.hiddenMap,
      campaignId: ids.campaign,
      name: "Подземье",
      lifecycle: "DRAFT",
    },
  ]);
  await db.insert(schema.worldMapLocations).values([
    {
      id: ids.publicLocation,
      campaignId: ids.campaign,
      mapId: ids.publishedMap,
      name: "Старый маяк",
      visibility: "PUBLIC",
      x: 0.2,
      y: 0.3,
    },
    {
      id: ids.gmLocation,
      campaignId: ids.campaign,
      mapId: ids.publishedMap,
      name: "Логово",
      visibility: "GM_ONLY",
      x: 0.4,
      y: 0.5,
    },
    {
      id: ids.locationOnHiddenMap,
      campaignId: ids.campaign,
      mapId: ids.hiddenMap,
      name: "Грибной лес",
      visibility: "PUBLIC",
      x: 0.6,
      y: 0.7,
    },
  ]);
  const grid = {
    enabled: true,
    size: 64,
    offsetX: 0,
    offsetY: 0,
    color: "#ffffff",
    opacity: 0.2,
  };
  await db.insert(schema.scenes).values([
    { id: ids.activeScene, campaignId: ids.campaign, name: "Таверна", grid },
    { id: ids.otherScene, campaignId: ids.campaign, name: "Засада", grid },
    {
      id: ids.foreignScene,
      campaignId: ids.foreignCampaign,
      name: "Чужая",
      grid,
    },
  ]);
  await db
    .update(schema.campaigns)
    .set({ activeSceneId: ids.activeScene })
    .where(eq(schema.campaigns.id, ids.campaign));
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
  return app.inject({
    method: "POST",
    url: "/api/story/posts",
    headers: headers(secrets.gm),
    payload: { actionId: action(), body: "Запись", ...payload },
  });
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

async function list(secret: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/story/posts",
    headers: headers(secret),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as {
    posts: Array<{
      id: string;
      entityLinks: Array<{ kind: string; entityId: string }>;
      linkTargets: StoryLinkTargetDto[];
    }>;
  };
}

describe("UIX-245 chronicle entity links", () => {
  it("shows players only links to visible targets, with labels", async () => {
    const draftChronicle = await createDraft({ title: "Черновик мастера" });
    expect(draftChronicle.statusCode, draftChronicle.body).toBe(201);
    const allLinks = [
      link("WORLD_ENTITY", ids.publishedEntity),
      link("WORLD_ENTITY", ids.draftEntity),
      link("WORLD_MAP", ids.publishedMap),
      link("WORLD_MAP", ids.hiddenMap),
      link("LOCATION", ids.publicLocation),
      link("LOCATION", ids.gmLocation),
      link("LOCATION", ids.locationOnHiddenMap),
      link("SCENE", ids.activeScene),
      link("SCENE", ids.otherScene),
      link("CHRONICLE", draftChronicle.json<{ id: string }>().id),
    ];
    const created = await createDraft({
      title: "Переправа",
      entityLinks: allLinks,
    });
    expect(created.statusCode, created.body).toBe(201);
    const post = created.json<{
      id: string;
      revision: number;
      linkTargets: StoryLinkTargetDto[];
    }>();
    expect(post.linkTargets.map((target) => target.playerVisible)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    await publish(post);

    const gmPost = (await list(secrets.gm)).posts.find(
      (item) => item.id === post.id,
    )!;
    expect(gmPost.entityLinks).toHaveLength(allLinks.length);
    expect(gmPost.linkTargets.map((target) => target.label)).toEqual([
      "Ледяная переправа",
      "Тайный культ",
      "Северный край",
      "Подземье",
      "Старый маяк",
      "Логово",
      "Грибной лес",
      "Таверна",
      "Засада",
      "Черновик мастера",
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/story/posts",
      headers: headers(secrets.player),
    });
    const playerPost = (
      response.json() as Awaited<ReturnType<typeof list>>
    ).posts.find((item) => item.id === post.id)!;
    expect(playerPost.linkTargets).toEqual([
      {
        ...link("WORLD_ENTITY", ids.publishedEntity),
        label: "Ледяная переправа",
        playerVisible: true,
      },
      {
        ...link("WORLD_MAP", ids.publishedMap),
        label: "Северный край",
        playerVisible: true,
      },
      {
        ...link("LOCATION", ids.publicLocation),
        label: "Старый маяк",
        playerVisible: true,
      },
      {
        ...link("SCENE", ids.activeScene),
        label: "Таверна",
        playerVisible: true,
      },
    ]);
    expect(playerPost.entityLinks).toEqual(
      playerPost.linkTargets.map(({ kind, entityId }) => ({ kind, entityId })),
    );
    // Скрытые цели не утекают ни подписью, ни идентификатором.
    for (const secret of [
      "Тайный культ",
      "Подземье",
      "Логово",
      "Грибной лес",
      "Засада",
      "Черновик мастера",
      ids.draftEntity,
      ids.hiddenMap,
      ids.gmLocation,
      ids.locationOnHiddenMap,
      ids.otherScene,
    ])
      expect(response.body).not.toContain(secret);
  });

  it("rejects unknown and foreign targets (duplicates: story-post-contract)", async () => {
    for (const entityLinks of [
      [link("WORLD_ENTITY", crypto.randomUUID())],
      [link("SCENE", ids.foreignScene)],
      [link("LOCATION", ids.publishedMap)],
    ]) {
      const response = await createDraft({ entityLinks });
      expect(response.statusCode, JSON.stringify(entityLinks)).toBe(400);
      expect(response.json()).toEqual({ error: "STORY_LINKS_INVALID" });
    }
  });

  it("keeps a link to a deleted target editable and shows it to the GM only", async () => {
    const created = await createDraft({
      entityLinks: [link("SCENE", ids.otherScene)],
    });
    const post = created.json<{ id: string; revision: number }>();
    await db.delete(schema.scenes).where(eq(schema.scenes.id, ids.otherScene));
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/story/posts/${post.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: action(),
        revision: post.revision,
        body: "Исправленный текст",
        entityLinks: [
          link("SCENE", ids.otherScene),
          link("WORLD_ENTITY", ids.publishedEntity),
        ],
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(
      updated.json<{ linkTargets: StoryLinkTargetDto[] }>().linkTargets,
    ).toEqual([
      { ...link("SCENE", ids.otherScene), label: null, playerVisible: false },
      {
        ...link("WORLD_ENTITY", ids.publishedEntity),
        label: "Ледяная переправа",
        playerVisible: true,
      },
    ]);
    const added = await app.inject({
      method: "PATCH",
      url: `/api/story/posts/${post.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: action(),
        revision: post.revision + 1,
        entityLinks: [link("SCENE", crypto.randomUUID())],
      },
    });
    expect(added.statusCode).toBe(400);
  });

  it("lets only the GM search link targets by name", async () => {
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/story/link-targets",
      headers: headers(secrets.player),
    });
    expect(forbidden.statusCode).toBe(403);

    const all = await app.inject({
      method: "GET",
      url: "/api/story/link-targets",
      headers: headers(secrets.gm),
    });
    expect(all.statusCode, all.body).toBe(200);
    const kinds = new Set(
      all
        .json<{ targets: StoryLinkTargetDto[] }>()
        .targets.map((target) => target.kind),
    );
    expect([...kinds].sort()).toEqual([
      "LOCATION",
      "SCENE",
      "WORLD_ENTITY",
      "WORLD_MAP",
    ]);
    expect(all.body).not.toContain("Чужая");

    const found = await app.inject({
      method: "GET",
      url: `/api/story/link-targets?q=${encodeURIComponent("маяк")}`,
      headers: headers(secrets.gm),
    });
    expect(found.json<{ targets: StoryLinkTargetDto[] }>().targets).toEqual([
      {
        ...link("LOCATION", ids.publicLocation),
        label: "Старый маяк",
        playerVisible: true,
      },
    ]);
    const wildcard = await app.inject({
      method: "GET",
      url: `/api/story/link-targets?q=${encodeURIComponent("%")}`,
      headers: headers(secrets.gm),
    });
    expect(wildcard.json<{ targets: StoryLinkTargetDto[] }>().targets).toEqual(
      [],
    );
  });
});
