import { createHash } from "node:crypto";
import {
  InventoryAssignmentError,
  lockInventoryGraph,
  validateInventoryAssignment,
} from "./inventory-assignment.js";
import { canAccessCharacter } from "./character-access.js";
import { postgresErrorCode } from "./database-errors.js";
import {
  and,
  eq,
  gt,
  isNull,
  isNotNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assets,
  characters,
  gameEvents,
  worldContent,
  worldContentInstanceActions,
  worldContentInstances,
  worldInstanceBindings,
  memberships,
  worldMapLocations,
} from "@arken/db";
import {
  createWorldContentInstanceSchema,
  deleteWorldContentInstanceSchema,
  updateWorldContentInstanceSchema,
  type WorldContentInstanceDto,
  type WorldContentInstancePlayerDto,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";
import { worldContentPlayerVisibleIn } from "./world-content.js";
import { nonShopInstance } from "./economy-stock-visibility.js";

/**
 * HTTP CRUD routes for campaign-scoped World Content instances (UIX-264,
 * child of UIX-245 Stage 4's canonical entity manager). See
 * `world_content_instances` in `packages/db/src/schema.ts` for the full
 * architectural rationale.
 *
 * Writes are GM-only, everything is campaign-scoped (`auth.campaignId`, matching
 * `./encounters.ts`/`./character-media.ts`): a GM instances a canonical
 * entity into *their own* campaign only, and can never see or touch another
 * campaign's instances. Idempotency/audit follows the same
 * actionId-lookup + revision/CAS pattern as `./world-content-routes.ts`,
 * adapted for `worldContentInstanceActions`, which — unlike
 * `worldContentActions` — IS campaign-scoped, so `actionId` dedup here is
 * scoped per campaign (mirrors `gameEvents`/`action_journal`), not global.
 *
 * UIX-245 step 5: the list route also serves players — only instances the GM
 * marked as discovered, of canon they can see in this campaign, without
 * `gmNotes`/`currentLocationId` (`WorldContentInstancePlayerDto`). Every
 * other route below requires `auth.role === "GM"`.
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

class InstanceReplay extends Error {
  constructor(readonly matches: boolean) {
    super("ACTION_ID_REUSED");
  }
}
const requestFingerprint = (
  operation: string,
  id: string | null,
  body: unknown,
) =>
  createHash("sha256")
    .update(JSON.stringify({ operation, id, body }))
    .digest("hex");
function matchingReceipt(
  row: NonNullable<Awaited<ReturnType<typeof findAction>>>,
  hash: string,
  actor: string,
) {
  const payload = row.payload as { requestHash?: unknown } | null;
  return row.actorMembershipId === actor && payload?.requestHash === hash;
}
async function lockRequest(
  tx: Transaction,
  campaignId: string,
  actionId: string,
  hash: string,
  actor: string,
) {
  // Same action lock as bindings; acquire before the graph lock everywhere.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${campaignId + ":" + actionId}, 0))`,
  );
  const old = await findAction(tx, campaignId, actionId);
  if (old) throw new InstanceReplay(matchingReceipt(old, hash, actor));
  const [other] = await tx
    .select({ actionId: gameEvents.actionId })
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  if (other) throw new InstanceReplay(false);
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
    inventoryCharacterId: row.inventoryCharacterId,
    currentLocationId: row.currentLocationId,
    quantity: row.quantity,
    condition: row.condition,
    discovered: row.discovered,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** UIX-245 step 5: a discovered instance as its campaign's players see it. */
function toPlayerDto(
  row: WorldContentInstanceRow,
): WorldContentInstancePlayerDto {
  const {
    gmNotes: _gmNotes,
    inventoryCharacterId: _inventoryCharacterId,
    currentLocationId: _currentLocationId,
    ...visible
  } = toDto(row);
  return visible;
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

async function ownerBelongsToCampaign(
  db: RequestDb,
  campaignId: string,
  membershipId: string | null | undefined,
) {
  if (membershipId == null) return true;
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.campaignId, campaignId),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

async function portraitAssetError(
  db: RequestDb,
  campaignId: string,
  assetId: string | null | undefined,
): Promise<string | null> {
  if (assetId == null) return null;
  const [asset] = await db
    .select({ kind: assets.kind, mimeType: assets.mimeType })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.campaignId, campaignId)))
    .limit(1);
  if (!asset) return "WORLD_CONTENT_PORTRAIT_ASSET_UNAVAILABLE";
  if (
    (asset.kind !== "IMAGE" && asset.kind !== "PORTRAIT") ||
    !asset.mimeType.startsWith("image/")
  )
    return "WORLD_CONTENT_PORTRAIT_NOT_IMAGE";
  return null;
}

async function locationBelongsToCampaign(
  db: RequestDb,
  campaignId: string,
  locationId: string | null | undefined,
) {
  if (locationId == null) return true;
  const [location] = await db
    .select({ id: worldMapLocations.id })
    .from(worldMapLocations)
    .where(
      and(
        eq(worldMapLocations.id, locationId),
        eq(worldMapLocations.campaignId, campaignId),
      ),
    )
    .limit(1);
  return Boolean(location);
}

function isInstanceLocationForeignKeyFailure(reason: unknown): boolean {
  let current: unknown = reason;
  while (current && typeof current === "object") {
    const error = current as {
      cause?: unknown;
      code?: string;
      constraint?: string;
    };
    if (
      error.code === "23503" &&
      error.constraint === "world_content_instances_campaign_location_fk"
    )
      return true;
    current = error.cause;
  }
  return false;
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
  app.get("/api/characters/:id/inventory", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const query = z
      .object({
        cursor: z.string().uuid().optional(),
        available: z.enum(["true"]).optional(),
      })
      .strict()
      .parse(request.query);
    if (query.available && auth.role !== "GM")
      return fail(reply, 403, "GM_REQUIRED");
    reply.header("Cache-Control", "private, no-store");
    // canAccessCharacter alone is NOT a campaign boundary.
    const [character] = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.id, id), eq(characters.campaignId, auth.campaignId)),
      )
      .limit(1);
    if (!character || !(await canAccessCharacter(db, auth, character)))
      return fail(reply, 404, "CHARACTER_NOT_FOUND");
    const conditions = [
      eq(worldContentInstances.campaignId, auth.campaignId),
      query.available
        ? isNull(worldContentInstances.inventoryCharacterId)
        : eq(worldContentInstances.inventoryCharacterId, id),
      eq(worldContent.type, "ITEM"),
    ];
    if (query.cursor)
      conditions.push(gt(worldContentInstances.id, query.cursor));
    if (query.available)
      conditions.push(
        gt(worldContentInstances.quantity, 0),
        notExists(
          db
            .select({ id: worldInstanceBindings.instanceId })
            .from(worldInstanceBindings)
            .where(
              and(
                eq(worldInstanceBindings.campaignId, auth.campaignId),
                or(
                  and(
                    eq(
                      worldInstanceBindings.instanceId,
                      worldContentInstances.id,
                    ),
                    isNotNull(worldInstanceBindings.containerInstanceId),
                  ),
                  eq(
                    worldInstanceBindings.containerInstanceId,
                    worldContentInstances.id,
                  ),
                ),
              ),
            ),
        ),
      );
    if (auth.role !== "GM")
      conditions.push(
        eq(worldContentInstances.discovered, true),
        worldContentPlayerVisibleIn(auth.campaignId),
      );
    const rows = await db
      .select({
        id: worldContentInstances.id,
        name: worldContent.name,
        displayNameOverride: worldContentInstances.displayNameOverride,
        quantity: worldContentInstances.quantity,
        condition: worldContentInstances.condition,
        revision: worldContentInstances.revision,
      })
      .from(worldContentInstances)
      .innerJoin(
        worldContent,
        eq(worldContent.id, worldContentInstances.worldContentId),
      )
      .where(and(...conditions))
      .orderBy(worldContentInstances.id)
      .limit(101);
    // No secret counts, location, notes, editorial metadata or media URLs.
    return reply.send({
      items: rows
        .slice(0, 100)
        .map(({ displayNameOverride, name, ...row }) => ({
          ...row,
          name: displayNameOverride ?? name,
        })),
      nextCursor: rows.length > 100 ? rows[99]!.id : null,
    });
  });
  app.get("/api/world-content-instances", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = listQuerySchema.parse(request.query);
    const conditions = [eq(worldContentInstances.campaignId, auth.campaignId)];
    if (query.worldContentId)
      conditions.push(
        eq(worldContentInstances.worldContentId, query.worldContentId),
      );
    if (auth.role === "GM") {
      const rows = await db
        .select()
        .from(worldContentInstances)
        .where(and(...conditions));
      return reply.send(rows.map(toDto));
    }
    // UIX-245 step 5: players read only discovered instances of canon they can
    // see in this campaign; nothing else exists for them.
    const rows = await db
      .select({ instance: worldContentInstances })
      .from(worldContentInstances)
      .innerJoin(
        worldContent,
        eq(worldContentInstances.worldContentId, worldContent.id),
      )
      .where(
        and(
          ...conditions,
          eq(worldContentInstances.discovered, true),
          nonShopInstance(),
          worldContentPlayerVisibleIn(auth.campaignId),
        ),
      );
    return reply.send(rows.map(({ instance }) => toPlayerDto(instance)));
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
    const requestHash = requestFingerprint("create", null, body);
    const previous = await findAction(db, auth.campaignId, body.actionId);
    if (previous)
      return matchingReceipt(previous, requestHash, auth.membershipId)
        ? reply.code(200).send({ duplicate: true })
        : fail(reply, 409, "ACTION_ID_REUSED");
    if (
      !(await ownerBelongsToCampaign(
        db,
        auth.campaignId,
        body.ownerMembershipId,
      ))
    )
      return fail(reply, 400, "WORLD_CONTENT_OWNER_NOT_IN_CAMPAIGN");
    const portraitError = await portraitAssetError(
      db,
      auth.campaignId,
      body.portraitAssetId,
    );
    if (portraitError) return fail(reply, 400, portraitError);
    if (
      !(await locationBelongsToCampaign(
        db,
        auth.campaignId,
        body.currentLocationId,
      ))
    )
      return fail(reply, 400, "WORLD_CONTENT_LOCATION_NOT_IN_CAMPAIGN");
    const entity = await findCanonicalEntity(db, body.worldContentId);
    if (!entity) return fail(reply, 404, "WORLD_CONTENT_NOT_FOUND");
    let created: WorldContentInstanceRow;
    try {
      created = await db.transaction(async (tx) => {
        await lockRequest(
          tx,
          auth.campaignId,
          body.actionId,
          requestHash,
          auth.membershipId,
        );
        await lockInventoryGraph(tx, auth.campaignId);
        await validateInventoryAssignment(
          tx,
          auth.campaignId,
          {
            worldContentId: body.worldContentId,
            inventoryCharacterId: body.inventoryCharacterId ?? null,
            quantity: body.quantity ?? null,
          },
          true,
        );
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
            inventoryCharacterId: body.inventoryCharacterId ?? null,
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
          payload: { ...row, requestHash },
        });
        return row;
      });
    } catch (reason) {
      if (reason instanceof InstanceReplay)
        return reason.matches
          ? reply.code(200).send({ duplicate: true })
          : fail(reply, 409, "ACTION_ID_REUSED");
      if (reason instanceof InventoryAssignmentError)
        return fail(reply, 400, reason.message);
      if (isInstanceLocationForeignKeyFailure(reason))
        return fail(reply, 400, "WORLD_CONTENT_LOCATION_NOT_IN_CAMPAIGN");
      throw reason;
    }
    return reply.code(201).send(toDto(created));
  });

  app.patch("/api/world-content-instances/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = idParams.parse(request.params);
    const body = updateWorldContentInstanceSchema.parse(request.body);
    const requestHash = requestFingerprint("update", id, body);
    const previous = await findAction(db, auth.campaignId, body.actionId);
    if (previous)
      return matchingReceipt(previous, requestHash, auth.membershipId)
        ? reply.code(200).send({ duplicate: true })
        : fail(reply, 409, "ACTION_ID_REUSED");
    const existing = await findInstance(db, auth.campaignId, id);
    if (!existing || existing.revision !== body.revision) {
      // A same-action transaction may have committed after the fast receipt lookup.
      const committed = await findAction(db, auth.campaignId, body.actionId);
      if (committed)
        return matchingReceipt(committed, requestHash, auth.membershipId)
          ? reply.code(200).send({ duplicate: true })
          : fail(reply, 409, "ACTION_ID_REUSED");
      return fail(
        reply,
        existing ? 409 : 404,
        existing
          ? "WORLD_CONTENT_INSTANCE_CONFLICT"
          : "WORLD_CONTENT_INSTANCE_NOT_FOUND",
      );
    }
    if (
      !(await ownerBelongsToCampaign(
        db,
        auth.campaignId,
        body.ownerMembershipId,
      ))
    )
      return fail(reply, 400, "WORLD_CONTENT_OWNER_NOT_IN_CAMPAIGN");
    const { actionId, revision: _revision, ...changes } = body;
    if (
      changes.portraitAssetId != null &&
      changes.portraitAssetId !== existing.portraitAssetId
    ) {
      const portraitError = await portraitAssetError(
        db,
        auth.campaignId,
        changes.portraitAssetId,
      );
      if (portraitError) return fail(reply, 400, portraitError);
    }
    if (
      changes.currentLocationId != null &&
      changes.currentLocationId !== existing.currentLocationId &&
      !(await locationBelongsToCampaign(
        db,
        auth.campaignId,
        changes.currentLocationId,
      ))
    )
      return fail(reply, 400, "WORLD_CONTENT_LOCATION_NOT_IN_CAMPAIGN");
    let updated: WorldContentInstanceRow | null;
    try {
      updated = await db.transaction(async (tx) => {
        await lockRequest(
          tx,
          auth.campaignId,
          body.actionId,
          requestHash,
          auth.membershipId,
        );
        await lockInventoryGraph(tx, auth.campaignId);
        await validateInventoryAssignment(
          tx,
          auth.campaignId,
          { ...existing, ...changes },
          changes.inventoryCharacterId != null &&
            changes.inventoryCharacterId !== existing.inventoryCharacterId,
        );
        const [row] = await tx
          .update(worldContentInstances)
          .set({
            ...changes,
            revision: existing.revision + 1,
            updatedAt: new Date(),
          })
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
          payload: { ...row, requestHash, before: existing },
        });
        return row;
      });
    } catch (reason) {
      if (reason instanceof InstanceReplay)
        return reason.matches
          ? reply.code(200).send({ duplicate: true })
          : fail(reply, 409, "ACTION_ID_REUSED");
      if (reason instanceof InventoryAssignmentError)
        return fail(reply, 400, reason.message);
      if (isInstanceLocationForeignKeyFailure(reason))
        return fail(reply, 400, "WORLD_CONTENT_LOCATION_NOT_IN_CAMPAIGN");
      throw reason;
    }
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
    const requestHash = requestFingerprint("delete", id, body);
    const previous = await findAction(db, auth.campaignId, body.actionId);
    if (previous)
      return matchingReceipt(previous, requestHash, auth.membershipId)
        ? reply.code(200).send({ duplicate: true })
        : fail(reply, 409, "ACTION_ID_REUSED");
    const existing = await findInstance(db, auth.campaignId, id);
    if (!existing || existing.revision !== body.revision) {
      // A same-action transaction may have committed after the fast receipt lookup.
      const committed = await findAction(db, auth.campaignId, body.actionId);
      if (committed)
        return matchingReceipt(committed, requestHash, auth.membershipId)
          ? reply.code(200).send({ duplicate: true })
          : fail(reply, 409, "ACTION_ID_REUSED");
      return fail(
        reply,
        existing ? 409 : 404,
        existing
          ? "WORLD_CONTENT_INSTANCE_CONFLICT"
          : "WORLD_CONTENT_INSTANCE_NOT_FOUND",
      );
    }
    if (existing.inventoryCharacterId)
      return fail(reply, 409, "INVENTORY_DETACH_BEFORE_DELETE");
    const deleted = await db
      .transaction(async (tx) => {
        await lockRequest(
          tx,
          auth.campaignId,
          body.actionId,
          requestHash,
          auth.membershipId,
        );
        await lockInventoryGraph(tx, auth.campaignId);
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
          payload: { ...existing, requestHash },
        });
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof InstanceReplay)
          return error.matches ? ("DUPLICATE" as const) : ("REUSED" as const);
        if (postgresErrorCode(error) === "23503") return "REFERENCED" as const;
        throw error;
      });
    if (deleted === "DUPLICATE")
      return reply.code(200).send({ duplicate: true });
    if (deleted === "REUSED") return fail(reply, 409, "ACTION_ID_REUSED");
    if (deleted === "REFERENCED")
      return fail(reply, 409, "INSTANCE_CONTAINER_IN_USE");
    if (!deleted) return fail(reply, 409, "WORLD_CONTENT_INSTANCE_CONFLICT");
    return reply.code(204).send();
  });
}
