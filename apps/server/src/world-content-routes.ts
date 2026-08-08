import { and, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  worldContent,
  worldContentActions,
  worldContentMedia,
  worldContentRelations,
} from "@arken/db";
import {
  addWorldContentMediaSchema,
  createWorldContentRelationSchema,
  createWorldContentSchema,
  deleteWorldContentRelationSchema,
  deleteWorldContentSchema,
  removeWorldContentMediaSchema,
  transitionWorldContentLifecycleSchema,
  updateWorldContentMediaSchema,
  updateWorldContentSchema,
  worldContentTypeSchema,
  type WorldContentLifecycle,
  type WorldContentMediaDto,
  type WorldContentRelationDto,
  type WorldContentRelationEdgeDto,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";
import {
  toGmDto,
  toPlayerDto,
  worldContentByIdVisibleTo,
  worldContentDefaultOrder,
  worldContentPlayerColumns,
  worldContentVisibility,
  type WorldContentAuthContext,
} from "./world-content.js";

/**
 * HTTP CRUD routes for World Content (UIX-245 Stage 2: GM entity manager
 * server slice). Follows the actionId-idempotency + `*Actions` audit-row +
 * revision/CAS pattern used throughout this codebase (see
 * `./character-media.ts` and the `POST /api/fog-reveals` handler in
 * `./routes.ts`), adapted for `worldContentActions`, which — unlike
 * `gameEvents`/`actionJournal` — has no `campaignId` (World Content is
 * campaign-independent; see the `worldContent` doc comment in
 * `packages/db/src/schema.ts`), so `actionId` dedup here is global, not
 * scoped per campaign.
 *
 * All mutations are GM-only. Reads apply the GM/player visibility split via
 * `canViewWorldContent`/`worldContentVisibility`/`worldContentByIdVisibleTo`
 * from `./world-content.ts`, whose signatures this file does not modify.
 */

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type RequestDb = Database | Transaction;
type WorldContentMediaRow = typeof worldContentMedia.$inferSelect;
type WorldContentRelationRow = typeof worldContentRelations.$inferSelect;

function fail(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  status: number,
  error: string,
) {
  return reply.code(status).send({ error });
}

/**
 * The minimal shape exposed for the *other* side of a relation edge, or (in
 * spirit) any place a caller just needs enough to render a link — never the
 * full GM or player DTO. Deliberately excludes `lifecycle` too: a player
 * must not learn a hidden entity's lifecycle, only that it doesn't exist.
 */
const worldContentEntityRefColumns = {
  id: worldContent.id,
  slug: worldContent.slug,
  type: worldContent.type,
  name: worldContent.name,
} as const;

/** Global actionId lookup: `worldContentActions` has no campaignId (see module doc comment). */
async function findAction(db: RequestDb, actionId: string) {
  const [row] = await db
    .select()
    .from(worldContentActions)
    .where(eq(worldContentActions.actionId, actionId))
    .limit(1);
  return row ?? null;
}

/**
 * Postgres unique-violation errors surface either directly or wrapped in
 * Drizzle's `DrizzleQueryError.cause` (see `drizzle-orm/pg-core/session.js`)
 * — unwrap one level of `cause` so both shapes are recognized.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    if (typeof candidate !== "object" || candidate === null) continue;
    if (!("code" in candidate) || (candidate as { code?: unknown }).code !== "23505")
      continue;
    const name =
      ("constraint_name" in candidate &&
        (candidate as { constraint_name?: unknown }).constraint_name) ||
      ("constraint" in candidate && (candidate as { constraint?: unknown }).constraint);
    if (name === constraint) return true;
  }
  return false;
}

function mediaDto(row: WorldContentMediaRow): WorldContentMediaDto {
  return {
    id: row.id,
    worldContentId: row.worldContentId,
    assetId: row.assetId,
    caption: row.caption,
    ordering: row.ordering,
    createdAt: row.createdAt.toISOString(),
  };
}

function relationDto(row: WorldContentRelationRow): WorldContentRelationDto {
  return {
    id: row.id,
    fromWorldContentId: row.fromWorldContentId,
    toWorldContentId: row.toWorldContentId,
    relationType: row.relationType,
    note: row.note,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findEntity(db: RequestDb, id: string) {
  const [row] = await db
    .select()
    .from(worldContent)
    .where(eq(worldContent.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * DRAFT -> PUBLISHED -> ARCHIVED is the forward path; ARCHIVED -> PUBLISHED
 * (republish) is the one reverse transition allowed, mirroring "un-delete
 * restores what was live", not what was mid-edit. ARCHIVED -> DRAFT is
 * deliberately not legal: silently resurrecting archived canon back into an
 * unreviewed draft state would let it disappear from the player-visible
 * encyclopedia without an explicit publish action. Self-transitions
 * (X -> X) are not legal through this table either — `DELETE` handles the
 * ARCHIVED -> ARCHIVED idempotent case separately.
 */
const LEGAL_LIFECYCLE_TRANSITIONS: Record<
  WorldContentLifecycle,
  WorldContentLifecycle[]
> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: ["PUBLISHED"],
};

function isLegalTransition(
  from: WorldContentLifecycle,
  to: WorldContentLifecycle,
): boolean {
  return LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to);
}

const idParams = z.object({ id: z.string().uuid() }).strict();
const mediaParams = z
  .object({ id: z.string().uuid(), mediaId: z.string().uuid() })
  .strict();
const relationParams = z
  .object({ relationId: z.string().uuid() })
  .strict();
const listQuerySchema = z
  .object({
    type: worldContentTypeSchema.optional(),
    tags: z.string().trim().min(1).max(500).optional(),
    q: z.string().trim().min(1).max(200).optional(),
  })
  .partial()
  .passthrough();

export function registerWorldContentRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/world-content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = listQuerySchema.parse(request.query);
    const authCtx: WorldContentAuthContext = { role: auth.role };
    const conditions: SQL[] = [worldContentVisibility(authCtx)];
    if (query.type) conditions.push(eq(worldContent.type, query.type));
    const tags = query.tags
      ? query.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    for (const tag of tags)
      conditions.push(
        sql`${worldContent.tags} @> ${JSON.stringify([tag])}::jsonb`,
      );
    if (query.q) {
      const like = `%${query.q}%`;
      conditions.push(
        or(
          ilike(worldContent.name, like),
          ilike(worldContent.summary, like),
          sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${worldContent.aliases}) AS alias WHERE alias ILIKE ${like})`,
        )!,
      );
    }
    const where = and(...conditions)!;
    if (auth.role === "GM") {
      const rows = await db
        .select()
        .from(worldContent)
        .where(where)
        .orderBy(worldContentDefaultOrder);
      return reply.send(rows.map(toGmDto));
    }
    const rows = await db
      .select(worldContentPlayerColumns)
      .from(worldContent)
      .where(where)
      .orderBy(worldContentDefaultOrder);
    return reply.send(rows.map(toPlayerDto));
  });

  app.get("/api/world-content/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const authCtx: WorldContentAuthContext = { role: auth.role };
    if (auth.role === "GM") {
      const [row] = await db
        .select()
        .from(worldContent)
        .where(worldContentByIdVisibleTo(authCtx, id))
        .limit(1);
      if (!row) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
      return reply.send(toGmDto(row));
    }
    const [row] = await db
      .select(worldContentPlayerColumns)
      .from(worldContent)
      .where(worldContentByIdVisibleTo(authCtx, id))
      .limit(1);
    if (!row) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
    return reply.send(toPlayerDto(row));
  });

  /**
   * `GET /api/world-content/:id/relations` (UIX-245 Stage 4): edges in both
   * directions, each joined with the *other* entity's minimal ref
   * (id/slug/type/name) so the client never has to do N+1 lookups. Visibility
   * is layered twice: the subject entity itself must be visible to the
   * caller (same 404 as the single-entity GET — a player must never learn
   * this entity exists via a relations probe either), and for a player the
   * *other* entity on each edge must also be PUBLISHED or the edge is
   * dropped entirely, never merely redacted — a player must not learn a
   * hidden entity exists just because something published links to it. The
   * GM sees every edge, regardless of the other entity's lifecycle.
   */
  app.get("/api/world-content/:id/relations", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const authCtx: WorldContentAuthContext = { role: auth.role };
    const [subject] = await db
      .select({ id: worldContent.id })
      .from(worldContent)
      .where(worldContentByIdVisibleTo(authCtx, id))
      .limit(1);
    if (!subject) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");

    const edges = await db
      .select()
      .from(worldContentRelations)
      .where(
        or(
          eq(worldContentRelations.fromWorldContentId, id),
          eq(worldContentRelations.toWorldContentId, id),
        ),
      );
    if (edges.length === 0) return reply.send([]);

    const otherIds = Array.from(
      new Set(
        edges.map((edge) =>
          edge.fromWorldContentId === id
            ? edge.toWorldContentId
            : edge.fromWorldContentId,
        ),
      ),
    );
    const otherRows = await db
      .select(worldContentEntityRefColumns)
      .from(worldContent)
      .where(and(inArray(worldContent.id, otherIds), worldContentVisibility(authCtx)));
    const otherById = new Map(otherRows.map((row) => [row.id, row]));

    const result: WorldContentRelationEdgeDto[] = [];
    for (const edge of edges) {
      const isOutgoing = edge.fromWorldContentId === id;
      const otherId = isOutgoing ? edge.toWorldContentId : edge.fromWorldContentId;
      const other = otherById.get(otherId);
      // Not visible to this caller (e.g. a player and the other entity is
      // DRAFT/ARCHIVED) -> drop the edge entirely, not just the entity data.
      if (!other) continue;
      result.push({
        id: edge.id,
        relationType: edge.relationType,
        note: edge.note,
        direction: isOutgoing ? "OUTGOING" : "INCOMING",
        entity: other,
      });
    }
    return reply.send(result);
  });

  /**
   * `GET /api/world-content/:id/media` (UIX-245 Stage 4): the ordered
   * gallery for one entity. Visibility is gated on the *parent* entity only
   * (same 404 as the single-entity GET) — `world_content_media` rows carry
   * no lifecycle of their own.
   */
  app.get("/api/world-content/:id/media", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const authCtx: WorldContentAuthContext = { role: auth.role };
    const [subject] = await db
      .select({ id: worldContent.id })
      .from(worldContent)
      .where(worldContentByIdVisibleTo(authCtx, id))
      .limit(1);
    if (!subject) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
    const rows = await db
      .select()
      .from(worldContentMedia)
      .where(eq(worldContentMedia.worldContentId, id))
      .orderBy(worldContentMedia.ordering);
    return reply.send(rows.map(mediaDto));
  });

  app.post("/api/world-content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const body = createWorldContentSchema.parse(request.body);
    if (await findAction(db, body.actionId))
      return reply.code(200).send({ duplicate: true });
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(worldContent)
          .values({
            slug: body.slug,
            type: body.type,
            subtype: body.subtype ?? null,
            name: body.name,
            aliases: body.aliases ?? [],
            summary: body.summary ?? "",
            publicText: body.publicText ?? "",
            gmOnlyText: body.gmOnlyText ?? "",
            tags: body.tags ?? [],
            coverAssetId: body.coverAssetId ?? null,
          })
          .returning();
        if (!row) throw new Error("WORLD_CONTENT_CREATE_FAILED");
        await tx.insert(worldContentActions).values({
          actionId: body.actionId,
          type: "world_content.created",
          entityType: "world_content",
          entityId: row.id,
          entityRevision: row.revision,
          actorMembershipId: auth.membershipId,
          payload: row,
        });
        return row;
      });
      return reply.code(201).send(toGmDto(created));
    } catch (error) {
      if (isUniqueViolation(error, "world_content_slug_idx"))
        return fail(reply, 409, "WORLD_CONTENT_SLUG_CONFLICT");
      throw error;
    }
  });

  app.patch("/api/world-content/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = idParams.parse(request.params);
    const body = updateWorldContentSchema.parse(request.body);
    if (await findAction(db, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const existing = await findEntity(db, id);
    if (!existing) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
    if (existing.revision !== body.revision)
      return fail(reply, 409, "WORLD_CONTENT_CONFLICT");
    const { actionId, revision: _revision, ...changes } = body;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(worldContent)
        .set({ ...changes, revision: existing.revision + 1, updatedAt: new Date() })
        .where(
          and(eq(worldContent.id, id), eq(worldContent.revision, existing.revision)),
        )
        .returning();
      if (!row) return null;
      await tx.insert(worldContentActions).values({
        actionId,
        type: "world_content.updated",
        entityType: "world_content",
        entityId: id,
        entityRevision: row.revision,
        actorMembershipId: auth.membershipId,
        payload: row,
      });
      return row;
    });
    if (!updated) return fail(reply, 409, "WORLD_CONTENT_CONFLICT");
    return reply.send(toGmDto(updated));
  });

  /**
   * Dedicated lifecycle-transition action, distinct from the free-form field
   * PATCH above — mirrors `POST /api/world-maps/:id/publish` and
   * `/archive` in `./world-map-routes.ts` rather than overloading PATCH with
   * a mixed field-update/state-machine body.
   */
  app.post("/api/world-content/:id/lifecycle", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = idParams.parse(request.params);
    const body = transitionWorldContentLifecycleSchema.parse(request.body);
    if (await findAction(db, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const existing = await findEntity(db, id);
    if (!existing) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
    if (existing.revision !== body.revision)
      return fail(reply, 409, "WORLD_CONTENT_CONFLICT");
    if (!isLegalTransition(existing.lifecycle, body.lifecycle))
      return fail(reply, 422, "WORLD_CONTENT_INVALID_LIFECYCLE_TRANSITION");
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(worldContent)
        .set({ lifecycle: body.lifecycle, revision: existing.revision + 1, updatedAt: new Date() })
        .where(
          and(eq(worldContent.id, id), eq(worldContent.revision, existing.revision)),
        )
        .returning();
      if (!row) return null;
      await tx.insert(worldContentActions).values({
        actionId: body.actionId,
        type: "world_content.lifecycle_changed",
        entityType: "world_content",
        entityId: id,
        entityRevision: row.revision,
        actorMembershipId: auth.membershipId,
        payload: { from: existing.lifecycle, to: row.lifecycle },
      });
      return row;
    });
    if (!updated) return fail(reply, 409, "WORLD_CONTENT_CONFLICT");
    return reply.send(toGmDto(updated));
  });

  /**
   * Soft-delete: transitions to ARCHIVED rather than removing the row.
   * World Content is deliberately durable (see `packages/db/src/schema.ts`
   * doc comment: canon must survive campaign deletion and keep its
   * provenance/audit trail), so a hard DELETE would contradict that intent.
   * Idempotent on an already-ARCHIVED entity: returns the current state
   * without a redundant transition or audit row.
   */
  app.delete("/api/world-content/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = idParams.parse(request.params);
    const body = deleteWorldContentSchema.parse(request.body);
    const existing = await findEntity(db, id);
    if (!existing) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
    if (existing.lifecycle === "ARCHIVED") return reply.send(toGmDto(existing));
    if (await findAction(db, body.actionId))
      return reply.code(200).send({ duplicate: true });
    if (existing.revision !== body.revision)
      return fail(reply, 409, "WORLD_CONTENT_CONFLICT");
    const archived = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(worldContent)
        .set({ lifecycle: "ARCHIVED", revision: existing.revision + 1, updatedAt: new Date() })
        .where(
          and(eq(worldContent.id, id), eq(worldContent.revision, existing.revision)),
        )
        .returning();
      if (!row) return null;
      await tx.insert(worldContentActions).values({
        actionId: body.actionId,
        type: "world_content.archived",
        entityType: "world_content",
        entityId: id,
        entityRevision: row.revision,
        actorMembershipId: auth.membershipId,
        payload: { from: existing.lifecycle, to: row.lifecycle },
      });
      return row;
    });
    if (!archived) return fail(reply, 409, "WORLD_CONTENT_CONFLICT");
    return reply.send(toGmDto(archived));
  });

  app.post("/api/world-content/:id/relations", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = idParams.parse(request.params);
    const body = createWorldContentRelationSchema.parse(request.body);
    if (id === body.toWorldContentId)
      return fail(reply, 422, "WORLD_CONTENT_SELF_RELATION");
    if (await findAction(db, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [from, to] = await Promise.all([
      findEntity(db, id),
      findEntity(db, body.toWorldContentId),
    ]);
    if (!from) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
    if (!to) return fail(reply, 404, "WORLD_CONTENT_RELATION_TARGET_NOT_FOUND");
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(worldContentRelations)
          .values({
            fromWorldContentId: id,
            toWorldContentId: body.toWorldContentId,
            relationType: body.relationType,
            note: body.note ?? null,
          })
          .returning();
        if (!row) throw new Error("WORLD_CONTENT_RELATION_CREATE_FAILED");
        await tx.insert(worldContentActions).values({
          actionId: body.actionId,
          type: "world_content.relation_created",
          entityType: "world_content_relation",
          entityId: row.id,
          entityRevision: row.revision,
          actorMembershipId: auth.membershipId,
          payload: row,
        });
        return row;
      });
      return reply.code(201).send(relationDto(created));
    } catch (error) {
      if (isUniqueViolation(error, "world_content_relations_edge_idx"))
        return fail(reply, 409, "WORLD_CONTENT_RELATION_ALREADY_EXISTS");
      throw error;
    }
  });

  app.delete("/api/world-content/relations/:relationId", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { relationId } = relationParams.parse(request.params);
    const body = deleteWorldContentRelationSchema.parse(request.body);
    if (await findAction(db, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [existing] = await db
      .select()
      .from(worldContentRelations)
      .where(eq(worldContentRelations.id, relationId))
      .limit(1);
    if (!existing) return fail(reply, 404, "WORLD_CONTENT_RELATION_NOT_FOUND");
    await db.transaction(async (tx) => {
      await tx
        .delete(worldContentRelations)
        .where(eq(worldContentRelations.id, relationId));
      await tx.insert(worldContentActions).values({
        actionId: body.actionId,
        type: "world_content.relation_deleted",
        entityType: "world_content_relation",
        entityId: relationId,
        entityRevision: existing.revision,
        actorMembershipId: auth.membershipId,
        payload: existing,
      });
    });
    return reply.code(204).send();
  });

  app.post("/api/world-content/:id/media", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = idParams.parse(request.params);
    const body = addWorldContentMediaSchema.parse(request.body);
    if (await findAction(db, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const entity = await findEntity(db, id);
    if (!entity) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
    try {
      const created = await db.transaction(async (tx) => {
        const [orderingRow] = await tx
          .select({
            nextOrdering: sql<number>`coalesce(max(${worldContentMedia.ordering}), -1) + 1`,
          })
          .from(worldContentMedia)
          .where(eq(worldContentMedia.worldContentId, id));
        const nextOrdering = orderingRow?.nextOrdering ?? 0;
        const [row] = await tx
          .insert(worldContentMedia)
          .values({
            worldContentId: id,
            assetId: body.assetId,
            caption: body.caption ?? null,
            ordering: nextOrdering,
          })
          .returning();
        if (!row) throw new Error("WORLD_CONTENT_MEDIA_CREATE_FAILED");
        await tx.insert(worldContentActions).values({
          actionId: body.actionId,
          type: "world_content.media_added",
          entityType: "world_content_media",
          entityId: row.id,
          entityRevision: 0,
          actorMembershipId: auth.membershipId,
          payload: row,
        });
        return row;
      });
      return reply.code(201).send(mediaDto(created));
    } catch (error) {
      if (isUniqueViolation(error, "world_content_media_entity_asset_idx"))
        return fail(reply, 409, "WORLD_CONTENT_MEDIA_ALREADY_ATTACHED");
      throw error;
    }
  });

  app.patch("/api/world-content/:id/media/:mediaId", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id, mediaId } = mediaParams.parse(request.params);
    const body = updateWorldContentMediaSchema.parse(request.body);
    if (await findAction(db, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [existing] = await db
      .select()
      .from(worldContentMedia)
      .where(
        and(eq(worldContentMedia.id, mediaId), eq(worldContentMedia.worldContentId, id)),
      )
      .limit(1);
    if (!existing) return fail(reply, 404, "WORLD_CONTENT_MEDIA_NOT_FOUND");
    const { actionId, ...changes } = body;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(worldContentMedia)
        .set(changes)
        .where(eq(worldContentMedia.id, mediaId))
        .returning();
      if (!row) throw new Error("WORLD_CONTENT_MEDIA_UPDATE_FAILED");
      await tx.insert(worldContentActions).values({
        actionId,
        type: "world_content.media_updated",
        entityType: "world_content_media",
        entityId: mediaId,
        entityRevision: 0,
        actorMembershipId: auth.membershipId,
        payload: row,
      });
      return row;
    });
    return reply.send(mediaDto(updated));
  });

  app.delete("/api/world-content/:id/media/:mediaId", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id, mediaId } = mediaParams.parse(request.params);
    const body = removeWorldContentMediaSchema.parse(request.body);
    if (await findAction(db, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [existing] = await db
      .select()
      .from(worldContentMedia)
      .where(
        and(eq(worldContentMedia.id, mediaId), eq(worldContentMedia.worldContentId, id)),
      )
      .limit(1);
    if (!existing) return fail(reply, 404, "WORLD_CONTENT_MEDIA_NOT_FOUND");
    await db.transaction(async (tx) => {
      await tx.delete(worldContentMedia).where(eq(worldContentMedia.id, mediaId));
      await tx.insert(worldContentActions).values({
        actionId: body.actionId,
        type: "world_content.media_removed",
        entityType: "world_content_media",
        entityId: mediaId,
        entityRevision: 0,
        actorMembershipId: auth.membershipId,
        payload: existing,
      });
    });
    return reply.code(204).send();
  });
}
