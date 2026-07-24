import { createHash, randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  sum,
} from "drizzle-orm";
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
  createStickerMessageSchema,
  stickerPackAudienceSchema,
  stickerPackSendPolicySchema,
  stickerPackSubjectSchema,
  stickerProvenanceTypeSchema,
  createDirectChatMessageSchema,
  createOrGetDirectChatThreadSchema,
  markChatThreadReadSchema,
  createFogRevealSchema,
  changeTokenLayerSchema,
  createDrawingSchema,
  canvasBulkCommandSchema,
  drawingCommandSchema,
  resizeTokenSchema,
  tokenAppearanceSchema,
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
  renameCampaignSchema,
  deleteTokenSchema,
  gmLoginSchema,
  inviteClaimSchema,
  rotatePlayerAccessSchema,
  rotateGmAccessSchema,
  replaceTokenControllersSchema,
  placeTokenDefinitionSchema,
  renameCommandSchema,
  revisionCommandSchema,
  tokenDefinitionUpdateSchema,
  updateSceneMetadataSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@arken/contracts";
import { betaPlayerByHandle, uniqueBetaPlayerIdentity } from "@arken/contracts";
import {
  assets,
  actionJournal,
  catalogEntries,
  characterCatalogEntries,
  campaigns,
  characters,
  chatMessages,
  chatReadCursors,
  chatThreads,
  chatAttachments,
  chatAttachmentUploads,
  stickerMedia,
  stickerPackEntitlements,
  stickerPacks,
  stickers,
  playerLikenessConsents,
  drawings,
  fogReveals,
  feedbackAttachments,
  feedbackReports,
  gameEvents,
  gmAccessCredentials,
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
import { applyRollMode, DiceFormulaError, rollFormula } from "./dice.js";
import { env } from "./env.js";
import { hashToken, randomToken, safeEqual } from "./security.js";
import { buildSnapshot } from "./snapshot.js";
import { registerWorldMapRoutes } from "./world-map-routes.js";
import { registerStoryRoutes } from "./story.js";
import {
  canPostToStream,
  createOrGetDirectThread,
  directThreadMemberIds,
  chatBroadcastAudience,
  chatMessageDto,
  chatVisibilityFilter,
  clampReadSequence,
  ensureStreamThread,
  resolveChatThread,
} from "./chat.js";
import {
  canMemberSendPack,
  canMembersViewPack,
  resolveSticker,
  isMatchingStickerReplay,
  invalidateStickerConsentClients,
  stickerMessageVisibility,
  stickerAssetUrl,
  stickerPresentation,
} from "./sticker-access.js";
import { invalidateRedoBranch } from "./canvas-history.js";
import {
  normalizeLegacyEntryData,
  normalizeLegacyFormula,
  normalizeLegacyStats,
} from "./entry-data.js";
import {
  clientEventSchema,
  publicUploadError,
  safeClientMessage,
  sanitizeClientContext,
} from "./telemetry.js";
import {
  assertStorageCapacity,
  displayNameFromUpload,
  openStoredFile,
  removeStoredUpload,
  storeUpload,
} from "./storage.js";
import {
  authenticatedFeedbackFieldsSchema,
  parseFeedbackDiagnostics,
  publicSuggestionSchema,
} from "./feedback.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
const campaignRoom = (id: string) => `campaign:${id}`;
const gmRoom = (id: string) => `campaign:${id}:gm`;
const memberRoom = (id: string) => `member:${id}`;
const sessionRoom = (id: string) => `session:${id}`;

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
  registerWorldMapRoutes(app, db, (campaignId) =>
    broadcastSnapshots(io, db, campaignId),
  );
  registerStoryRoutes(app, db, io);

  app.get("/healthz", { logLevel: "silent" }, async (_request, reply) => {
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
    const credentials = await db
      .select({
        membershipId: memberships.id,
        tokenHash: gmAccessCredentials.tokenHash,
      })
      .from(gmAccessCredentials)
      .innerJoin(
        memberships,
        eq(memberships.campaignId, gmAccessCredentials.campaignId),
      )
      .where(eq(memberships.role, "GM"));
    const gm = credentials.find((credential) =>
      safeEqual(hashToken(body.token), credential.tokenHash),
    );
    if (!gm) return reply.code(403).send({ error: "INVALID_MASTER_TOKEN" });
    await createSession(db, reply, gm.membershipId);
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

  // Temporary closed-beta shortcut. This intentionally authenticates by a
  // public alias and must be removed when UIX-232's recorded debt is paid.
  app.post("/api/auth/player/:handle", async (request, reply) => {
    const handle = z
      .object({ handle: z.string().min(1).max(40) })
      .parse(request.params).handle;
    const player = betaPlayerByHandle(handle);
    if (!player) return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
    const activeGrants = await db
      .select({
        membershipId: playerAccessGrants.membershipId,
        label: playerAccessGrants.label,
        displayName: memberships.displayName,
      })
      .from(playerAccessGrants)
      .innerJoin(
        memberships,
        eq(playerAccessGrants.membershipId, memberships.id),
      )
      .where(
        and(
          isNull(playerAccessGrants.revokedAt),
          eq(memberships.role, "PLAYER"),
          eq(playerAccessGrants.campaignId, memberships.campaignId),
        ),
      );
    const grant = uniqueBetaPlayerIdentity(player, activeGrants);
    if (!grant) return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
    await createSession(db, reply, grant.membershipId);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (token) {
      const deleted = await db
        .delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(token)))
        .returning({ id: sessions.id });
      for (const session of deleted)
        io.in(sessionRoom(session.id)).disconnectSockets(true);
    }
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.post("/api/gm-access/rotate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = rotateGmAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ ok: true, duplicate: true });
    const result = await db.transaction(async (tx) => {
      const [credential] = await tx
        .select()
        .from(gmAccessCredentials)
        .where(eq(gmAccessCredentials.campaignId, auth.campaignId))
        .limit(1);
      if (!credential) return null;
      const [rotated] = await tx
        .update(gmAccessCredentials)
        .set({
          tokenHash: hashToken(body.token),
          revision: credential.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(gmAccessCredentials.campaignId, auth.campaignId),
            eq(gmAccessCredentials.tokenHash, credential.tokenHash),
            eq(gmAccessCredentials.revision, credential.revision),
          ),
        )
        .returning();
      if (!rotated) return null;
      const gmRows = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "GM"),
          ),
        );
      const gmMembershipIds = gmRows.map((member) => member.id);
      await tx
        .delete(sessions)
        .where(inArray(sessions.membershipId, gmMembershipIds));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "gm_access.rotated",
        entityType: "campaign",
        entityId: auth.campaignId,
      });
      return gmMembershipIds;
    });
    if (!result) return reply.code(409).send({ error: "GM_ACCESS_CONFLICT" });
    for (const membershipId of result)
      io.in(memberRoom(membershipId)).disconnectSockets(true);
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

  app.post(
    "/api/client-logs",
    {
      bodyLimit: 4 * 1024,
      config: { rateLimit: { max: 120, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const body = clientEventSchema.parse(request.body);
      app.log[body.level](
        {
          source: "browser",
          buildRevision: env.BUILD_REVISION,
          membershipId: auth.membershipId,
          campaignId: auth.campaignId,
          event: body.event,
          message: safeClientMessage(body.event),
          context: sanitizeClientContext(body.context),
          requestId: request.id,
        },
        "client.event",
      );
      return reply.code(202).send({ ok: true });
    },
  );

  app.post(
    "/api/feedback/suggestions",
    {
      bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const body = publicSuggestionSchema.parse(request.body);
      // Bots commonly fill this invisible field. Answer successfully without
      // retaining their payload, so the endpoint does not become an oracle.
      if (body.website) return reply.code(202).send({ accepted: true });
      const [created] = await db
        .insert(feedbackReports)
        .values({
          kind: "SUGGESTION",
          description: body.description,
          contact: body.contact || null,
          buildVersion: env.APP_VERSION,
          buildRevision: env.BUILD_REVISION,
          requestId: request.id,
          diagnostics: {},
        })
        .returning({ id: feedbackReports.id });
      request.log.info(
        { reportId: created?.id },
        "feedback.suggestion_received",
      );
      return reply.code(201).send({ id: created?.id, accepted: true });
    },
  );

  app.post(
    "/api/feedback/reports",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (!request.isMultipart())
        return reply.code(415).send({ error: "MULTIPART_REQUIRED" });

      const fields: Record<string, string> = {};
      const uploads: Array<{
        kind: "SCREENSHOT" | "USER_IMAGE";
        buffer: Buffer;
      }> = [];
      for await (const part of request.parts({
        limits: {
          files: 2,
          fields: 5,
          parts: 7,
          fileSize: env.MAX_IMAGE_BYTES,
        },
      })) {
        if (part.type === "file") {
          const kind =
            part.fieldname === "screenshot"
              ? "SCREENSHOT"
              : part.fieldname === "image"
                ? "USER_IMAGE"
                : null;
          if (!kind) {
            part.file.resume();
            return reply.code(400).send({ error: "UNKNOWN_ATTACHMENT_FIELD" });
          }
          if (uploads.some((upload) => upload.kind === kind)) {
            part.file.resume();
            return reply.code(400).send({ error: "DUPLICATE_ATTACHMENT" });
          }
          uploads.push({ kind, buffer: await part.toBuffer() });
        } else {
          if (typeof part.value !== "string" || fields[part.fieldname])
            return reply.code(400).send({ error: "INVALID_FEEDBACK_FIELD" });
          fields[part.fieldname] = part.value;
        }
      }
      const body = authenticatedFeedbackFieldsSchema.parse(fields);
      if (body.website) return reply.code(202).send({ accepted: true });
      const diagnostics = parseFeedbackDiagnostics(body.diagnostics);

      const incomingBytes = uploads.reduce(
        (total, upload) => total + upload.buffer.length,
        0,
      );
      if (incomingBytes > 0) {
        const [assetUsage, attachmentUsage] = await Promise.all([
          db.select({ used: sum(assets.sizeBytes) }).from(assets),
          db
            .select({ used: sum(feedbackAttachments.sizeBytes) })
            .from(feedbackAttachments),
        ]);
        await assertStorageCapacity(
          Number(assetUsage[0]?.used ?? 0) +
            Number(attachmentUsage[0]?.used ?? 0),
          incomingBytes,
        );
      }

      const stored = [] as Array<
        Awaited<ReturnType<typeof storeUpload>> & {
          kind: "SCREENSHOT" | "USER_IMAGE";
        }
      >;
      try {
        for (const upload of uploads)
          stored.push({
            kind: upload.kind,
            ...(await storeUpload(upload.buffer, "image")),
          });
        const report = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(feedbackReports)
            .values({
              kind: body.kind,
              campaignId: auth.campaignId,
              actorMembershipId: auth.membershipId,
              title: body.title,
              description: body.description,
              buildVersion: env.APP_VERSION,
              buildRevision: env.BUILD_REVISION,
              requestId: request.id,
              diagnostics,
            })
            .returning({ id: feedbackReports.id });
          if (!created) throw new Error("FEEDBACK_CREATE_FAILED");
          if (stored.length)
            await tx.insert(feedbackAttachments).values(
              stored.map((attachment) => ({
                reportId: created.id,
                kind: attachment.kind,
                storageKey: attachment.storageKey,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                width: attachment.width!,
                height: attachment.height!,
              })),
            );
          return created;
        });
        request.log.info(
          {
            reportId: report.id,
            kind: body.kind,
            attachmentCount: stored.length,
          },
          "feedback.report_received",
        );
        return reply.code(201).send({ id: report.id, accepted: true });
      } catch (error) {
        await Promise.all(
          stored.map((attachment) => removeStoredUpload(attachment.storageKey)),
        );
        const errorCode = publicUploadError(error);
        if (errorCode !== "UPLOAD_FAILED")
          return reply.code(400).send({ error: errorCode });
        throw error;
      }
    },
  );

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
    const placement = await db.transaction(async (tx) => {
      // A character's first placement starts through this legacy route before
      // the client has received its linked definition. Serialize that setup on
      // the character so a repeated click cannot create another starter token.
      if (body.characterId) {
        await tx.execute(
          sql`select id from characters where id = ${body.characterId} and campaign_id = ${auth.campaignId} for update`,
        );
        const [existing] = await tx
          .select({ token: tokens })
          .from(tokens)
          .innerJoin(
            tokenDefinitions,
            eq(tokens.definitionId, tokenDefinitions.id),
          )
          .where(
            and(
              eq(tokens.sceneId, scene.id),
              eq(tokenDefinitions.characterId, body.characterId),
              eq(tokens.x, body.x),
              eq(tokens.y, body.y),
            ),
          )
          .limit(1);
        if (existing) return { token: existing.token, created: false };
      }
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
        token: {
          ...created,
          definitionId: definition.id,
          controllerMembershipIds,
        },
        created: true,
      };
    });
    if (placement.created) await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(placement.created ? 201 : 200).send(placement.token);
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
    const priorAction = await findAction(db, auth.campaignId, body.actionId);
    if (priorAction) {
      if (priorAction.entityType === "token" && priorAction.entityId) {
        const [priorPlacement] = await db
          .select()
          .from(tokens)
          .where(eq(tokens.id, priorAction.entityId))
          .limit(1);
        if (priorPlacement) return reply.code(200).send(priorPlacement);
      }
      return reply.code(200).send({ duplicate: true });
    }
    const [campaign] = await db
      .select({ activeSceneId: campaigns.activeSceneId })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    const requestedSceneId = body.sceneId ?? campaign?.activeSceneId;
    if (!requestedSceneId)
      return reply.code(409).send({ error: "ACTIVE_SCENE_REQUIRED" });
    if (auth.role !== "GM" && requestedSceneId !== campaign?.activeSceneId)
      return reply.code(403).send({ error: "INACTIVE_SCENE_FORBIDDEN" });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, requestedSceneId),
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
      if (lockedDefinition.characterId) {
        const [existing] = await tx
          .select()
          .from(tokens)
          .where(
            and(
              eq(tokens.definitionId, lockedDefinition.id),
              eq(tokens.sceneId, scene.id),
              eq(tokens.x, x),
              eq(tokens.y, y),
            ),
          )
          .limit(1);
        if (existing) return { token: existing, created: false };
      }
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
      return { token: created, created: true };
    });
    if (!placement)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_DELETED" });
    if (placement.created) await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(placement.created ? 201 : 200).send(placement.token);
  });

  app.patch("/api/tokens/:id/size", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = resizeTokenSchema.parse(request.body);
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
      return reply.code(409).send({ error: "STALE_REVISION" });
    // The client only exposes a proportional handle, but the server remains
    // authoritative so an older or malicious client cannot distort a token.
    const widthScale = body.width / row.token.width;
    const heightScale = body.height / row.token.height;
    const scale =
      Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
    const boundedScale = Math.min(
      Math.min(1024 / row.token.width, 1024 / row.token.height),
      Math.max(Math.max(16 / row.token.width, 16 / row.token.height), scale),
    );
    const width = Math.round(row.token.width * boundedScale);
    const height = Math.round(row.token.height * boundedScale);
    const updated = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [saved] = await tx
        .update(tokens)
        .set({
          width,
          height,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!saved) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "TOKEN_RESIZED",
        entityType: "TOKEN",
        entityId: id,
        entityRevision: saved.revision,
        payload: { width: saved.width, height: saved.height },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: saved.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: saved.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_RESIZE",
        targetType: "TOKEN",
        targetId: id,
        before: { width: row.token.width, height: row.token.height },
        after: { width: saved.width, height: saved.height },
        beforeRevision: row.token.revision,
        afterRevision: saved.revision,
        currentRevision: saved.revision,
      });
      return saved;
    });
    if (!updated) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.patch("/api/tokens/:id/appearance", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = tokenAppearanceSchema.parse(request.body);
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
      return reply.code(409).send({ error: "STALE_REVISION" });
    const updated = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [saved] = await tx
        .update(tokens)
        .set({
          baseColor: body.baseColor,
          frameColor: body.frameColor,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!saved) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "TOKEN_APPEARANCE_UPDATED",
        entityType: "TOKEN",
        entityId: id,
        entityRevision: saved.revision,
        payload: { baseColor: saved.baseColor, frameColor: saved.frameColor },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: saved.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: saved.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_APPEARANCE",
        targetType: "TOKEN",
        targetId: id,
        before: {
          baseColor: row.token.baseColor,
          frameColor: row.token.frameColor,
        },
        after: { baseColor: saved.baseColor, frameColor: saved.frameColor },
        beforeRevision: row.token.revision,
        afterRevision: saved.revision,
        currentRevision: saved.revision,
      });
      return saved;
    });
    if (!updated) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
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
        activeSceneId: campaigns.activeSceneId,
      })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .innerJoin(campaigns, eq(scenes.campaignId, campaigns.id))
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
        row.token.layer === "GM" ||
        row.token.sceneId !== row.activeSceneId
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
    const left = Math.max(0, body.x);
    const top = Math.max(0, body.y);
    const right = Math.min(scene.width, body.x + body.width);
    const bottom = Math.min(scene.height, body.y + body.height);
    if (right <= left || bottom <= top)
      return reply.code(422).send({ error: "FOG_OUTSIDE_SCENE" });
    const { actionId, sceneId: _sceneId, ...rest } = body;
    const revealInput = {
      ...rest,
      sceneId: scene.id,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
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

  app.post("/api/canvas/bulk", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = canvasBulkCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    if (
      new Set(
        body.targets.map((target) => `${target.targetType}:${target.targetId}`),
      ).size !== body.targets.length
    )
      return reply.code(422).send({ error: "DUPLICATE_BULK_TARGET" });
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
    const tokenIds = body.targets
      .filter((target) => target.targetType === "TOKEN")
      .map((target) => target.targetId);
    const drawingIds = body.targets
      .filter((target) => target.targetType === "DRAWING")
      .map((target) => target.targetId);
    const tokenRows = tokenIds.length
      ? await db
          .select()
          .from(tokens)
          .where(
            and(inArray(tokens.id, tokenIds), eq(tokens.sceneId, scene.id)),
          )
      : [];
    const drawingRows = drawingIds.length
      ? await db
          .select()
          .from(drawings)
          .where(
            and(
              inArray(drawings.id, drawingIds),
              eq(drawings.sceneId, scene.id),
            ),
          )
      : [];
    if (
      tokenRows.length !== tokenIds.length ||
      drawingRows.length !== drawingIds.length
    )
      return reply.code(404).send({ error: "CANVAS_TARGET_NOT_FOUND" });
    const requested = new Map(
      body.targets.map((target) => [
        `${target.targetType}:${target.targetId}`,
        target,
      ]),
    );
    if (
      [
        ...tokenRows.map((row) => ["TOKEN", row] as const),
        ...drawingRows.map((row) => ["DRAWING", row] as const),
      ].some(
        ([kind, row]) =>
          requested.get(`${kind}:${row.id}`)?.revision !== row.revision,
      )
    )
      return reply.code(409).send({ error: "STALE_REVISION" });
    if (auth.role !== "GM") {
      const controlled = tokenIds.length
        ? await db
            .select({ tokenDefinitionId: tokenControllers.tokenDefinitionId })
            .from(tokenControllers)
            .where(
              and(
                inArray(
                  tokenControllers.tokenDefinitionId,
                  tokenRows.map((row) => row.definitionId),
                ),
                eq(tokenControllers.membershipId, auth.membershipId),
              ),
            )
        : [];
      const controlledIds = new Set(
        controlled.map((row) => row.tokenDefinitionId),
      );
      if (
        tokenRows.some(
          (row) =>
            !controlledIds.has(row.definitionId) ||
            row.locked ||
            !row.visible ||
            row.layer === "GM",
        ) ||
        drawingRows.some((row) => row.authorMembershipId !== auth.membershipId)
      )
        return reply.code(403).send({ error: "CANVAS_TARGET_FORBIDDEN" });
    }
    const result = await db
      .transaction(async (tx) => {
        await invalidateRedoBranch(tx, auth, scene.id);
        const afterTokens: (typeof tokens.$inferSelect)[] = [];
        const afterDrawings: (typeof drawings.$inferSelect)[] = [];
        for (const row of tokenRows) {
          if (body.operation === "DELETE") {
            const [deleted] = await tx
              .delete(tokens)
              .where(
                and(eq(tokens.id, row.id), eq(tokens.revision, row.revision)),
              )
              .returning();
            if (!deleted) throw new Error("BULK_CONFLICT");
          } else {
            const [updated] = await tx
              .update(tokens)
              .set({
                x: row.x + body.deltaX,
                y: row.y + body.deltaY,
                revision: row.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(eq(tokens.id, row.id), eq(tokens.revision, row.revision)),
              )
              .returning();
            if (!updated) throw new Error("BULK_CONFLICT");
            afterTokens.push(updated);
          }
        }
        for (const row of drawingRows) {
          if (body.operation === "DELETE") {
            const [deleted] = await tx
              .delete(drawings)
              .where(
                and(
                  eq(drawings.id, row.id),
                  eq(drawings.revision, row.revision),
                ),
              )
              .returning();
            if (!deleted) throw new Error("BULK_CONFLICT");
          } else {
            const [updated] = await tx
              .update(drawings)
              .set({
                x: row.x + body.deltaX,
                y: row.y + body.deltaY,
                revision: row.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(drawings.id, row.id),
                  eq(drawings.revision, row.revision),
                ),
              )
              .returning();
            if (!updated) throw new Error("BULK_CONFLICT");
            afterDrawings.push(updated);
          }
        }
        const targetRevisions = {
          tokens: Object.fromEntries(
            tokenRows.map((row) => [row.id, row.revision]),
          ),
          drawings: Object.fromEntries(
            drawingRows.map((row) => [row.id, row.revision]),
          ),
        };
        const before = {
          tokens: tokenRows,
          drawings: drawingRows,
          revisions: targetRevisions,
        };
        const after =
          body.operation === "DELETE"
            ? {
                tokens: [],
                drawings: [],
                revisions: targetRevisions,
              }
            : {
                tokens: afterTokens,
                drawings: afterDrawings,
                revisions: {
                  tokens: Object.fromEntries(
                    afterTokens.map((row) => [row.id, row.revision]),
                  ),
                  drawings: Object.fromEntries(
                    afterDrawings.map((row) => [row.id, row.revision]),
                  ),
                },
              };
        await tx.insert(actionJournal).values({
          campaignId: auth.campaignId,
          sceneId: scene.id,
          actorMembershipId: auth.membershipId,
          actionId: body.actionId,
          type: `CANVAS_BULK_${body.operation}`,
          targetType: "CANVAS_BULK",
          targetId: body.actionId,
          before,
          after,
          currentRevision: 0,
          scope: tokenRows.some((row) => row.layer === "GM") ? "GM" : "PUBLIC",
        });
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: `canvas.bulk.${body.operation.toLowerCase()}`,
          entityType: "canvas_bulk",
          entityId: body.actionId,
          payload: { sceneId: scene.id, targets: body.targets },
        });
        return after;
      })
      .catch((error: unknown) =>
        error instanceof Error && error.message === "BULK_CONFLICT"
          ? null
          : Promise.reject(error),
      );
    if (!result) return reply.code(409).send({ error: "CANVAS_BULK_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return { ok: true, ...result };
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
      const saved = await db
        .transaction(async (tx) => {
          let targetRevision = command.currentRevision;
          if (command.targetType === "CANVAS_BULK") {
            const conflict = (): never => {
              throw new Error("CANVAS_BULK_HISTORY_CONFLICT");
            };
            type StoredToken = Omit<typeof tokens.$inferSelect, "updatedAt"> & {
              updatedAt: Date | string;
            };
            type StoredDrawing = Omit<
              typeof drawings.$inferSelect,
              "createdAt" | "updatedAt"
            > & {
              createdAt: Date | string;
              updatedAt: Date | string;
            };
            type CompoundSnapshot = {
              tokens: StoredToken[];
              drawings: StoredDrawing[];
              revisions?: {
                tokens?: Record<string, number>;
                drawings?: Record<string, number>;
              };
            };
            const desired = snapshot as CompoundSnapshot;
            const current = (
              direction === "undo" ? command.after : command.before
            ) as CompoundSnapshot;
            const tokenIds = new Set([
              ...desired.tokens.map((row) => row.id),
              ...current.tokens.map((row) => row.id),
              ...Object.keys(desired.revisions?.tokens ?? {}),
              ...Object.keys(current.revisions?.tokens ?? {}),
            ]);
            const drawingIds = new Set([
              ...desired.drawings.map((row) => row.id),
              ...current.drawings.map((row) => row.id),
              ...Object.keys(desired.revisions?.drawings ?? {}),
              ...Object.keys(current.revisions?.drawings ?? {}),
            ]);
            const currentTokens = tokenIds.size
              ? await tx
                  .select()
                  .from(tokens)
                  .where(inArray(tokens.id, [...tokenIds]))
              : [];
            const currentDrawings = drawingIds.size
              ? await tx
                  .select()
                  .from(drawings)
                  .where(inArray(drawings.id, [...drawingIds]))
              : [];
            const currentTokenRows = new Map(
              currentTokens.map((row) => [row.id, row]),
            );
            const currentDrawingRows = new Map(
              currentDrawings.map((row) => [row.id, row]),
            );
            const expectedTokenRows = new Map(
              current.tokens.map((row) => [row.id, row]),
            );
            const expectedDrawingRows = new Map(
              current.drawings.map((row) => [row.id, row]),
            );
            for (const id of tokenIds) {
              const actual = currentTokenRows.get(id);
              const expected = expectedTokenRows.get(id);
              if (
                Boolean(actual) !== Boolean(expected) ||
                (actual &&
                  actual.revision !==
                    (current.revisions?.tokens?.[id] ?? expected?.revision))
              )
                conflict();
            }
            for (const id of drawingIds) {
              const actual = currentDrawingRows.get(id);
              const expected = expectedDrawingRows.get(id);
              if (
                Boolean(actual) !== Boolean(expected) ||
                (actual &&
                  actual.revision !==
                    (current.revisions?.drawings?.[id] ?? expected?.revision))
              )
                conflict();
            }
            const desiredTokenIds = new Set(
              desired.tokens.map((row) => row.id),
            );
            const desiredDrawingIds = new Set(
              desired.drawings.map((row) => row.id),
            );
            const nextTokenRevisions = {
              ...(desired.revisions?.tokens ?? {}),
            };
            const nextDrawingRevisions = {
              ...(desired.revisions?.drawings ?? {}),
            };
            const nextTokens: StoredToken[] = [];
            const nextDrawings: StoredDrawing[] = [];
            for (const prior of current.tokens) {
              if (desiredTokenIds.has(prior.id)) continue;
              const [deleted] = await tx
                .delete(tokens)
                .where(
                  and(
                    eq(tokens.id, prior.id),
                    eq(
                      tokens.revision,
                      current.revisions?.tokens?.[prior.id] ?? prior.revision,
                    ),
                  ),
                )
                .returning();
              const deletedRow = deleted ?? conflict();
              nextTokenRevisions[prior.id] = deletedRow.revision;
            }
            for (const prior of current.drawings) {
              if (desiredDrawingIds.has(prior.id)) continue;
              const [deleted] = await tx
                .delete(drawings)
                .where(
                  and(
                    eq(drawings.id, prior.id),
                    eq(
                      drawings.revision,
                      current.revisions?.drawings?.[prior.id] ?? prior.revision,
                    ),
                  ),
                )
                .returning();
              const deletedRow = deleted ?? conflict();
              nextDrawingRevisions[prior.id] = deletedRow.revision;
            }
            for (const token of desired.tokens) {
              const existing = currentTokenRows.get(token.id);
              const nextRevision =
                (current.revisions?.tokens?.[token.id] ??
                  desired.revisions?.tokens?.[token.id] ??
                  token.revision) + 1;
              if (existing) {
                const [updated] = await tx
                  .update(tokens)
                  .set({
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
                    baseColor: token.baseColor,
                    frameColor: token.frameColor,
                    revision: nextRevision,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(tokens.id, token.id),
                      eq(tokens.revision, existing.revision),
                    ),
                  )
                  .returning();
                const updatedRow = updated ?? conflict();
                nextTokens.push(updatedRow);
                nextTokenRevisions[token.id] = updatedRow.revision;
              } else {
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
                    baseColor: token.baseColor,
                    frameColor: token.frameColor,
                    revision: nextRevision,
                    updatedAt: new Date(token.updatedAt),
                  })
                  .returning();
                const restoredRow = restored ?? conflict();
                nextTokens.push(restoredRow);
                nextTokenRevisions[token.id] = restoredRow.revision;
              }
            }
            for (const drawing of desired.drawings) {
              const existing = currentDrawingRows.get(drawing.id);
              const nextRevision =
                (current.revisions?.drawings?.[drawing.id] ??
                  desired.revisions?.drawings?.[drawing.id] ??
                  drawing.revision) + 1;
              if (existing) {
                const [updated] = await tx
                  .update(drawings)
                  .set({
                    sceneId: drawing.sceneId,
                    authorMembershipId: drawing.authorMembershipId,
                    points: drawing.points,
                    color: drawing.color,
                    x: drawing.x,
                    y: drawing.y,
                    revision: nextRevision,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(drawings.id, drawing.id),
                      eq(drawings.revision, existing.revision),
                    ),
                  )
                  .returning();
                const updatedRow = updated ?? conflict();
                nextDrawings.push(updatedRow);
                nextDrawingRevisions[drawing.id] = updatedRow.revision;
              } else {
                const [restored] = await tx
                  .insert(drawings)
                  .values({
                    id: drawing.id,
                    sceneId: drawing.sceneId,
                    authorMembershipId: drawing.authorMembershipId,
                    points: drawing.points,
                    color: drawing.color,
                    x: drawing.x,
                    y: drawing.y,
                    revision: nextRevision,
                    createdAt: new Date(drawing.createdAt),
                    updatedAt: new Date(drawing.updatedAt),
                  })
                  .returning();
                const restoredRow = restored ?? conflict();
                nextDrawings.push(restoredRow);
                nextDrawingRevisions[drawing.id] = restoredRow.revision;
              }
            }
            const nextSnapshot: CompoundSnapshot = {
              tokens: nextTokens,
              drawings: nextDrawings,
              revisions: {
                tokens: nextTokenRevisions,
                drawings: nextDrawingRevisions,
              },
            };
            if (direction === "undo") command.before = nextSnapshot;
            else command.after = nextSnapshot;
            targetRevision = (targetRevision ?? 0) + 1;
          } else if (command.targetType === "DRAWING") {
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
                  baseColor: token.baseColor,
                  frameColor: token.frameColor,
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
                width?: number;
                height?: number;
                baseColor?: string;
                frameColor?: string | null;
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
                  ...(values.width !== undefined
                    ? { width: values.width }
                    : {}),
                  ...(values.height !== undefined
                    ? { height: values.height }
                    : {}),
                  ...(values.baseColor !== undefined
                    ? { baseColor: values.baseColor }
                    : {}),
                  ...(values.frameColor !== undefined
                    ? { frameColor: values.frameColor }
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
              ...(command.targetType === "CANVAS_BULK"
                ? { before: command.before, after: command.after }
                : {}),
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
        })
        .catch((error: unknown) =>
          error instanceof Error &&
          error.message === "CANVAS_BULK_HISTORY_CONFLICT"
            ? null
            : Promise.reject(error),
        );
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

  const stickerPackInputSchema = z
    .object({
      name: z.string().trim().min(1).max(120),
      subject: stickerPackSubjectSchema,
      subjectCharacterId: z.string().uuid().nullable().optional(),
      subjectMembershipId: z.string().uuid().nullable().optional(),
      subjectLabel: z.string().trim().min(1).max(80).nullable().optional(),
      audience: stickerPackAudienceSchema.default("CAMPAIGN"),
      sendPolicy: stickerPackSendPolicySchema.default("ALL_MEMBERS"),
    })
    .strict();
  const stickerMetadataSchema = z
    .object({
      name: z.string().trim().min(1).max(80),
      altText: z.string().trim().min(1).max(240),
      provenanceType: stickerProvenanceTypeSchema,
      sourceReference: z.string().trim().min(1).max(1000).optional(),
      authorCredit: z.string().trim().min(1).max(200).optional(),
      licenseNote: z.string().trim().min(1).max(1000).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.provenanceType === "IMPORTED" &&
        (!value.sourceReference || !value.authorCredit || !value.licenseNote)
      )
        context.addIssue({
          code: "custom",
          message: "Imported stickers require provenance",
        });
    });
  const requireGm = async (
    request: Parameters<typeof requireAuth>[0],
    reply: Parameters<typeof requireAuth>[1],
  ) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth || auth.role !== "GM") {
      if (auth) reply.code(403).send({ error: "GM_REQUIRED" });
      return null;
    }
    return auth;
  };

  app.post("/api/sticker-packs", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const body = stickerPackInputSchema.parse(request.body);
    const shapeValid =
      body.subject === "CHARACTER"
        ? !!body.subjectCharacterId &&
          !body.subjectMembershipId &&
          !body.subjectLabel
        : body.subject === "PLAYER"
          ? !!body.subjectMembershipId &&
            !body.subjectCharacterId &&
            !body.subjectLabel
          : !!body.subjectLabel &&
            !body.subjectCharacterId &&
            !body.subjectMembershipId;
    if (!shapeValid)
      return reply.code(422).send({ error: "INVALID_STICKER_PACK_SUBJECT" });
    if (body.subjectMembershipId) {
      const [member] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.id, body.subjectMembershipId),
          ),
        )
        .limit(1);
      if (!member)
        return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    }
    if (body.subjectCharacterId) {
      const [character] = await db
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            eq(characters.campaignId, auth.campaignId),
            eq(characters.id, body.subjectCharacterId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    }
    const [created] = await db
      .insert(stickerPacks)
      .values({ campaignId: auth.campaignId, ...body })
      .returning();
    return reply.code(201).send(created);
  });

  app.patch("/api/sticker-packs/:id", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        revision: z.number().int().nonnegative(),
        name: z.string().trim().min(1).max(120).optional(),
        audience: stickerPackAudienceSchema.optional(),
        sendPolicy: stickerPackSendPolicySchema.optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.name !== undefined ||
          value.audience !== undefined ||
          value.sendPolicy !== undefined,
      )
      .parse(request.body);
    const [updated] = await db
      .update(stickerPacks)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.audience !== undefined ? { audience: body.audience } : {}),
        ...(body.sendPolicy !== undefined
          ? { sendPolicy: body.sendPolicy }
          : {}),
        revision: body.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "DRAFT"),
          eq(stickerPacks.revision, body.revision),
        ),
      )
      .returning();
    if (!updated)
      return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    return updated;
  });

  app.delete("/api/sticker-packs/:id", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [updated] = await db
      .update(stickerPacks)
      .set({ lifecycle: "ARCHIVED", deprecatedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          inArray(stickerPacks.lifecycle, ["DRAFT", "DEPRECATED"]),
        ),
      )
      .returning({ id: stickerPacks.id });
    if (!updated)
      return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    return reply.code(204).send();
  });

  app.post("/api/sticker-packs/:id/stickers", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const metadata = stickerMetadataSchema.parse(request.query);
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "DRAFT"),
        ),
      )
      .limit(1);
    if (!pack) return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    const file = await request.file({
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    });
    if (!file) return reply.code(400).send({ error: "UPLOAD_REQUIRED" });
    const buffer = await file.toBuffer();
    const [assetUsage, feedbackUsage, chatUsage, stickerUsage] =
      await Promise.all([
        db.select({ used: sum(assets.sizeBytes) }).from(assets),
        db
          .select({ used: sum(feedbackAttachments.sizeBytes) })
          .from(feedbackAttachments),
        db
          .select({ used: sum(chatAttachmentUploads.sizeBytes) })
          .from(chatAttachmentUploads),
        db.select({ used: sum(stickerMedia.sizeBytes) }).from(stickerMedia),
      ]);
    await assertStorageCapacity(
      Number(assetUsage[0]?.used ?? 0) +
        Number(feedbackUsage[0]?.used ?? 0) +
        Number(chatUsage[0]?.used ?? 0) +
        Number(stickerUsage[0]?.used ?? 0),
      buffer.length,
    );
    let stored: Awaited<ReturnType<typeof storeUpload>> | undefined;
    try {
      stored = await storeUpload(buffer, "image");
      if (
        stored.mimeType !== "image/webp" ||
        !stored.width ||
        !stored.height ||
        stored.width > 4096 ||
        stored.height > 4096
      )
        throw new Error("INVALID_STICKER_MEDIA");
      const result = await db.transaction(async (tx) => {
        const [media] = await tx
          .insert(stickerMedia)
          .values({
            campaignId: auth.campaignId,
            uploadedByMembershipId: auth.membershipId,
            storageKey: stored!.storageKey,
            mimeType: stored!.mimeType,
            sizeBytes: stored!.sizeBytes,
            width: stored!.width!,
            height: stored!.height!,
            sha256: createHash("sha256").update(buffer).digest("hex"),
          })
          .returning();
        const [sticker] = await tx
          .insert(stickers)
          .values({
            campaignId: auth.campaignId,
            packId: pack.id,
            mediaId: media!.id,
            ...metadata,
          })
          .returning();
        return sticker!;
      });
      return reply.code(201).send(result);
    } catch (error) {
      if (stored) await removeStoredUpload(stored.storageKey);
      return reply.code(400).send({ error: publicUploadError(error) });
    }
  });

  app.post("/api/sticker-packs/:id/publish", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "DRAFT"),
        ),
      )
      .limit(1);
    if (!pack) return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    if (pack.subject === "PLAYER") {
      const [consent] = await db
        .select()
        .from(playerLikenessConsents)
        .where(
          and(
            eq(playerLikenessConsents.campaignId, auth.campaignId),
            eq(playerLikenessConsents.packId, id),
            eq(playerLikenessConsents.membershipId, pack.subjectMembershipId!),
            eq(playerLikenessConsents.status, "GRANTED"),
          ),
        )
        .limit(1);
      if (!consent)
        return reply.code(409).send({ error: "LIKENESS_CONSENT_REQUIRED" });
    }
    const [item] = await db
      .select({ id: stickers.id })
      .from(stickers)
      .where(
        and(eq(stickers.campaignId, auth.campaignId), eq(stickers.packId, id)),
      )
      .limit(1);
    if (!item) return reply.code(409).send({ error: "STICKER_PACK_EMPTY" });
    const [updated] = await db
      .update(stickerPacks)
      .set({
        lifecycle: "ACTIVE",
        revision: pack.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(eq(stickerPacks.id, id), eq(stickerPacks.revision, pack.revision)),
      )
      .returning();
    return updated ?? reply.code(409).send({ error: "STICKER_PACK_CONFLICT" });
  });

  app.post("/api/sticker-packs/:id/deprecate", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [updated] = await db
      .update(stickerPacks)
      .set({
        lifecycle: "DEPRECATED",
        deprecatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "ACTIVE"),
        ),
      )
      .returning();
    if (!updated)
      return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    return updated;
  });

  app.put(
    "/api/sticker-packs/:id/entitlements/:membershipId",
    async (request, reply) => {
      const auth = await requireGm(request, reply);
      if (!auth) return;
      const params = z
        .object({ id: z.string().uuid(), membershipId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({ granted: z.boolean() })
        .strict()
        .parse(request.body);
      const [pack] = await db
        .select({ id: stickerPacks.id })
        .from(stickerPacks)
        .where(
          and(
            eq(stickerPacks.campaignId, auth.campaignId),
            eq(stickerPacks.id, params.id),
          ),
        )
        .limit(1);
      const [member] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.id, params.membershipId),
          ),
        )
        .limit(1);
      if (!pack || !member)
        return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
      if (body.granted)
        await db
          .insert(stickerPackEntitlements)
          .values({
            campaignId: auth.campaignId,
            packId: params.id,
            membershipId: params.membershipId,
          })
          .onConflictDoNothing();
      else
        await db
          .delete(stickerPackEntitlements)
          .where(
            and(
              eq(stickerPackEntitlements.campaignId, auth.campaignId),
              eq(stickerPackEntitlements.packId, params.id),
              eq(stickerPackEntitlements.membershipId, params.membershipId),
            ),
          );
      return reply.code(204).send();
    },
  );

  app.put("/api/sticker-packs/:id/consent", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { granted } = z
      .object({ granted: z.boolean() })
      .strict()
      .parse(request.body);
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.subject, "PLAYER"),
          eq(stickerPacks.subjectMembershipId, auth.membershipId),
        ),
      )
      .limit(1);
    if (!pack) return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .insert(playerLikenessConsents)
        .values({
          campaignId: auth.campaignId,
          packId: id,
          membershipId: auth.membershipId,
          status: granted ? "GRANTED" : "REVOKED",
          grantedAt: now,
          revokedAt: granted ? null : now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            playerLikenessConsents.packId,
            playerLikenessConsents.membershipId,
          ],
          set: {
            status: granted ? "GRANTED" : "REVOKED",
            grantedAt: granted
              ? now
              : sql`coalesce(${playerLikenessConsents.grantedAt}, ${now})`,
            revokedAt: granted ? null : now,
            updatedAt: now,
          },
        });
      if (!granted)
        await tx
          .update(stickerPacks)
          .set({
            lifecycle: "DEPRECATED",
            deprecatedAt: now,
            revision: pack.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(stickerPacks.id, id),
              eq(stickerPacks.campaignId, auth.campaignId),
            ),
          );
    });
    await invalidateStickerConsentClients(
      (campaignId) => broadcastSnapshots(io, db, campaignId),
      auth.campaignId,
    );
    return reply.code(204).send();
  });

  app.get("/api/stickers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const packs = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.lifecycle, "ACTIVE"),
        ),
      );
    const result = [];
    for (const pack of packs) {
      if (
        !(await canMembersViewPack(db, auth.campaignId, pack, [
          auth.membershipId,
        ]))
      )
        continue;
      const items = await db
        .select({ sticker: stickers, media: stickerMedia })
        .from(stickers)
        .innerJoin(
          stickerMedia,
          and(
            eq(stickerMedia.id, stickers.mediaId),
            eq(stickerMedia.campaignId, stickers.campaignId),
          ),
        )
        .where(
          and(
            eq(stickers.campaignId, auth.campaignId),
            eq(stickers.packId, pack.id),
          ),
        );
      result.push({
        id: pack.id,
        name: pack.name,
        subject: pack.subject,
        subjectCharacterId: pack.subjectCharacterId,
        subjectMembershipId: pack.subjectMembershipId,
        subjectLabel: pack.subjectLabel,
        lifecycle: pack.lifecycle,
        canSend: await canMemberSendPack(db, auth, pack),
        stickers: items.map(({ sticker, media }) => ({
          id: sticker.id,
          packId: sticker.packId,
          name: sticker.name,
          altText: sticker.altText,
          url: stickerAssetUrl(sticker.id),
          width: media.width,
          height: media.height,
          attribution: {
            authorCredit: sticker.authorCredit,
            licenseNote: sticker.licenseNote,
          },
        })),
      });
    }
    reply.header("Cache-Control", "private, no-store");
    return result;
  });

  app.get("/api/stickers/:id/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = await resolveSticker(db, auth, id);
    if (!row || !["ACTIVE", "DEPRECATED"].includes(row.pack.lifecycle))
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const [revokedConsent] =
      row.pack.subject === "PLAYER"
        ? await db
            .select({ status: playerLikenessConsents.status })
            .from(playerLikenessConsents)
            .where(
              and(
                eq(playerLikenessConsents.campaignId, auth.campaignId),
                eq(playerLikenessConsents.packId, row.pack.id),
                eq(playerLikenessConsents.status, "REVOKED"),
              ),
            )
            .limit(1)
        : [];
    if (revokedConsent)
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const currentlyVisible = await canMembersViewPack(
      db,
      auth.campaignId,
      row.pack,
      [auth.membershipId],
    );
    const [historicalMessage] = currentlyVisible
      ? []
      : await db
          .select({
            id: chatMessages.id,
            viewers: chatMessages.stickerViewerMembershipIds,
          })
          .from(chatMessages)
          .innerJoin(
            chatThreads,
            and(
              eq(chatThreads.id, chatMessages.threadId),
              eq(chatThreads.campaignId, chatMessages.campaignId),
            ),
          )
          .where(
            and(
              eq(chatMessages.campaignId, auth.campaignId),
              eq(chatMessages.stickerId, row.sticker.id),
              chatVisibilityFilter(auth),
              or(
                eq(chatThreads.type, "STREAM"),
                eq(chatThreads.participantAMembershipId, auth.membershipId),
                eq(chatThreads.participantBMembershipId, auth.membershipId),
              ),
            ),
          )
          .limit(1);
    const visibleHistoricalMessage =
      historicalMessage &&
      (!historicalMessage.viewers ||
        historicalMessage.viewers.includes(auth.membershipId));
    if (!currentlyVisible && !visibleHistoricalMessage)
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    try {
      const file = await openStoredFile(
        row.media.storageKey,
        request.headers.range,
      );
      reply.header("Content-Type", row.media.mimeType);
      reply.header("Cache-Control", "private, no-store");
      reply.header("Content-Length", String(file.end - file.start + 1));
      if (file.partial) {
        reply.code(206);
        reply.header(
          "Content-Range",
          `bytes ${file.start}-${file.end}/${file.size}`,
        );
      }
      return reply.send(file.stream);
    } catch {
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    }
  });

  app.post("/api/chat/stickers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createStickerMessageSchema.parse(request.body);
    let thread;
    try {
      thread = await resolveChatThread(db, auth, body, ["TABLE", "STORY"], {
        allowDirect: true,
      });
    } catch {
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    }
    if (
      thread.type === "STREAM" &&
      (!thread.stream || !canPostToStream(auth, thread.stream))
    )
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate)
      return isMatchingStickerReplay(duplicate, {
        membershipId: auth.membershipId,
        threadId: thread.id,
        stickerId: body.stickerId,
      })
        ? reply.code(200).send(duplicate.payload)
        : reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    const resolved = await resolveSticker(db, auth, body.stickerId);
    if (
      !resolved ||
      resolved.pack.lifecycle !== "ACTIVE" ||
      !(await canMemberSendPack(db, auth, resolved.pack))
    )
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const viewers =
      thread.type === "DIRECT" ? directThreadMemberIds(thread) : [];
    if (
      viewers.length &&
      !(await canMembersViewPack(db, auth.campaignId, resolved.pack, viewers))
    )
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const presentation = stickerPresentation(resolved);
    let audienceMembershipIds: string[] | null = null;
    if (thread.type === "DIRECT") {
      audienceMembershipIds = viewers;
    } else if (resolved.pack.audience !== "CAMPAIGN") {
      const recipientRows =
        resolved.pack.audience === "GM_ONLY"
          ? await db
              .select({ id: memberships.id })
              .from(memberships)
              .where(
                and(
                  eq(memberships.campaignId, auth.campaignId),
                  eq(memberships.role, "GM"),
                ),
              )
          : await db
              .select({ id: memberships.id })
              .from(memberships)
              .leftJoin(
                stickerPackEntitlements,
                and(
                  eq(
                    stickerPackEntitlements.campaignId,
                    memberships.campaignId,
                  ),
                  eq(stickerPackEntitlements.membershipId, memberships.id),
                  eq(stickerPackEntitlements.packId, resolved.pack.id),
                ),
              )
              .where(
                and(
                  eq(memberships.campaignId, auth.campaignId),
                  or(
                    eq(memberships.role, "GM"),
                    eq(stickerPackEntitlements.packId, resolved.pack.id),
                  ),
                ),
              );
      audienceMembershipIds = [
        ...new Set([
          ...recipientRows.map((item) => item.id),
          auth.membershipId,
        ]),
      ];
    }
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(chatMessages)
        .values({
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
          characterId: null,
          kind: "TEXT",
          threadId: thread.id,
          visibility: stickerMessageVisibility(resolved.pack.audience),
          body: "",
          stickerId: resolved.sticker.id,
          stickerPresentation: presentation,
          stickerViewerMembershipIds: audienceMembershipIds,
        })
        .returning();
      const dto = chatMessageDto(row!, auth.displayName, thread.stream);
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "chat.created",
          entityType: "chat",
          entityId: row!.id,
          payload: dto,
        })
        .returning();
      return { dto, event: event! };
    });
    const envelope = {
      sequence: Number(saved.event.sequence),
      actionId: body.actionId,
      emittedAt: saved.event.createdAt.toISOString(),
      data: saved.dto,
    };
    if (audienceMembershipIds) {
      for (const membershipId of audienceMembershipIds)
        io.to(memberRoom(membershipId)).emit("chat:created", envelope);
    } else {
      io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
    }
    return reply.code(201).send(saved.dto);
  });

  app.post("/api/chat/attachments", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const expired = await db
      .select({
        id: chatAttachmentUploads.id,
        storageKey: chatAttachmentUploads.storageKey,
      })
      .from(chatAttachmentUploads)
      .where(
        and(
          eq(chatAttachmentUploads.status, "STAGED"),
          lt(chatAttachmentUploads.expiresAt, new Date()),
        ),
      )
      .limit(25);
    if (expired.length) {
      await Promise.all(
        expired.map((item) => removeStoredUpload(item.storageKey)),
      );
      await db.delete(chatAttachmentUploads).where(
        inArray(
          chatAttachmentUploads.id,
          expired.map((item) => item.id),
        ),
      );
    }
    const file = await request.file({
      limits: { files: 1, fileSize: env.MAX_IMAGE_BYTES },
    });
    if (!file) return reply.code(400).send({ error: "UPLOAD_REQUIRED" });
    const buffer = await file.toBuffer();
    if (file.file.truncated)
      return reply.code(400).send({ error: "IMAGE_TOO_LARGE" });
    const [assetUsage, feedbackUsage, chatUsage] = await Promise.all([
      db.select({ used: sum(assets.sizeBytes) }).from(assets),
      db
        .select({ used: sum(feedbackAttachments.sizeBytes) })
        .from(feedbackAttachments),
      db
        .select({ used: sum(chatAttachmentUploads.sizeBytes) })
        .from(chatAttachmentUploads),
    ]);
    const usedBytes =
      Number(assetUsage[0]?.used ?? 0) +
      Number(feedbackUsage[0]?.used ?? 0) +
      Number(chatUsage[0]?.used ?? 0);
    await assertStorageCapacity(usedBytes, buffer.length);
    let stored: Awaited<ReturnType<typeof storeUpload>> | undefined;
    try {
      stored = await storeUpload(buffer, "image");
      const [upload] = await db
        .insert(chatAttachmentUploads)
        .values({
          campaignId: auth.campaignId,
          uploadedByMembershipId: auth.membershipId,
          fileName: file.filename.slice(0, 255),
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          width: stored.width,
          height: stored.height,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .returning();
      if (!upload) throw new Error("UPLOAD_FAILED");
      return reply.code(201).send({
        contentId: upload.contentId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        width: upload.width,
        height: upload.height,
        createdAt: upload.createdAt.toISOString(),
      });
    } catch (error) {
      if (stored) await removeStoredUpload(stored.storageKey);
      return reply.code(400).send({ error: publicUploadError(error) });
    }
  });

  app.get(
    "/api/chat/attachments/:contentId/content",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const { contentId } = z
        .object({ contentId: z.string().uuid() })
        .parse(request.params);
      const [item] = await db
        .select({ upload: chatAttachmentUploads, thread: chatThreads })
        .from(chatAttachments)
        .innerJoin(
          chatAttachmentUploads,
          and(
            eq(chatAttachmentUploads.campaignId, chatAttachments.campaignId),
            eq(chatAttachmentUploads.contentId, chatAttachments.contentId),
          ),
        )
        .innerJoin(
          chatThreads,
          and(
            eq(chatThreads.campaignId, chatAttachments.campaignId),
            eq(chatThreads.id, chatAttachments.threadId),
          ),
        )
        .where(
          and(
            eq(chatAttachments.campaignId, auth.campaignId),
            eq(chatAttachments.contentId, contentId),
            or(
              and(
                eq(chatThreads.type, "STREAM"),
                eq(
                  chatAttachmentUploads.uploadedByMembershipId,
                  auth.membershipId,
                ),
              ),
              eq(chatThreads.participantAMembershipId, auth.membershipId),
              eq(chatThreads.participantBMembershipId, auth.membershipId),
            ),
          ),
        )
        .limit(1);
      if (!item) return reply.code(404).send({ error: "NOT_FOUND" });
      try {
        const opened = await openStoredFile(item.upload.storageKey, undefined);
        reply.header("Content-Type", item.upload.mimeType);
        reply.header("Content-Length", String(opened.size));
        reply.header("Cache-Control", "private, no-store");
        return reply.send(opened.stream);
      } catch {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
    },
  );

  app.post("/api/chat/direct", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createOrGetDirectChatThreadSchema.parse(request.body);
    const [participant] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.campaignId, auth.campaignId),
          eq(memberships.id, body.participantMembershipId),
        ),
      )
      .limit(1);
    if (!participant || participant.id === auth.membershipId)
      return reply.code(404).send({ error: "CHAT_THREAD_NOT_FOUND" });
    const { thread, created } = await createOrGetDirectThread(
      db,
      auth,
      participant.id,
    );
    const participantIds = directThreadMemberIds(thread);
    const participantRows = await db
      .select({
        membershipId: memberships.id,
        displayName: memberships.displayName,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.campaignId, auth.campaignId),
          inArray(memberships.id, participantIds),
        ),
      );
    const byId = new Map(
      participantRows.map((item) => [item.membershipId, item]),
    );
    const dto = {
      id: thread.id,
      campaignId: thread.campaignId,
      type: "DIRECT" as const,
      stream: null,
      participants: participantIds
        .map((id) => byId.get(id)!)
        .filter(Boolean) as [
        { membershipId: string; displayName: string },
        { membershipId: string; displayName: string },
      ],
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    };
    if (created) {
      const event = {
        thread: dto,
        state: {
          threadId: thread.id,
          stream: null,
          lastReadSequence: 0,
          latestSequence: 0,
          unreadCount: 0,
        },
      };
      for (const membershipId of participantIds)
        io.to(memberRoom(membershipId)).emit("chat:thread_created", event);
    }
    return reply.code(created ? 201 : 200).send(dto);
  });

  app.post("/api/chat/direct/messages", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createDirectChatMessageSchema.parse(request.body);
    let thread;
    try {
      thread = await resolveChatThread(
        db,
        auth,
        { threadId: body.threadId },
        [],
        { allowDirect: true },
      );
    } catch {
      return reply.code(404).send({ error: "CHAT_THREAD_NOT_FOUND" });
    }
    if (thread.type !== "DIRECT")
      return reply.code(404).send({ error: "CHAT_THREAD_NOT_FOUND" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      if (
        duplicate.membershipId === auth.membershipId &&
        duplicate.type === "chat.created" &&
        duplicate.payload &&
        typeof duplicate.payload === "object" &&
        "threadId" in duplicate.payload &&
        duplicate.payload.threadId === thread.id
      )
        return reply.code(200).send(duplicate.payload);
      return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    }
    let saved;
    try {
      saved = await db.transaction(async (tx) => {
        const attachmentIds = body.attachmentContentIds;
        const staged = attachmentIds.length
          ? await tx
              .select()
              .from(chatAttachmentUploads)
              .where(
                and(
                  eq(chatAttachmentUploads.campaignId, auth.campaignId),
                  eq(
                    chatAttachmentUploads.uploadedByMembershipId,
                    auth.membershipId,
                  ),
                  eq(chatAttachmentUploads.status, "STAGED"),
                  gt(chatAttachmentUploads.expiresAt, new Date()),
                  inArray(chatAttachmentUploads.contentId, attachmentIds),
                ),
              )
          : [];
        if (staged.length !== attachmentIds.length)
          throw new Error("CHAT_ATTACHMENT_NOT_FOUND");
        const [row] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: null,
            threadId: thread.id,
            body: body.body,
            visibility: "PUBLIC",
          })
          .returning();
        if (!row) throw new Error("MESSAGE_CREATE_FAILED");
        if (staged.length) {
          await tx.insert(chatAttachments).values(
            staged.map((upload) => ({
              contentId: upload.contentId,
              campaignId: auth.campaignId,
              threadId: thread.id,
              messageId: row.id,
            })),
          );
          await tx
            .update(chatAttachmentUploads)
            .set({ status: "CLAIMED" })
            .where(inArray(chatAttachmentUploads.contentId, attachmentIds));
        }
        const dto = {
          ...chatMessageDto(row, auth.displayName, null),
          attachments: staged.map((upload) => ({
            contentId: upload.contentId,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            width: upload.width,
            height: upload.height,
            createdAt: upload.createdAt.toISOString(),
          })),
        };
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
        return { dto, event };
      });
    } catch (error) {
      const replay = await findAction(db, auth.campaignId, body.actionId);
      if (
        replay?.membershipId === auth.membershipId &&
        replay.type === "chat.created" &&
        replay.payload &&
        typeof replay.payload === "object" &&
        "threadId" in replay.payload &&
        replay.payload.threadId === thread.id
      )
        return reply.code(200).send(replay.payload);
      if (replay) return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
      if (
        error instanceof Error &&
        error.message === "CHAT_ATTACHMENT_NOT_FOUND"
      )
        return reply.code(404).send({ error: "CHAT_ATTACHMENT_NOT_FOUND" });
      throw error;
    }

    const envelope = {
      sequence: Number(saved.event.sequence),
      actionId: body.actionId,
      emittedAt: saved.event.createdAt.toISOString(),
      data: saved.dto,
    };
    for (const membershipId of directThreadMemberIds(thread))
      io.to(memberRoom(membershipId)).emit("chat:created", envelope);
    return reply.code(201).send(saved.dto);
  });

  app.post("/api/chat", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createChatMessageSchema.parse(request.body);
    let thread;
    try {
      thread = await resolveChatThread(db, auth, body, ["TABLE", "STORY"]);
      if (thread.type !== "STREAM" || !thread.stream)
        throw new Error("CHAT_THREAD_NOT_FOUND");
      if (!canPostToStream(auth, thread.stream))
        throw new Error("CHAT_THREAD_FORBIDDEN");
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "CHAT_THREAD_FORBIDDEN";
      return reply
        .code(code === "CHAT_THREAD_NOT_FOUND" ? 404 : 403)
        .send({ error: code });
    }
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    let characterId: string | null = null;
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
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
      characterId = character.id;
    }
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(chatMessages)
        .values({
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
          characterId,
          threadId: thread.id,
          body: body.body,
          visibility: body.visibility,
        })
        .returning();
      if (!row) throw new Error("MESSAGE_CREATE_FAILED");
      const dto = chatMessageDto(row, auth.displayName, thread.stream);
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
    if (chatBroadcastAudience(row.visibility) === "CAMPAIGN")
      io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
    else {
      io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
      io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
    }
    return reply.code(201).send(dto);
  });

  app.post("/api/chat/read", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = markChatThreadReadSchema.parse(request.body);
    let thread;
    try {
      thread = await resolveChatThread(
        db,
        auth,
        { threadId: body.threadId },
        ["ROLLS", "STORY", "TABLE"],
        { allowDirect: true },
      );
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "CHAT_THREAD_FORBIDDEN";
      return reply
        .code(code === "CHAT_THREAD_NOT_FOUND" ? 404 : 403)
        .send({ error: code });
    }
    const [latest] = await db
      .select({ sequence: chatMessages.sequence })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.campaignId, auth.campaignId),
          eq(chatMessages.threadId, thread.id),
          chatVisibilityFilter(auth),
        ),
      )
      .orderBy(desc(chatMessages.sequence))
      .limit(1);
    const [previousCursor] = await db
      .select({ lastReadSequence: chatReadCursors.lastReadSequence })
      .from(chatReadCursors)
      .where(
        and(
          eq(chatReadCursors.membershipId, auth.membershipId),
          eq(chatReadCursors.threadId, thread.id),
        ),
      )
      .limit(1);
    const nextSequence = clampReadSequence(
      previousCursor?.lastReadSequence ?? 0,
      body.sequence,
      latest?.sequence ?? 0,
    );
    const [cursor] = await db
      .insert(chatReadCursors)
      .values({
        campaignId: auth.campaignId,
        membershipId: auth.membershipId,
        threadId: thread.id,
        lastReadSequence: nextSequence,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [chatReadCursors.membershipId, chatReadCursors.threadId],
        set: {
          lastReadSequence: sql`greatest(${chatReadCursors.lastReadSequence}, ${nextSequence})`,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!cursor) throw new Error("CHAT_CURSOR_UPDATE_FAILED");
    return {
      campaignId: cursor.campaignId,
      threadId: cursor.threadId,
      lastReadSequence: cursor.lastReadSequence,
      updatedAt: cursor.updatedAt.toISOString(),
    };
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
    const tableThread = await ensureStreamThread(db, auth.campaignId, "TABLE");
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
            threadId: tableThread.id,
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

  app.patch("/api/campaign", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = renameCampaignSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const [replayed] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      return replayed
        ? reply.code(200).send(replayed)
        : reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    }
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
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          name: body.name,
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
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.renamed",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: { name: next.name },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
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
    const tableThread = await ensureStreamThread(db, auth.campaignId, "TABLE");
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
          threadId: tableThread.id,
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
      const tableThread = await ensureStreamThread(
        db,
        auth.campaignId,
        "TABLE",
      );
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
            threadId: tableThread.id,
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
      const mode = body.mode ?? "EXECUTE";
      const replay = await findAction(db, auth.campaignId, body.actionId);
      if (replay) return reply.code(200).send({ duplicate: true });
      if (auth.role !== "GM" && body.visibility === "GM_ONLY")
        return reply.code(403).send({ error: "GM_ONLY_VISIBILITY_FORBIDDEN" });
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
      if (
        body.entryRevision !== undefined &&
        body.entryRevision !== row.entry.revision
      )
        return reply
          .code(409)
          .send({ error: "ENTRY_CONFLICT", revision: row.entry.revision });
      const parsedData = entryDataSchema.safeParse(
        normalizeLegacyEntryData(row.entry.data),
      );
      if (!parsedData.success)
        return reply.code(400).send({ error: "INVALID_ENTRY_DATA" });
      const rollsThread = await ensureStreamThread(
        db,
        auth.campaignId,
        "ROLLS",
      );
      let action:
        NonNullable<typeof parsedData.data.rollActions>[number] | undefined;
      let formula: string | null = null;
      let result: ReturnType<typeof rollFormula> | null = null;
      if (mode === "EXECUTE") {
        action = parsedData.data.rollActions?.find(
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
              return reply
                .code(400)
                .send({ error: "INVALID_MODIFIER_FORMULA" });
            formulaParts.push(
              String(terms.reduce((sum, term) => sum + Number(term), 0)),
            );
            continue;
          }
          const key = `modifier_${index}`;
          const value =
            source.type === "CHARACTERISTIC"
              ? normalizeLegacyStats(row.character.stats)[source.key]
              : parsedData.data.values?.[source.key];
          if (value === undefined || !Number.isFinite(value))
            return reply
              .code(400)
              .send({ error: "MISSING_MODIFIER_SOURCE", source });
          values[key] = value;
          formulaParts.push(key);
        }
        formula = formulaParts.join(" + ");
        result = rollFormula(formula, values, randomInt, action.label);
        if (
          action.consumeUse &&
          (!parsedData.data.uses || parsedData.data.uses.current < 1)
        )
          return reply.code(409).send({ error: "NO_ABILITY_USES" });
      }
      const uses = parsedData.data.uses;
      const afterUses =
        mode === "EXECUTE" && action?.consumeUse && uses
          ? { ...uses, current: uses.current - 1 }
          : uses;
      const skillCard = {
        version: 1 as const,
        execution:
          mode === "EXECUTE" ? ("EXECUTED" as const) : ("SHARED" as const),
        entry: {
          id: row.entry.id,
          revision: row.entry.revision,
          sourceCatalogEntryId: row.entry.sourceCatalogEntryId,
          kind: row.entry.kind,
          name: row.entry.name,
          description: row.entry.description,
          notes: parsedData.data.notes ?? null,
        },
        actor: {
          membershipId: auth.membershipId,
          displayName: auth.displayName,
          characterId: row.character.id,
          characterName: row.character.name,
        },
        action: action
          ? {
              id: action.id,
              kind: action.kind,
              label: action.label,
              dice: action.dice,
              advantage: action.advantage,
              consumeUse: action.consumeUse,
            }
          : null,
        formula,
        result,
        uses: uses
          ? {
              before: uses.current,
              after: afterUses!.current,
              max: uses.max,
              recharge: uses.recharge,
            }
          : null,
        visibility: body.visibility,
      };
      let saved: {
        message: typeof chatMessages.$inferSelect;
        event: typeof gameEvents.$inferSelect;
      } | null;
      try {
        saved = await db.transaction(async (tx) => {
          if (mode === "EXECUTE" && action?.consumeUse) {
            const [updated] = await tx
              .update(characterCatalogEntries)
              .set({
                data: { ...parsedData.data, uses: afterUses! },
                revision: row.entry.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(characterCatalogEntries.id, row.entry.id),
                  eq(characterCatalogEntries.revision, row.entry.revision),
                ),
              )
              .returning({ id: characterCatalogEntries.id });
            if (!updated) return null;
          }
          const [message] = await tx
            .insert(chatMessages)
            .values({
              campaignId: auth.campaignId,
              membershipId: auth.membershipId,
              characterId: row.character.id,
              kind: "DICE",
              threadId: rollsThread.id,
              visibility: body.visibility,
              body: [
                action?.label ?? row.entry.name,
                row.entry.description,
                parsedData.data.notes,
              ]
                .filter(Boolean)
                .join(" - "),
              dice: result ? { ...result, skillCard } : { skillCard },
            })
            .returning();
          if (!message) throw new Error("ROLL_SAVE_FAILED");
          const [event] = await tx
            .insert(gameEvents)
            .values({
              campaignId: auth.campaignId,
              actionId: body.actionId,
              membershipId: auth.membershipId,
              type: mode === "EXECUTE" ? "entry.roll" : "entry.shared",
              entityType: "chat",
              entityId: message.id,
              entityRevision:
                mode === "EXECUTE" && action?.consumeUse
                  ? row.entry.revision + 1
                  : row.entry.revision,
              payload: { skillCard, messageId: message.id },
            })
            .returning();
          if (!event) throw new Error("EVENT_RECORD_FAILED");
          return { message, event };
        });
      } catch (error) {
        // A concurrent retry may lose only at the unique action receipt. The
        // transaction rolls back its message/resource changes, then replay it.
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505" &&
          (await findAction(db, auth.campaignId, body.actionId))
        )
          return reply.code(200).send({ duplicate: true });
        throw error;
      }
      if (!saved) {
        // A concurrent request with this same action can commit between our
        // preflight receipt lookup and the entry CAS. Its receipt is the
        // authoritative idempotent result; only a different stale action is
        // an optimistic-concurrency conflict.
        if (await findAction(db, auth.campaignId, body.actionId))
          return reply.code(200).send({ duplicate: true });
        return reply.code(409).send({ error: "ENTRY_CONFLICT" });
      }
      const dto = chatMessageDto(
        saved.message,
        auth.displayName,
        rollsThread.stream,
      );
      const envelope = {
        sequence: Number(saved.event.sequence),
        actionId: body.actionId,
        emittedAt: saved.event.createdAt.toISOString(),
        data: dto,
      };
      if (chatBroadcastAudience(saved.message.visibility) === "CAMPAIGN")
        io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      else {
        io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
        io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
      }
      await broadcastSnapshots(io, db, auth.campaignId);
      return reply
        .code(201)
        .send({ ...(result ?? {}), skillCard, messageId: saved.message.id });
    },
  );

  app.post("/api/dice", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = diceRequestSchema.parse(request.body);
    const rollsThread = await ensureStreamThread(db, auth.campaignId, "ROLLS");
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
      const normalizedFormula = applyRollMode(
        normalizeLegacyFormula(body.formula),
        body.rollMode ?? "NORMAL",
      );
      const modeLabel =
        body.rollMode === "ADVANTAGE"
          ? "преимущество"
          : body.rollMode === "DISADVANTAGE"
            ? "помеха"
            : null;
      const rollLabel = `${body.label ?? body.formula}${modeLabel ? ` · ${modeLabel}` : ""}`;
      const result = rollFormula(
        normalizedFormula,
        normalizeLegacyStats(character?.stats),
        randomInt,
        rollLabel,
      );
      const saved = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: character?.id ?? null,
            kind: "DICE",
            threadId: rollsThread.id,
            visibility: body.visibility,
            body: rollLabel,
            dice: result,
          })
          .returning();
        if (!row) throw new Error("ROLL_SAVE_FAILED");
        const dto = chatMessageDto(row, auth.displayName, rollsThread.stream);
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
      if (chatBroadcastAudience(row.visibility) === "CAMPAIGN")
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
      const errorCode = publicUploadError(error);
      request.log.warn({ errorCode, actionId }, "asset.upload_rejected");
      return reply.code(400).send({ error: errorCode });
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
