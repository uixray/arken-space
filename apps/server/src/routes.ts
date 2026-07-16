import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { and, desc, eq, gt, inArray, isNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import {
  activateSceneSchema,
  actionIdSchema,
  assetKindSchema,
  characterCommandSchema,
  assignCatalogEntrySchema,
  catalogEntryCommandSchema,
  characterCatalogEntryCommandSchema,
  createChatMessageSchema,
  createFogRevealSchema,
  changeTokenLayerSchema,
  createDrawingSchema,
  drawingCommandSchema,
  historyCommandSchema,
  sceneCanvasConfigSchema,
  updateDrawingSchema,
  createInviteSchema,
  createSceneSchema,
  createTokenSchema,
  createTokenDefinitionSchema,
  diceRequestSchema,
  entryDataSchema,
  entryRollRequestSchema,
  campaignClockCommandSchema,
  characterCountersCommandSchema,
  rechargeEntryCommandSchema,
  deleteTokenSchema,
  gmLoginSchema,
  inviteClaimSchema,
  rotatePlayerAccessSchema,
  replaceTokenControllersSchema,
  placeTokenDefinitionSchema,
  renameCommandSchema,
  revisionCommandSchema,
  tokenDefinitionUpdateSchema,
  updateSceneMetadataSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@arken/contracts";
import {
  assets,
  actionJournal,
  catalogEntries,
  characterCatalogEntries,
  campaigns,
  characters,
  chatMessages,
  drawings,
  fogReveals,
  gameEvents,
  invites,
  playerAccessGrants,
  memberships,
  scenes,
  sessions,
  tokens,
  tokenControllers,
  tokenDefinitions,
} from "@arken/db";
import { createStarterCharacter } from "@arken/system";
import { createSession, requireAuth } from "./auth.js";
import { DiceFormulaError, rollFormula } from "./dice.js";
import { env } from "./env.js";
import { hashToken, randomToken, safeEqual } from "./security.js";
import { buildSnapshot } from "./snapshot.js";
import { invalidateRedoBranch } from "./canvas-history.js";
import { normalizeLegacyEntryData } from "./entry-data.js";
import {
  assertStorageCapacity,
  displayNameFromUpload,
  openStoredFile,
  removeStoredUpload,
  storeUpload,
} from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
const campaignRoom = (id: string) => `campaign:${id}`;
const gmRoom = (id: string) => `campaign:${id}:gm`;
const memberRoom = (id: string) => `member:${id}`;

async function broadcastSnapshots(
  io: RealtimeServer,
  db: Database,
  campaignId: string,
) {
  const sockets = await io.in(campaignRoom(campaignId)).fetchSockets();
  await Promise.all(
    sockets.map(async (socket) => {
      const auth = socket.data.auth;
      if (auth?.campaignId === campaignId) {
        socket.emit("game:snapshot", await buildSnapshot(db, auth));
      }
    }),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

export function fitFrameToWorld(
  assetWidth: number | null | undefined,
  assetHeight: number | null | undefined,
  worldWidth: number,
  worldHeight: number,
) {
  if (!assetWidth || !assetHeight)
    return { x: 0, y: 0, width: worldWidth, height: worldHeight };
  const scale = Math.min(worldWidth / assetWidth, worldHeight / assetHeight);
  const width = assetWidth * scale;
  const height = assetHeight * scale;
  return {
    x: (worldWidth - width) / 2,
    y: (worldHeight - height) / 2,
    width,
    height,
  };
}

const walletLabels = {
  gold: "золото",
  silver: "серебро",
  copper: "медь",
  sp: "СП",
} as const;

type Wallet = Record<keyof typeof walletLabels, number>;

function formatWalletChanges(before: Wallet, after: Wallet) {
  const changes = Object.entries(walletLabels)
    .filter(
      ([key]) => before[key as keyof Wallet] !== after[key as keyof Wallet],
    )
    .map(([key, label]) => {
      const currency = key as keyof Wallet;
      return `${label} ${before[currency]} → ${after[currency]}`;
    });
  return changes.length > 0 ? `кошелёк: ${changes.join(", ")}` : "";
}

type Resources = Record<string, { current: number; maximum?: number }>;

function formatResourceValue(value: Resources[string] | undefined) {
  if (!value) return "удалён";
  return value.maximum === undefined
    ? String(value.current)
    : `${value.current}/${value.maximum}`;
}

function formatResourceChanges(before: Resources, after: Resources) {
  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort();
  const changes = keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => {
      if (!before[key])
        return `${key}: добавлен ${formatResourceValue(after[key])}`;
      if (!after[key]) return `${key}: удалён`;
      return `${key}: ${formatResourceValue(before[key])} → ${formatResourceValue(after[key])}`;
    });
  return changes.length > 0 ? `ресурсы: ${changes.join(", ")}` : "";
}

async function findAction(db: Database, campaignId: string, actionId: string) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  return event ?? null;
}

function sceneDto(
  scene: typeof scenes.$inferSelect,
  activeSceneId: string | null,
) {
  return {
    id: scene.id,
    name: scene.name,
    projection: scene.projection,
    mapAssetId: scene.mapAssetId,
    width: scene.width,
    height: scene.height,
    backgroundFrame: {
      x: scene.backgroundX,
      y: scene.backgroundY,
      width: scene.backgroundWidth,
      height: scene.backgroundHeight,
    },
    grid: scene.grid,
    mapScale: scene.mapScale,
    revision: scene.revision,
    active: activeSceneId === scene.id,
  };
}

async function findSceneDto(db: Database, campaignId: string, sceneId: string) {
  const [row] = await db
    .select({ scene: scenes, activeSceneId: campaigns.activeSceneId })
    .from(scenes)
    .innerJoin(campaigns, eq(campaigns.id, scenes.campaignId))
    .where(and(eq(scenes.id, sceneId), eq(scenes.campaignId, campaignId)))
    .limit(1);
  return row ? sceneDto(row.scene, row.activeSceneId) : null;
}

export async function claimInviteOwnership(
  db: Database,
  invite: typeof invites.$inferSelect,
  displayName: string,
) {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .insert(memberships)
      .values({
        campaignId: invite.campaignId,
        role: "PLAYER",
        displayName,
      })
      .returning();
    if (!member) throw new Error("MEMBER_CREATE_FAILED");
    await tx
      .update(characters)
      .set({ ownerMembershipId: member.id, updatedAt: new Date() })
      .where(
        and(
          eq(characters.id, invite.characterId),
          eq(characters.campaignId, invite.campaignId),
        ),
      );
    await tx.execute(sql`insert into token_controllers (token_definition_id, membership_id)
      select d.id, ${member.id} from token_definitions d
      where d.character_id = ${invite.characterId} and d.campaign_id = ${invite.campaignId}
      and not exists (select 1 from token_controllers c where c.token_definition_id = d.id)
      on conflict do nothing`);
    const [claimed] = await tx
      .update(invites)
      .set({ claimedAt: new Date(), claimedByMembershipId: member.id })
      .where(and(eq(invites.id, invite.id), isNull(invites.claimedAt)))
      .returning();
    if (!claimed) throw new Error("INVITE_ALREADY_CLAIMED");
    return member;
  });
}

function playerAccessDto(
  grant: typeof playerAccessGrants.$inferSelect,
  characterId: string | null,
) {
  return {
    id: grant.id,
    membershipId: grant.membershipId,
    characterId,
    label: grant.label,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

async function createPlayerAccess(
  db: Database,
  campaignId: string,
  characterId: string,
  label: string,
  actionId: string,
  actorMembershipId: string,
) {
  const token = randomToken();
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from characters where id = ${characterId} and campaign_id = ${campaignId} for update`,
    );
    const [character] = await tx
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, campaignId),
        ),
      )
      .limit(1);
    if (!character) throw new Error("CHARACTER_NOT_FOUND");
    if (character.ownerMembershipId) {
      const [existing] = await tx
        .select()
        .from(playerAccessGrants)
        .where(
          and(
            eq(playerAccessGrants.campaignId, campaignId),
            eq(playerAccessGrants.membershipId, character.ownerMembershipId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.revokedAt) {
          const [reactivated] = await tx
            .update(playerAccessGrants)
            .set({
              label,
              tokenHash: hashToken(token),
              revokedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(playerAccessGrants.id, existing.id))
            .returning();
          if (!reactivated) throw new Error("ACCESS_GRANT_CREATE_FAILED");
          await tx
            .delete(sessions)
            .where(eq(sessions.membershipId, existing.membershipId));
          await tx.insert(gameEvents).values({
            campaignId,
            actionId,
            membershipId: actorMembershipId,
            type: "player_access.reactivated",
            entityType: "player_access",
            entityId: existing.id,
            payload: { characterId },
          });
          return {
            grant: reactivated,
            memberId: existing.membershipId,
            created: true,
          };
        }
        await tx.insert(gameEvents).values({
          campaignId,
          actionId,
          membershipId: actorMembershipId,
          type: "player_access.reused",
          entityType: "player_access",
          entityId: existing.id,
          payload: { characterId },
        });
        return {
          grant: existing,
          memberId: existing.membershipId,
          created: false,
        };
      }
    }
    const [member] = await tx
      .insert(memberships)
      .values({ campaignId, role: "PLAYER", displayName: label })
      .returning();
    if (!member) throw new Error("MEMBER_CREATE_FAILED");
    await tx
      .update(characters)
      .set({ ownerMembershipId: member.id, updatedAt: new Date() })
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, campaignId),
        ),
      );
    await tx.execute(sql`insert into token_controllers (token_definition_id, membership_id)
      select d.id, ${member.id} from token_definitions d
      where d.character_id = ${characterId} and d.campaign_id = ${campaignId}
      and not exists (select 1 from token_controllers c where c.token_definition_id = d.id)
      on conflict do nothing`);
    const [grant] = await tx
      .insert(playerAccessGrants)
      .values({
        campaignId,
        membershipId: member.id,
        label,
        tokenHash: hashToken(token),
      })
      .returning();
    if (!grant) throw new Error("ACCESS_GRANT_CREATE_FAILED");
    await tx.insert(gameEvents).values({
      campaignId,
      actionId,
      membershipId: actorMembershipId,
      type: "player_access.created",
      entityType: "player_access",
      entityId: grant.id,
      payload: { membershipId: member.id, characterId },
    });
    return { grant, memberId: member.id, created: true };
  });
  return { ...result, token: result.created ? token : null };
}
export function registerRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
) {
  app.get("/healthz", async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return {
        status: "ok",
        database: "ok",
        buildVersion: env.APP_VERSION,
        buildRevision: env.BUILD_REVISION,
        schemaVersion: env.SCHEMA_VERSION,
        time: new Date().toISOString(),
      };
    } catch (error) {
      app.log.error({ error }, "health.database_unavailable");
      return reply.code(503).send({
        status: "error",
        database: "unavailable",
        time: new Date().toISOString(),
      });
    }
  });

  app.post("/api/auth/gm", async (request, reply) => {
    const body = gmLoginSchema.parse(request.body);
    if (!safeEqual(hashToken(body.token), hashToken(env.GM_ACCESS_TOKEN)))
      return reply.code(403).send({ error: "INVALID_MASTER_TOKEN" });
    const [gm] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.role, "GM"))
      .limit(1);
    if (!gm) return reply.code(503).send({ error: "MASTER_NOT_SEEDED" });
    await createSession(db, reply, gm.id);
    return { ok: true };
  });

  app.post("/api/auth/invite", async (request, reply) => {
    const body = inviteClaimSchema.parse(request.body);
    const tokenHash = hashToken(body.token);
    const [grant] = await db
      .select({ membershipId: playerAccessGrants.membershipId })
      .from(playerAccessGrants)
      .innerJoin(
        memberships,
        eq(playerAccessGrants.membershipId, memberships.id),
      )
      .where(
        and(
          eq(playerAccessGrants.tokenHash, tokenHash),
          isNull(playerAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (grant) {
      if (body.displayName)
        await db
          .update(memberships)
          .set({ displayName: body.displayName })
          .where(eq(memberships.id, grant.membershipId));
      await createSession(db, reply, grant.membershipId);
      return { ok: true };
    }

    const [invite] = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          isNull(invites.claimedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invite) return reply.code(410).send({ error: "INVITE_EXPIRED" });

    const result = await claimInviteOwnership(
      db,
      invite,
      body.displayName ?? invite.label,
    );
    await createSession(db, reply, result.id);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (token)
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/bootstrap", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    return buildSnapshot(db, auth);
  });

  app.get("/api/diagnostics", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const snapshot = await buildSnapshot(db, auth);
    return {
      status: "ok",
      requestId: request.id,
      buildVersion: snapshot.buildVersion,
      buildRevision: snapshot.buildRevision,
      schemaVersion: snapshot.schemaVersion,
      snapshotVersion: snapshot.snapshotVersion,
      serverTime: snapshot.serverTime,
    };
  });

  app.get("/api/preview/:membershipId", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { membershipId } = z
      .object({ membershipId: z.string().uuid() })
      .parse(request.params);
    const [target] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, membershipId),
          eq(memberships.campaignId, auth.campaignId),
          eq(memberships.role, "PLAYER"),
        ),
      )
      .limit(1);
    if (!target) return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
    return buildSnapshot(db, {
      membershipId: target.id,
      campaignId: target.campaignId,
      role: target.role,
      displayName: target.displayName,
    });
  });

  app.patch("/api/memberships/:id/name", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = renameCommandSchema
      .extend({
        name: z.string().trim().min(1).max(40),
      })
      .parse(request.body);
    if (auth.role !== "GM" && id !== auth.membershipId)
      return reply.code(403).send({ error: "MEMBERSHIP_FORBIDDEN" });
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, id),
          eq(memberships.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current)
      return reply.code(404).send({ error: "MEMBERSHIP_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "MEMBERSHIP_CONFLICT", revision: current.revision });
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(memberships)
        .set({ displayName: body.name, revision: current.revision + 1 })
        .where(
          and(
            eq(memberships.id, id),
            eq(memberships.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "membership.renamed",
        entityType: "membership",
        entityId: next.id,
        entityRevision: next.revision,
        payload: { membershipId: next.id, displayName: next.displayName },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "MEMBERSHIP_CONFLICT" });
    const sockets = await io.in(campaignRoom(auth.campaignId)).fetchSockets();
    for (const socket of sockets) {
      if (socket.data.auth?.membershipId === id)
        socket.data.auth.displayName = updated.displayName;
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.post("/api/client-logs", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = z
      .object({
        level: z.enum(["info", "warn", "error"]),
        event: z.string().trim().min(1).max(120),
        message: z.string().max(2000).optional(),
        context: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(request.body);
    app.log[body.level](
      {
        source: "browser",
        membershipId: auth.membershipId,
        campaignId: auth.campaignId,
        event: body.event,
        message: body.message,
        context: body.context,
        requestId: request.id,
      },
      "client.event",
    );
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/characters", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        actionId: actionIdSchema,
      })
      .parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const character = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(characters)
        .values({
          campaignId: auth.campaignId,
          name: body.name,
          ...createStarterCharacter(),
        })
        .returning();
      if (!created) throw new Error("CHARACTER_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character.created",
        entityType: "character",
        entityId: created.id,
        entityRevision: created.revision,
        payload: { characterId: created.id },
      });
      return created;
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(character);
  });

  app.patch("/api/characters/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = characterCommandSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.id, id), eq(characters.campaignId, auth.campaignId)),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    if (auth.role !== "GM" && current.ownerMembershipId !== auth.membershipId)
      return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    if (body.revision !== undefined && body.revision !== current.revision)
      return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    const { actionId, revision: _revision, ...updates } = body;
    if (
      auth.role !== "GM" &&
      Object.keys(updates).some(
        (key) =>
          ![
            "name",
            "portraitAssetId",
            "stats",
            "backstory",
            "inventory",
            "notes",
            "resources",
          ].includes(key),
      )
    )
      return reply.code(403).send({ error: "CHARACTER_FIELD_FORBIDDEN" });
    if (updates.portraitAssetId) {
      const [portrait] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, updates.portraitAssetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "PORTRAIT"),
          ),
        )
        .limit(1);
      if (!portrait)
        return reply.code(400).send({ error: "INVALID_PORTRAIT_ASSET" });
      if (
        auth.role !== "GM" &&
        portrait.uploadedByMembershipId !== auth.membershipId
      )
        return reply.code(403).send({ error: "PORTRAIT_ASSET_FORBIDDEN" });
    }
    const mergedUpdates = updates.stats
      ? {
          ...updates,
          stats: {
            ...(current.stats as Record<string, number>),
            ...updates.stats,
          },
        }
      : updates;
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(characters)
        .set({
          ...mergedUpdates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(characters.id, id), eq(characters.revision, current.revision)),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "character.updated",
        entityType: "character",
        entityId: next.id,
        entityRevision: next.revision,
        payload: { characterId: next.id },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    if (updated) {
      await broadcastSnapshots(io, db, auth.campaignId);
    }
    return updated;
  });

  app.post("/api/catalog", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const parsedBody = catalogEntryCommandSchema.safeParse(request.body);
    if (!parsedBody.success)
      return reply.code(400).send({ error: "INVALID_CATALOG_ENTRY" });
    const body = parsedBody.data;
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const { actionId, ...input } = body;
    const created = await db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(catalogEntries)
        .values({ campaignId: auth.campaignId, ...input })
        .returning();
      if (!entry) throw new Error("CATALOG_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "catalog.created",
        entityType: "catalog_entry",
        entityId: entry.id,
        entityRevision: 0,
      });
      return entry;
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(created);
  });

  app.patch("/api/catalog/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const parsedBody = catalogEntryCommandSchema
      .partial()
      .extend({
        actionId: actionIdSchema,
        revision: z.number().int().nonnegative().optional(),
      })
      .safeParse(request.body);
    if (!parsedBody.success)
      return reply.code(400).send({ error: "INVALID_CATALOG_ENTRY" });
    const body = parsedBody.data;
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.id, id),
          eq(catalogEntries.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CATALOG_NOT_FOUND" });
    if (body.revision !== undefined && body.revision !== current.revision)
      return reply.code(409).send({ error: "CATALOG_CONFLICT" });
    const { actionId, revision: _revision, ...updates } = body;
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(catalogEntries)
        .set({
          ...updates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogEntries.id, id),
            eq(catalogEntries.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "catalog.updated",
        entityType: "catalog_entry",
        entityId: id,
        entityRevision: next.revision,
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CATALOG_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.delete("/api/catalog/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = revisionCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ ok: true, duplicate: true });
    const [current] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.id, id),
          eq(catalogEntries.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CATALOG_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply.code(409).send({ error: "CATALOG_CONFLICT" });
    let deleted;
    try {
      deleted = await db.transaction(async (tx) => {
        // Assigned entries are snapshots. Removing a template only severs their
        // provenance link; it must never remove or mutate the character copies.
        await tx
          .update(characterCatalogEntries)
          .set({ sourceCatalogEntryId: null })
          .where(eq(characterCatalogEntries.sourceCatalogEntryId, id));
        const [entry] = await tx
          .delete(catalogEntries)
          .where(
            and(
              eq(catalogEntries.id, id),
              eq(catalogEntries.campaignId, auth.campaignId),
              eq(catalogEntries.revision, body.revision),
            ),
          )
          .returning();
        if (!entry) throw new Error("CATALOG_DELETE_CONFLICT");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "catalog.deleted",
          entityType: "catalog_entry",
          entityId: id,
          entityRevision: body.revision,
        });
        return entry;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CATALOG_DELETE_CONFLICT")
        return reply.code(409).send({ error: "CATALOG_CONFLICT" });
      throw error;
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return { ok: true, deleted };
  });

  app.post("/api/characters/:id/catalog", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const characterId = z
      .object({ id: z.string().uuid() })
      .parse(request.params).id;
    const body = assignCatalogEntrySchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [source] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.id, body.catalogEntryId),
          eq(catalogEntries.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    const [character] = await db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!source || !character)
      return reply.code(404).send({ error: "ASSIGNMENT_SOURCE_NOT_FOUND" });
    const [existingAssignment] = await db
      .select({ id: characterCatalogEntries.id })
      .from(characterCatalogEntries)
      .where(
        and(
          eq(characterCatalogEntries.characterId, characterId),
          eq(characterCatalogEntries.sourceCatalogEntryId, source.id),
        ),
      )
      .limit(1);
    if (existingAssignment)
      return reply.code(409).send({ error: "CATALOG_ALREADY_ASSIGNED" });
    let assigned;
    try {
      assigned = await db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(characterCatalogEntries)
          .values({
            characterId,
            sourceCatalogEntryId: source.id,
            kind: source.kind,
            name: source.name,
            description: source.description,
            data: source.data,
          })
          .returning();
        if (!entry) throw new Error("ASSIGNMENT_CREATE_FAILED");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.assigned",
          entityType: "character_catalog_entry",
          entityId: entry.id,
          entityRevision: 0,
        });
        return entry;
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        return reply.code(409).send({ error: "CATALOG_ALREADY_ASSIGNED" });
      throw error;
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(assigned);
  });

  app.patch(
    "/api/characters/:characterId/catalog/:id",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      const params = z
        .object({ characterId: z.string().uuid(), id: z.string().uuid() })
        .parse(request.params);
      const body = characterCatalogEntryCommandSchema
        .extend({ revision: z.number().int().nonnegative().optional() })
        .parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const [current] = await db
        .select({ entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characterCatalogEntries.id, params.id),
            eq(characterCatalogEntries.characterId, params.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!current)
        return reply.code(404).send({ error: "CHARACTER_ENTRY_NOT_FOUND" });
      if (
        body.revision !== undefined &&
        body.revision !== current.entry.revision
      )
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      const { actionId, revision: _revision, ...updates } = body;
      const updated = await db.transaction(async (tx) => {
        const [next] = await tx
          .update(characterCatalogEntries)
          .set({
            ...updates,
            revision: current.entry.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characterCatalogEntries.id, params.id),
              eq(characterCatalogEntries.revision, current.entry.revision),
            ),
          )
          .returning();
        if (!next) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.updated",
          entityType: "character_catalog_entry",
          entityId: next.id,
          entityRevision: next.revision,
        });
        return next;
      });
      if (!updated)
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      await broadcastSnapshots(io, db, auth.campaignId);
      return updated;
    },
  );

  app.delete(
    "/api/characters/:characterId/catalog/:id",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      const params = z
        .object({ characterId: z.string().uuid(), id: z.string().uuid() })
        .parse(request.params);
      const body = revisionCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ ok: true, duplicate: true });
      const [current] = await db
        .select({ entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characterCatalogEntries.id, params.id),
            eq(characterCatalogEntries.characterId, params.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!current)
        return reply.code(404).send({ error: "CHARACTER_ENTRY_NOT_FOUND" });
      if (current.entry.revision !== body.revision)
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      const deleted = await db.transaction(async (tx) => {
        const [entry] = await tx
          .delete(characterCatalogEntries)
          .where(
            and(
              eq(characterCatalogEntries.id, params.id),
              eq(characterCatalogEntries.characterId, params.characterId),
              eq(characterCatalogEntries.revision, body.revision),
            ),
          )
          .returning();
        if (!entry) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.deleted",
          entityType: "character_catalog_entry",
          entityId: params.id,
          entityRevision: body.revision,
          payload: { characterId: params.characterId },
        });
        return entry;
      });
      if (!deleted)
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      await broadcastSnapshots(io, db, auth.campaignId);
      return { ok: true };
    },
  );

  app.post("/api/invites", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createInviteSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    let access;
    try {
      access = await createPlayerAccess(
        db,
        auth.campaignId,
        body.characterId,
        body.label,
        body.actionId,
        auth.membershipId,
      );
    } catch (error) {
      if (errorMessage(error).includes("CHARACTER_NOT_FOUND"))
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
      throw error;
    }
    return reply.code(access.created ? 201 : 200).send({
      grant: playerAccessDto(access.grant, body.characterId),
      created: access.created,
      url: access.token ? `${env.PUBLIC_URL}/join/${access.token}` : null,
    });
  });

  app.get("/api/player-access", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const rows = await db
      .select({ grant: playerAccessGrants, characterId: characters.id })
      .from(playerAccessGrants)
      .leftJoin(
        characters,
        and(
          eq(characters.campaignId, playerAccessGrants.campaignId),
          eq(characters.ownerMembershipId, playerAccessGrants.membershipId),
        ),
      )
      .where(eq(playerAccessGrants.campaignId, auth.campaignId))
      .orderBy(desc(playerAccessGrants.createdAt));
    return rows.map(({ grant, characterId }) =>
      playerAccessDto(grant, characterId),
    );
  });
  app.post("/api/player-access/:id/revoke", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = rotatePlayerAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    const [grant] = await db
      .select()
      .from(playerAccessGrants)
      .where(
        and(
          eq(playerAccessGrants.id, id),
          eq(playerAccessGrants.campaignId, auth.campaignId),
          isNull(playerAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (!grant)
      return reply.code(404).send({ error: "PLAYER_ACCESS_NOT_FOUND" });
    await db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(playerAccessGrants)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(playerAccessGrants.id, grant.id),
            isNull(playerAccessGrants.revokedAt),
            eq(playerAccessGrants.tokenHash, grant.tokenHash),
          ),
        )
        .returning();
      if (!revoked) throw new Error("PLAYER_ACCESS_CONFLICT");
      await tx
        .delete(sessions)
        .where(eq(sessions.membershipId, grant.membershipId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "player_access.revoked",
        entityType: "player_access",
        entityId: grant.id,
      });
    });
    io.in(memberRoom(grant.membershipId)).disconnectSockets(true);
    return { ok: true };
  });

  app.post("/api/player-access/:id/rotate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = rotatePlayerAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    const [grant] = await db
      .select()
      .from(playerAccessGrants)
      .where(
        and(
          eq(playerAccessGrants.id, id),
          eq(playerAccessGrants.campaignId, auth.campaignId),
          isNull(playerAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (!grant)
      return reply.code(404).send({ error: "PLAYER_ACCESS_NOT_FOUND" });
    const token = randomToken();
    await db.transaction(async (tx) => {
      const [rotated] = await tx
        .update(playerAccessGrants)
        .set({ tokenHash: hashToken(token), updatedAt: new Date() })
        .where(
          and(
            eq(playerAccessGrants.id, grant.id),
            isNull(playerAccessGrants.revokedAt),
            eq(playerAccessGrants.tokenHash, grant.tokenHash),
          ),
        )
        .returning();
      if (!rotated) throw new Error("PLAYER_ACCESS_CONFLICT");
      await tx
        .delete(sessions)
        .where(eq(sessions.membershipId, grant.membershipId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "player_access.rotated",
        entityType: "player_access",
        entityId: grant.id,
      });
    });
    io.in(memberRoom(grant.membershipId)).disconnectSockets(true);
    return {
      grant: playerAccessDto(
        { ...grant, tokenHash: hashToken(token), updatedAt: new Date() },
        null,
      ),
      created: false,
      url: `${env.PUBLIC_URL}/join/${token}`,
    };
  });

  app.post("/api/scenes", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createSceneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const replay = duplicate.entityId
        ? await findSceneDto(db, auth.campaignId, duplicate.entityId)
        : null;
      if (replay) return reply.code(200).send(replay);
      return reply.code(409).send({ error: "ACTION_REPLAY_UNAVAILABLE" });
    }
    const mapAsset = body.mapAssetId
      ? (
          await db
            .select({
              id: assets.id,
              kind: assets.kind,
              width: assets.width,
              height: assets.height,
            })
            .from(assets)
            .where(
              and(
                eq(assets.id, body.mapAssetId),
                eq(assets.campaignId, auth.campaignId),
              ),
            )
            .limit(1)
        )[0]
      : null;
    if (body.mapAssetId && !mapAsset)
      return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    if (mapAsset && mapAsset.kind !== "MAP")
      return reply.code(422).send({ error: "MAP_ASSET_REQUIRED" });
    const initialBackground =
      body.backgroundFrame ??
      fitFrameToWorld(
        mapAsset?.width,
        mapAsset?.height,
        body.width,
        body.height,
      );
    const { actionId, backgroundFrame: _backgroundFrame, ...sceneInput } = body;
    const scene = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(scenes)
        .values({
          campaignId: auth.campaignId,
          ...sceneInput,
          mapAssetId: body.mapAssetId ?? null,
          backgroundX: initialBackground.x,
          backgroundY: initialBackground.y,
          backgroundWidth: initialBackground.width,
          backgroundHeight: initialBackground.height,
        })
        .returning();
      if (!created) throw new Error("SCENE_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "scene.created",
        entityType: "scene",
        entityId: created.id,
        payload: { sceneId: created.id },
      });
      return created;
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(sceneDto(scene, null));
  });

  app.patch("/api/scenes/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsedBody = updateSceneMetadataSchema.safeParse(request.body);
    if (!parsedBody.success)
      return reply.code(400).send({
        error: "INVALID_SCENE_METADATA",
        issues: parsedBody.error.issues,
      });
    const body = parsedBody.data;
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const replay = duplicate.entityId
        ? await findSceneDto(db, auth.campaignId, duplicate.entityId)
        : null;
      if (replay) return reply.code(200).send(replay);
      return reply.code(409).send({ error: "ACTION_REPLAY_UNAVAILABLE" });
    }
    const [current] = await db
      .select()
      .from(scenes)
      .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (body.revision !== current.revision)
      return reply.code(409).send({ error: "SCENE_CONFLICT" });
    const { actionId, revision: _revision, ...sceneUpdates } = body;
    if (body.mapAssetId) {
      const [mapAsset] = await db
        .select({ kind: assets.kind })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.mapAssetId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!mapAsset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      if (mapAsset.kind !== "MAP")
        return reply.code(422).send({ error: "MAP_ASSET_REQUIRED" });
    }
    const scene = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(scenes)
        .set({
          ...sceneUpdates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(scenes.id, id), eq(scenes.revision, current.revision)))
        .returning();
      if (!updated) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "scene.updated",
        entityType: "scene",
        entityId: updated.id,
        payload: { sceneId: updated.id },
      });
      return updated;
    });
    if (!scene) return reply.code(409).send({ error: "SCENE_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    const [campaign] = await db
      .select({ activeSceneId: campaigns.activeSceneId })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    return sceneDto(scene, campaign?.activeSceneId ?? null);
  });

  app.post("/api/scenes/activate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = activateSceneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return { ok: true, duplicate: true };
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    await db.transaction(async (tx) => {
      await tx
        .update(campaigns)
        .set({ activeSceneId: scene.id, updatedAt: new Date() })
        .where(eq(campaigns.id, auth.campaignId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "scene.activated",
        entityType: "scene",
        entityId: scene.id,
        payload: { sceneId: scene.id },
      });
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return { ok: true };
  });

  app.post("/api/tokens", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createTokenSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (body.assetId) {
      const [asset] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.assetId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!asset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    }
    const [existingDefinition] = body.definitionId
      ? await db
          .select()
          .from(tokenDefinitions)
          .where(
            and(
              eq(tokenDefinitions.id, body.definitionId),
              eq(tokenDefinitions.campaignId, auth.campaignId),
            ),
          )
          .limit(1)
      : [];
    if (body.definitionId && !existingDefinition)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (existingDefinition && body.controllerMembershipIds !== undefined)
      return reply
        .code(400)
        .send({ error: "CONTROLLERS_BELONG_TO_DEFINITION" });
    let tokenOwnerMembershipId = body.ownerMembershipId ?? null;
    let seededControllerMembershipId: string | null = null;
    if (body.characterId) {
      const [character] = await db
        .select({ ownerMembershipId: characters.ownerMembershipId })
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
      tokenOwnerMembershipId = character.ownerMembershipId;
      seededControllerMembershipId = character.ownerMembershipId;
    } else if (tokenOwnerMembershipId) {
      const [owner] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, tokenOwnerMembershipId),
            eq(memberships.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!owner) return reply.code(404).send({ error: "OWNER_NOT_FOUND" });
    }
    const {
      actionId,
      definitionId: _definitionId,
      controllerMembershipIds: explicitControllers,
      ...tokenInput
    } = body;
    let controllerMembershipIds =
      explicitControllers ??
      (seededControllerMembershipId
        ? [seededControllerMembershipId]
        : tokenOwnerMembershipId
          ? [tokenOwnerMembershipId]
          : []);
    if (
      new Set(controllerMembershipIds).size !== controllerMembershipIds.length
    )
      return reply.code(400).send({ error: "DUPLICATE_CONTROLLERS" });
    if (existingDefinition) {
      controllerMembershipIds = (
        await db
          .select({ membershipId: tokenControllers.membershipId })
          .from(tokenControllers)
          .where(eq(tokenControllers.tokenDefinitionId, existingDefinition.id))
      ).map((item) => item.membershipId);
    }
    if (controllerMembershipIds.length) {
      const valid = await db
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.campaignId, auth.campaignId));
      const validIds = new Set(
        valid
          .filter((member) => member.role === "PLAYER")
          .map((member) => member.id),
      );
      if (controllerMembershipIds.some((id) => !validIds.has(id)))
        return reply.code(404).send({ error: "CONTROLLER_NOT_FOUND" });
    }
    const token = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, scene.id);
      const [definition] = existingDefinition
        ? [existingDefinition]
        : await tx
            .insert(tokenDefinitions)
            .values({
              campaignId: auth.campaignId,
              characterId: body.characterId ?? null,
              defaultAssetId: body.assetId ?? null,
              name: body.name,
              defaultWidth: body.width,
              defaultHeight: body.height,
            })
            .returning();
      if (!definition) throw new Error("TOKEN_DEFINITION_CREATE_FAILED");
      if (!existingDefinition && controllerMembershipIds.length)
        await tx.insert(tokenControllers).values(
          controllerMembershipIds.map((membershipId) => ({
            tokenDefinitionId: definition.id,
            membershipId,
          })),
        );
      const [created] = await tx
        .insert(tokens)
        .values({
          ...tokenInput,
          definitionId: definition.id,
          characterId: definition.characterId,
          ownerMembershipId: tokenOwnerMembershipId,
          assetId: definition.defaultAssetId,
        })
        .returning();
      if (!created) throw new Error("TOKEN_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "token.created",
        entityType: "token",
        entityId: created.id,
        entityRevision: created.revision,
        payload: { tokenId: created.id },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: created.sceneId,
        actorMembershipId: auth.membershipId,
        actionId,
        scope: created.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_CREATE",
        targetType: "TOKEN",
        targetId: created.id,
        before: null,
        after: created,
        afterRevision: created.revision,
        currentRevision: created.revision,
      });
      return {
        ...created,
        definitionId: definition.id,
        controllerMembershipIds,
      };
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(token);
  });

  app.post("/api/token-definitions", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createTokenDefinitionSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate?.entityId) {
      const [existing] = await db
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, duplicate.entityId),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (existing) return reply.code(200).send(existing);
    }
    if (body.defaultAssetId) {
      const [asset] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.defaultAssetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      if (!asset)
        return reply.code(404).send({ error: "TOKEN_ASSET_NOT_FOUND" });
    }
    if (body.characterId) {
      const [character] = await db
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    }
    const controllerIds = [...new Set(body.controllerMembershipIds)];
    if (controllerIds.length) {
      const controllers = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "PLAYER"),
            inArray(memberships.id, controllerIds),
          ),
        );
      if (controllers.length !== controllerIds.length)
        return reply.code(404).send({ error: "CONTROLLER_NOT_FOUND" });
    }
    const created = await db.transaction(async (tx) => {
      const [definition] = await tx
        .insert(tokenDefinitions)
        .values({
          campaignId: auth.campaignId,
          name: body.name,
          characterId: body.characterId,
          defaultAssetId: body.defaultAssetId,
          defaultWidth: body.defaultWidth,
          defaultHeight: body.defaultHeight,
        })
        .returning();
      if (!definition) throw new Error("TOKEN_DEFINITION_CREATE_FAILED");
      if (controllerIds.length)
        await tx.insert(tokenControllers).values(
          controllerIds.map((membershipId) => ({
            tokenDefinitionId: definition.id,
            membershipId,
          })),
        );
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token_definition.created",
        entityType: "token_definition",
        entityId: definition.id,
        entityRevision: definition.revision,
      });
      return { ...definition, controllerMembershipIds: controllerIds };
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(created);
  });

  app.post("/api/token-definitions/:id/placements", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = placeTokenDefinitionSchema.parse({
      ...(request.body as Record<string, unknown>),
      definitionId: id,
    });
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [campaign] = await db
      .select({ activeSceneId: campaigns.activeSceneId })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!campaign?.activeSceneId)
      return reply.code(409).send({ error: "ACTIVE_SCENE_REQUIRED" });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, campaign.activeSceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    const [definition] = await db
      .select()
      .from(tokenDefinitions)
      .where(
        and(
          eq(tokenDefinitions.id, id),
          eq(tokenDefinitions.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene || !definition)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    const controllers = await db
      .select({ membershipId: tokenControllers.membershipId })
      .from(tokenControllers)
      .where(eq(tokenControllers.tokenDefinitionId, definition.id));
    if (
      auth.role !== "GM" &&
      !controllers.some((item) => item.membershipId === auth.membershipId)
    )
      return reply.code(403).send({ error: "TOKEN_DEFINITION_FORBIDDEN" });
    const snap = (value: number) =>
      scene.grid.enabled
        ? Math.round((value - scene.grid.offsetX) / scene.grid.size) *
            scene.grid.size +
          scene.grid.offsetX
        : value;
    const x = snap(body.x ?? scene.width / 2 - definition.defaultWidth / 2);
    const y = snap(body.y ?? scene.height / 2 - definition.defaultHeight / 2);
    const placement = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from token_definitions where id = ${definition.id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [lockedDefinition] = await tx
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, definition.id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!lockedDefinition) return null;
      await invalidateRedoBranch(tx, auth, scene.id);
      const [created] = await tx
        .insert(tokens)
        .values({
          definitionId: lockedDefinition.id,
          sceneId: scene.id,
          characterId: lockedDefinition.characterId,
          assetId: lockedDefinition.defaultAssetId,
          name: lockedDefinition.name,
          x,
          y,
          width: lockedDefinition.defaultWidth,
          height: lockedDefinition.defaultHeight,
          layer: "PLAYER",
        })
        .returning();
      if (!created) throw new Error("TOKEN_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token.placed",
        entityType: "token",
        entityId: created.id,
        entityRevision: created.revision,
        payload: { definitionId: definition.id, sceneId: scene.id },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: scene.id,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "TOKEN_CREATE",
        targetType: "TOKEN",
        targetId: created.id,
        before: null,
        after: created,
        afterRevision: created.revision,
        currentRevision: created.revision,
      });
      return created;
    });
    if (!placement)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_DELETED" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(placement);
  });

  app.delete("/api/tokens/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = deleteTokenSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ ok: true, duplicate: true });
    const [row] = await db
      .select({
        token: tokens,
        definition: tokenDefinitions,
        campaignId: scenes.campaignId,
      })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .innerJoin(tokenDefinitions, eq(tokens.definitionId, tokenDefinitions.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row || row.definition.campaignId !== auth.campaignId)
      return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "STALE_REVISION" });
    if (auth.role !== "GM") {
      const [controller] = await db
        .select()
        .from(tokenControllers)
        .where(
          and(
            eq(tokenControllers.tokenDefinitionId, row.definition.id),
            eq(tokenControllers.membershipId, auth.membershipId),
          ),
        )
        .limit(1);
      if (
        !controller ||
        row.token.locked ||
        !row.token.visible ||
        row.token.layer === "GM"
      )
        return reply.code(403).send({ error: "TOKEN_FORBIDDEN" });
    }
    const deleted = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [placement] = await tx
        .delete(tokens)
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!placement) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "TOKEN_DELETED",
        entityType: "TOKEN",
        entityId: id,
        entityRevision: body.revision,
        payload: {
          definitionId: row.definition.id,
          sceneId: placement.sceneId,
        },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: placement.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: placement.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_DELETE",
        targetType: "TOKEN",
        targetId: placement.id,
        before: placement,
        after: null,
        beforeRevision: placement.revision,
        currentRevision: placement.revision,
      });
      return placement;
    });
    if (!deleted) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return { ok: true };
  });

  app.put("/api/token-definitions/:id/controllers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = replaceTokenControllersSchema.parse(request.body);
    if (
      new Set(body.controllerMembershipIds).size !==
      body.controllerMembershipIds.length
    )
      return reply.code(400).send({ error: "DUPLICATE_CONTROLLERS" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [definition] = await db
      .select()
      .from(tokenDefinitions)
      .where(
        and(
          eq(tokenDefinitions.id, id),
          eq(tokenDefinitions.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!definition)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (body.controllerMembershipIds.length) {
      const valid = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "PLAYER"),
          ),
        );
      const ids = new Set(valid.map((item) => item.id));
      if (
        body.controllerMembershipIds.some(
          (membershipId) => !ids.has(membershipId),
        )
      )
        return reply.code(400).send({ error: "INVALID_CONTROLLER" });
    }
    const replaced = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(tokenDefinitions)
        .set({ revision: definition.revision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.revision, body.revision),
          ),
        )
        .returning();
      if (!updated) return null;
      await tx
        .delete(tokenControllers)
        .where(eq(tokenControllers.tokenDefinitionId, id));
      if (body.controllerMembershipIds.length)
        await tx.insert(tokenControllers).values(
          body.controllerMembershipIds.map((membershipId) => ({
            tokenDefinitionId: id,
            membershipId,
          })),
        );
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token.controllers_replaced",
        entityType: "token_definition",
        entityId: id,
        payload: { controllerMembershipIds: body.controllerMembershipIds },
      });
      return updated;
    });
    if (!replaced) {
      const [latest] = await db
        .select({ revision: tokenDefinitions.revision })
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      return reply.code(409).send({
        error: "TOKEN_DEFINITION_CONFLICT",
        revision: latest?.revision ?? null,
      });
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return {
      ok: true,
      controllerMembershipIds: body.controllerMembershipIds,
      revision: replaced.revision,
    };
  });

  app.patch("/api/token-definitions/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = tokenDefinitionUpdateSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(tokenDefinitions)
      .where(
        and(
          eq(tokenDefinitions.id, id),
          eq(tokenDefinitions.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_CONFLICT" });
    if (auth.role !== "GM") {
      if (body.defaultWidth !== undefined || body.defaultHeight !== undefined)
        return reply.code(403).send({ error: "TOKEN_SIZE_FORBIDDEN" });
      const [controller] = await db
        .select()
        .from(tokenControllers)
        .where(
          and(
            eq(tokenControllers.tokenDefinitionId, id),
            eq(tokenControllers.membershipId, auth.membershipId),
          ),
        )
        .limit(1);
      if (!controller)
        return reply.code(403).send({ error: "TOKEN_DEFINITION_FORBIDDEN" });
    }
    if (body.defaultAssetId) {
      const [asset] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, body.defaultAssetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      if (
        !asset ||
        (auth.role !== "GM" &&
          asset.uploadedByMembershipId !== auth.membershipId)
      )
        return reply.code(404).send({ error: "TOKEN_ASSET_NOT_FOUND" });
    }
    if (body.characterId) {
      const [character] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (
        !character ||
        (auth.role !== "GM" &&
          character.ownerMembershipId !== auth.membershipId)
      )
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    }
    const { actionId, revision: _revision, ...changes } = body;
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(tokenDefinitions)
        .set({
          ...changes,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "token_definition.updated",
        entityType: "token_definition",
        entityId: id,
        entityRevision: next.revision,
      });
      return next;
    });
    if (!updated)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.delete("/api/token-definitions/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = revisionCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from token_definitions where id = ${id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [current] = await tx
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!current) return { outcome: "missing" as const };
      if (current.revision !== body.revision)
        return { outcome: "conflict" as const };
      await tx.execute(
        sql`select id from tokens where definition_id = ${id} for update`,
      );
      const placementRows = await tx
        .select({ id: tokens.id, sceneId: tokens.sceneId })
        .from(tokens)
        .where(eq(tokens.definitionId, id));
      const sceneIds = [...new Set(placementRows.map((row) => row.sceneId))];
      const dependentJournalRows = await tx
        .select({ targetId: actionJournal.targetId })
        .from(actionJournal)
        .where(
          and(
            eq(actionJournal.campaignId, auth.campaignId),
            eq(actionJournal.targetType, "TOKEN"),
            sql`(${actionJournal.before}->>'definitionId' = ${id} or ${actionJournal.after}->>'definitionId' = ${id})`,
          ),
        );
      const affectedTokenIds = [
        ...new Set([
          ...placementRows.map((row) => row.id),
          ...dependentJournalRows.map((row) => row.targetId),
        ]),
      ];
      if (affectedTokenIds.length)
        await tx
          .update(actionJournal)
          .set({
            status: "INVALIDATED",
            transitionSequence: sql`nextval(pg_get_serial_sequence('action_journal', 'transition_sequence'))`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(actionJournal.campaignId, auth.campaignId),
              eq(actionJournal.targetType, "TOKEN"),
              inArray(actionJournal.targetId, affectedTokenIds),
              sql`${actionJournal.status} in ('APPLIED', 'UNDONE')`,
            ),
          );
      const [deleted] = await tx
        .delete(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.revision, current.revision),
          ),
        )
        .returning();
      if (!deleted) throw new Error("TOKEN_DEFINITION_CONFLICT");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token_definition.deleted",
        entityType: "token_definition",
        entityId: id,
        entityRevision: current.revision,
        payload: {
          placementsRemoved: placementRows.length,
          sceneIds,
          undoable: false,
          reason: "destructive definition deletion cascades placements",
        },
      });
      return {
        outcome: "deleted" as const,
        placementsRemoved: placementRows.length,
        sceneIds,
      };
    });
    if (result.outcome === "missing")
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (result.outcome === "conflict")
      return reply.code(409).send({ error: "TOKEN_DEFINITION_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(204).send();
  });

  app.post("/api/fog-reveals", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createFogRevealSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const { actionId, ...revealInput } = body;
    const result = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, scene.id);
      const [reveal] = await tx
        .insert(fogReveals)
        .values(revealInput)
        .returning();
      if (!reveal) throw new Error("FOG_CREATE_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "fog.created",
          entityType: "fog",
          entityId: reveal.id,
          payload: reveal,
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: scene.id,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "FOG_CREATE",
        targetType: "FOG",
        targetId: reveal.id,
        before: null,
        after: reveal,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { reveal, event };
    });
    const { reveal, event } = result;
    if (reveal) {
      io.to(campaignRoom(auth.campaignId)).emit("fog:created", {
        sequence: Number(event.sequence),
        actionId,
        emittedAt: event.createdAt.toISOString(),
        data: reveal,
      });
    }
    return reply.code(201).send(reveal);
  });

  app.delete("/api/fog-reveals/latest", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    return reply.code(410).send({
      error: "LEGACY_FOG_UNDO_REMOVED",
      replacement: "/api/canvas/undo",
    });
  });

  app.patch("/api/tokens/:id/layer", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = changeTokenLayerSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ token: tokens })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    const saved = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [updated] = await tx
        .update(tokens)
        .set({
          layer: body.layer,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, row.token.revision)))
        .returning();
      if (!updated) return null;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "token.layer",
          entityType: "token",
          entityId: id,
          entityRevision: updated.revision,
          payload: updated,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: updated.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope:
          updated.layer === "GM" || row.token.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_LAYER",
        targetType: "TOKEN",
        targetId: id,
        before: { layer: row.token.layer },
        after: { layer: updated.layer },
        beforeRevision: row.token.revision,
        afterRevision: updated.revision,
        currentRevision: updated.revision,
      });
      return { updated, event };
    });
    if (!saved) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return saved.updated;
  });

  app.post("/api/drawings", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createDrawingSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const { actionId, ...input } = body;
    const saved = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, scene.id);
      const [drawing] = await tx
        .insert(drawings)
        .values({ ...input, authorMembershipId: auth.membershipId })
        .returning();
      if (!drawing) throw new Error("DRAWING_CREATE_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "drawing.created",
          entityType: "drawing",
          entityId: drawing.id,
          entityRevision: 0,
          payload: drawing,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: scene.id,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "DRAWING_CREATE",
        targetType: "DRAWING",
        targetId: drawing.id,
        before: null,
        after: drawing,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { drawing, event };
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(saved.drawing);
  });

  app.patch("/api/drawings/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = updateDrawingSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(and(eq(drawings.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (
      !row ||
      (auth.role !== "GM" &&
        row.drawing.authorMembershipId !== auth.membershipId)
    )
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    if (row.drawing.revision !== body.revision)
      return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    const { actionId, revision: _revision, ...changes } = body;
    const saved = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [updated] = await tx
        .update(drawings)
        .set({
          ...changes,
          revision: row.drawing.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(drawings.id, id), eq(drawings.revision, row.drawing.revision)),
        )
        .returning();
      if (!updated) return null;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "drawing.updated",
          entityType: "drawing",
          entityId: id,
          entityRevision: updated.revision,
          payload: updated,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: updated.sceneId,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "DRAWING_UPDATE",
        targetType: "DRAWING",
        targetId: id,
        before: row.drawing,
        after: updated,
        beforeRevision: row.drawing.revision,
        afterRevision: updated.revision,
        currentRevision: updated.revision,
      });
      return { updated, event };
    });
    if (!saved) return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return saved.updated;
  });

  app.post("/api/drawings/:id/copy", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = drawingCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(and(eq(drawings.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (
      !row ||
      (auth.role !== "GM" &&
        row.drawing.authorMembershipId !== auth.membershipId)
    )
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    if (row.drawing.revision !== body.revision)
      return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    const saved = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [copy] = await tx
        .insert(drawings)
        .values({
          sceneId: row.drawing.sceneId,
          authorMembershipId: auth.membershipId,
          points: row.drawing.points,
          color: row.drawing.color,
          x: row.drawing.x + 16,
          y: row.drawing.y + 16,
        })
        .returning();
      if (!copy) throw new Error("DRAWING_COPY_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "drawing.copied",
          entityType: "drawing",
          entityId: copy.id,
          entityRevision: 0,
          payload: copy,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: copy.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "DRAWING_CREATE",
        targetType: "DRAWING",
        targetId: copy.id,
        before: null,
        after: copy,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { copy, event };
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(saved.copy);
  });

  app.delete("/api/drawings/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = drawingCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(and(eq(drawings.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (
      !row ||
      (auth.role !== "GM" &&
        row.drawing.authorMembershipId !== auth.membershipId)
    )
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    if (row.drawing.revision !== body.revision)
      return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [deleted] = await tx
        .delete(drawings)
        .where(
          and(eq(drawings.id, id), eq(drawings.revision, row.drawing.revision)),
        )
        .returning();
      if (!deleted) throw new Error("DRAWING_CONFLICT");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "drawing.deleted",
        entityType: "drawing",
        entityId: id,
        entityRevision: row.drawing.revision,
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: row.drawing.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "DRAWING_DELETE",
        targetType: "DRAWING",
        targetId: id,
        before: row.drawing,
        after: null,
        beforeRevision: row.drawing.revision,
        currentRevision: row.drawing.revision,
      });
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(204).send();
  });

  app.get("/api/canvas/history", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = z.object({ sceneId: z.string().uuid() }).parse(request.query);
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(
        and(
          eq(scenes.id, query.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const rows = await db
      .select({
        sequence: actionJournal.sequence,
        actorMembershipId: actionJournal.actorMembershipId,
        type: actionJournal.type,
        targetType: actionJournal.targetType,
        targetId: actionJournal.targetId,
        status: actionJournal.status,
        createdAt: actionJournal.createdAt,
      })
      .from(actionJournal)
      .where(
        and(
          eq(actionJournal.campaignId, auth.campaignId),
          eq(actionJournal.sceneId, scene.id),
          auth.role === "GM"
            ? undefined
            : and(
                eq(actionJournal.actorMembershipId, auth.membershipId),
                eq(actionJournal.scope, "PUBLIC"),
              ),
        ),
      )
      .orderBy(desc(actionJournal.sequence))
      .limit(100);
    return rows;
  });

  for (const direction of ["undo", "redo"] as const) {
    app.post(`/api/canvas/${direction}`, async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const body = historyCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const desiredStatus = direction === "undo" ? "APPLIED" : "UNDONE";
      const [command] = await db
        .select()
        .from(actionJournal)
        .where(
          and(
            eq(actionJournal.campaignId, auth.campaignId),
            eq(actionJournal.sceneId, body.sceneId),
            eq(actionJournal.status, desiredStatus),
            auth.role === "GM"
              ? undefined
              : and(
                  eq(actionJournal.actorMembershipId, auth.membershipId),
                  eq(actionJournal.scope, "PUBLIC"),
                ),
          ),
        )
        .orderBy(desc(actionJournal.transitionSequence))
        .limit(1);
      if (!command)
        return reply.code(404).send({ error: "HISTORY_ACTION_NOT_FOUND" });
      const snapshot = direction === "undo" ? command.before : command.after;
      const saved = await db.transaction(async (tx) => {
        let targetRevision = command.currentRevision;
        if (command.targetType === "DRAWING") {
          if (snapshot === null) {
            const [deleted] = await tx
              .delete(drawings)
              .where(
                and(
                  eq(drawings.id, command.targetId),
                  targetRevision === null
                    ? undefined
                    : eq(drawings.revision, targetRevision),
                ),
              )
              .returning();
            if (!deleted) return null;
          } else {
            const drawing = snapshot as typeof drawings.$inferSelect;
            const [existing] = await tx
              .select()
              .from(drawings)
              .where(eq(drawings.id, command.targetId))
              .limit(1);
            if (existing) {
              if (
                targetRevision === null ||
                existing.revision !== targetRevision
              )
                return null;
              const [updated] = await tx
                .update(drawings)
                .set({
                  points: drawing.points,
                  color: drawing.color,
                  x: drawing.x,
                  y: drawing.y,
                  revision: existing.revision + 1,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(drawings.id, command.targetId),
                    eq(drawings.revision, existing.revision),
                  ),
                )
                .returning();
              if (!updated) return null;
              targetRevision = updated.revision;
            } else {
              const nextRevision = (targetRevision ?? drawing.revision) + 1;
              const [restored] = await tx
                .insert(drawings)
                .values({
                  id: command.targetId,
                  sceneId: drawing.sceneId,
                  authorMembershipId: drawing.authorMembershipId,
                  points: drawing.points,
                  color: drawing.color,
                  x: drawing.x,
                  y: drawing.y,
                  revision: nextRevision,
                })
                .returning();
              if (!restored) return null;
              targetRevision = restored.revision;
            }
          }
        } else if (command.targetType === "TOKEN") {
          if (snapshot === null) {
            const [deleted] = await tx
              .delete(tokens)
              .where(
                and(
                  eq(tokens.id, command.targetId),
                  command.currentRevision === null
                    ? undefined
                    : eq(tokens.revision, command.currentRevision),
                ),
              )
              .returning();
            if (!deleted) return null;
            targetRevision = deleted.revision;
          } else if (
            command.type === "TOKEN_DELETE" ||
            command.type === "TOKEN_CREATE"
          ) {
            const token = snapshot as typeof tokens.$inferSelect;
            const [existing] = await tx
              .select({ id: tokens.id })
              .from(tokens)
              .where(eq(tokens.id, command.targetId))
              .limit(1);
            if (existing) return null;
            const nextRevision = (targetRevision ?? token.revision) + 1;
            const [restored] = await tx
              .insert(tokens)
              .values({
                id: token.id,
                definitionId: token.definitionId,
                sceneId: token.sceneId,
                characterId: token.characterId,
                ownerMembershipId: token.ownerMembershipId,
                assetId: token.assetId,
                levelId: token.levelId,
                layer: token.layer,
                name: token.name,
                x: token.x,
                y: token.y,
                z: token.z,
                width: token.width,
                height: token.height,
                rotation: token.rotation,
                visible: token.visible,
                locked: token.locked,
                revision: nextRevision,
              })
              .returning();
            if (!restored) return null;
            targetRevision = restored.revision;
          } else {
            const values = snapshot as {
              layer?: "MAP" | "GM" | "PLAYER";
              x?: number;
              y?: number;
              z?: number;
              levelId?: string | null;
            } | null;
            if (!values || targetRevision === null) return null;
            const [updated] = await tx
              .update(tokens)
              .set({
                ...(values.layer ? { layer: values.layer } : {}),
                ...(values.x !== undefined ? { x: values.x } : {}),
                ...(values.y !== undefined ? { y: values.y } : {}),
                ...(values.z !== undefined ? { z: values.z } : {}),
                ...(values.levelId !== undefined
                  ? { levelId: values.levelId }
                  : {}),
                revision: targetRevision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(tokens.id, command.targetId),
                  eq(tokens.revision, targetRevision),
                ),
              )
              .returning();
            if (!updated) return null;
            targetRevision = updated.revision;
          }
        } else if (command.targetType === "FOG") {
          if (snapshot === null) {
            const [deleted] = await tx
              .delete(fogReveals)
              .where(eq(fogReveals.id, command.targetId))
              .returning();
            if (!deleted) return null;
          } else {
            const fog = snapshot as typeof fogReveals.$inferSelect;
            const [restored] = await tx
              .insert(fogReveals)
              .values({
                id: command.targetId,
                sceneId: fog.sceneId,
                x: fog.x,
                y: fog.y,
                width: fog.width,
                height: fog.height,
                operation: fog.operation,
                revision: (targetRevision ?? fog.revision) + 1,
              })
              .returning();
            if (!restored) return null;
            targetRevision = restored.revision;
          }
        } else if (command.targetType === "SCENE") {
          if (snapshot === null) return null;
          const values = snapshot as {
            name?: string;
            mapAssetId?: string | null;
            grid: typeof scenes.$inferSelect.grid;
            mapScale: number;
            world?: { width: number; height: number };
            backgroundFrame?: {
              x: number;
              y: number;
              width: number;
              height: number;
            };
          };
          const [currentScene] = await tx
            .select({ revision: scenes.revision })
            .from(scenes)
            .where(
              and(
                eq(scenes.id, command.targetId),
                eq(scenes.campaignId, auth.campaignId),
              ),
            )
            .limit(1);
          if (!currentScene) return null;
          const [updated] = await tx
            .update(scenes)
            .set({
              ...(values.name !== undefined ? { name: values.name } : {}),
              ...(values.mapAssetId !== undefined
                ? { mapAssetId: values.mapAssetId }
                : {}),
              grid: values.grid,
              mapScale: values.mapScale,
              ...(values.world
                ? { width: values.world.width, height: values.world.height }
                : {}),
              ...(values.backgroundFrame
                ? {
                    backgroundX: values.backgroundFrame.x,
                    backgroundY: values.backgroundFrame.y,
                    backgroundWidth: values.backgroundFrame.width,
                    backgroundHeight: values.backgroundFrame.height,
                  }
                : {}),
              revision: currentScene.revision + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(scenes.id, command.targetId),
                eq(scenes.revision, currentScene.revision),
                eq(scenes.campaignId, auth.campaignId),
              ),
            )
            .returning();
          if (!updated) return null;
          targetRevision = updated.revision;
        } else return null;
        const nextStatus = direction === "undo" ? "UNDONE" : "APPLIED";
        const [journal] = await tx
          .update(actionJournal)
          .set({
            status: nextStatus,
            currentRevision: targetRevision,
            transitionSequence: sql`nextval(pg_get_serial_sequence('action_journal', 'transition_sequence'))`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(actionJournal.sequence, command.sequence),
              eq(actionJournal.status, desiredStatus),
            ),
          )
          .returning();
        if (!journal) return null;
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: `canvas.${direction}`,
            entityType: command.targetType.toLowerCase(),
            entityId: command.targetId,
            entityRevision: targetRevision,
            payload: { journalSequence: command.sequence },
          })
          .returning();
        if (!event) throw new Error("EVENT_RECORD_FAILED");
        return { journal, event };
      });
      if (!saved)
        return reply.code(409).send({ error: "HISTORY_CONFLICT_RESYNC" });
      await broadcastSnapshots(io, db, auth.campaignId);
      return {
        sequence: saved.journal.sequence,
        status: saved.journal.status,
        eventSequence: Number(saved.event.sequence),
      };
    });
  }

  app.patch("/api/scenes/:id/canvas", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = sceneCanvasConfigSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(scenes)
      .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply.code(409).send({ error: "SCENE_CONFLICT" });
    if (body.mapAssetId) {
      const [mapAsset] = await db
        .select({ kind: assets.kind })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.mapAssetId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!mapAsset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      if (mapAsset.kind !== "MAP")
        return reply.code(422).send({ error: "MAP_ASSET_REQUIRED" });
    }
    const [updated] = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, id);
      const [next] = await tx
        .update(scenes)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.mapAssetId !== undefined
            ? { mapAssetId: body.mapAssetId }
            : {}),
          ...(body.grid ? { grid: body.grid } : {}),
          ...(body.mapScale !== undefined ? { mapScale: body.mapScale } : {}),
          ...(body.world
            ? { width: body.world.width, height: body.world.height }
            : {}),
          ...(body.backgroundFrame
            ? {
                backgroundX: body.backgroundFrame.x,
                backgroundY: body.backgroundFrame.y,
                backgroundWidth: body.backgroundFrame.width,
                backgroundHeight: body.backgroundFrame.height,
              }
            : {}),
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(scenes.id, id), eq(scenes.revision, current.revision)))
        .returning();
      if (!next) return [];
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "scene.canvas",
        entityType: "scene",
        entityId: id,
        entityRevision: next.revision,
        payload: {
          name: next.name,
          mapAssetId: next.mapAssetId,
          grid: next.grid,
          mapScale: next.mapScale,
          world: { width: next.width, height: next.height },
          backgroundFrame: {
            x: next.backgroundX,
            y: next.backgroundY,
            width: next.backgroundWidth,
            height: next.backgroundHeight,
          },
        },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: id,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "SCENE_CANVAS",
        targetType: "SCENE",
        targetId: id,
        before: {
          name: current.name,
          mapAssetId: current.mapAssetId,
          grid: current.grid,
          mapScale: current.mapScale,
          world: { width: current.width, height: current.height },
          backgroundFrame: {
            x: current.backgroundX,
            y: current.backgroundY,
            width: current.backgroundWidth,
            height: current.backgroundHeight,
          },
        },
        after: {
          name: next.name,
          mapAssetId: next.mapAssetId,
          grid: next.grid,
          mapScale: next.mapScale,
          world: { width: next.width, height: next.height },
          backgroundFrame: {
            x: next.backgroundX,
            y: next.backgroundY,
            width: next.backgroundWidth,
            height: next.backgroundHeight,
          },
        },
        beforeRevision: current.revision,
        afterRevision: next.revision,
        currentRevision: next.revision,
      });
      return [next];
    });
    if (!updated) return reply.code(409).send({ error: "SCENE_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.post("/api/chat", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createChatMessageSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(chatMessages)
        .values({
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
          characterId: body.characterId ?? null,
          body: body.body,
          visibility: body.visibility,
        })
        .returning();
      if (!row) throw new Error("MESSAGE_CREATE_FAILED");
      const dto = {
        id: row.id,
        sequence: row.sequence,
        membershipId: row.membershipId,
        displayName: auth.displayName,
        characterId: row.characterId,
        body: row.body,
        visibility: row.visibility,
        kind: row.kind,
        dice: null,
        createdAt: row.createdAt.toISOString(),
      } as const;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "chat.created",
          entityType: "chat",
          entityId: row.id,
          payload: dto,
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      return { row, dto, event };
    });
    const { row, dto, event } = saved;
    const envelope = {
      sequence: Number(event.sequence),
      actionId: body.actionId,
      emittedAt: event.createdAt.toISOString(),
      data: dto,
    };
    if (row.visibility === "PUBLIC")
      io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
    else {
      io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
      io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
    }
    return reply.code(201).send(dto);
  });

  app.post("/api/campaign/clock", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = campaignClockCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    if (body.command === "START_BATTLE" && current.battleActive)
      return reply.code(409).send({ error: "BATTLE_ALREADY_ACTIVE" });
    if (body.command === "END_BATTLE" && !current.battleActive)
      return reply.code(409).send({ error: "BATTLE_NOT_ACTIVE" });
    const nextDay = current.day + (body.command === "ADVANCE_DAY" ? 1 : 0);
    const nextBattle =
      current.battleCounter + (body.command === "START_BATTLE" ? 1 : 0);
    let result;
    try {
      result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(campaigns)
          .set({
            day: nextDay,
            battleActive:
              body.command === "START_BATTLE"
                ? true
                : body.command === "END_BATTLE"
                  ? false
                  : current.battleActive,
            battleCounter: nextBattle,
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaigns.id, auth.campaignId),
              eq(campaigns.revision, current.revision),
            ),
          )
          .returning();
        if (!updated) throw new Error("CAMPAIGN_CONFLICT");
        const entryRows = await tx
          .select({ entry: characterCatalogEntries })
          .from(characterCatalogEntries)
          .innerJoin(
            characters,
            eq(characterCatalogEntries.characterId, characters.id),
          )
          .where(eq(characters.campaignId, auth.campaignId));
        let recharged = 0;
        for (const { entry } of entryRows) {
          const parsed = entryDataSchema.safeParse(
            normalizeLegacyEntryData(entry.data),
          );
          if (!parsed.success || !parsed.data.uses) continue;
          const uses = parsed.data.uses;
          const due =
            (body.command === "ADVANCE_DAY" && uses.recharge === "DAY") ||
            (body.command === "END_BATTLE" && uses.recharge === "BATTLE") ||
            (body.command === "ADVANCE_DAY" &&
              uses.recharge === "WEEK" &&
              nextDay - (uses.lastRechargeDay ?? 1) >= 7);
          if (!due) continue;
          const nextUses = {
            ...uses,
            current: uses.max,
            ...(uses.recharge === "WEEK" || uses.recharge === "DAY"
              ? { lastRechargeDay: nextDay }
              : {}),
            ...(uses.recharge === "BATTLE"
              ? { lastBattleCounter: nextBattle }
              : {}),
          };
          const [rechargedEntry] = await tx
            .update(characterCatalogEntries)
            .set({
              data: { ...parsed.data, uses: nextUses },
              revision: entry.revision + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(characterCatalogEntries.id, entry.id),
                eq(characterCatalogEntries.revision, entry.revision),
              ),
            )
            .returning({ id: characterCatalogEntries.id });
          if (!rechargedEntry) throw new Error("ENTRY_CONFLICT");
          recharged++;
        }
        const label =
          body.command === "ADVANCE_DAY"
            ? `День кампании: ${nextDay}`
            : body.command === "START_BATTLE"
              ? `Бой #${nextBattle} начат`
              : `Бой #${current.battleCounter} завершён`;
        const [message] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            kind: "SYSTEM",
            visibility: "PUBLIC",
            body:
              recharged > 0
                ? `${label}. Перезаряжено: ${recharged}.`
                : `${label}.`,
          })
          .returning();
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "campaign.clock",
          entityType: "campaign",
          entityId: auth.campaignId,
          entityRevision: updated.revision,
          payload: {
            command: body.command,
            day: nextDay,
            battleCounter: nextBattle,
            recharged,
          },
        });
        return { updated, message };
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "CAMPAIGN_CONFLICT" ||
          error.message === "ENTRY_CONFLICT")
      )
        return reply.code(409).send({ error: error.message });
      throw error;
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return result.updated;
  });

  app.patch("/api/characters/:id/counters", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = characterCountersCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [character] = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.id, id), eq(characters.campaignId, auth.campaignId)),
      )
      .limit(1);
    if (
      !character ||
      (auth.role !== "GM" && character.ownerMembershipId !== auth.membershipId)
    )
      return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    if (character.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CHARACTER_CONFLICT", revision: character.revision });
    const changes = [
      body.wallet ? formatWalletChanges(character.wallet, body.wallet) : "",
      body.resources
        ? formatResourceChanges(character.resources, body.resources)
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    if (!changes) return reply.code(400).send({ error: "NO_COUNTER_CHANGES" });
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(characters)
        .set({
          ...(body.wallet ? { wallet: body.wallet } : {}),
          ...(body.resources ? { resources: body.resources } : {}),
          revision: character.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(characters.id, id),
            eq(characters.revision, character.revision),
          ),
        )
        .returning();
      if (!updated) return null;
      const [message] = await tx
        .insert(chatMessages)
        .values({
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
          characterId: id,
          kind: "SYSTEM",
          visibility: "PUBLIC",
          body: `${character.name} — ${changes}`,
        })
        .returning();
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character.counters",
        entityType: "character",
        entityId: id,
        entityRevision: updated.revision,
        payload: { wallet: body.wallet, resources: body.resources },
      });
      return { updated, message };
    });
    if (!result) return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return result.updated;
  });

  app.post(
    "/api/characters/:characterId/catalog/:entryId/recharge",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
        .parse(request.params);
      const body = rechargeEntryCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const [row] = await db
        .select({ character: characters, entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characters.id, params.characterId),
            eq(characterCatalogEntries.id, params.entryId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (
        !row ||
        (auth.role !== "GM" &&
          row.character.ownerMembershipId !== auth.membershipId)
      )
        return reply.code(403).send({ error: "CHARACTER_ENTRY_FORBIDDEN" });
      if (row.entry.revision !== body.revision)
        return reply
          .code(409)
          .send({ error: "ENTRY_CONFLICT", revision: row.entry.revision });
      const parsed = entryDataSchema.safeParse(
        normalizeLegacyEntryData(row.entry.data),
      );
      if (!parsed.success || !parsed.data.uses)
        return reply.code(400).send({ error: "ENTRY_HAS_NO_USES" });
      const result = await db.transaction(async (tx) => {
        const [clock] = await tx
          .select({
            day: campaigns.day,
            battleCounter: campaigns.battleCounter,
          })
          .from(campaigns)
          .where(eq(campaigns.id, auth.campaignId))
          .limit(1);
        if (!clock) throw new Error("CAMPAIGN_NOT_FOUND");
        const anchoredUses = {
          ...parsed.data.uses!,
          current: parsed.data.uses!.max,
          ...(parsed.data.uses!.recharge === "DAY" ||
          parsed.data.uses!.recharge === "WEEK"
            ? { lastRechargeDay: clock.day }
            : {}),
          ...(parsed.data.uses!.recharge === "BATTLE"
            ? { lastBattleCounter: clock.battleCounter }
            : {}),
        };
        const [updated] = await tx
          .update(characterCatalogEntries)
          .set({
            data: {
              ...parsed.data,
              uses: anchoredUses,
            },
            revision: row.entry.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characterCatalogEntries.id, row.entry.id),
              eq(characterCatalogEntries.revision, row.entry.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        const [message] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: row.character.id,
            kind: "SYSTEM",
            visibility: "PUBLIC",
            body: `${auth.displayName}: ${row.entry.name} перезаряжена (${parsed.data.uses!.max}/${parsed.data.uses!.max})`,
          })
          .returning();
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "entry.recharged",
          entityType: "character_catalog_entry",
          entityId: row.entry.id,
          entityRevision: updated.revision,
        });
        return { updated, message };
      });
      if (!result) return reply.code(409).send({ error: "ENTRY_CONFLICT" });
      await broadcastSnapshots(io, db, auth.campaignId);
      return result.updated;
    },
  );

  app.post(
    "/api/characters/:characterId/catalog/:entryId/roll",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
        .parse(request.params);
      const body = entryRollRequestSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const [row] = await db
        .select({ character: characters, entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characters.id, params.characterId),
            eq(characterCatalogEntries.id, params.entryId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (
        !row ||
        (auth.role !== "GM" &&
          row.character.ownerMembershipId !== auth.membershipId)
      )
        return reply.code(403).send({ error: "CHARACTER_ENTRY_FORBIDDEN" });
      const parsedData = entryDataSchema.safeParse(
        normalizeLegacyEntryData(row.entry.data),
      );
      if (!parsedData.success)
        return reply.code(400).send({ error: "INVALID_ENTRY_DATA" });
      const action = parsedData.data.rollActions?.find(
        (candidate) => candidate.id === body.rollActionId,
      );
      if (!action)
        return reply.code(404).send({ error: "ROLL_ACTION_NOT_FOUND" });
      const values: Record<string, number> = {};
      const formulaParts = [
        action.advantage && /^1?d20$/.test(action.dice)
          ? "2d20kh1"
          : action.dice,
      ];
      for (const [index, source] of action.modifiers.entries()) {
        if (source.type === "CONSTANT") {
          formulaParts.push(String(source.value));
          continue;
        }
        if (source.type === "FORMULA") {
          const terms = source.formula.match(/[+-]?\d+/g);
          if (!terms)
            return reply.code(400).send({ error: "INVALID_MODIFIER_FORMULA" });
          formulaParts.push(
            String(terms.reduce((sum, term) => sum + Number(term), 0)),
          );
          continue;
        }
        const key = `modifier_${index}`;
        const value =
          source.type === "CHARACTERISTIC"
            ? row.character.stats[source.key]
            : parsedData.data.values?.[source.key];
        if (value === undefined || !Number.isFinite(value))
          return reply
            .code(400)
            .send({ error: "MISSING_MODIFIER_SOURCE", source });
        values[key] = value;
        formulaParts.push(key);
      }
      const formula = formulaParts.join(" + ");
      const result = rollFormula(formula, values, randomInt, action.label);
      const uses = parsedData.data.uses;
      const consumeUse = action.consumeUse;
      if (consumeUse && (!uses || uses.current < 1))
        return reply.code(409).send({ error: "NO_ABILITY_USES" });
      const saved = await db.transaction(async (tx) => {
        let systemMessage = null;
        if (consumeUse && uses) {
          const nextData = {
            ...parsedData.data,
            uses: { ...uses, current: uses.current - 1 },
          };
          const [updated] = await tx
            .update(characterCatalogEntries)
            .set({
              data: nextData,
              revision: row.entry.revision + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(characterCatalogEntries.id, row.entry.id),
                eq(characterCatalogEntries.revision, row.entry.revision),
              ),
            )
            .returning();
          if (!updated) return null;
          [systemMessage] = await tx
            .insert(chatMessages)
            .values({
              campaignId: auth.campaignId,
              membershipId: auth.membershipId,
              characterId: row.character.id,
              kind: "SYSTEM",
              visibility: "PUBLIC",
              body: `${auth.displayName}: ${row.entry.name} — использования ${uses.current} → ${uses.current - 1}`,
            })
            .returning();
          if (!systemMessage) throw new Error("COUNTER_AUDIT_FAILED");
        }
        const audit = {
          ...result,
          source: {
            entryId: row.entry.id,
            entryName: row.entry.name,
            actionId: action.id,
            actionKind: action.kind,
          },
          actor: {
            membershipId: auth.membershipId,
            displayName: auth.displayName,
          },
          characterId: row.character.id,
        };
        const [message] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: row.character.id,
            kind: "DICE",
            visibility: body.visibility,
            body: [action.label, row.entry.description, parsedData.data.notes]
              .filter(Boolean)
              .join(" — "),
            dice: audit,
          })
          .returning();
        if (!message) throw new Error("ROLL_SAVE_FAILED");
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: "entry.roll",
            entityType: "character_catalog_entry",
            entityId: row.entry.id,
            entityRevision: consumeUse
              ? row.entry.revision + 1
              : row.entry.revision,
            payload: audit,
          })
          .returning();
        return { message, systemMessage, event, audit };
      });
      if (!saved) return reply.code(409).send({ error: "ENTRY_CONFLICT" });
      await broadcastSnapshots(io, db, auth.campaignId);
      return reply
        .code(201)
        .send({ ...saved.audit, messageId: saved.message.id });
    },
  );

  app.post("/api/dice", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = diceRequestSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    let character = null;
    if (body.characterId) {
      [character] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (
        !character ||
        (auth.role !== "GM" &&
          character.ownerMembershipId !== auth.membershipId)
      )
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    } else if (auth.role === "PLAYER") {
      [character] = await db
        .select()
        .from(characters)
        .where(eq(characters.ownerMembershipId, auth.membershipId))
        .limit(1);
    }
    try {
      const normalizedFormula = body.formula.replace(
        /\bspirit\b/gi,
        "willpower",
      );
      const result = rollFormula(
        normalizedFormula,
        character?.stats ?? {},
        randomInt,
        body.label,
      );
      const saved = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: character?.id ?? null,
            kind: "DICE",
            visibility: body.visibility,
            body: body.label ?? body.formula,
            dice: result,
          })
          .returning();
        if (!row) throw new Error("ROLL_SAVE_FAILED");
        const dto = {
          id: row.id,
          sequence: row.sequence,
          membershipId: row.membershipId,
          displayName: auth.displayName,
          characterId: row.characterId,
          body: row.body,
          visibility: row.visibility,
          kind: row.kind,
          dice: result,
          createdAt: row.createdAt.toISOString(),
        } as const;
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: "dice.created",
            entityType: "chat",
            entityId: row.id,
            payload: dto,
          })
          .returning();
        if (!event) throw new Error("EVENT_RECORD_FAILED");
        return { row, dto, event };
      });
      const { row, dto, event } = saved;
      const envelope = {
        sequence: Number(event.sequence),
        actionId: body.actionId,
        emittedAt: event.createdAt.toISOString(),
        data: dto,
      };
      if (row.visibility === "PUBLIC")
        io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      else {
        io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
        io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
      }
      return reply.code(201).send(dto);
    } catch (error) {
      if (error instanceof DiceFormulaError)
        return reply
          .code(400)
          .send({ error: "INVALID_DICE_FORMULA", message: error.message });
      throw error;
    }
  });

  app.post("/api/assets", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = z.object({ kind: assetKindSchema }).parse(request.query);
    if (auth.role !== "GM" && !["TOKEN", "PORTRAIT"].includes(query.kind))
      return reply.code(403).send({ error: "ASSET_FORBIDDEN" });
    const actionId = actionIdSchema.parse(request.headers["x-action-id"]);
    const duplicate = await findAction(db, auth.campaignId, actionId);
    if (duplicate?.entityId) {
      const [existing] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, duplicate.entityId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (existing) return reply.code(200).send(existing);
    }
    const file = await request.file({
      limits: {
        fileSize:
          query.kind === "AUDIO" ? env.MAX_AUDIO_BYTES : env.MAX_IMAGE_BYTES,
        files: 1,
      },
    });
    if (!file) return reply.code(400).send({ error: "FILE_REQUIRED" });
    const buffer = await file.toBuffer();
    const [usage] = await db
      .select({ used: sum(assets.sizeBytes) })
      .from(assets)
      .where(eq(assets.campaignId, auth.campaignId));
    await assertStorageCapacity(Number(usage?.used ?? 0), buffer.length);
    try {
      const stored = await storeUpload(
        buffer,
        query.kind === "AUDIO" ? "audio" : "image",
      );
      const asset = await db
        .transaction(async (tx) => {
          const [created] = await tx
            .insert(assets)
            .values({
              campaignId: auth.campaignId,
              uploadedByMembershipId: auth.membershipId,
              kind: query.kind,
              name: displayNameFromUpload(file.filename),
              ...stored,
            })
            .returning();
          if (!created) throw new Error("ASSET_CREATE_FAILED");
          await tx.insert(gameEvents).values({
            campaignId: auth.campaignId,
            actionId,
            membershipId: auth.membershipId,
            type: "asset.created",
            entityType: "asset",
            entityId: created.id,
            payload: { assetId: created.id, kind: created.kind },
          });
          return created;
        })
        .catch(async (error) => {
          await removeStoredUpload(stored.storageKey);
          throw error;
        });
      await broadcastSnapshots(io, db, auth.campaignId);
      return reply.code(201).send(asset);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get("/api/assets/:id/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [asset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
      .limit(1);
    if (!asset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    if (auth.role !== "GM") {
      const snapshot = await buildSnapshot(db, auth);
      if (!snapshot.assets.some((visible) => visible.id === asset.id))
        return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    }
    try {
      const file = await openStoredFile(
        asset.storageKey,
        request.headers.range,
      );
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Type", asset.mimeType);
      reply.header("Cache-Control", "private, max-age=86400");
      reply.header("Content-Length", String(file.end - file.start + 1));
      if (file.partial) {
        reply.code(206);
        reply.header(
          "Content-Range",
          `bytes ${file.start}-${file.end}/${file.size}`,
        );
      }
      return reply.send(file.stream);
    } catch (error) {
      if (errorMessage(error) === "INVALID_RANGE")
        return reply.code(416).send({ error: "INVALID_RANGE" });
      return reply.code(404).send({ error: "ASSET_CONTENT_NOT_FOUND" });
    }
  });
}
