import Fastify, { type FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import cookie from "@fastify/cookie";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerWorldContentRoutes } from "./world-content-routes.js";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  foreignCampaign: id(),
  gm: id(),
  player: id(),
  foreignPlayer: id(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  foreignPlayer: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

beforeAll(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "Campaign" },
    { id: ids.foreignCampaign, name: "Foreign Campaign" },
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
      id: ids.foreignPlayer,
      campaignId: ids.foreignCampaign,
      role: "PLAYER",
      displayName: "Foreign Campaign Player",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.player, secrets.player],
    [ids.foreignPlayer, secrets.foreignPlayer],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  app = Fastify();
  await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => {
    const problem = error as Error & {
      validation?: unknown;
      statusCode?: number;
    };
    const isValidationError =
      Boolean(problem.validation) || problem.name === "ZodError";
    const statusCode = isValidationError ? 400 : (problem.statusCode ?? 500);
    return reply.code(statusCode).send({
      error: isValidationError ? "VALIDATION_ERROR" : "REQUEST_FAILED",
      message: problem.message,
    });
  });
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
async function createEntity(
  secret: string,
  overrides: Record<string, unknown> = {},
) {
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
async function seedGalleryAsset(
  assetId: string,
  options: {
    campaignId?: string;
    kind?: "MAP" | "TOKEN" | "PORTRAIT" | "IMAGE" | "AUDIO" | "DICE_FRAME";
    mimeType?: string;
  } = {},
) {
  const kind = options.kind ?? "IMAGE";
  await db.insert(schema.assets).values({
    id: assetId,
    campaignId: options.campaignId ?? ids.campaign,
    uploadedByMembershipId:
      options.campaignId === ids.foreignCampaign ? ids.foreignPlayer : ids.gm,
    kind,
    audioPurpose: kind === "AUDIO" ? "MUSIC" : null,
    name: "World content gallery fixture",
    storageKey: `uix245-gallery/${assetId}`,
    mimeType:
      options.mimeType ?? (kind === "AUDIO" ? "audio/mpeg" : "image/png"),
    sizeBytes: 128,
    posterStorageKey:
      kind === "DICE_FRAME" ? `uix245-gallery-poster/${assetId}` : null,
    posterSizeBytes: kind === "DICE_FRAME" ? 64 : null,
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
    const draft = (
      await createEntity(secrets.gm, { name: "Draft Thing" })
    ).json();
    const published = (
      await createEntity(secrets.gm, { name: "Published Thing" })
    ).json();
    const publishRes = await publish(published.id, 0);
    expect(publishRes.statusCode).toBe(200);
    const publishedRow = publishRes.json();

    const gmList = (
      await app.inject({
        method: "GET",
        url: "/api/world-content",
        headers: headers(secrets.gm),
      })
    ).json();
    const gmIds = gmList.map((r: { id: string }) => r.id);
    expect(gmIds).toEqual(expect.arrayContaining([draft.id, publishedRow.id]));

    const playerList = (
      await app.inject({
        method: "GET",
        url: "/api/world-content",
        headers: headers(secrets.player),
      })
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

  it("reuses published canon across campaigns without exposing hidden entities or GM fields", async () => {
    const published = (
      await createEntity(secrets.gm, {
        name: "Shared Published Canon",
        gmOnlyText: "Foreign campaign secret text",
      })
    ).json();
    await db
      .update(schema.worldContent)
      .set({
        sourceUrl: "https://example.test/private-provenance",
        rawContentHash: "private-provenance-hash",
      })
      .where(eq(schema.worldContent.id, published.id));
    const publishedRow = (await publish(published.id, 0)).json();
    const draft = (
      await createEntity(secrets.gm, { name: "Foreign Hidden Draft" })
    ).json();
    const archived = (
      await createEntity(secrets.gm, { name: "Foreign Hidden Archive" })
    ).json();
    const archivedPublished = (await publish(archived.id, 0)).json();
    const archivedResult = await app.inject({
      method: "POST",
      url: `/api/world-content/${archived.id}/lifecycle`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        revision: archivedPublished.revision,
        lifecycle: "ARCHIVED",
      },
    });
    expect(archivedResult.statusCode).toBe(200);

    for (const hidden of [draft, archived]) {
      const relation = await app.inject({
        method: "POST",
        url: `/api/world-content/${published.id}/relations`,
        headers: headers(secrets.gm),
        payload: {
          actionId: id(),
          toWorldContentId: hidden.id,
          relationType: "NEAR",
        },
      });
      expect(relation.statusCode, relation.body).toBe(201);
    }

    const foreignPlayer = headers(secrets.foreignPlayer);
    const playerGetPublished = await app.inject({
      method: "GET",
      url: `/api/world-content/${published.id}`,
      headers: foreignPlayer,
    });
    expect(playerGetPublished.statusCode).toBe(200);
    expect(playerGetPublished.json()).toMatchObject({
      id: publishedRow.id,
      name: "Shared Published Canon",
      publicText: "",
    });
    for (const key of ["gmOnlyText", "provenance", "lifecycle"])
      expect(playerGetPublished.json()).not.toHaveProperty(key);
    expect(playerGetPublished.body).not.toContain(
      "Foreign campaign secret text",
    );
    expect(playerGetPublished.body).not.toContain("private-provenance");

    const hiddenIds = [draft.id, archived.id];
    const listed = await app.inject({
      method: "GET",
      url: "/api/world-content",
      headers: foreignPlayer,
    });
    expect(listed.statusCode).toBe(200);
    const listedRows = listed.json();
    expect(listedRows.map((row: { id: string }) => row.id)).toContain(
      published.id,
    );
    for (const hiddenId of hiddenIds)
      expect(listedRows.map((row: { id: string }) => row.id)).not.toContain(
        hiddenId,
      );
    for (const key of ["gmOnlyText", "provenance", "lifecycle"])
      for (const row of listedRows) expect(row).not.toHaveProperty(key);

    const relations = await app.inject({
      method: "GET",
      url: `/api/world-content/${published.id}/relations`,
      headers: foreignPlayer,
    });
    expect(relations.statusCode).toBe(200);
    expect(relations.json()).toEqual([]);
    for (const hidden of [draft, archived]) {
      const detail = await app.inject({
        method: "GET",
        url: `/api/world-content/${hidden.id}`,
        headers: foreignPlayer,
      });
      const unknown = await app.inject({
        method: "GET",
        url: `/api/world-content/${id()}`,
        headers: foreignPlayer,
      });
      expect(detail.statusCode).toBe(404);
      expect(detail.body).toBe(unknown.body);

      const search = await app.inject({
        method: "GET",
        url: `/api/world-content?q=${encodeURIComponent(hidden.name)}`,
        headers: foreignPlayer,
      });
      expect(search.statusCode).toBe(200);
      expect(search.json()).toEqual([]);
      expect(search.body).not.toContain(hidden.name);
    }
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
      await createEntity(secrets.gm, {
        type: "LOCATION",
        name: "Quiet Village",
        tags: ["peaceful"],
      })
    ).json();

    const byType = (
      await app.inject({
        method: "GET",
        url: "/api/world-content?type=MONSTER",
        headers: headers(secrets.gm),
      })
    ).json();
    expect(byType.map((r: { id: string }) => r.id)).toContain(monster.id);
    expect(byType.map((r: { id: string }) => r.id)).not.toContain(other.id);

    const byTag = (
      await app.inject({
        method: "GET",
        url: "/api/world-content?tags=dragon",
        headers: headers(secrets.gm),
      })
    ).json();
    expect(byTag.map((r: { id: string }) => r.id)).toContain(monster.id);

    const bySearch = (
      await app.inject({
        method: "GET",
        url: "/api/world-content?q=cinders",
        headers: headers(secrets.gm),
      })
    ).json();
    expect(bySearch.map((r: { id: string }) => r.id)).toContain(monster.id);
  });
});

describe("world content HTTP: relatedTo list filter", () => {
  it("matches both edge directions, intersects other filters, and hides inaccessible IDs and endpoints", async () => {
    const subject = (
      await createEntity(secrets.gm, { name: "Known Subject" })
    ).json();
    const incoming = (
      await createEntity(secrets.gm, {
        type: "PERSON",
        name: "Mira Vale",
        tags: ["ally", "harbor"],
        gmOnlyText: "private note",
      })
    ).json();
    const outgoing = (
      await createEntity(secrets.gm, {
        type: "LOCATION",
        name: "Old Harbor",
        tags: ["harbor"],
      })
    ).json();
    const hidden = (
      await createEntity(secrets.gm, { name: "Hidden Target" })
    ).json();
    await publish(subject.id, 0);
    await publish(incoming.id, 0);
    await publish(outgoing.id, 0);

    for (const [from, to] of [
      [incoming.id, subject.id],
      [subject.id, outgoing.id],
      [subject.id, hidden.id],
    ]) {
      const relation = await app.inject({
        method: "POST",
        url: `/api/world-content/${from}/relations`,
        headers: headers(secrets.gm),
        payload: {
          actionId: id(),
          toWorldContentId: to,
          relationType: "CONNECTED_TO",
        },
      });
      expect(relation.statusCode).toBe(201);
    }

    const playerResponse = await app.inject({
      method: "GET",
      url: `/api/world-content?relatedTo=${subject.id}`,
      headers: headers(secrets.player),
    });
    expect(playerResponse.statusCode).toBe(200);
    const playerRows = playerResponse.json();
    expect(playerRows.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining([incoming.id, outgoing.id]),
    );
    expect(playerRows.map((row: { id: string }) => row.id)).not.toContain(
      hidden.id,
    );
    for (const row of playerRows) expect(row).not.toHaveProperty("gmOnlyText");

    const gmResponse = await app.inject({
      method: "GET",
      url: `/api/world-content?relatedTo=${subject.id}`,
      headers: headers(secrets.gm),
    });
    expect(gmResponse.json().map((row: { id: string }) => row.id)).toContain(
      hidden.id,
    );

    const combined = await app.inject({
      method: "GET",
      url: `/api/world-content?relatedTo=${subject.id}&type=PERSON&tags=ally&q=Mira`,
      headers: headers(secrets.player),
    });
    expect(combined.json().map((row: { id: string }) => row.id)).toEqual([
      incoming.id,
    ]);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/world-content?relatedTo=not-a-uuid",
      headers: headers(secrets.player),
    });
    expect(invalid.statusCode).toBe(400);

    const hiddenSubject = await app.inject({
      method: "GET",
      url: `/api/world-content?relatedTo=${hidden.id}`,
      headers: headers(secrets.player),
    });
    const unknownSubject = await app.inject({
      method: "GET",
      url: `/api/world-content?relatedTo=${id()}`,
      headers: headers(secrets.player),
    });
    expect(hiddenSubject.statusCode).toBe(404);
    expect(hiddenSubject.body).toBe(unknownSubject.body);
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
      payload: {
        actionId: id(),
        revision: 0,
        name: "New name",
        gmOnlyText: "secret",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      name: "New name",
      gmOnlyText: "secret",
      revision: 1,
    });
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
    expect(first.json()).toMatchObject({ name: "Once", revision: 1 });
    const retry = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.gm),
      payload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });

    const authoritative = await app.inject({
      method: "GET",
      url: `/api/world-content/${created.id}`,
      headers: headers(secrets.gm),
    });
    expect(authoritative.json()).toMatchObject({ name: "Once", revision: 1 });
    const actions = await db
      .select()
      .from(schema.worldContentActions)
      .where(eq(schema.worldContentActions.actionId, actionId));
    expect(actions).toHaveLength(1);
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
      payload: {
        actionId: id(),
        toWorldContentId: a.id,
        relationType: "MEMBER_OF",
      },
    });
    expect(selfRel.statusCode).toBe(422);

    const missingTarget = await app.inject({
      method: "POST",
      url: `/api/world-content/${a.id}/relations`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        toWorldContentId: id(),
        relationType: "MEMBER_OF",
      },
    });
    expect(missingTarget.statusCode).toBe(404);

    const created = await app.inject({
      method: "POST",
      url: `/api/world-content/${a.id}/relations`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        toWorldContentId: b.id,
        relationType: "MEMBER_OF",
      },
    });
    expect(created.statusCode).toBe(201);
    const relation = created.json();

    const duplicateEdge = await app.inject({
      method: "POST",
      url: `/api/world-content/${a.id}/relations`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        toWorldContentId: b.id,
        relationType: "MEMBER_OF",
      },
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

describe("world content HTTP: GET relations (UIX-245 stage 4)", () => {
  it("404s the whole request when the subject entity itself isn't visible to the caller", async () => {
    const draft = (
      await createEntity(secrets.gm, { name: "Hidden Subject" })
    ).json();
    const res = await app.inject({
      method: "GET",
      url: `/api/world-content/${draft.id}/relations`,
      headers: headers(secrets.player),
    });
    expect(res.statusCode).toBe(404);
  });

  it("shows a GM every edge in both directions regardless of the other entity's lifecycle", async () => {
    const hub = (await createEntity(secrets.gm, { name: "Hub" })).json();
    await publish(hub.id, 0);
    const draftTarget = (
      await createEntity(secrets.gm, { name: "Draft Target" })
    ).json();
    const publishedTarget = (
      await createEntity(secrets.gm, { name: "Published Target" })
    ).json();
    const publishedTargetRow = (await publish(publishedTarget.id, 0)).json();
    const incomingSource = (
      await createEntity(secrets.gm, { name: "Incoming Source" })
    ).json();
    const incomingSourceRow = (await publish(incomingSource.id, 0)).json();

    await app.inject({
      method: "POST",
      url: `/api/world-content/${hub.id}/relations`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        toWorldContentId: draftTarget.id,
        relationType: "GUARDS",
      },
    });
    await app.inject({
      method: "POST",
      url: `/api/world-content/${hub.id}/relations`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        toWorldContentId: publishedTargetRow.id,
        relationType: "NEAR",
      },
    });
    await app.inject({
      method: "POST",
      url: `/api/world-content/${incomingSourceRow.id}/relations`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        toWorldContentId: hub.id,
        relationType: "MEMBER_OF",
      },
    });

    const gmRes = await app.inject({
      method: "GET",
      url: `/api/world-content/${hub.id}/relations`,
      headers: headers(secrets.gm),
    });
    expect(gmRes.statusCode).toBe(200);
    const gmEdges = gmRes.json();
    expect(gmEdges).toHaveLength(3);
    const gmEntityIds = gmEdges.map(
      (edge: { entity: { id: string } }) => edge.entity.id,
    );
    expect(gmEntityIds).toEqual(
      expect.arrayContaining([
        draftTarget.id,
        publishedTargetRow.id,
        incomingSourceRow.id,
      ]),
    );
    const outgoingToDraft = gmEdges.find(
      (edge: { entity: { id: string } }) => edge.entity.id === draftTarget.id,
    );
    expect(outgoingToDraft).toMatchObject({
      direction: "OUTGOING",
      relationType: "GUARDS",
    });
    const incoming = gmEdges.find(
      (edge: { entity: { id: string } }) =>
        edge.entity.id === incomingSourceRow.id,
    );
    expect(incoming).toMatchObject({
      direction: "INCOMING",
      relationType: "MEMBER_OF",
    });

    // A player on the same hub never learns the DRAFT target exists, but
    // sees both PUBLISHED edges in the correct direction.
    const playerRes = await app.inject({
      method: "GET",
      url: `/api/world-content/${hub.id}/relations`,
      headers: headers(secrets.player),
    });
    expect(playerRes.statusCode).toBe(200);
    const playerEdges = playerRes.json();
    const playerEntityIds = playerEdges.map(
      (edge: { entity: { id: string } }) => edge.entity.id,
    );
    expect(playerEntityIds).not.toContain(draftTarget.id);
    expect(playerEntityIds).toEqual(
      expect.arrayContaining([publishedTargetRow.id, incomingSourceRow.id]),
    );
    expect(playerEdges).toHaveLength(2);
    // Player-safe entity ref never carries lifecycle or extra fields.
    for (const edge of playerEdges) {
      expect(edge.entity).not.toHaveProperty("lifecycle");
      expect(Object.keys(edge.entity).sort()).toEqual([
        "id",
        "name",
        "slug",
        "type",
      ]);
    }
  });

  it("returns an empty list when there are no relations", async () => {
    const solo = (await createEntity(secrets.gm, { name: "Solo" })).json();
    await publish(solo.id, 0);
    const res = await app.inject({
      method: "GET",
      url: `/api/world-content/${solo.id}/relations`,
      headers: headers(secrets.gm),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("world content HTTP: GET media (UIX-245 stage 4)", () => {
  it("404s when the parent entity isn't visible to the caller", async () => {
    const draft = (
      await createEntity(secrets.gm, { name: "Hidden Parent" })
    ).json();
    const res = await app.inject({
      method: "GET",
      url: `/api/world-content/${draft.id}/media`,
      headers: headers(secrets.player),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns the ordered gallery for GM and (once published) player callers alike", async () => {
    const entity = (
      await createEntity(secrets.gm, { name: "Gallery Owner" })
    ).json();
    const assetOne = id();
    const assetTwo = id();
    await seedGalleryAsset(assetOne);
    await seedGalleryAsset(assetTwo);
    const attachOne = await app.inject({
      method: "POST",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), assetId: assetOne, caption: "First" },
    });
    expect(attachOne.statusCode, attachOne.body).toBe(201);
    const attachTwo = await app.inject({
      method: "POST",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), assetId: assetTwo, caption: "Second" },
    });
    expect(attachTwo.statusCode, attachTwo.body).toBe(201);

    const gmRes = await app.inject({
      method: "GET",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.gm),
    });
    expect(gmRes.statusCode).toBe(200);
    expect(gmRes.json()).toMatchObject([
      { assetId: assetOne, ordering: 0 },
      { assetId: assetTwo, ordering: 1 },
    ]);

    const playerBefore = await app.inject({
      method: "GET",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.player),
    });
    expect(playerBefore.statusCode).toBe(404);

    await publish(entity.id, 0);
    const playerAfter = await app.inject({
      method: "GET",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.player),
    });
    expect(playerAfter.statusCode).toBe(200);
    expect(playerAfter.json()).toHaveLength(2);
  });
});

describe("world content HTTP: media", () => {
  it("keeps the importer row lock before media and action inserts in the same route transaction", async () => {
    const source = await readFile(
      new URL("./world-content-routes.ts", import.meta.url),
      "utf8",
    );
    const mediaRouteStart = source.indexOf(
      'app.post("/api/world-content/:id/media"',
    );
    const mediaRouteEnd = source.indexOf(
      'app.patch("/api/world-content/:id/media/:mediaId"',
      mediaRouteStart,
    );
    expect(mediaRouteStart).toBeGreaterThanOrEqual(0);
    expect(mediaRouteEnd).toBeGreaterThan(mediaRouteStart);
    const mediaRoute = source.slice(mediaRouteStart, mediaRouteEnd);
    const transaction =
      mediaRoute.match(/db\.transaction\s*\(\s*async\s*\(\s*tx\s*\)/)?.index ??
      -1;
    const lock = mediaRoute.indexOf('.for("update")');
    const mediaInsert = mediaRoute.indexOf(".insert(worldContentMedia)");
    const actionInsert = mediaRoute.indexOf(".insert(worldContentActions)");
    expect(transaction).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(transaction);
    expect(mediaInsert).toBeGreaterThan(lock);
    expect(actionInsert).toBeGreaterThan(mediaInsert);
  });

  it("checks importer DRAFT preconditions after auth and before its transaction; committed ordering is explicit", async () => {
    const provenance = {
      sourceUrl: "https://arc.framer.photos/#uix263-ordering",
      sourceExternalId: "artbook-import-ordering",
      retrievedAt: new Date(0).toISOString(),
      rawContentHash: "sha256:ordering",
      attribution: "Reviewed source attribution",
      rightsReviewStatus: "APPROVED",
      editorialApprovalStatus: "PENDING",
    };
    let reachedSeam!: () => void;
    let releaseSeam!: () => void;
    const seamReached = new Promise<void>((resolve) => (reachedSeam = resolve));
    let gate = new Promise<void>((resolve) => (releaseSeam = resolve));
    const raceApp = Fastify();
    await raceApp.register(cookie);
    registerWorldContentRoutes(raceApp, db as never, {
      beforeImporterMediaTransaction: async () => {
        reachedSeam();
        await gate;
      },
    });
    await raceApp.ready();
    try {
      const entity = (await createEntity(secrets.gm, { provenance })).json();
      const assetId = id();
      await seedGalleryAsset(assetId);
      const condition = {
        expectedRevision: entity.revision,
        slug: entity.slug,
        type: entity.type,
        name: entity.name,
        summary: entity.summary,
        provenance: entity.provenance,
      };
      const actionId = id();
      const importerRequest = raceApp.inject({
        method: "POST",
        url: `/api/world-content/${entity.id}/media`,
        headers: headers(secrets.gm),
        payload: { actionId, assetId, importPrecondition: condition },
      });
      await seamReached;
      const published = await raceApp.inject({
        method: "POST",
        url: `/api/world-content/${entity.id}/lifecycle`,
        headers: headers(secrets.gm),
        payload: {
          actionId: id(),
          revision: entity.revision,
          lifecycle: "PUBLISHED",
        },
      });
      expect(published.statusCode, published.body).toBe(200);
      releaseSeam();
      gate = Promise.resolve();
      const rejected = await importerRequest;
      expect(rejected.statusCode, rejected.body).toBe(409);
      expect(
        await db
          .select()
          .from(schema.worldContentMedia)
          .where(eq(schema.worldContentMedia.worldContentId, entity.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.worldContentActions)
          .where(eq(schema.worldContentActions.actionId, actionId)),
      ).toHaveLength(0);

      const editedFirst = (
        await createEntity(secrets.gm, {
          provenance: {
            ...provenance,
            sourceExternalId: "artbook-edit-first",
          },
        })
      ).json();
      const editedAsset = id();
      await seedGalleryAsset(editedAsset);
      const edit = await raceApp.inject({
        method: "PATCH",
        url: `/api/world-content/${editedFirst.id}`,
        headers: headers(secrets.gm),
        payload: {
          actionId: id(),
          revision: editedFirst.revision,
          name: "Changed after the importer preview",
        },
      });
      expect(edit.statusCode, edit.body).toBe(200);
      const staleAfterEdit = await raceApp.inject({
        method: "POST",
        url: `/api/world-content/${editedFirst.id}/media`,
        headers: headers(secrets.gm),
        payload: {
          actionId: id(),
          assetId: editedAsset,
          importPrecondition: {
            ...condition,
            expectedRevision: editedFirst.revision,
            slug: editedFirst.slug,
            type: editedFirst.type,
            name: editedFirst.name,
            summary: editedFirst.summary,
            provenance: editedFirst.provenance,
          },
        },
      });
      expect(staleAfterEdit.statusCode, staleAfterEdit.body).toBe(409);

      const second = (
        await createEntity(secrets.gm, {
          provenance: {
            ...provenance,
            sourceExternalId: "artbook-import-first",
          },
        })
      ).json();
      const secondAsset = id();
      await seedGalleryAsset(secondAsset);
      const importFirstActionId = id();
      const attached = await raceApp.inject({
        method: "POST",
        url: `/api/world-content/${second.id}/media`,
        headers: headers(secrets.gm),
        payload: {
          actionId: importFirstActionId,
          assetId: secondAsset,
          importPrecondition: {
            ...condition,
            expectedRevision: second.revision,
            slug: second.slug,
            type: second.type,
            name: second.name,
            summary: second.summary,
            provenance: second.provenance,
          },
        },
      });
      expect(attached.statusCode, attached.body).toBe(201);
      const attachedEntity = await raceApp.inject({
        method: "GET",
        url: `/api/world-content/${second.id}`,
        headers: headers(secrets.gm),
      });
      expect(attachedEntity.statusCode, attachedEntity.body).toBe(200);
      const thenPublished = await raceApp.inject({
        method: "POST",
        url: `/api/world-content/${second.id}/lifecycle`,
        headers: headers(secrets.gm),
        payload: {
          actionId: id(),
          revision: attachedEntity.json().revision,
          lifecycle: "PUBLISHED",
        },
      });
      expect(thenPublished.statusCode, thenPublished.body).toBe(200);
      expect(thenPublished.json().lifecycle).toBe("PUBLISHED");
      expect(
        await db
          .select()
          .from(schema.worldContentMedia)
          .where(eq(schema.worldContentMedia.worldContentId, second.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(schema.worldContentActions)
          .where(eq(schema.worldContentActions.actionId, importFirstActionId)),
      ).toHaveLength(1);
    } finally {
      releaseSeam();
      await raceApp.close();
    }
  });
  it("enforces atomic importer DRAFT/source/revision preconditions while preserving generic GM media edits", async () => {
    const provenance = {
      sourceUrl: "https://arc.framer.photos/#uix263-test",
      sourceExternalId: "artbook-import-precondition",
      retrievedAt: new Date(0).toISOString(),
      rawContentHash: "sha256:test",
      attribution: "Reviewed source attribution",
      rightsReviewStatus: "APPROVED",
      editorialApprovalStatus: "PENDING",
    };
    const entity = (await createEntity(secrets.gm, { provenance })).json();
    const assetId = id();
    await seedGalleryAsset(assetId);
    const precondition = {
      expectedRevision: entity.revision,
      slug: entity.slug,
      type: entity.type,
      name: entity.name,
      summary: entity.summary,
      provenance: entity.provenance,
    };
    const add = (body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/api/world-content/${entity.id}/media`,
        headers: headers(secrets.gm),
        payload: body,
      });
    const actionId = id();
    const attached = await add({
      actionId,
      assetId,
      importPrecondition: precondition,
    });
    expect(attached.statusCode, attached.body).toBe(201);
    const duplicate = await add({
      actionId,
      assetId,
      importPrecondition: precondition,
    });
    expect(duplicate.json()).toEqual({ duplicate: true });
    expect(
      await db
        .select()
        .from(schema.worldContentMedia)
        .where(eq(schema.worldContentMedia.worldContentId, entity.id)),
    ).toHaveLength(1);

    const editedBeforeRetry = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${entity.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        revision: entity.revision,
        name: `${entity.name} changed after preview`,
      },
    });
    expect(editedBeforeRetry.statusCode, editedBeforeRetry.body).toBe(200);
    const actionCount = await db.select().from(schema.worldContentActions);
    const staleRevision = await add({
      actionId: id(),
      assetId,
      importPrecondition: precondition,
    });
    expect(staleRevision.statusCode).toBe(409);
    for (const changed of [
      { name: "Manual edit" },
      { summary: "Changed source text" },
      { provenance: { ...provenance, rawContentHash: "sha256:changed" } },
    ]) {
      const mismatch = await add({
        actionId: id(),
        assetId,
        importPrecondition: { ...precondition, ...changed },
      });
      expect(mismatch.statusCode).toBe(409);
    }
    const partial = await add({
      actionId: id(),
      assetId,
      importPrecondition: { expectedRevision: 0 },
    });
    expect(partial.statusCode).toBe(400);
    expect(
      await db
        .select()
        .from(schema.worldContentMedia)
        .where(eq(schema.worldContentMedia.worldContentId, entity.id)),
    ).toHaveLength(1);
    expect(await db.select().from(schema.worldContentActions)).toHaveLength(
      actionCount.length,
    );

    await publish(entity.id, editedBeforeRetry.json().revision);
    const publishedPrecondition = await db.select().from(schema.worldContent);
    const publishedEntity = publishedPrecondition.find(
      (item) => item.id === entity.id,
    )!;
    const published = await add({
      actionId: id(),
      assetId,
      importPrecondition: {
        ...precondition,
        expectedRevision: publishedEntity.revision,
      },
    });
    expect(published.statusCode).toBe(409);
    const genericAssetId = id();
    await seedGalleryAsset(genericAssetId);
    const generic = await app.inject({
      method: "POST",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), assetId: genericAssetId },
    });
    expect(generic.statusCode, generic.body).toBe(201);
    const archived = await app.inject({
      method: "POST",
      url: `/api/world-content/${entity.id}/lifecycle`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        revision: publishedEntity.revision,
        lifecycle: "ARCHIVED",
      },
    });
    expect(archived.statusCode).toBe(200);
    const archivedAttempt = await add({
      actionId: id(),
      assetId,
      importPrecondition: {
        ...precondition,
        expectedRevision: archived.json().revision,
      },
    });
    expect(archivedAttempt.statusCode).toBe(409);

    const rollbackEntity = (
      await createEntity(secrets.gm, { provenance })
    ).json();
    const forcedActionId = id();
    const constraintName = `test_fail_media_action_${forcedActionId.replaceAll("-", "")}`;
    await database.exec(
      `ALTER TABLE world_content_actions ADD CONSTRAINT ${constraintName} CHECK (action_id <> '${forcedActionId}'::uuid)`,
    );
    try {
      const failed = await app.inject({
        method: "POST",
        url: `/api/world-content/${rollbackEntity.id}/media`,
        headers: headers(secrets.gm),
        payload: {
          actionId: forcedActionId,
          assetId: genericAssetId,
          importPrecondition: {
            expectedRevision: rollbackEntity.revision,
            slug: rollbackEntity.slug,
            type: rollbackEntity.type,
            name: rollbackEntity.name,
            summary: rollbackEntity.summary,
            provenance: rollbackEntity.provenance,
          },
        },
      });
      expect(failed.statusCode).toBe(500);
      expect(
        await db
          .select()
          .from(schema.worldContentMedia)
          .where(
            eq(schema.worldContentMedia.worldContentId, rollbackEntity.id),
          ),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.worldContentActions)
          .where(eq(schema.worldContentActions.actionId, forcedActionId)),
      ).toHaveLength(0);
    } finally {
      await database.exec(
        `ALTER TABLE world_content_actions DROP CONSTRAINT ${constraintName}`,
      );
    }
    const player = await app.inject({
      method: "POST",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.player),
      payload: { actionId: id(), assetId: genericAssetId },
    });
    expect(player.statusCode).toBe(403);
  });

  it("accepts campaign-owned image-compatible kinds and rejects missing, foreign, and non-image references", async () => {
    const entity = (await createEntity(secrets.gm)).json();
    const supported = [
      "MAP",
      "TOKEN",
      "PORTRAIT",
      "IMAGE",
      "DICE_FRAME",
    ] as const;
    for (const kind of supported) {
      const assetId = id();
      await seedGalleryAsset(assetId, { kind, mimeType: "image/webp" });
      const create = await createEntity(secrets.gm, {
        slug: `kind-${kind.toLowerCase().replaceAll("_", "-")}-${id()}`,
        coverAssetId: assetId,
      });
      expect(create.statusCode, `${kind} create: ${create.body}`).toBe(201);
      const latestEntity = await app.inject({
        method: "GET",
        url: `/api/world-content/${entity.id}`,
        headers: headers(secrets.gm),
      });
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/world-content/${entity.id}`,
        headers: headers(secrets.gm),
        payload: {
          actionId: id(),
          revision: latestEntity.json().revision,
          coverAssetId: assetId,
        },
      });
      expect(patch.statusCode, `${kind} patch: ${patch.body}`).toBe(200);
      const attached = await app.inject({
        method: "POST",
        url: `/api/world-content/${entity.id}/media`,
        headers: headers(secrets.gm),
        payload: { actionId: id(), assetId },
      });
      expect(attached.statusCode, `${kind} media: ${attached.body}`).toBe(201);
    }

    const foreignId = id();
    const audioId = id();
    const wrongMimeId = id();
    await seedGalleryAsset(foreignId, { campaignId: ids.foreignCampaign });
    await seedGalleryAsset(audioId, { kind: "AUDIO" });
    await seedGalleryAsset(wrongMimeId, { mimeType: "application/pdf" });
    const invalidIds = [foreignId, audioId, wrongMimeId, id()];
    for (const assetId of invalidIds) {
      const create = await createEntity(secrets.gm, {
        slug: `bad-cover-${id()}`,
        coverAssetId: assetId,
      });
      expect(create.statusCode, create.body).toBe(422);
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/world-content/${entity.id}`,
        headers: headers(secrets.gm),
        payload: { actionId: id(), revision: 0, coverAssetId: assetId },
      });
      expect(patch.statusCode, patch.body).toBe(422);
      const media = await app.inject({
        method: "POST",
        url: `/api/world-content/${entity.id}/media`,
        headers: headers(secrets.gm),
        payload: { actionId: id(), assetId },
      });
      expect(media.statusCode, media.body).toBe(422);
    }

    const player = await app.inject({
      method: "POST",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.player),
      payload: { actionId: id(), assetId: foreignId },
    });
    expect(player.statusCode).toBe(403);
    const currentBeforeClear = await app.inject({
      method: "GET",
      url: `/api/world-content/${entity.id}`,
      headers: headers(secrets.gm),
    });
    const clear = await app.inject({
      method: "PATCH",
      url: `/api/world-content/${entity.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        revision: currentBeforeClear.json().revision,
        coverAssetId: null,
      },
    });
    expect(clear.statusCode, clear.body).toBe(200);
    expect(clear.json().coverAssetId).toBeNull();
    expect(clear.json().revision).toBe(currentBeforeClear.json().revision + 1);
  });

  it("attaches, reorders/recaptions, and removes gallery entries", async () => {
    const entity = (await createEntity(secrets.gm)).json();
    const assetId = id();
    await seedGalleryAsset(assetId);

    const attached = await app.inject({
      method: "POST",
      url: `/api/world-content/${entity.id}/media`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), assetId, caption: "Cover art" },
    });
    expect(attached.statusCode, attached.body).toBe(201);
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
    expect(updated.json()).toMatchObject({
      caption: "Updated caption",
      ordering: 3,
    });

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

describe("world content HTTP: import provenance (UIX-263)", () => {
  it("stores provenance on create and returns it to the GM only", async () => {
    const provenance = {
      sourceUrl: "https://arc.framer.photos/#panteon",
      sourceExternalId: "artbook-yaro",
      retrievedAt: "2026-10-22T00:00:00.000Z",
      rawContentHash: "sha256:abc",
      attribution: "Вселенная — автор",
      rightsReviewStatus: "APPROVED",
      editorialApprovalStatus: "PENDING",
    } as const;
    const created = await createEntity(secrets.gm, { provenance });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ lifecycle: "DRAFT", provenance });
    await publish(created.json().id, created.json().revision);
    const player = await app.inject({
      method: "GET",
      url: `/api/world-content/${created.json().id}`,
      headers: headers(secrets.player),
    });
    expect(player.statusCode).toBe(200);
    expect(player.body).not.toContain("arc.framer.photos");
  });
});
