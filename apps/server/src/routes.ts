import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Server } from "socket.io";
import { and, asc, desc, eq, gt, inArray, isNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { canonicalizeFogGeometry, FogGeometryError } from "./fog-geometry.js";
import { registerPublicRoadmapVoteRoutes } from "./roadmap-votes.js";
import { registerAccountCampaignRoutes } from "./account-campaigns.js";
import {
  activateSceneSchema,
  createFogRevealSchema,
  canvasBulkCommandSchema,
  historyCommandSchema,
  sceneCanvasConfigSchema,
  createSceneSchema,
  gmLoginSchema,
  inviteClaimSchema,
  rotateGmAccessSchema,
  renameCommandSchema,
  updateSceneMetadataSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type CharacterDto,
  type ChatMessageDto,
} from "@arken/contracts";
import {
  assets,
  actionJournal,
  characterControllers,
  campaigns,
  characters,
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
} from "@arken/db";
import { createSession, requireAuth } from "./auth.js";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";
import {
  createAccountMailContext,
  type AccountMailContext,
} from "./account-mail-context.js";
import { env } from "./env.js";
import { hashToken, safeEqual } from "./security.js";
import {
  buildSnapshot,
  loadCampaignReadSet,
  withoutPersonalTheme,
} from "./snapshot.js";
import {
  largestFields,
  measureSnapshot,
  queryCountSince,
  readQueryCount,
  SNAPSHOT_METRICS_ENABLED,
  sumByField,
  type BroadcastMeasurement,
} from "./snapshot-metrics.js";
import { registerWorldMapRoutes } from "./world-map-routes.js";
import { registerStoryRoutes } from "./story.js";
import { registerStoryAttachmentLifecycleRoutes } from "./story-attachment-lifecycle.js";
import { registerStickerPackAdminRoutes } from "./sticker-pack-admin.js";
import { registerGlobalStickerRoutes } from "./global-sticker-catalog.js";
import { registerAssetLifecycleRoutes } from "./asset-usage.js";
import { registerSoundpadRoutes } from "./soundpad-routes.js";
import { registerAudioClipRoutes } from "./audio-clip-routes.js";
import { registerOperatorFeedbackRoutes } from "./operator-feedback.js";
import { registerPlayerRequestRoutes } from "./player-requests.js";
import { registerCharacterMediaRoutes } from "./character-media.js";
import { registerGalleryChatShareRoutes } from "./gallery-chat-share.js";
import { registerChatAttachmentContentRoute } from "./chat-attachment-content.js";
import { registerTerrainStampRoutes } from "./terrain-stamp-routes.js";
import { registerCharacterArchiveRoutes } from "./character-archive-routes.js";
import { createBroadcastCoalescer } from "./broadcast-coalescer.js";
import { findAction } from "./action-lookup.js";
import { isStampDrawing, LAYERED_DRAWING_KINDS } from "./drawing-kinds.js";
import { registerDrawingRoutes } from "./drawing-routes.js";
import { registerStickerRoutes } from "./sticker-routes.js";
import { registerChatRoutes } from "./chat-routes.js";
import { registerTokenRoutes } from "./token-routes.js";
import { registerCharacterRoutes } from "./character-routes.js";
import { registerCampaignRoutes } from "./campaign-routes.js";
import { registerCharacterPlayRoutes } from "./character-play-routes.js";
import { registerAssetRoutes } from "./asset-routes.js";
import { registerAccessRoutes } from "./access-routes.js";
import { errorMessage } from "./error-message.js";
import { campaignRoom, gmRoom, memberRoom, sessionRoom } from "./rooms.js";
import { emitCharacterUpdated } from "./character-events.js";
import {
  canvasSceneVisibleTo,
  emitDrawingChange,
  type DrawingChange,
} from "./drawing-events.js";
import { registerEncounterRoutes } from "./encounters.js";
import { defaultThemeForMembership } from "./player-themes.js";
import { registerPlayerThemeRoutes } from "./player-theme-routes.js";
import { campaignCanvasDatabase } from "./campaign-pause-guard.js";
import { registerCampaignPauseRoutes } from "./campaign-pause.js";
import { clearCampaignCanvasEphemera, projectedToken } from "./realtime.js";
import { emitTokenUpdated } from "./token-events.js";
import { normalizeTokenConditions } from "./token-conditions.js";
import { registerWorldContentRoutes } from "./world-content-routes.js";
import { registerWorldContentInstanceRoutes } from "./world-content-instances.js";
import { registerSpellPackRoutes } from "./spell-pack-routes.js";
import { registerSpellAssignmentRoutes } from "./spell-assignment-routes.js";
import { registerSpellProjectionRoutes } from "./spell-projection-routes.js";
import { chatBroadcastAudience } from "./chat.js";
import { invalidateRedoBranch } from "./canvas-history.js";
import {
  clientEventSchema,
  publicUploadError,
  safeClientMessage,
  sanitizeClientContext,
} from "./telemetry.js";
import {
  assertStorageCapacity,
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

function historyContainsStamp(command: typeof actionJournal.$inferSelect) {
  const snapshots = [command.before, command.after];
  if (command.targetType === "DRAWING")
    return snapshots.some(
      (snapshot) =>
        typeof snapshot === "object" &&
        snapshot !== null &&
        "kind" in snapshot &&
        LAYERED_DRAWING_KINDS.includes(snapshot.kind),
    );
  if (command.targetType !== "CANVAS_BULK") return false;
  return snapshots.some((snapshot) => {
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      !("drawings" in snapshot)
    )
      return false;
    const rows = snapshot.drawings;
    return (
      Array.isArray(rows) &&
      rows.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "kind" in row &&
          LAYERED_DRAWING_KINDS.includes(row.kind),
      )
    );
  });
}

/** Рассматриваемая сцена сокета, если она есть, — в виде списка для снапшота. */
function viewedScenes(data: { viewedSceneId?: string | null }): string[] {
  return data.viewedSceneId ? [data.viewedSceneId] : [];
}

const snapshotCoalescers = new WeakMap<
  RealtimeServer,
  ReturnType<typeof createBroadcastCoalescer>
>();

/**
 * Sends every campaign socket its snapshot. Bursts of writes share one
 * rebuild (see broadcast-coalescer.ts); each caller still resolves only after
 * a snapshot that includes its own committed change.
 */
function broadcastSnapshots(
  io: RealtimeServer,
  db: Database,
  campaignId: string,
) {
  let coalesce = snapshotCoalescers.get(io);
  if (!coalesce) {
    coalesce = createBroadcastCoalescer();
    snapshotCoalescers.set(io, coalesce);
  }
  return coalesce(campaignId, () => emitCampaignSnapshots(io, db, campaignId));
}

/**
 * UIX-412: a token change that keeps its visibility (conditions, colours)
 * reaches the sockets that see the token as `token:updated`, instead of a
 * full snapshot rebuild. Ordered after any running snapshot broadcast.
 */
async function publishTokenChange(
  io: RealtimeServer,
  db: Database,
  campaignId: string,
  tokenId: string,
  envelope: { sequence: number; actionId: string; emittedAt: string },
) {
  await snapshotCoalescers.get(io)?.settled(campaignId);
  const projection = await projectedToken(db, campaignId, tokenId);
  if (!projection) return;
  const { token, activeSceneId } = projection;
  const reveals = await db
    .select()
    .from(fogReveals)
    .where(eq(fogReveals.sceneId, token.sceneId))
    .orderBy(asc(fogReveals.sequence));
  const sockets = (await io.in(campaignRoom(campaignId)).fetchSockets()).filter(
    (socket) => socket.data.auth?.campaignId === campaignId,
  );
  const { updatedAt: _updatedAt, ...dto } = token;
  emitTokenUpdated(
    sockets,
    { activeSceneId },
    token,
    token.controllerMembershipIds,
    reveals,
    (controllerMembershipIds) => ({
      ...dto,
      conditions: normalizeTokenConditions(dto.conditions),
      controllerMembershipIds,
    }),
    envelope,
  );
}

/**
 * UIX-412: a character change (with its public table line, if any) reaches
 * the GM, owner and controllers as `character:updated` and the campaign as
 * `chat:created`, instead of a full snapshot rebuild. Ordered after any
 * running snapshot broadcast for the same reason as drawings below.
 */
async function publishCharacterChange(
  io: RealtimeServer,
  campaignId: string,
  change: {
    character: { ownerMembershipId: string | null };
    controllerIds: string[];
    project: (visibleControllerIds: string[]) => CharacterDto;
    message: ChatMessageDto | null;
    envelope: { sequence: number; actionId: string; emittedAt: string };
  },
) {
  await snapshotCoalescers.get(io)?.settled(campaignId);
  const sockets = (await io.in(campaignRoom(campaignId)).fetchSockets()).filter(
    (socket) => socket.data.auth?.campaignId === campaignId,
  );
  emitCharacterUpdated(
    sockets,
    change.character,
    change.controllerIds,
    change.project,
    change.envelope,
  );
  if (change.message) {
    const envelope = { ...change.envelope, data: change.message };
    if (chatBroadcastAudience(change.message.visibility) === "CAMPAIGN")
      io.to(campaignRoom(campaignId)).emit("chat:created", envelope);
    else io.to(gmRoom(campaignId)).emit("chat:created", envelope);
  }
}

/**
 * UIX-412: a drawing change reaches each socket as one point event instead of
 * a full snapshot rebuild. It is sent only after the snapshot broadcast that
 * may be running settles: that snapshot can predate the commit, and arriving
 * after the event it would erase the drawing again. Snapshots started later
 * already read the committed row.
 */
async function publishDrawingChange(
  io: RealtimeServer,
  db: Database,
  campaignId: string,
  change: DrawingChange,
) {
  const coalesce = snapshotCoalescers.get(io);
  await coalesce?.settled(campaignId);
  const [campaign] = await db
    .select({ activeSceneId: campaigns.activeSceneId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return;
  const sockets = (await io.in(campaignRoom(campaignId)).fetchSockets()).filter(
    (socket) => socket.data.auth?.campaignId === campaignId,
  );
  const fallback = emitDrawingChange(sockets, campaign, change);
  if (fallback === "snapshot") await broadcastSnapshots(io, db, campaignId);
}

async function emitCampaignSnapshots(
  io: RealtimeServer,
  db: Database,
  campaignId: string,
) {
  const sockets = await io.in(campaignRoom(campaignId)).fetchSockets();
  const targetSockets = sockets.filter(
    (socket) => socket.data.auth?.campaignId === campaignId,
  );
  // Пустая комната не должна платить за общий read set только ради отчёта.
  if (targetSockets.length === 0) return;

  // Счётчик и таймер стартуют до общего чтения: иначе отчёт скрывал как раз
  // ту часть работы, ради которой UIX-409 и вводила CampaignReadSet.
  let startedAt = 0;
  let queryCountAtStart = 0;
  if (SNAPSHOT_METRICS_ENABLED) {
    // Глобальный счётчик намеренно не сбрасывается: параллельная рассылка не
    // должна обнулять чужое окно. Delta остаётся process-window estimate;
    // точное acceptance-число даёт только изолированный measurement process.
    queryCountAtStart = readQueryCount();
    startedAt = performance.now();
  }
  /**
   * UIX-409 — кампанийные чтения делаются один раз на всю рассылку.
   *
   * Семь снапшотов читали одно и то же семь раз: 239 запросов при пуле в
   * десять соединений — это очередь, а не работа. Набор живёт только внутри
   * этого вызова: кеша со временем жизни нет и не будет.
   *
   * Побочно это чинит согласованность: раньше семь снапшотов одной рассылки
   * строились в семь разных моментов и могли расходиться между собой.
   */
  const readSet = await loadCampaignReadSet(db, campaignId);
  if (!SNAPSHOT_METRICS_ENABLED) {
    await Promise.all(
      targetSockets.map(async (socket) => {
        const auth = socket.data.auth;
        if (auth?.campaignId === campaignId) {
          // UIX-408: мастеру приходит канвас и той сцены, которую он
          // рассматривает, — иначе он рисовал бы туман поверх якобы пустой.
          socket.emit(
            "game:snapshot",
            await buildSnapshot(db, auth, viewedScenes(socket.data), readSet),
          );
        }
      }),
    );
    return;
  }

  /**
   * UIX-408/409, этап 0. Меряется **вся рассылка**, а не одна сборка: пул к
   * PostgreSQL — десять соединений, а семь сборок по полтора десятка
   * параллельных запросов дают около сотни, конкурирующих за эти десять.
   * Нелинейно растёт очередь, и видно её только здесь.
   */
  const perSocket: BroadcastMeasurement["perSocket"] = [];
  const fieldReports: Record<string, number>[] = [];
  await Promise.all(
    targetSockets.map(async (socket) => {
      const auth = socket.data.auth;
      if (auth?.campaignId !== campaignId) return;
      const socketStartedAt = performance.now();
      const snapshot = await buildSnapshot(
        db,
        auth,
        viewedScenes(socket.data),
        readSet,
      );
      const ms = performance.now() - socketStartedAt;
      const { bytes, byField } = measureSnapshot(snapshot);
      perSocket.push({ role: auth.role, bytes, ms });
      fieldReports.push(byField);
      socket.emit("game:snapshot", snapshot);
    }),
  );
  const measurement: BroadcastMeasurement = {
    campaignId,
    sockets: perSocket.length,
    queries: queryCountSince(queryCountAtStart),
    queryCountScope: "PROCESS_WINDOW_ESTIMATE",
    totalBytes: perSocket.reduce((sum, item) => sum + item.bytes, 0),
    totalMs: performance.now() - startedAt,
    perSocket,
    bytesByField: sumByField(fieldReports),
  };
  // Числа, а не игровые данные: количество запросов, байты и миллисекунды.
  console.info(
    "[snapshot-metrics]",
    JSON.stringify({
      ...measurement,
      largest: largestFields(measurement.bytesByField),
    }),
  );
}

/**
 * A historical exact retry may arrive after a newer pause/resume command.
 * Recheck the authoritative revision under the same exclusive campaign lock
 * used by Canvas mutations before emitting a snapshot for that receipt.
 */
export async function broadcastCampaignPauseSnapshot(
  io: RealtimeServer,
  db: Database,
  campaignId: string,
  expected: { paused: boolean; revision: number },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ paused: campaigns.paused, revision: campaigns.revision })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)
      .for("update");
    if (
      !current ||
      current.paused !== expected.paused ||
      current.revision !== expected.revision
    )
      return false;
    await broadcastSnapshots(io, db, campaignId);
    return true;
  });
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
    const [lockedInvite] = await tx
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          eq(invites.id, invite.id),
          eq(invites.campaignId, invite.campaignId),
        ),
      )
      .for("update")
      .limit(1);
    if (!lockedInvite) throw new Error("INVITE_UNAVAILABLE");
    const [claimed] = await tx
      .update(invites)
      .set({ claimedAt: new Date() })
      .where(
        and(
          eq(invites.id, invite.id),
          eq(invites.campaignId, invite.campaignId),
          isNull(invites.claimedAt),
          isNull(invites.revokedAt),
          sql`${invites.expiresAt} > clock_timestamp()`,
        ),
      )
      .returning({ id: invites.id });
    if (!claimed) throw new Error("INVITE_UNAVAILABLE");
    const membershipId = randomUUID();
    const [member] = await tx
      .insert(memberships)
      .values({
        id: membershipId,
        campaignId: invite.campaignId,
        role: "PLAYER",
        displayName,
        defaultThemeId: defaultThemeForMembership(membershipId),
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
    await tx
      .insert(characterControllers)
      .values({ characterId: invite.characterId, membershipId: member.id })
      .onConflictDoNothing();
    await tx.execute(sql`insert into token_controllers (token_definition_id, membership_id)
      select d.id, ${member.id} from token_definitions d
      where d.character_id = ${invite.characterId} and d.campaign_id = ${invite.campaignId}
      and not exists (select 1 from token_controllers c where c.token_definition_id = d.id)
      on conflict do nothing`);
    await tx
      .update(invites)
      .set({ claimedByMembershipId: member.id })
      .where(eq(invites.id, invite.id));
    return member;
  });
}

type SceneTokenGeometrySnapshot = {
  tokens: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    revision: number;
  }>;
};

const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 1024;
const roundedCanvasValue = (value: number) =>
  Math.round(value * 1_000_000) / 1_000_000;
class SceneGridTokenBoundsError extends Error {
  constructor(
    readonly tokenId: string,
    readonly width: number,
    readonly height: number,
  ) {
    super("SCENE_GRID_TOKEN_BOUNDS");
  }
}
const scaledTokenLength = (value: number, scale: number) =>
  roundedCanvasValue(value * scale);
const scaledGridCoordinate = (
  value: number,
  previousOffset: number,
  nextOffset: number,
  scale: number,
) => roundedCanvasValue(nextOffset + (value - previousOffset) * scale);

export function registerRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
  mailContext: AccountMailContext = createAccountMailContext(env),
) {
  registerAccountAuthRoutes(app, db, io, {
    enabled: env.ACCOUNT_AUTH_ENABLED,
    registrationEnabled: env.ACCOUNT_REGISTRATION_ENABLED,
    legacyDevEnabled:
      env.NODE_ENV === "development" && env.LEGACY_DEV_AUTH_ENABLED,
    campaignLinkAccessEnabled: env.CAMPAIGN_LINK_ACCESS_ENABLED,
    campaignCreationEnabled: env.ACCOUNT_CAMPAIGN_CREATION_ENABLED,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    cookieSecure: env.NODE_ENV === "production",
    accountCookieName: env.ACCOUNT_SESSION_COOKIE_NAME,
    gameCookieName: env.SESSION_COOKIE_NAME,
    csrfCookieName: env.ACCOUNT_CSRF_COOKIE_NAME,
    webOrigin: env.WEB_ORIGIN,
    publicUrl: env.PUBLIC_URL,
    mailRuntimeEnabled: mailContext.runtimeEnabled,
    mail: mailContext.adapter,
    mailKeyring: mailContext.keyring,
  });
  registerAccountCampaignRoutes(app, db, io, {
    enabled: env.ACCOUNT_AUTH_ENABLED,
    creationEnabled: env.ACCOUNT_CAMPAIGN_CREATION_ENABLED,
    creationLimit: env.ACCOUNT_CAMPAIGN_CREATION_LIMIT,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    cookieSecure: env.NODE_ENV === "production",
    accountCookieName: env.ACCOUNT_SESSION_COOKIE_NAME,
    gameCookieName: env.SESSION_COOKIE_NAME,
    csrfCookieName: env.ACCOUNT_CSRF_COOKIE_NAME,
    webOrigin: env.WEB_ORIGIN,
  });
  const requireCampaignLinkOrigin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (!env.CAMPAIGN_LINK_ACCESS_ENABLED) {
      await reply.code(410).send({ error: "CAMPAIGN_LINK_ACCESS_DISABLED" });
      return false;
    }
    if (request.headers.origin !== env.WEB_ORIGIN) {
      await reply.code(403).send({ error: "ORIGIN_FORBIDDEN" });
      return false;
    }
    return true;
  };
  const rotateCurrentGameCookieSession = async (request: FastifyRequest) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (!token) return;
    const [old] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .limit(1);
    if (!old) return;
    await db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.id, old.id));
    io.in(sessionRoom(old.id)).disconnectSockets(true);
  };
  registerPublicRoadmapVoteRoutes(app, db);
  const canvasTx = (campaignId: string) =>
    campaignCanvasDatabase(db, campaignId);
  registerWorldMapRoutes(app, db, (campaignId) =>
    broadcastSnapshots(io, db, campaignId),
  );
  registerTerrainStampRoutes(app, db);
  registerStoryRoutes(app, db, io);
  registerStoryAttachmentLifecycleRoutes(app, db);
  registerStickerPackAdminRoutes(app, db, (request, reply) =>
    requireAuth(request, reply, db),
  );
  registerGlobalStickerRoutes(app, db);
  registerOperatorFeedbackRoutes(app, db);
  registerPlayerRequestRoutes(app, db, io);
  registerCharacterMediaRoutes(app, db);
  registerGalleryChatShareRoutes(app, db, io);
  registerChatAttachmentContentRoute(app, db);
  registerCharacterArchiveRoutes(app, db, (campaignId) =>
    broadcastSnapshots(io, db, campaignId),
  );
  registerPlayerThemeRoutes(app, db);
  registerEncounterRoutes(app, db, (campaignId) =>
    broadcastSnapshots(io, db, campaignId),
  );
  registerCampaignPauseRoutes(
    app,
    db,
    async (campaignId, state) => {
      await broadcastCampaignPauseSnapshot(io, db, campaignId, state);
    },
    async (campaignId, state) => {
      if (state.paused) await clearCampaignCanvasEphemera(io, campaignId);
    },
  );
  registerWorldContentRoutes(app, db);
  registerWorldContentInstanceRoutes(app, db);
  registerSpellPackRoutes(app, db);
  registerSpellAssignmentRoutes(app, db);
  registerSpellProjectionRoutes(app, db);
  registerAssetLifecycleRoutes(app, db, io, broadcastSnapshots);
  registerSoundpadRoutes(app, db, io);
  registerAudioClipRoutes(app, db, io);

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
    if (!(await requireCampaignLinkOrigin(request, reply))) return;
    const body = gmLoginSchema.parse(request.body);
    const credentials = await db
      .select({
        membershipId: memberships.id,
        campaignId: gmAccessCredentials.campaignId,
        credentialRevision: gmAccessCredentials.revision,
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
    await rotateCurrentGameCookieSession(request);
    await createSession(db, reply, gm.membershipId, {
      source: "GM_LINK",
      campaignId: gm.campaignId,
      credentialRevision: gm.credentialRevision,
    });
    return { ok: true };
  });

  app.post("/api/auth/invite", async (request, reply) => {
    if (!(await requireCampaignLinkOrigin(request, reply))) return;
    const body = inviteClaimSchema.parse(request.body);
    const tokenHash = hashToken(body.token);
    const [grant] = await db
      .select({
        membershipId: playerAccessGrants.membershipId,
        id: playerAccessGrants.id,
        campaignId: playerAccessGrants.campaignId,
        revision: playerAccessGrants.revision,
      })
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
      await rotateCurrentGameCookieSession(request);
      await createSession(db, reply, grant.membershipId, {
        source: "PLAYER_GRANT",
        grantId: grant.id,
        grantRevision: grant.revision,
      });
      return { ok: true };
    }

    const [invite] = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          isNull(invites.claimedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invite) return reply.code(410).send({ error: "INVITE_EXPIRED" });

    let result: Awaited<ReturnType<typeof claimInviteOwnership>>;
    try {
      result = await claimInviteOwnership(
        db,
        invite,
        body.displayName ?? invite.label,
      );
    } catch (error) {
      if (errorMessage(error).includes("INVITE_UNAVAILABLE"))
        return reply.code(410).send({ error: "INVITE_EXPIRED" });
      throw error;
    }
    await rotateCurrentGameCookieSession(request);
    await createSession(db, reply, result.id, {
      source: "LEGACY_INVITE",
      inviteId: invite.id,
    });
    return { ok: true };
  });

  // Temporary closed-beta shortcut. This intentionally authenticates by a
  // public alias and must be removed when UIX-232's recorded debt is paid.
  app.post("/api/auth/player/:handle", async (request, reply) => {
    return reply.code(410).send({ error: "PUBLIC_ALIAS_LOGIN_DISABLED" });
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
    return withoutPersonalTheme(
      await buildSnapshot(db, {
        membershipId: target.id,
        campaignId: target.campaignId,
        role: target.role,
        displayName: target.displayName,
      }),
    );
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
          // Structural-only: class name + bounded stack frames describe
          // code, never user content (see telemetry.ts). occurrenceCount
          // reflects client-side dedup of repeated identical errors.
          // Absent on performance windows, which carry measurements rather
          // than a failure — hence the presence checks rather than a direct
          // read off the union.
          errorName: "errorName" in body ? body.errorName : undefined,
          stack: "stack" in body ? body.stack : undefined,
          occurrenceCount:
            "occurrenceCount" in body ? body.occurrenceCount : undefined,
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

  registerCharacterRoutes(app, db, {
    broadcast: (campaignId) => broadcastSnapshots(io, db, campaignId),
    publishCharacter: (campaignId, change) =>
      publishCharacterChange(io, campaignId, change),
  });

  registerAccessRoutes(app, db, io);

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
    const scene = await canvasTx(auth.campaignId).transaction(async (tx) => {
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
    await canvasTx(auth.campaignId).transaction(async (tx) => {
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

  registerTokenRoutes(app, db, {
    canvasTx,
    broadcast: (campaignId) => broadcastSnapshots(io, db, campaignId),
    publishToken: (campaignId, tokenId, envelope) =>
      publishTokenChange(io, db, campaignId, tokenId, envelope),
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
    const legacy = !body.geometry;
    const requestedGeometry = body.geometry ?? {
      type: "RECT" as const,
      x: body.x!,
      y: body.y!,
      width: body.width!,
      height: body.height!,
    };
    let canonical;
    try {
      canonical = canonicalizeFogGeometry(requestedGeometry, scene, legacy);
    } catch (error) {
      if (error instanceof FogGeometryError)
        return reply.code(422).send({ error: error.code });
      throw error;
    }
    const { actionId } = body;
    const revealInput = {
      sceneId: scene.id,
      operation: body.operation,
      shape: canonical.geometry.type,
      geometry: canonical.geometry,
      bbox: canonical.bbox,
      x: canonical.bbox.x,
      y: canonical.bbox.y,
      width: canonical.bbox.width,
      height: canonical.bbox.height,
    };
    const result = await canvasTx(auth.campaignId).transaction(async (tx) => {
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
      /**
       * UIX-408: событие уходит только тем, у кого эта сцена в снапшоте.
       *
       * Раньше оно летело всей кампании, а лишнее отсеивалось на клиенте при
       * отрисовке. После сужения выборки это перестало быть безобидным:
       * клиент пришивает пришедший туман к `snapshot.fogReveals` без проверки
       * сцены, и накопленное пережило бы любое число рассылок — инвариант «в
       * снапшоте туман только видимых сцен» ломался бы прямо на проводе.
       */
      const envelope = {
        sequence: Number(event.sequence),
        actionId,
        emittedAt: event.createdAt.toISOString(),
        data: reveal,
      };
      const [current] = await db
        .select({ activeSceneId: campaigns.activeSceneId })
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      for (const socket of await io
        .in(campaignRoom(auth.campaignId))
        .fetchSockets())
        if (
          current &&
          canvasSceneVisibleTo(socket.data, current, reveal.sceneId)
        )
          socket.emit("fog:created", envelope);
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

  registerDrawingRoutes(app, db, {
    canvasTx,
    publish: (campaignId, change) =>
      publishDrawingChange(io, db, campaignId, change),
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
        drawingRows.some(
          (row) =>
            isStampDrawing(row) || row.authorMembershipId !== auth.membershipId,
        )
      )
        return reply.code(403).send({ error: "CANVAS_TARGET_FORBIDDEN" });
    }
    const guardedDb = canvasTx(auth.campaignId);
    const result = await guardedDb
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
          scope:
            tokenRows.some((row) => row.layer === "GM") ||
            drawingRows.some(isStampDrawing)
              ? "GM"
              : "PUBLIC",
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
    const historyColumns = {
      sequence: actionJournal.sequence,
      actorMembershipId: actionJournal.actorMembershipId,
      type: actionJournal.type,
      targetType: actionJournal.targetType,
      targetId: actionJournal.targetId,
      status: actionJournal.status,
      createdAt: actionJournal.createdAt,
    };
    const visibleHistory = and(
      eq(actionJournal.campaignId, auth.campaignId),
      eq(actionJournal.sceneId, scene.id),
      auth.role === "GM"
        ? undefined
        : and(
            eq(actionJournal.actorMembershipId, auth.membershipId),
            eq(actionJournal.scope, "PUBLIC"),
          ),
    );
    const rows = await db
      .select(historyColumns)
      .from(actionJournal)
      .where(visibleHistory)
      // UIX-503: это не лента создания записей, а проекция текущего стека
      // Undo/Redo. Команды ниже выбирают кандидата по transitionSequence;
      // если здесь сортировать по исходному sequence, после двух Undo клиент
      // назовёт одно действие, а сервер повторит другое.
      .orderBy(desc(actionJournal.transitionSequence))
      .limit(100);
    const candidates = await db
      .selectDistinctOn([actionJournal.status], historyColumns)
      .from(actionJournal)
      .where(
        and(
          visibleHistory,
          inArray(actionJournal.status, ["APPLIED", "UNDONE"]),
        ),
      )
      .orderBy(actionJournal.status, desc(actionJournal.transitionSequence));
    const nextDirections = new Map(
      candidates.map((candidate) => [
        candidate.sequence,
        candidate.status === "APPLIED" ? ("undo" as const) : ("redo" as const),
      ]),
    );
    const recentSequences = new Set(rows.map((row) => row.sequence));
    // После ста переходов кандидат противоположного статуса может оказаться за
    // пределами обычной страницы. Добавляем его отдельно и маркируем, чтобы UI
    // по-прежнему обещал ровно ту команду, которую выберет POST ниже.
    return [
      ...rows.map((row) => ({
        ...row,
        nextDirection: nextDirections.get(row.sequence) ?? null,
      })),
      ...candidates
        .filter((candidate) => !recentSequences.has(candidate.sequence))
        .map((candidate) => ({
          ...candidate,
          nextDirection: nextDirections.get(candidate.sequence) ?? null,
        })),
    ];
  });

  for (const direction of ["undo", "redo"] as const) {
    app.post(`/api/canvas/${direction}`, async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const body = historyCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const desiredStatus = direction === "undo" ? "APPLIED" : "UNDONE";
      const [candidateCommand] = await db
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
      if (!candidateCommand)
        return reply.code(404).send({ error: "HISTORY_ACTION_NOT_FOUND" });
      // Players may replay legacy/public freehand history, but GM-owned stamp
      // instances are never player-editable—even while their layer is public.
      if (auth.role !== "GM" && historyContainsStamp(candidateCommand))
        return reply.code(403).send({ error: "STAMP_FORBIDDEN" });
      const guardedDb = canvasTx(auth.campaignId);
      const saved = await guardedDb
        .transaction(async (tx) => {
          // Every canvas mutation that can create or restore tokens takes the
          // scene lock first. Grid rescale uses the same lock, making token
          // placement and history replay linearizable with the rescale.
          await tx.execute(
            sql`select id from scenes where id = ${body.sceneId} and campaign_id = ${auth.campaignId} for update`,
          );
          await tx.execute(
            sql`select sequence from action_journal where sequence = ${candidateCommand.sequence} for update`,
          );
          const [command] = await tx
            .select()
            .from(actionJournal)
            .where(eq(actionJournal.sequence, candidateCommand.sequence))
            .limit(1);
          if (!command || command.status !== desiredStatus) return null;
          const snapshot =
            direction === "undo" ? command.before : command.after;
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
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
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
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
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
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
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
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
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
                  shape: fog.shape,
                  geometry: fog.geometry,
                  bbox: fog.bbox,
                  sequence: fog.sequence,
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
              tokenGeometry?: SceneTokenGeometrySnapshot;
            };
            const expectedValues = (
              direction === "undo" ? command.after : command.before
            ) as typeof values;
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
            if (
              !currentScene ||
              (command.currentRevision !== null &&
                currentScene.revision !== command.currentRevision)
            )
              return null;
            if (
              Boolean(values.tokenGeometry) !==
              Boolean(expectedValues.tokenGeometry)
            )
              return null;
            if (values.tokenGeometry && expectedValues.tokenGeometry) {
              const desired = values.tokenGeometry;
              const expected = expectedValues.tokenGeometry;
              const desiredTokenIds = desired.tokens
                .map((row) => row.id)
                .sort();
              const expectedTokenIds = expected.tokens
                .map((row) => row.id)
                .sort();
              if (desiredTokenIds.join() !== expectedTokenIds.join())
                return null;
              const currentTokens = desiredTokenIds.length
                ? await tx
                    .select({
                      id: tokens.id,
                      revision: tokens.revision,
                    })
                    .from(tokens)
                    .where(inArray(tokens.id, desiredTokenIds))
                : [];
              const expectedTokens = new Map(
                expected.tokens.map((row) => [row.id, row]),
              );
              if (
                currentTokens.length !== desiredTokenIds.length ||
                currentTokens.some(
                  (row) =>
                    row.revision !== expectedTokens.get(row.id)?.revision,
                )
              )
                return null;
              const nextTokens: SceneTokenGeometrySnapshot["tokens"] = [];
              for (const token of desired.tokens) {
                const expectedRevision = expectedTokens.get(token.id)!.revision;
                const [saved] = await tx
                  .update(tokens)
                  .set({
                    x: token.x,
                    y: token.y,
                    width: token.width,
                    height: token.height,
                    revision: expectedRevision + 1,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(tokens.id, token.id),
                      eq(tokens.revision, expectedRevision),
                    ),
                  )
                  .returning({
                    id: tokens.id,
                    x: tokens.x,
                    y: tokens.y,
                    width: tokens.width,
                    height: tokens.height,
                    revision: tokens.revision,
                  });
                if (!saved) throw new Error("SCENE_GRID_HISTORY_CONFLICT");
                nextTokens.push(saved);
              }
              values.tokenGeometry = { tokens: nextTokens };
              if (direction === "undo") command.before = values;
              else command.after = values;
            }
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
            if (!updated) throw new Error("SCENE_GRID_HISTORY_CONFLICT");
            targetRevision = updated.revision;
          } else return null;
          const nextStatus = direction === "undo" ? "UNDONE" : "APPLIED";
          const [journal] = await tx
            .update(actionJournal)
            .set({
              status: nextStatus,
              currentRevision: targetRevision,
              ...(["CANVAS_BULK", "SCENE"].includes(command.targetType)
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
          if (!journal) throw new Error("HISTORY_JOURNAL_CONFLICT");
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
          [
            "CANVAS_BULK_HISTORY_CONFLICT",
            "SCENE_GRID_HISTORY_CONFLICT",
            "HISTORY_JOURNAL_CONFLICT",
          ].includes(error.message)
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
    const guardedDb = canvasTx(auth.campaignId);
    const result = await guardedDb
      .transaction(async (tx) => {
        // Scene mutation, token placement, and token-restoring history all use
        // this same row lock. The token set below is therefore a complete,
        // linearizable snapshot for this rescale.
        await tx.execute(
          sql`select id from scenes where id = ${id} and campaign_id = ${auth.campaignId} for update`,
        );
        const [current] = await tx
          .select()
          .from(scenes)
          .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId)))
          .limit(1);
        if (!current) return { status: "not_found" as const };
        if (current.revision !== body.revision)
          return { status: "conflict" as const };

        const shouldRescaleTokenGeometry = Boolean(
          body.grid &&
          current.grid.enabled &&
          body.grid.enabled &&
          current.grid.size !== body.grid.size,
        );
        const currentTokenGeometry = shouldRescaleTokenGeometry
          ? await tx
              .select({
                id: tokens.id,
                x: tokens.x,
                y: tokens.y,
                width: tokens.width,
                height: tokens.height,
                revision: tokens.revision,
              })
              .from(tokens)
              .where(eq(tokens.sceneId, id))
          : [];
        const scale =
          shouldRescaleTokenGeometry && body.grid
            ? body.grid.size / current.grid.size
            : 1;
        const plannedTokenGeometry = currentTokenGeometry.map((token) => ({
          ...token,
          x: scaledGridCoordinate(
            token.x,
            current.grid.offsetX,
            body.grid!.offsetX,
            scale,
          ),
          y: scaledGridCoordinate(
            token.y,
            current.grid.offsetY,
            body.grid!.offsetY,
            scale,
          ),
          width: scaledTokenLength(token.width, scale),
          height: scaledTokenLength(token.height, scale),
        }));
        const outOfBounds = plannedTokenGeometry.find(
          (token) =>
            token.width < MIN_TOKEN_LENGTH ||
            token.width > MAX_TOKEN_LENGTH ||
            token.height < MIN_TOKEN_LENGTH ||
            token.height > MAX_TOKEN_LENGTH,
        );
        if (outOfBounds)
          throw new SceneGridTokenBoundsError(
            outOfBounds.id,
            outOfBounds.width,
            outOfBounds.height,
          );

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
          .where(
            and(
              eq(scenes.id, id),
              eq(scenes.campaignId, auth.campaignId),
              eq(scenes.revision, current.revision),
            ),
          )
          .returning();
        if (!next) throw new Error("SCENE_GRID_RESCALE_CONFLICT");

        let beforeTokenGeometry: SceneTokenGeometrySnapshot | undefined;
        let afterTokenGeometry: SceneTokenGeometrySnapshot | undefined;
        if (shouldRescaleTokenGeometry && body.grid) {
          beforeTokenGeometry = { tokens: currentTokenGeometry };
          const nextTokens: SceneTokenGeometrySnapshot["tokens"] = [];
          for (const token of plannedTokenGeometry) {
            const [saved] = await tx
              .update(tokens)
              .set({
                x: token.x,
                y: token.y,
                width: token.width,
                height: token.height,
                revision: token.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(tokens.id, token.id),
                  eq(tokens.revision, token.revision),
                ),
              )
              .returning({
                id: tokens.id,
                x: tokens.x,
                y: tokens.y,
                width: tokens.width,
                height: tokens.height,
                revision: tokens.revision,
              });
            if (!saved) throw new Error("SCENE_GRID_RESCALE_CONFLICT");
            nextTokens.push(saved);
          }
          afterTokenGeometry = { tokens: nextTokens };
          // Earlier token snapshots use the previous grid coordinate system.
          // Retire them so later history never replays stale pixel geometry;
          // drawing and fog actions remain independently undoable.
          if (nextTokens.length)
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
                  eq(actionJournal.sceneId, id),
                  eq(actionJournal.targetType, "TOKEN"),
                  inArray(
                    actionJournal.targetId,
                    nextTokens.map((token) => token.id),
                  ),
                  eq(actionJournal.status, "APPLIED"),
                ),
              );
        }
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
            ...(afterTokenGeometry
              ? { rescaledTokens: afterTokenGeometry.tokens.length }
              : {}),
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
            ...(beforeTokenGeometry
              ? { tokenGeometry: beforeTokenGeometry }
              : {}),
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
            ...(afterTokenGeometry
              ? { tokenGeometry: afterTokenGeometry }
              : {}),
          },
          beforeRevision: current.revision,
          afterRevision: next.revision,
          currentRevision: next.revision,
        });
        return { status: "ok" as const, scene: next };
      })
      .catch((error: unknown) => {
        if (error instanceof SceneGridTokenBoundsError)
          return {
            status: "bounds" as const,
            tokenId: error.tokenId,
            width: error.width,
            height: error.height,
          };
        if (
          error instanceof Error &&
          error.message === "SCENE_GRID_RESCALE_CONFLICT"
        )
          return { status: "conflict" as const };
        return Promise.reject(error);
      });
    if (result.status === "not_found")
      return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (result.status === "conflict")
      return reply.code(409).send({ error: "SCENE_CONFLICT" });
    if (result.status === "bounds")
      return reply.code(422).send({
        error: "SCENE_GRID_TOKEN_BOUNDS",
        policy: "REJECT",
        min: MIN_TOKEN_LENGTH,
        max: MAX_TOKEN_LENGTH,
        tokenId: result.tokenId,
        width: result.width,
        height: result.height,
      });
    await broadcastSnapshots(io, db, auth.campaignId);
    return result.scene;
  });

  registerStickerRoutes(app, db, {
    broadcast: (campaignId) => broadcastSnapshots(io, db, campaignId),
  });

  registerChatRoutes(app, db, io);

  registerCampaignRoutes(app, db, {
    broadcast: (campaignId) => broadcastSnapshots(io, db, campaignId),
  });

  registerCharacterPlayRoutes(app, db, io, {
    broadcast: (campaignId) => broadcastSnapshots(io, db, campaignId),
    publishCharacter: (campaignId, change) =>
      publishCharacterChange(io, campaignId, change),
  });

  registerAssetRoutes(app, db, {
    broadcast: (campaignId) => broadcastSnapshots(io, db, campaignId),
  });
}
