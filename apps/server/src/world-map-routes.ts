import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  approveWorldMapBackgroundSchema,
  archiveWorldMapSchema,
  createWorldMapLocationSchema,
  createWorldMapSchema,
  deleteWorldMapLocationSchema,
  linkWorldMapLocationSceneSchema,
  publishWorldMapSchema,
  setWorldMapDraftBackgroundSchema,
  setWorldMapPartyPositionSchema,
  unlinkWorldMapLocationSceneSchema,
  updateWorldMapLocationSchema,
  updateWorldMapSchema,
} from "@arken/contracts";
import {
  assets,
  gameEvents,
  scenes,
  worldMapLocations,
  worldMapLocationScenes,
  worldMapPartyPosition,
  worldMaps,
} from "@arken/db";
import { requireAuth, type AuthContext } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Broadcast = (campaignId: string) => Promise<void>;

const idParams = z.object({ id: z.string().uuid() }).strict();
const sceneParams = z
  .object({ id: z.string().uuid(), sceneId: z.string().uuid() })
  .strict();
const clearPositionSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

function mapDto(map: typeof worldMaps.$inferSelect) {
  return {
    id: map.id,
    name: map.name,
    scope: map.scope,
    visibility: map.visibility,
    lifecycle: map.lifecycle,
    backgroundAssetId: map.backgroundAssetId,
    revision: map.revision,
  };
}

function locationDto(location: typeof worldMapLocations.$inferSelect) {
  return {
    id: location.id,
    mapId: location.mapId,
    name: location.name,
    kind: location.kind,
    summary: location.summary,
    gmNotes: location.gmNotes,
    visibility: location.visibility,
    x: location.x,
    y: location.y,
    revision: location.revision,
  };
}

type GameEvent = typeof gameEvents.$inferSelect;
type WorldMapMutation<T> = { result: T } | { replay: GameEvent };
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer Value,
) => unknown
  ? Value
  : never;

function isGameEventActionConflict(error: unknown) {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "23505"
  )
    return false;
  const constraint =
    ("constraint_name" in error && error.constraint_name) ||
    ("constraint" in error && error.constraint);
  return constraint === "game_events_campaign_action_idx";
}

async function replayEvent(
  db: Database,
  auth: AuthContext,
  actionId: string,
  type: string,
) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, auth.campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  if (!event) return null;
  // An action id is idempotent only for the actor and command that created it.
  if (event.membershipId !== auth.membershipId || event.type !== type)
    return "invalid" as const;
  return event;
}

/**
 * A same-action retry can pass the preflight lookup before the original
 * transaction commits. If its event insert then loses the unique-index race,
 * the failed transaction has rolled back its mutation; replay the committed
 * event instead of surfacing the database error as a 500.
 */
export async function runWorldMapMutation<T>(
  db: Database,
  auth: AuthContext,
  actionId: string,
  type: string,
  mutation: (tx: Transaction) => Promise<T>,
): Promise<WorldMapMutation<T>> {
  try {
    return { result: await db.transaction(mutation) };
  } catch (error) {
    if (!isGameEventActionConflict(error)) throw error;
    const replay = await replayEvent(db, auth, actionId, type);
    if (!replay || replay === "invalid") throw error;
    return { replay };
  }
}

async function mapForReplay(
  db: Database,
  campaignId: string,
  event: GameEvent,
) {
  if (!event.entityId) return null;
  const [map] = await db
    .select()
    .from(worldMaps)
    .where(
      and(
        eq(worldMaps.id, event.entityId),
        eq(worldMaps.campaignId, campaignId),
      ),
    )
    .limit(1);
  return map ?? null;
}

async function locationForReplay(
  db: Database,
  campaignId: string,
  event: GameEvent,
) {
  if (!event.entityId) return null;
  const [location] = await db
    .select()
    .from(worldMapLocations)
    .where(
      and(
        eq(worldMapLocations.id, event.entityId),
        eq(worldMapLocations.campaignId, campaignId),
      ),
    )
    .limit(1);
  return location ?? null;
}

export async function resolveInitialPartyPositionRace(
  db: Database,
  auth: AuthContext,
  actionId: string,
  type: string,
) {
  const replay = await replayEvent(db, auth, actionId, type);
  if (replay === "invalid") return "invalid" as const;
  return replay ? ("duplicate" as const) : ("conflict" as const);
}

export async function insertInitialWorldMapPartyPosition(
  tx: Transaction,
  values: Pick<
    typeof worldMapPartyPosition.$inferInsert,
    "campaignId" | "mapId" | "locationId" | "updatedByMembershipId"
  >,
) {
  const [position] = await tx
    .insert(worldMapPartyPosition)
    .values(values)
    .onConflictDoNothing({ target: worldMapPartyPosition.campaignId })
    .returning();
  return position ?? null;
}

async function draftMap(db: Database, campaignId: string, mapId: string) {
  const [map] = await db
    .select()
    .from(worldMaps)
    .where(and(eq(worldMaps.id, mapId), eq(worldMaps.campaignId, campaignId)))
    .limit(1);
  return map?.lifecycle === "DRAFT" ? map : null;
}

async function draftLocation(
  db: Database,
  campaignId: string,
  locationId: string,
) {
  const [row] = await db
    .select({ location: worldMapLocations, map: worldMaps })
    .from(worldMapLocations)
    .innerJoin(
      worldMaps,
      and(
        eq(worldMaps.id, worldMapLocations.mapId),
        eq(worldMaps.campaignId, worldMapLocations.campaignId),
      ),
    )
    .where(
      and(
        eq(worldMapLocations.id, locationId),
        eq(worldMapLocations.campaignId, campaignId),
      ),
    )
    .limit(1);
  return row && row.map.lifecycle === "DRAFT" ? row : null;
}

async function approvedMapAsset(
  db: Database,
  campaignId: string,
  assetId: string,
) {
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.campaignId, campaignId),
        eq(assets.kind, "MAP"),
      ),
    )
    .limit(1);
  return asset ?? null;
}

export function registerWorldMapRoutes(
  app: FastifyInstance,
  db: Database,
  broadcastSnapshots: Broadcast,
) {
  const requireGm = async (
    request: Parameters<typeof requireAuth>[0],
    reply: Parameters<typeof requireAuth>[1],
  ) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth || auth.role !== "GM") {
      if (auth) await reply.code(403).send({ error: "GM_REQUIRED" });
      return null;
    }
    return auth;
  };

  app.post("/api/world-maps", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const body = createWorldMapSchema.parse(request.body);
    const replay = await replayEvent(
      db,
      auth,
      body.actionId,
      "world_map.created",
    );
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay?.entityId) {
      const [map] = await db
        .select()
        .from(worldMaps)
        .where(
          and(
            eq(worldMaps.id, replay.entityId),
            eq(worldMaps.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (map) return reply.code(200).send(mapDto(map));
    }
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      "world_map.created",
      async (tx) => {
        const [map] = await tx
          .insert(worldMaps)
          .values({
            campaignId: auth.campaignId,
            name: body.name,
            scope: body.scope,
            visibility: body.visibility,
          })
          .returning();
        if (!map) throw new Error("WORLD_MAP_CREATE_FAILED");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "world_map.created",
          entityType: "WORLD_MAP",
          entityId: map.id,
          entityRevision: map.revision,
          payload: { mapId: map.id },
        });
        return map;
      },
    );
    if ("replay" in mutation) {
      const map = await mapForReplay(db, auth.campaignId, mutation.replay);
      if (map) return reply.code(200).send(mapDto(map));
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    }
    const result = mutation.result;
    await broadcastSnapshots(auth.campaignId);
    return reply.code(201).send(mapDto(result));
  });

  app.patch("/api/world-maps/:id", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const body = updateWorldMapSchema.parse({
      ...(request.body as object),
      mapId: id,
    });
    const replay = await replayEvent(
      db,
      auth,
      body.actionId,
      "world_map.updated",
    );
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay?.entityId) {
      const [map] = await db
        .select()
        .from(worldMaps)
        .where(
          and(
            eq(worldMaps.id, replay.entityId),
            eq(worldMaps.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (map) return reply.code(200).send(mapDto(map));
    }
    const map = await draftMap(db, auth.campaignId, id);
    if (!map) return reply.code(404).send({ error: "WORLD_MAP_NOT_FOUND" });
    if (map.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "WORLD_MAP_CONFLICT", current: mapDto(map) });
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      "world_map.updated",
      async (tx) => {
        const [updated] = await tx
          .update(worldMaps)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.scope !== undefined ? { scope: body.scope } : {}),
            ...(body.visibility !== undefined
              ? { visibility: body.visibility }
              : {}),
            revision: map.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(worldMaps.id, id),
              eq(worldMaps.campaignId, auth.campaignId),
              eq(worldMaps.lifecycle, "DRAFT"),
              eq(worldMaps.revision, map.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "world_map.updated",
          entityType: "WORLD_MAP",
          entityId: id,
          entityRevision: updated.revision,
          payload: { mapId: id },
        });
        return updated;
      },
    );
    if ("replay" in mutation) {
      const map = await mapForReplay(db, auth.campaignId, mutation.replay);
      if (map) return reply.code(200).send(mapDto(map));
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    }
    const result = mutation.result;
    if (!result) return reply.code(409).send({ error: "WORLD_MAP_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    return reply.send(mapDto(result));
  });

  app.post("/api/world-maps/:id/draft-background", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const body = setWorldMapDraftBackgroundSchema.parse({
      ...(request.body as object),
      mapId: id,
    });
    const replay = await replayEvent(
      db,
      auth,
      body.actionId,
      "world_map.background_set",
    );
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay?.entityId) {
      const [map] = await db
        .select()
        .from(worldMaps)
        .where(
          and(
            eq(worldMaps.id, replay.entityId),
            eq(worldMaps.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (map) return reply.code(200).send(mapDto(map));
    }
    const map = await draftMap(db, auth.campaignId, id);
    if (!map) return reply.code(404).send({ error: "WORLD_MAP_NOT_FOUND" });
    if (map.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "WORLD_MAP_CONFLICT", current: mapDto(map) });
    if (
      body.backgroundAssetId &&
      !(await approvedMapAsset(db, auth.campaignId, body.backgroundAssetId))
    )
      return reply.code(404).send({ error: "MAP_ASSET_NOT_FOUND" });
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      "world_map.background_set",
      async (tx) => {
        const [updated] = await tx
          .update(worldMaps)
          .set({
            backgroundAssetId: body.backgroundAssetId,
            backgroundAssetApprovedByMembershipId: null,
            backgroundAssetApprovedAt: null,
            revision: map.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(worldMaps.id, id),
              eq(worldMaps.campaignId, auth.campaignId),
              eq(worldMaps.lifecycle, "DRAFT"),
              eq(worldMaps.revision, map.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "world_map.background_set",
          entityType: "WORLD_MAP",
          entityId: id,
          entityRevision: updated.revision,
          payload: {
            mapId: id,
            hasBackground: Boolean(body.backgroundAssetId),
          },
        });
        return updated;
      },
    );
    if ("replay" in mutation) {
      const map = await mapForReplay(db, auth.campaignId, mutation.replay);
      if (map) return reply.code(200).send(mapDto(map));
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    }
    const result = mutation.result;
    if (!result) return reply.code(409).send({ error: "WORLD_MAP_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    return reply.send(mapDto(result));
  });

  app.post("/api/world-maps/:id/approve-background", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const body = approveWorldMapBackgroundSchema.parse({
      ...(request.body as object),
      mapId: id,
    });
    const replay = await replayEvent(
      db,
      auth,
      body.actionId,
      "world_map.background_approved",
    );
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay?.entityId) {
      const [map] = await db
        .select()
        .from(worldMaps)
        .where(
          and(
            eq(worldMaps.id, replay.entityId),
            eq(worldMaps.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (map) return reply.code(200).send(mapDto(map));
    }
    const map = await draftMap(db, auth.campaignId, id);
    if (!map) return reply.code(404).send({ error: "WORLD_MAP_NOT_FOUND" });
    if (map.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "WORLD_MAP_CONFLICT", current: mapDto(map) });
    if (
      !map.backgroundAssetId ||
      !(await approvedMapAsset(db, auth.campaignId, map.backgroundAssetId))
    )
      return reply.code(422).send({ error: "APPROVED_MAP_ASSET_REQUIRED" });
    const now = new Date();
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      "world_map.background_approved",
      async (tx) => {
        const [updated] = await tx
          .update(worldMaps)
          .set({
            backgroundAssetApprovedByMembershipId: auth.membershipId,
            backgroundAssetApprovedAt: now,
            revision: map.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(worldMaps.id, id),
              eq(worldMaps.campaignId, auth.campaignId),
              eq(worldMaps.lifecycle, "DRAFT"),
              eq(worldMaps.revision, map.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "world_map.background_approved",
          entityType: "WORLD_MAP",
          entityId: id,
          entityRevision: updated.revision,
          payload: { mapId: id, backgroundAssetId: updated.backgroundAssetId },
        });
        return updated;
      },
    );
    if ("replay" in mutation) {
      const map = await mapForReplay(db, auth.campaignId, mutation.replay);
      if (map) return reply.code(200).send(mapDto(map));
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    }
    const result = mutation.result;
    if (!result) return reply.code(409).send({ error: "WORLD_MAP_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    return reply.send(mapDto(result));
  });

  app.post("/api/world-maps/:id/publish", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const body = publishWorldMapSchema.parse({
      ...(request.body as object),
      mapId: id,
    });
    const replay = await replayEvent(
      db,
      auth,
      body.actionId,
      "world_map.published",
    );
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay?.entityId) {
      const [map] = await db
        .select()
        .from(worldMaps)
        .where(
          and(
            eq(worldMaps.id, replay.entityId),
            eq(worldMaps.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (map) return reply.code(200).send(mapDto(map));
    }
    const map = await draftMap(db, auth.campaignId, id);
    if (!map) return reply.code(404).send({ error: "WORLD_MAP_NOT_FOUND" });
    if (map.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "WORLD_MAP_CONFLICT", current: mapDto(map) });
    if (
      !map.backgroundAssetId ||
      !map.backgroundAssetApprovedByMembershipId ||
      !map.backgroundAssetApprovedAt ||
      !(await approvedMapAsset(db, auth.campaignId, map.backgroundAssetId))
    )
      return reply.code(422).send({ error: "APPROVED_MAP_ASSET_REQUIRED" });
    const now = new Date();
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      "world_map.published",
      async (tx) => {
        const [updated] = await tx
          .update(worldMaps)
          .set({
            lifecycle: "PUBLISHED",
            publishedAt: now,
            archivedAt: null,
            revision: map.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(worldMaps.id, id),
              eq(worldMaps.campaignId, auth.campaignId),
              eq(worldMaps.lifecycle, "DRAFT"),
              eq(worldMaps.revision, map.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "world_map.published",
          entityType: "WORLD_MAP",
          entityId: id,
          entityRevision: updated.revision,
          payload: { mapId: id },
        });
        return updated;
      },
    );
    if ("replay" in mutation) {
      const map = await mapForReplay(db, auth.campaignId, mutation.replay);
      if (map) return reply.code(200).send(mapDto(map));
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    }
    const result = mutation.result;
    if (!result) return reply.code(409).send({ error: "WORLD_MAP_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    return reply.send(mapDto(result));
  });

  app.post("/api/world-maps/:id/archive", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const body = archiveWorldMapSchema.parse({
      ...(request.body as object),
      mapId: id,
    });
    const replay = await replayEvent(
      db,
      auth,
      body.actionId,
      "world_map.archived",
    );
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay?.entityId) {
      const [map] = await db
        .select()
        .from(worldMaps)
        .where(
          and(
            eq(worldMaps.id, replay.entityId),
            eq(worldMaps.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (map) return reply.code(200).send(mapDto(map));
    }
    const [map] = await db
      .select()
      .from(worldMaps)
      .where(
        and(
          eq(worldMaps.id, id),
          eq(worldMaps.campaignId, auth.campaignId),
          inArray(worldMaps.lifecycle, ["DRAFT", "PUBLISHED"]),
        ),
      )
      .limit(1);
    if (!map) return reply.code(404).send({ error: "WORLD_MAP_NOT_FOUND" });
    if (map.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "WORLD_MAP_CONFLICT", current: mapDto(map) });
    const now = new Date();
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      "world_map.archived",
      async (tx) => {
        const [updated] = await tx
          .update(worldMaps)
          .set({
            lifecycle: "ARCHIVED",
            archivedAt: now,
            revision: map.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(worldMaps.id, id),
              eq(worldMaps.campaignId, auth.campaignId),
              eq(worldMaps.revision, map.revision),
              inArray(worldMaps.lifecycle, ["DRAFT", "PUBLISHED"]),
            ),
          )
          .returning();
        if (!updated) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "world_map.archived",
          entityType: "WORLD_MAP",
          entityId: id,
          entityRevision: updated.revision,
          payload: { mapId: id },
        });
        return updated;
      },
    );
    if ("replay" in mutation) {
      const map = await mapForReplay(db, auth.campaignId, mutation.replay);
      if (map) return reply.code(200).send(mapDto(map));
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    }
    const result = mutation.result;
    if (!result) return reply.code(409).send({ error: "WORLD_MAP_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    return reply.send(mapDto(result));
  });

  app.post("/api/world-maps/locations", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const body = createWorldMapLocationSchema.parse(request.body);
    const replay = await replayEvent(
      db,
      auth,
      body.actionId,
      "world_map.location_created",
    );
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay?.entityId) {
      const [location] = await db
        .select()
        .from(worldMapLocations)
        .where(
          and(
            eq(worldMapLocations.id, replay.entityId),
            eq(worldMapLocations.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (location) return reply.code(200).send(locationDto(location));
    }
    if (!(await draftMap(db, auth.campaignId, body.mapId)))
      return reply.code(404).send({ error: "WORLD_MAP_NOT_FOUND" });
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      "world_map.location_created",
      async (tx) => {
        const [location] = await tx
          .insert(worldMapLocations)
          .values({
            campaignId: auth.campaignId,
            mapId: body.mapId,
            name: body.name,
            kind: body.kind,
            summary: body.summary,
            gmNotes: body.gmNotes,
            visibility: body.visibility,
            x: body.x,
            y: body.y,
          })
          .returning();
        if (!location) throw new Error("WORLD_MAP_LOCATION_CREATE_FAILED");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "world_map.location_created",
          entityType: "WORLD_MAP_LOCATION",
          entityId: location.id,
          entityRevision: location.revision,
          payload: { mapId: location.mapId, locationId: location.id },
        });
        return location;
      },
    );
    if ("replay" in mutation) {
      const location = await locationForReplay(
        db,
        auth.campaignId,
        mutation.replay,
      );
      if (location) return reply.code(200).send(locationDto(location));
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    }
    const result = mutation.result;
    await broadcastSnapshots(auth.campaignId);
    return reply.code(201).send(locationDto(result));
  });

  app.patch("/api/world-maps/locations/:id", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const body = updateWorldMapLocationSchema.parse({
      ...(request.body as object),
      locationId: id,
    });
    const replay = await replayEvent(
      db,
      auth,
      body.actionId,
      "world_map.location_updated",
    );
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay?.entityId) {
      const [location] = await db
        .select()
        .from(worldMapLocations)
        .where(
          and(
            eq(worldMapLocations.id, replay.entityId),
            eq(worldMapLocations.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (location) return reply.code(200).send(locationDto(location));
    }
    const row = await draftLocation(db, auth.campaignId, id);
    if (!row)
      return reply.code(404).send({ error: "WORLD_MAP_LOCATION_NOT_FOUND" });
    if (row.location.revision !== body.revision)
      return reply.code(409).send({
        error: "WORLD_MAP_LOCATION_CONFLICT",
        current: locationDto(row.location),
      });
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      "world_map.location_updated",
      async (tx) => {
        const [updated] = await tx
          .update(worldMapLocations)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.kind !== undefined ? { kind: body.kind } : {}),
            ...(body.summary !== undefined ? { summary: body.summary } : {}),
            ...(body.gmNotes !== undefined ? { gmNotes: body.gmNotes } : {}),
            ...(body.visibility !== undefined
              ? { visibility: body.visibility }
              : {}),
            ...(body.x !== undefined ? { x: body.x } : {}),
            ...(body.y !== undefined ? { y: body.y } : {}),
            revision: row.location.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(worldMapLocations.id, id),
              eq(worldMapLocations.campaignId, auth.campaignId),
              eq(worldMapLocations.revision, row.location.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "world_map.location_updated",
          entityType: "WORLD_MAP_LOCATION",
          entityId: id,
          entityRevision: updated.revision,
          payload: { mapId: updated.mapId, locationId: id },
        });
        return updated;
      },
    );
    if ("replay" in mutation) {
      const location = await locationForReplay(
        db,
        auth.campaignId,
        mutation.replay,
      );
      if (location) return reply.code(200).send(locationDto(location));
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    }
    const result = mutation.result;
    if (!result)
      return reply.code(409).send({ error: "WORLD_MAP_LOCATION_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    return reply.send(locationDto(result));
  });

  app.delete("/api/world-maps/locations/:id", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = idParams.parse(request.params);
    const body = deleteWorldMapLocationSchema.parse({
      ...(request.body as object),
      locationId: id,
    });
    const replay = await replayEvent(
      db,
      auth,
      body.actionId,
      "world_map.location_deleted",
    );
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay) return reply.code(204).send();
    const row = await draftLocation(db, auth.campaignId, id);
    if (!row)
      return reply.code(404).send({ error: "WORLD_MAP_LOCATION_NOT_FOUND" });
    if (row.location.revision !== body.revision)
      return reply.code(409).send({
        error: "WORLD_MAP_LOCATION_CONFLICT",
        current: locationDto(row.location),
      });
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      "world_map.location_deleted",
      async (tx) => {
        const [gone] = await tx
          .delete(worldMapLocations)
          .where(
            and(
              eq(worldMapLocations.id, id),
              eq(worldMapLocations.campaignId, auth.campaignId),
              eq(worldMapLocations.revision, row.location.revision),
            ),
          )
          .returning();
        if (!gone) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "world_map.location_deleted",
          entityType: "WORLD_MAP_LOCATION",
          entityId: id,
          entityRevision: row.location.revision,
          payload: { mapId: row.location.mapId, locationId: id },
        });
        return gone;
      },
    );
    if ("replay" in mutation) return reply.code(204).send();
    const deleted = mutation.result;
    if (!deleted)
      return reply.code(409).send({ error: "WORLD_MAP_LOCATION_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    return reply.code(204).send();
  });

  const linkLocationScene = async (
    request: FastifyRequest,
    reply: FastifyReply,
    unlink: boolean,
  ) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id, sceneId } = sceneParams.parse(request.params);
    const schema = unlink
      ? unlinkWorldMapLocationSceneSchema
      : linkWorldMapLocationSceneSchema;
    const body = schema.parse({
      ...(request.body as object),
      locationId: id,
      sceneId,
    });
    const type = unlink
      ? "world_map.location_scene_unlinked"
      : "world_map.location_scene_linked";
    const replay = await replayEvent(db, auth, body.actionId, type);
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay) return reply.code(204).send();
    const row = await draftLocation(db, auth.campaignId, id);
    if (!row)
      return reply.code(404).send({ error: "WORLD_MAP_LOCATION_NOT_FOUND" });
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(
        and(eq(scenes.id, sceneId), eq(scenes.campaignId, auth.campaignId)),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      type,
      async (tx) => {
        if (unlink)
          await tx
            .delete(worldMapLocationScenes)
            .where(
              and(
                eq(worldMapLocationScenes.campaignId, auth.campaignId),
                eq(worldMapLocationScenes.locationId, id),
                eq(worldMapLocationScenes.sceneId, sceneId),
              ),
            );
        else
          await tx
            .insert(worldMapLocationScenes)
            .values({ campaignId: auth.campaignId, locationId: id, sceneId })
            .onConflictDoNothing();
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type,
          entityType: "WORLD_MAP_LOCATION",
          entityId: id,
          entityRevision: row.location.revision,
          payload: { mapId: row.location.mapId, locationId: id, sceneId },
        });
      },
    );
    if ("replay" in mutation) return reply.code(204).send();
    await broadcastSnapshots(auth.campaignId);
    return reply.code(204).send();
  };
  app.post(
    "/api/world-maps/locations/:id/scenes/:sceneId",
    async (request, reply) => linkLocationScene(request, reply, false),
  );
  app.delete(
    "/api/world-maps/locations/:id/scenes/:sceneId",
    async (request, reply) => linkLocationScene(request, reply, true),
  );

  app.post("/api/world-maps/party-position", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const body = setWorldMapPartyPositionSchema.parse(request.body);
    const type = "world_map.party_position_set";
    const replay = await replayEvent(db, auth, body.actionId, type);
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay) return reply.code(200).send({ duplicate: true });
    const [location] = await db
      .select({ location: worldMapLocations, map: worldMaps })
      .from(worldMapLocations)
      .innerJoin(
        worldMaps,
        and(
          eq(worldMaps.id, worldMapLocations.mapId),
          eq(worldMaps.campaignId, worldMapLocations.campaignId),
        ),
      )
      .where(
        and(
          eq(worldMapLocations.id, body.locationId),
          eq(worldMapLocations.mapId, body.mapId),
          eq(worldMapLocations.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!location || location.map.lifecycle !== "PUBLISHED")
      return reply.code(404).send({ error: "WORLD_MAP_LOCATION_NOT_FOUND" });
    const [current] = await db
      .select()
      .from(worldMapPartyPosition)
      .where(eq(worldMapPartyPosition.campaignId, auth.campaignId))
      .limit(1);
    if (
      (current && body.revision !== current.revision) ||
      (!current && body.revision !== null)
    )
      return reply
        .code(409)
        .send({ error: "PARTY_POSITION_CONFLICT", current: current ?? null });
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      type,
      async (tx) => {
        let position;
        if (current)
          [position] = await tx
            .update(worldMapPartyPosition)
            .set({
              mapId: body.mapId,
              locationId: body.locationId,
              updatedByMembershipId: auth.membershipId,
              revision: current.revision + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(worldMapPartyPosition.campaignId, auth.campaignId),
                eq(worldMapPartyPosition.revision, current.revision),
              ),
            )
            .returning();
        else
          position = await insertInitialWorldMapPartyPosition(tx, {
            campaignId: auth.campaignId,
            mapId: body.mapId,
            locationId: body.locationId,
            updatedByMembershipId: auth.membershipId,
          });
        if (!position) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type,
          entityType: "WORLD_MAP_PARTY_POSITION",
          entityId: body.locationId,
          entityRevision: position.revision,
          payload: {
            mapId: body.mapId,
            locationId: body.locationId,
            revision: position.revision,
          },
        });
        return position;
      },
    );
    if ("replay" in mutation) return reply.code(200).send({ duplicate: true });
    const result = mutation.result;
    if (!result) {
      const race = await resolveInitialPartyPositionRace(
        db,
        auth,
        body.actionId,
        type,
      );
      if (race === "duplicate")
        return reply.code(200).send({ duplicate: true });
      if (race === "invalid")
        return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
      return reply.code(409).send({ error: "PARTY_POSITION_CONFLICT" });
    }
    await broadcastSnapshots(auth.campaignId);
    return reply.send({
      mapId: result.mapId,
      locationId: result.locationId,
      revision: result.revision,
      updatedAt: result.updatedAt.toISOString(),
    });
  });

  app.delete("/api/world-maps/party-position", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const body = clearPositionSchema.parse(request.body);
    const type = "world_map.party_position_cleared";
    const replay = await replayEvent(db, auth, body.actionId, type);
    if (replay === "invalid")
      return reply.code(409).send({ error: "ACTION_REPLAY_INVALID" });
    if (replay) return reply.code(204).send();
    const [current] = await db
      .select()
      .from(worldMapPartyPosition)
      .where(eq(worldMapPartyPosition.campaignId, auth.campaignId))
      .limit(1);
    if (!current)
      return reply.code(404).send({ error: "PARTY_POSITION_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "PARTY_POSITION_CONFLICT", current });
    const mutation = await runWorldMapMutation(
      db,
      auth,
      body.actionId,
      type,
      async (tx) => {
        const [position] = await tx
          .delete(worldMapPartyPosition)
          .where(
            and(
              eq(worldMapPartyPosition.campaignId, auth.campaignId),
              eq(worldMapPartyPosition.revision, body.revision),
            ),
          )
          .returning();
        if (!position) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type,
          entityType: "WORLD_MAP_PARTY_POSITION",
          entityId: position.locationId,
          entityRevision: position.revision,
          payload: {
            mapId: position.mapId,
            locationId: position.locationId,
            revision: position.revision,
          },
        });
        return position;
      },
    );
    if ("replay" in mutation) return reply.code(204).send();
    const deleted = mutation.result;
    if (!deleted)
      return reply.code(409).send({ error: "PARTY_POSITION_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    return reply.code(204).send();
  });
}
