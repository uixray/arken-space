import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { and, desc, eq, gt, isNull, sql, sum } from "drizzle-orm";
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
  createInviteSchema,
  createSceneSchema,
  createTokenSchema,
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
  undoFogRevealSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@arken/contracts";
import {
  assets,
  catalogEntries,
  characterCatalogEntries,
  campaigns,
  characters,
  chatMessages,
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
    const { actionId, ...updates } = body;
    if (
      auth.role !== "GM" &&
      Object.keys(updates).some(
        (key) =>
          !["backstory", "inventory", "notes", "resources"].includes(key),
      )
    )
      return reply.code(403).send({ error: "CHARACTER_FIELD_FORBIDDEN" });
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(characters)
        .set({
          ...updates,
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
    const body = catalogEntryCommandSchema.parse(request.body);
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
    const body = catalogEntryCommandSchema
      .partial()
      .extend({ actionId: actionIdSchema })
      .parse(request.body);
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
    const { actionId, ...updates } = body;
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
    const assigned = await db.transaction(async (tx) => {
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
      const body = characterCatalogEntryCommandSchema.parse(request.body);
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
      const { actionId, ...updates } = body;
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
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const { actionId, ...sceneInput } = body;
    const scene = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(scenes)
        .values({
          campaignId: auth.campaignId,
          ...sceneInput,
          mapAssetId: body.mapAssetId ?? null,
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
    return reply.code(201).send(scene);
  });

  app.patch("/api/scenes/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = createSceneSchema
      .partial()
      .extend({ actionId: actionIdSchema })
      .parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const { actionId, ...sceneUpdates } = body;
    const scene = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(scenes)
        .set({ ...sceneUpdates, updatedAt: new Date() })
        .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId)))
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
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return scene;
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
      return {
        ...created,
        definitionId: definition.id,
        controllerMembershipIds,
      };
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(token);
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
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = undoFogRevealSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return { ok: true, duplicate: true };
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

    const result = await db.transaction(async (tx) => {
      const [latest] = await tx
        .select()
        .from(fogReveals)
        .where(eq(fogReveals.sceneId, scene.id))
        .orderBy(desc(fogReveals.createdAt), desc(fogReveals.id))
        .limit(1);
      if (!latest) return null;
      await tx.delete(fogReveals).where(eq(fogReveals.id, latest.id));
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "fog.removed",
          entityType: "fog",
          entityId: latest.id,
          payload: { fogRevealId: latest.id, sceneId: latest.sceneId },
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      return { latest, event };
    });
    if (!result) return reply.code(404).send({ error: "FOG_REVEAL_NOT_FOUND" });
    const data = {
      fogRevealId: result.latest.id,
      sceneId: result.latest.sceneId,
    };
    io.to(campaignRoom(auth.campaignId)).emit("fog:removed", {
      sequence: Number(result.event.sequence),
      actionId: body.actionId,
      emittedAt: result.event.createdAt.toISOString(),
      data,
    });
    return { ok: true, ...data };
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
    const entryRows = await db
      .select({ entry: characterCatalogEntries })
      .from(characterCatalogEntries)
      .innerJoin(
        characters,
        eq(characterCatalogEntries.characterId, characters.id),
      )
      .where(eq(characters.campaignId, auth.campaignId));
    const result = await db.transaction(async (tx) => {
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
      if (!updated) return null;
      let recharged = 0;
      for (const { entry } of entryRows) {
        const parsed = entryDataSchema.safeParse(entry.data);
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
        await tx
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
          );
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
          body: `${label}. Перезаряжено: ${recharged}.`,
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
    if (!result) return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
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
      body.wallet
        ? `кошелёк ${JSON.stringify(character.wallet)} → ${JSON.stringify(body.wallet)}`
        : "",
      body.resources
        ? `ресурсы ${JSON.stringify(character.resources)} → ${JSON.stringify(body.resources)}`
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
          body: `${auth.displayName}: ${character.name} — ${changes}`,
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
      const parsed = entryDataSchema.safeParse(row.entry.data);
      if (!parsed.success || !parsed.data.uses)
        return reply.code(400).send({ error: "ENTRY_HAS_NO_USES" });
      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(characterCatalogEntries)
          .set({
            data: {
              ...parsed.data,
              uses: { ...parsed.data.uses!, current: parsed.data.uses!.max },
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
      const parsedData = entryDataSchema.safeParse(row.entry.data);
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
      if (uses && uses.current < 1)
        return reply.code(409).send({ error: "NO_ABILITY_USES" });
      const saved = await db.transaction(async (tx) => {
        if (uses) {
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
            entityRevision: uses ? row.entry.revision + 1 : row.entry.revision,
            payload: audit,
          })
          .returning();
        return { message, event, audit };
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
      const result = rollFormula(
        body.formula,
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
