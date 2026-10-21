import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { and, asc, eq, sum } from "drizzle-orm";
import { z } from "zod";
import { registerPublicRoadmapVoteRoutes } from "./roadmap-votes.js";
import { registerAccountCampaignRoutes } from "./account-campaigns.js";
import {
  renameCommandSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type CharacterDto,
  type ChatMessageDto,
} from "@arken/contracts";
import {
  assets,
  campaigns,
  fogReveals,
  feedbackAttachments,
  feedbackReports,
  gameEvents,
  memberships,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";
import {
  createAccountMailContext,
  type AccountMailContext,
} from "./account-mail-context.js";
import { env } from "./env.js";
import { buildSnapshot, loadCampaignReadSet } from "./snapshot.js";
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
import { registerDrawingRoutes } from "./drawing-routes.js";
import { registerStickerRoutes } from "./sticker-routes.js";
import { registerChatRoutes } from "./chat-routes.js";
import { registerTokenRoutes } from "./token-routes.js";
import { registerCharacterRoutes } from "./character-routes.js";
import { registerCampaignRoutes } from "./campaign-routes.js";
import { registerCharacterPlayRoutes } from "./character-play-routes.js";
import { registerAssetRoutes } from "./asset-routes.js";
import { registerAccessRoutes } from "./access-routes.js";
import { registerSessionRoutes } from "./session-routes.js";
import { registerSceneRoutes } from "./scene-routes.js";
import { registerCanvasRoutes } from "./canvas-routes.js";

// Kept importable from routes.js for existing callers and tests.
export { claimInviteOwnership } from "./session-routes.js";
export { fitFrameToWorld } from "./scene-routes.js";
import { campaignRoom, gmRoom } from "./rooms.js";
import { emitCharacterUpdated } from "./character-events.js";
import { emitDrawingChange, type DrawingChange } from "./drawing-events.js";
import { registerEncounterRoutes } from "./encounters.js";
import { registerPlayerThemeRoutes } from "./player-theme-routes.js";
import { registerMemberRulerColorRoutes } from "./member-ruler-color-routes.js";
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
  registerMemberRulerColorRoutes(app, db);
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

  registerSessionRoutes(app, db, io);

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

  registerSceneRoutes(app, db, io, {
    canvasTx,
    broadcast: (campaignId) => broadcastSnapshots(io, db, campaignId),
  });

  registerTokenRoutes(app, db, {
    canvasTx,
    broadcast: (campaignId) => broadcastSnapshots(io, db, campaignId),
    publishToken: (campaignId, tokenId, envelope) =>
      publishTokenChange(io, db, campaignId, tokenId, envelope),
  });

  registerDrawingRoutes(app, db, {
    canvasTx,
    publish: (campaignId, change) =>
      publishDrawingChange(io, db, campaignId, change),
  });

  registerCanvasRoutes(app, db, {
    canvasTx,
    broadcast: (campaignId) => broadcastSnapshots(io, db, campaignId),
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
