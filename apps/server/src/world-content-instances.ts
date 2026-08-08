import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  worldContent,
  worldContentInstanceActions,
  worldContentInstances,
} from "@arken/db";
import {
  createWorldContentInstanceSchema,
  deleteWorldContentInstanceSchema,
  updateWorldContentInstanceSchema,
  type WorldContentInstanceDto,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";

/**
 * HTTP CRUD routes for campaign-scoped World Content instances (UIX-264,
 * child of UIX-245 Stage 4's canonical entity manager). See
 * `world_content_instances` in `packages/db/src/schema.ts` for the full
 * architectural rationale.
 *
 * Entirely GM-only, entirely campaign-scoped (`auth.campaignId`, matching
 * `./encounters.ts`/`./character-media.ts`): a GM instances a canonical
 * entity into *their own* campaign only, and can never see or touch another
 * campaign's instances. Idempotency/audit follows the same
 * actionId-lookup + revision/CAS pattern as `./world-content-routes.ts`,
 * adapted for `worldContentInstanceActions`, which — unlike
 * `worldContentActions` — IS campaign-scoped, so `actionId` dedup here is
 * scoped per campaign (mirrors `gameEvents`/`action_journal`), not global.
 *
 * There is no player-facing projection in this stage (see
 * `worldContentInstanceDtoSchema`'s doc comment in `@arken/contracts`) — every
 * route below requires `auth.role === "GM"`.
 */

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type RequestDb = Database | Transaction;
type WorldContentInstanceRow = typeof worldContentInstances.$inferSelect;

function fail(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  status: number,
  error: string,
) {
  return reply.code(status).send({ error });
}

async function findAction(db: RequestDb, campaignId: string, actionId: string) {
  const [row] = await db
    .select()
    .from(worldContentInstanceActions)
    .where(
      and(
        eq(worldContentInstanceActions.campaignId, campaignId),
        eq(worldContentInstanceActions.actionId, actionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function toDto(row: WorldContentInstanceRow): WorldContentInstanceDto {
  return {
    id: row.id,
    campaignId: row.campaignId,
    worldContentId: row.worldContentId,
    displayNameOverride: row.displayNameOverride,
    currentState: row.currentState,
    gmNotes: row.gmNotes,
    portraitAssetId: row.portraitAssetId,
    ownerMembershipId: row.ownerMembershipId,
    currentLocationId: row.currentLocationId,
    quantity: row.quantity,
    condition: row.condition,
    discovered: row.discovered,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Campaign-scoped lookup, so a stale/foreign id 404s instead of leaking cross-campaign existence. */
async function findInstance(db: RequestDb, campaignId: string, id: string) {
  const [row] = await db
    .select()
    .from(worldContentInstances)
    .where(
      and(
        eq(worldContentInstances.campaignId, campaignId),
        eq(worldContentInstances.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The canonical entity need only exist — the GM can instance a DRAFT or
 * ARCHIVED entity, since the GM already sees every lifecycle state through
 * `./world-content-routes.ts`. No lifecycle/visibility filter here.
 */
async function findCanonicalEntity(db: RequestDb, id: string) {
  const [row] = await db
    .select({ id: worldContent.id })
    .from(worldContent)
    .where(eq(worldContent.id, id))
    .limit(1);
  return row ?? null;
}

const idParams = z.object({ id: z.string().uuid() }).strict();
const listQuerySchema = z
  .object({
    worldContentId: z.string().uuid().optional(),
  })
  .partial();

export function registerWorldContentInstanceRoutes(
  app: FastifyInstance,
  db: Database,
) {
  app.get("/api/world-content-instances", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const query = listQuerySchema.parse(request.query);
    const conditions = [eq(worldContentInstances.campaignId, auth.campaignId)];
    if (query.worldContentId)
      conditions.push(eq(worldContentInstances.worldContentId, query.worldContentId));
    const rows = await db
      .select()
      .from(worldContentInstances)
      .where(and(...conditions));
    return reply.send(rows.map(toDto));
  });

  app.get("/api/world-content-instances/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = idParams.parse(request.params);
    const row = await findInstance(db, auth.campaignId, id);
    if (!row) return fail(reply, 404, "WORLD_CONTENT_INSTANCE_NOT_FOUND");
    return reply.send(toDto(row));
  });

  app.post("/api/world-content-instances", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const body = createWorldContentInstanceSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const entity = await findCanonicalEntity(db, body.worldContentId);
    if (!entity) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(worldContentInstances)
        .values({
          campaignId: auth.campaignId,
          worldContentId: body.worldContentId,
          displayNameOverride: body.displayNameOverride ?? null,
          currentState: body.currentState ?? null,
          gmNotes: body.gmNotes ?? null,
          portraitAssetId: body.portraitAssetId ?? null,
          ownerMembershipId: body.ownerMembershipId ?? null,
          currentLocationId: body.currentLocationId ?? null,
          quantity: body.quantity ?? null,
          condition: body.condition ?? null,
          discovered: body.discovered ?? false,
        })
        .returning();
      if (!row) throw new Error("WORLD_CONTENT_INSTANCE_CREATE_FAILED");
      await tx.insert(worldContentInstanceActions).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        type: "world_content_instance.created",
        entityType: "world_content_instance",
        entityId: row.id,
        entityRevision: row.revision,
        actorMembershipId: auth.membershipId,
        payload: row,
      });
      return row;
    });
    return reply.code(201).send(toDto(created));
  });

  app.patch("/api/world-content-instances/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = idParams.parse(request.params);
    const body = updateWorldContentInstanceSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const existing = await findInstance(db, auth.campaignId, id);
    if (!existing) return fail(reply, 404, "WORLD_CONTENT_INSTANCE_NOT_FOUND");
    if (existing.revision !== body.revision)
      return fail(reply, 409, "WORLD_CONTENT_INSTANCE_CONFLICT");
    const { actionId, revision: _revision, ...changes } = body;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(worldContentInstances)
        .set({ ...changes, revision: existing.revision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(worldContentInstances.id, id),
            eq(worldContentInstances.campaignId, auth.campaignId),
            eq(worldContentInstances.revision, existing.revision),
          ),
        )
        .returning();
      if (!row) return null;
      await tx.insert(worldContentInstanceActions).values({
        campaignId: auth.campaignId,
        actionId,
        type: "world_content_instance.updated",
        entityType: "world_content_instance",
        entityId: id,
        entityRevision: row.revision,
        actorMembershipId: auth.membershipId,
        payload: row,
      });
      return row;
    });
    if (!updated) return fail(reply, 409, "WORLD_CONTENT_INSTANCE_CONFLICT");
    return reply.send(toDto(updated));
  });

  /**
   * Hard delete, scoped to `campaignId`. Unlike canonical `worldContent`
   * (durable canon, soft-deleted to ARCHIVED — see
   * `./world-content-routes.ts`), an instance is explicitly "mutable
   * campaign state" (UIX-264): it has no lifecycle of its own, no
   * publish/archive audience, and no reuse across campaigns to protect. A
   * campaign's own instances already disappear en masse when the campaign
   * itself is deleted (the `world_content_instances.campaign_id` FK is
   * `onDelete: cascade` — see `packages/db/src/schema.ts`), so a GM-initiated
   * hard delete of a single instance is consistent with that lifecycle, not
   * a special case. The canonical entity it points at is never touched.
   */
  app.delete("/api/world-content-instances/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = idParams.parse(request.params);
    const body = deleteWorldContentInstanceSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const existing = await findInstance(db, auth.campaignId, id);
    if (!existing) return fail(reply, 404, "WORLD_CONTENT_INSTANCE_NOT_FOUND");
    if (existing.revision !== body.revision)
      return fail(reply, 409, "WORLD_CONTENT_INSTANCE_CONFLICT");
    const deleted = await db.transaction(async (tx) => {
      const rows = await tx
        .delete(worldContentInstances)
        .where(
          and(
            eq(worldContentInstances.id, id),
            eq(worldContentInstances.campaignId, auth.campaignId),
            eq(worldContentInstances.revision, existing.revision),
          ),
        )
        .returning();
      if (rows.length === 0) return false;
      await tx.insert(worldContentInstanceActions).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        type: "world_content_instance.deleted",
        entityType: "world_content_instance",
        entityId: id,
        entityRevision: existing.revision,
        actorMembershipId: auth.membershipId,
        payload: existing,
      });
      return true;
    });
    if (!deleted) return fail(reply, 409, "WORLD_CONTENT_INSTANCE_CONFLICT");
    return reply.code(204).send();
  });
}
