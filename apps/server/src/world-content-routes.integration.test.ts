import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerWorldContentRoutes } from "./world-content-routes.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  gm: id(),
  player: id(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

beforeAll(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([{ id: ids.campaign, name: "Campaign" }]);
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    { id: ids.player, campaignId: ids.campaign, role: "PLAYER", displayName: "Player" },
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
  app = Fastify();
  await app.register(cookie);
  registerWorldContentRoutes(app, db as never);
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await database.close();
});

const createBody = (overrides: Record<string, unknown> = {}) => ({
  actionId: id(),
  slug: `entity-${id()}`,
  type: "LOCATION",
  name: "The Hollow Keep",
  ...overrides,
});
async function createEntity(secret: string, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/world-content",
    headers: headers(secret),
    payload: createBody(overrides),
  });
}
async function publish(entityId: string, revision: number) {
  return app.inject({
    method: "POST",
    url: `/api/world-content/${entityId}/lifecycle`,
    headers: headers(secrets.gm),
    payload: { actionId: id(), revision, lifecycle: "PUBLISHED" },
  });
}

describe("world content HTTP: create", () => {
  it("lets the GM create with DRAFT lifecycle and revision 0", async () => {
    const res = await createEntity(secrets.gm);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      lifecycle: "DRAFT",
      revision: 0,
      gmOnlyText: "",
    });
  });

  it("forbids a player from creating", async () => {
    const res = await createEntity(secrets.player);
    expect(res.statusCode).toBe(403);
  });

  it("is idempotent on duplicate actionId", async () => {
    const body = createBody();
    const first = await app.inject({
      method: "POST",
      url: "/api/world-content",
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    const retry = await app.inject({
      method: "POST",
      url: "/api/world-content",
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });
  });

  it("returns 409 on a duplicate slug", async () => {
    const slug = `dup-${id()}`;
    const first = await createEntity(secrets.gm, { slug });
    expect(first.statusCode).toBe(201);
    const second = await createEntity(secrets.gm, { slug });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "WORLD_CONTENT_SLUG_CONFLICT" });
  });
});

describe("world content HTTP: list + get visibility", () => {
  it("hides DRAFT/ARCHIVED from a player at the DB query level, not just client-side", async () => {
    const draft = (await createEntity(secrets.gm, { name: "Draft Thing" })).json();
    const published = (await createEntity(secrets.gm, { name: "Published Thing" })).json();
    const publishRes = await publish(published.id, 0);
    expect(publishRes.statusCode).toBe(200);
    const publishedRow = publishRes.json();

    const gmList = (
      await app.inject({ method: "GET", url: "/api/world-content", headers: headers(secrets.gm) })
    ).json();
    const gmIds = gmList.map((r: { id: string }) => r.id);
    expect(gmIds).toEqual(expect.arrayContaining([draft.id, publishedRow.id]));

    const playerList = (
      await app.inject({ method: "GET", url: "/api/world-content", headers: headers(secrets.player) })
    ).json();
    const playerIds = playerList.map((r: { id: string }) => r.id);
    expect(playerIds).toContain(publishedRow.id);
    expect(playerIds).not.toContain(draft.id);
    // Player DTO never carries gmOnlyText at all.
    for (const row of playerList) expect(row).not.toHaveProperty("gmOnlyText");

    const playerGetDraft = await app.inject({
      method: "GET",
      url: `/api/world-content/${draft.id}`,
      headers: headers(secrets.player),
    });
    expect(playerGetDraft.statusCode).toBe(404);

    const playerGetPublished = await app.inject({
      method: "GET",
      url: `/api/world-content/${publishedRow.id}`,
      headers: headers(secrets.player),
    });
    expect(playerGetPublished.statusCode).toBe(200);
    expect(playerGetPublished.json()).not.toHaveProperty("gmOnlyText");
  });

  it("filters by type, tags, and free-text search", async () => {
    const monster = (
      await createEntity(secrets.gm, {
        type: "MONSTER",
        name: "Ash Wyrm",
        summary: "A dragon of cinders",
        tags: ["dragon", "boss"],
      })
    ).json();
    const other = (
      await createEntity(secrets.gm, { type: "LOCATION", name: "Quiet Village", tags: ["peaceful"] })
    ).json();

    const byType = (
      await app.inject({ method: "GET", url: "/api/world-content?type=MONSTER", headers: headers(secrets.gm) })
    ).json();
    expect(byType.map((r: { id: string }) => r.id)).toContain(monster.id);
    expect(byType.map((r: { id: string }) => r.id)).not.toContain(other.id);

    const byTag = (
      await app.inject({ method: "GET", url: "/api/world-content?tags=dragon", headers: headers(secrets.gm) })
    ).json();
    expect(byTag.map((r: { id: string }) => r.id)).toContain(monster.id);

    const bySearch = (
      await app.inject({ method: "GET", url: "/api/world-content?q=cinders", headers: headers(secrets.gm) })
    ).json();
    expect(bySearch.map((r: { id: string }) => r.id)).toContain(monster.id);
  });
});

describe("world content HTTP: update", () => {
  it("forbids a player, revision-gates, and applies changes for the GM", async () => {
    const created = (await createEntity(secrets.gm)).json();
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.player),
      payload: { actionId: id(), revision: 0, name: "Nope" },
    });
    expect(forbidden.statusCode).toBe(403);

    const conflict = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 9, name: "Wrong revision" },
    });
    expect(conflict.statusCode).toBe(409);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 0, name: "New name", gmOnlyText: "secret" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: "New name", gmOnlyText: "secret", revision: 1 });
  });

  it("is idempotent on duplicate actionId for updates", async () => {
    const created = (await createEntity(secrets.gm)).json();
    const actionId = id();
    const payload = { actionId, revision: 0, name: "Once" };
    const first = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.gm),
      payload,
    });
    expect(first.statusCode).toBe(200);
    const retry = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.gm),
      payload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });
  });
});

describe("world content HTTP: lifecycle transitions", () => {
  it("allows DRAFT -> PUBLISHED -> ARCHIVED -> PUBLISHED, rejects ARCHIVED -> DRAFT and self-transitions", async () => {
    const created = (await createEntity(secrets.gm)).json();
    const toPublished = await publish(created.id, 0);
    expect(toPublished.statusCode).toBe(200);
    expect(toPublished.json().lifecycle).toBe("PUBLISHED");

    const toArchived = await app.inject({
      method: "POST",
      url: `/api/world-content/${created.id}/lifecycle`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 1, lifecycle: "ARCHIVED" },
    });
    expect(toArchived.statusCode).toBe(200);
    expect(toArchived.json().lifecycle).toBe("ARCHIVED");

    const backToDraft = await app.inject({
      method: "POST",
      url: `/api/world-content/${created.id}/lifecycle`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 2, lifecycle: "DRAFT" },
    });
    expect(backToDraft.statusCode).toBe(422);

    const republish = await app.inject({
      method: "POST",
      url: `/api/world-content/${created.id}/lifecycle`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 2, lifecycle: "PUBLISHED" },
    });
    expect(republish.statusCode).toBe(200);

    const selfTransition = await app.inject({
      method: "POST",
      url: `/api/world-content/${created.id}/lifecycle`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 3, lifecycle: "PUBLISHED" },
    });
    expect(selfTransition.statusCode).toBe(422);
  });
});

describe("world content HTTP: delete (soft-delete to ARCHIVED)", () => {
  it("is GM-only, archives instead of hard-deleting, and is idempotent once archived", async () => {
    const created = (await createEntity(secrets.gm)).json();
    const forbidden = await app.inject({
      method: "DELETE",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.player),
      payload: { actionId: id(), revision: 0 },
    });
    expect(forbidden.statusCode).toBe(403);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 0 },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().lifecycle).toBe("ARCHIVED");

    const stillThere = await db
      .select()
      .from(schema.worldContent)
      .where(eq(schema.worldContent.id, created.id));
    expect(stillThere).toHaveLength(1);

    const deleteAgain = await app.inject({
      method: "DELETE",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 99 },
    });
    expect(deleteAgain.statusCode).toBe(200);
    expect(deleteAgain.json().lifecycle).toBe("ARCHIVED");
  });
});

describe("world content HTTP: relations", () => {
  it("rejects self-relations, 404s a missing target, dedups edges, and deletes cleanly", async () => {
    const a = (await createEntity(secrets.gm, { name: "A" })).json();
    const b = (await createEntity(secrets.gm, { name: "B" })).json();

    const selfRel = await app.inject({
      method: "POST",
      url: `/api/world-content/${a.id}/relations`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), toWorldContentId: a.id, relationType: "MEMBER_OF" },
    });
    expect(selfRel.statusCode).toBe(422);

    const missingTarget = await app.inject({
      method: "POST",
      url: `/api/world-content/${a.id}/relations`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), toWorldContentId: id(), relationType: "MEMBER_OF" },
    });
    expect(missingTarget.statusCode).toBe(404);

    const created = await app.inject({
      method: "POST",
      url: `/api/world-content/${a.id}/relations`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), toWorldContentId: b.id, relationType: "MEMBER_OF" },
    });
    expect(created.statusCode).toBe(201);
    const relation = created.json();

    const duplicateEdge = await app.inject({
      method: "POST",
      url: `/api/world-content/${a.id}/relations`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), toWorldContentId: b.id, relationType: "MEMBER_OF" },
    });
    expect(duplicateEdge.statusCode).toBe(409);

    const forbiddenDelete = await app.inject({
      method: "DELETE",
      url: `/api/world-content/relations/${relation.id}`,
      headers: headers(secrets.player),
      payload: { actionId: id() },
    });
    expect(forbiddenDelete.statusCode).toBe(403);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/world-content/relations/${relation.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id() },
    });
    expect(deleted.statusCode).toBe(204);
  });
});

describe("world content HTTP: media", () => {
  it("attaches, reorders/recaptions, and removes gallery entries", async () => {
    const entity = (await createEntity(secrets.gm)).json();
    const assetId = id();

    const attached = await app.inject({
      method: "POST",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), assetId, caption: "Cover art" },
    });
    expect(attached.statusCode).toBe(201);
    const media = attached.json();
    expect(media).toMatchObject({ assetId, caption: "Cover art", ordering: 0 });

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${entity.id}/media/${media.id}`,
      headers: headers(secrets.player),
      payload: { actionId: id(), caption: "Nope" },
    });
    expect(forbidden.statusCode).toBe(403);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${entity.id}/media/${media.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), caption: "Updated caption", ordering: 3 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ caption: "Updated caption", ordering: 3 });

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/world-content/${entity.id}/media/${media.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id() },
    });
    expect(removed.statusCode).toBe(204);

    const missing = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${entity.id}/media/${media.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), caption: "Gone" },
    });
    expect(missing.statusCode).toBe(404);
  });
});
