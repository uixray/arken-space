import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Server } from "socket.io";
import { and, eq, gt, isNotNull, lt, or } from "drizzle-orm";
import {
  assets,
  audioClipCandidates,
  audioClipProvenance,
  campaignMediaReservations,
  campaignSoundPacks,
  campaignSounds,
} from "@arken/db";
import {
  audioClipPreviewRequestSchema,
  audioClipSaveRequestSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@arken/contracts";
import { requireAuth, type AuthContext } from "./auth.js";
import { assetContentVersion } from "./asset-lifecycle.js";
import {
  decodeWaveform,
  inspectAudioSource,
  renderPcmClip,
} from "./audio-clip-codec.js";
import {
  audioClipIntentHash,
  estimatePcmWavBytes,
} from "./audio-clip-lifecycle.js";
import { env } from "./env.js";
import {
  openStoredAudioSource,
  removeStoredUpload,
  storeGeneratedAudio,
} from "./storage.js";
import {
  lockCampaignMediaQuota,
  releaseCampaignMediaBytes,
  reserveCampaignMediaBytes,
  requireLiveCampaignMediaReservation,
} from "./media-quota-reservations.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
type Session = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthContext | null>;
const CANDIDATE_TTL_MS = 15 * 60 * 1000;

function statusView(row: typeof audioClipCandidates.$inferSelect) {
  return {
    candidateId: row.id,
    status: row.status as
      "PROCESSING" | "READY" | "EXPIRED" | "CANCELLED" | "FAILED" | "SAVED",
    range:
      row.frames && row.sampleRate && row.channels
        ? {
            startMs: row.startMs,
            endMs: row.endMs,
            actualStartMs: row.actualStartMs ?? row.startMs,
            actualEndMs: row.actualEndMs ?? row.endMs,
            actualStartFrame: row.actualStartFrame ?? 0,
            actualEndFrame: row.actualEndFrame ?? row.frames ?? 0,
            sampleRate: row.sampleRate,
            channels: row.channels,
            frames: row.frames,
          }
        : null,
    previewUrl:
      row.status === "READY"
        ? `/api/audio-clip-previews/${row.id}/content`
        : null,
    expiresAt: row.expiresAt.toISOString(),
    sizeBytes: row.sizeBytes,
  };
}

function publicError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const allowed = new Set([
    "INVALID_RANGE",
    "UNSUPPORTED_AUDIO",
    "CODEC_UNAVAILABLE",
    "PROCESSING_TIMEOUT",
    "PROCESSING_OUTPUT_LIMIT",
    "ANALYSIS_RESOURCE_LIMIT",
    "MEDIA_QUOTA_EXCEEDED",
    "LOW_DISK_SPACE",
    "PROCESSING_BUSY",
  ]);
  return allowed.has(code) ? code : "UNSUPPORTED_AUDIO";
}

async function ownedCandidate(db: Database, auth: AuthContext, id: string) {
  const [row] = await db
    .select()
    .from(audioClipCandidates)
    .where(
      and(
        eq(audioClipCandidates.id, id),
        eq(audioClipCandidates.campaignId, auth.campaignId),
        eq(audioClipCandidates.creatorMembershipId, auth.membershipId),
      ),
    )
    .limit(1);
  return row;
}

/** Marks expired previews and reclaims their immutable protected blobs. */
export async function cleanupExpiredAudioClipCandidates(db: Database) {
  const expired = await db
    .update(audioClipCandidates)
    .set({ status: "EXPIRED", reservedBytes: 0 })
    .where(
      and(
        or(
          eq(audioClipCandidates.status, "READY"),
          eq(audioClipCandidates.status, "PROCESSING"),
        ),
        lt(audioClipCandidates.expiresAt, new Date()),
      ),
    )
    .returning({
      storageKey: audioClipCandidates.storageKey,
      campaignId: audioClipCandidates.campaignId,
      actionId: audioClipCandidates.actionId,
    });
  await Promise.all(
    expired.map(({ storageKey }) =>
      storageKey ? removeStoredUpload(storageKey) : Promise.resolve(),
    ),
  );
  await Promise.all(
    expired.map(({ campaignId, actionId }) =>
      releaseCampaignMediaBytes(db, campaignId, `audio-clip:${actionId}`),
    ),
  );
  // Reclaim orphaned reservations under the same per-campaign mutex used by
  // reservations and final asset commits; never delete across campaigns unlocked.
  const now = new Date();
  const expiredCampaigns = await db
    .selectDistinct({ campaignId: campaignMediaReservations.campaignId })
    .from(campaignMediaReservations)
    .where(lt(campaignMediaReservations.expiresAt, now));
  for (const { campaignId } of expiredCampaigns)
    await db.transaction(async (tx) => {
      await lockCampaignMediaQuota(tx, campaignId);
      await tx
        .delete(campaignMediaReservations)
        .where(
          and(
            eq(campaignMediaReservations.campaignId, campaignId),
            lt(campaignMediaReservations.expiresAt, new Date()),
          ),
        );
    });
  return expired.length;
}

export function registerAudioClipRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
  getSession: Session = (request, reply) => requireAuth(request, reply, db),
) {
  const cleanupTimer = setInterval(
    () => void cleanupExpiredAudioClipCandidates(db).catch(() => undefined),
    60_000,
  );
  cleanupTimer.unref();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));

  app.get<{ Params: { assetId: string } }>(
    "/api/assets/:assetId/audio-analysis",
    async (request, reply) => {
      const auth = await getSession(request, reply);
      if (!auth)
        return reply.sent
          ? undefined
          : reply.code(401).send({ error: "AUTH_REQUIRED" });
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      const [asset] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, request.params.assetId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!asset || asset.kind !== "AUDIO")
        return reply.code(404).send({ error: "SOURCE_NOT_FOUND" });
      try {
        const first = await openStoredAudioSource(asset.storageKey);
        const profile = await inspectAudioSource(
          first.stream,
          asset.mimeType as "audio/mpeg" | "audio/ogg" | "audio/wav",
        );
        const decoded = await decodeWaveform(
          (await openStoredAudioSource(asset.storageKey)).stream,
          profile,
        );
        return {
          sourceAssetId: asset.id,
          sourceVersion: assetContentVersion(asset.storageKey),
          durationMs: decoded.durationMs,
          sampleRate: profile.sampleRate,
          channels: profile.channels,
          frames: decoded.frames,
          peaks: decoded.peaks,
        };
      } catch (error) {
        return reply.code(422).send({ error: publicError(error) });
      }
    },
  );

  app.post<{ Params: { assetId: string } }>(
    "/api/assets/:assetId/audio-clip-preview",
    async (request, reply) => {
      const auth = await getSession(request, reply);
      if (!auth)
        return reply.sent
          ? undefined
          : reply.code(401).send({ error: "AUTH_REQUIRED" });
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      const parsed = audioClipPreviewRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_RANGE" });
      const [asset] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, request.params.assetId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!asset || asset.kind !== "AUDIO")
        return reply.code(404).send({ error: "SOURCE_NOT_FOUND" });
      const version = assetContentVersion(asset.storageKey);
      if (parsed.data.sourceVersion !== version)
        return reply.code(409).send({ error: "SOURCE_STALE" });
      const intentHash = audioClipIntentHash({
        sourceAssetId: asset.id,
        sourceVersion: version,
        startMs: parsed.data.startMs,
        endMs: parsed.data.endMs,
      });
      const [prior] = await db
        .select()
        .from(audioClipCandidates)
        .where(
          and(
            eq(audioClipCandidates.campaignId, auth.campaignId),
            eq(audioClipCandidates.actionId, parsed.data.actionId),
          ),
        )
        .limit(1);
      if (prior) {
        if (prior.creatorMembershipId !== auth.membershipId)
          return reply.code(404).send({ error: "CANDIDATE_NOT_FOUND" });
        if (prior.intentHash !== intentHash)
          return reply.code(409).send({ error: "ACTION_CONFLICT" });
        return reply
          .code(prior.status === "PROCESSING" ? 202 : 200)
          .send(statusView(prior));
      }
      let inserted: typeof audioClipCandidates.$inferSelect | undefined;
      let generatedStorageKey: string | undefined;
      try {
        const probed = await inspectAudioSource(
          (await openStoredAudioSource(asset.storageKey)).stream,
          asset.mimeType as "audio/mpeg" | "audio/ogg" | "audio/wav",
        );
        const decoded = await decodeWaveform(
          (await openStoredAudioSource(asset.storageKey)).stream,
          probed,
        );
        const profile = {
          ...probed,
          frames: decoded.frames,
          durationMs: decoded.durationMs,
        };
        if (parsed.data.endMs > profile.durationMs)
          return reply.code(400).send({ error: "INVALID_RANGE" });
        const reservation = estimatePcmWavBytes(
          profile,
          parsed.data.startMs,
          parsed.data.endMs,
        );
        if (reservation > env.MAX_AUDIO_BYTES)
          return reply.code(413).send({ error: "UNSUPPORTED_AUDIO" });
        const now = new Date();
        const candidateId = randomUUID();
        await reserveCampaignMediaBytes(
          db,
          auth.campaignId,
          `audio-clip:${parsed.data.actionId}`,
          reservation,
        );
        const [row] = await db
          .insert(audioClipCandidates)
          .values({
            id: candidateId,
            campaignId: auth.campaignId,
            creatorMembershipId: auth.membershipId,
            sourceAssetId: asset.id,
            actionId: parsed.data.actionId,
            intentHash,
            sourceVersion: version,
            startMs: parsed.data.startMs,
            endMs: parsed.data.endMs,
            reservedBytes: reservation,
            expiresAt: new Date(now.getTime() + CANDIDATE_TTL_MS),
          })
          .onConflictDoNothing()
          .returning();
        inserted = row;
        if (!inserted) {
          const [raced] = await db
            .select()
            .from(audioClipCandidates)
            .where(
              and(
                eq(audioClipCandidates.campaignId, auth.campaignId),
                eq(audioClipCandidates.actionId, parsed.data.actionId),
              ),
            )
            .limit(1);
          if (!raced) return reply.code(503).send({ error: "PROCESSING_BUSY" });
          if (raced.creatorMembershipId !== auth.membershipId)
            return reply.code(404).send({ error: "CANDIDATE_NOT_FOUND" });
          if (raced.intentHash !== intentHash)
            return reply.code(409).send({ error: "ACTION_CONFLICT" });
          return reply
            .code(raced.status === "PROCESSING" ? 202 : 200)
            .send(statusView(raced));
        }
        const processingCandidate = inserted;
        if (!processingCandidate) throw new Error("PROCESSING_BUSY");
        const clip = await renderPcmClip(
          (await openStoredAudioSource(asset.storageKey)).stream,
          profile,
          parsed.data.startMs,
          parsed.data.endMs,
        );
        const [current] = await db
          .select({ storageKey: assets.storageKey })
          .from(assets)
          .where(
            and(
              eq(assets.id, asset.id),
              eq(assets.campaignId, auth.campaignId),
            ),
          )
          .limit(1);
        if (!current || assetContentVersion(current.storageKey) !== version)
          throw new Error("SOURCE_STALE");
        if (clip.buffer.length > reservation)
          throw new Error("PROCESSING_OUTPUT_LIMIT");
        const stored = await storeGeneratedAudio(clip.buffer);
        generatedStorageKey = stored.storageKey;
        const ready = await db.transaction(async (tx) => {
          await lockCampaignMediaQuota(tx, auth.campaignId);
          await requireLiveCampaignMediaReservation(
            tx,
            auth.campaignId,
            `audio-clip:${parsed.data.actionId}`,
            stored.sizeBytes,
          );
          const [candidate] = await tx
            .update(audioClipCandidates)
            .set({
              status: "READY",
              reservedBytes: stored.sizeBytes,
              storageKey: stored.storageKey,
              sizeBytes: stored.sizeBytes,
              sampleRate: clip.range.sampleRate,
              channels: clip.range.channels,
              frames: clip.range.frames,
              actualStartMs: clip.range.actualStartMs,
              actualEndMs: clip.range.actualEndMs,
              actualStartFrame: clip.range.actualStartFrame,
              actualEndFrame: clip.range.actualEndFrame,
            })
            .where(
              and(
                eq(audioClipCandidates.id, processingCandidate.id),
                eq(audioClipCandidates.status, "PROCESSING"),
              ),
            )
            .returning();
          if (candidate)
            await tx
              .update(campaignMediaReservations)
              .set({ reservedBytes: stored.sizeBytes })
              .where(
                and(
                  eq(campaignMediaReservations.campaignId, auth.campaignId),
                  eq(
                    campaignMediaReservations.requestKey,
                    `audio-clip:${parsed.data.actionId}`,
                  ),
                ),
              );
          return candidate;
        });
        if (!ready) {
          await removeStoredUpload(stored.storageKey);
          generatedStorageKey = undefined;
          return reply.code(409).send({ error: "CANDIDATE_EXPIRED" });
        }
        generatedStorageKey = undefined;
        return reply.code(201).send(statusView(ready));
      } catch (error) {
        if (generatedStorageKey)
          await removeStoredUpload(generatedStorageKey).catch(() => undefined);
        if (inserted) {
          // Cancellation/expiry owns terminal state and reservation cleanup. A
          // late codec failure must not turn that state back into FAILED.
          const [failed] = await db
            .update(audioClipCandidates)
            .set({ status: "FAILED", reservedBytes: 0 })
            .where(
              and(
                eq(audioClipCandidates.id, inserted.id),
                eq(audioClipCandidates.status, "PROCESSING"),
              ),
            )
            .returning({ id: audioClipCandidates.id });
          if (!failed)
            return reply.code(409).send({ error: "CANDIDATE_EXPIRED" });
          await releaseCampaignMediaBytes(
            db,
            auth.campaignId,
            `audio-clip:${parsed.data.actionId}`,
          );
        }
        const code =
          error instanceof Error && error.message === "SOURCE_STALE"
            ? "SOURCE_STALE"
            : publicError(error);
        const status =
          code === "LOW_DISK_SPACE" ||
          code === "MEDIA_QUOTA_EXCEEDED" ||
          code === "PROCESSING_OUTPUT_LIMIT" ||
          code === "ANALYSIS_RESOURCE_LIMIT"
            ? 413
            : code === "PROCESSING_BUSY" || code === "CODEC_UNAVAILABLE"
              ? 503
              : 422;
        return reply.code(status).send({ error: code });
      }
    },
  );

  app.get<{ Params: { candidateId: string } }>(
    "/api/audio-clip-previews/:candidateId",
    async (request, reply) => {
      const auth = await getSession(request, reply);
      if (!auth)
        return reply.sent
          ? undefined
          : reply.code(401).send({ error: "AUTH_REQUIRED" });
      const row = await ownedCandidate(db, auth, request.params.candidateId);
      if (!row) return reply.code(404).send({ error: "CANDIDATE_NOT_FOUND" });
      return statusView(row);
    },
  );

  app.get<{ Params: { candidateId: string } }>(
    "/api/audio-clip-previews/:candidateId/content",
    async (request, reply) => {
      const auth = await getSession(request, reply);
      if (!auth)
        return reply.sent
          ? undefined
          : reply.code(401).send({ error: "AUTH_REQUIRED" });
      const row = await ownedCandidate(db, auth, request.params.candidateId);
      if (
        !row ||
        row.status !== "READY" ||
        !row.storageKey ||
        row.expiresAt <= new Date()
      )
        return reply.code(404).send({ error: "CANDIDATE_NOT_FOUND" });
      const stored = await openStoredAudioSource(row.storageKey);
      reply
        .header("Cache-Control", "private, no-store")
        .header("Content-Type", "audio/wav")
        .header("Content-Length", String(stored.sizeBytes));
      return reply.send(stored.stream);
    },
  );

  app.delete<{ Params: { candidateId: string } }>(
    "/api/audio-clip-previews/:candidateId",
    async (request, reply) => {
      const auth = await getSession(request, reply);
      if (!auth)
        return reply.sent
          ? undefined
          : reply.code(401).send({ error: "AUTH_REQUIRED" });
      const row = await db
        .transaction(async (tx) => {
          await lockCampaignMediaQuota(tx, auth.campaignId);
          const [candidate] = await tx
            .select()
            .from(audioClipCandidates)
            .where(
              and(
                eq(audioClipCandidates.id, request.params.candidateId),
                eq(audioClipCandidates.campaignId, auth.campaignId),
                eq(audioClipCandidates.creatorMembershipId, auth.membershipId),
              ),
            )
            .for("update")
            .limit(1);
          if (!candidate) return null;
          if (candidate.status === "SAVED") throw new Error("ACTION_CONFLICT");
          await tx
            .update(audioClipCandidates)
            .set({ status: "CANCELLED", reservedBytes: 0, storageKey: null })
            .where(eq(audioClipCandidates.id, candidate.id));
          await tx
            .delete(campaignMediaReservations)
            .where(
              and(
                eq(campaignMediaReservations.campaignId, auth.campaignId),
                eq(
                  campaignMediaReservations.requestKey,
                  `audio-clip:${candidate.actionId}`,
                ),
              ),
            );
          return candidate;
        })
        .catch((error) => {
          if (error instanceof Error && error.message === "ACTION_CONFLICT")
            return "CONFLICT" as const;
          throw error;
        });
      if (row === "CONFLICT")
        return reply.code(409).send({ error: "ACTION_CONFLICT" });
      if (!row) return reply.code(404).send({ error: "CANDIDATE_NOT_FOUND" });
      if (row.storageKey) await removeStoredUpload(row.storageKey);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { packId: string } }>(
    "/api/soundpad/packs/:packId/clips",
    async (request, reply) => {
      const auth = await getSession(request, reply);
      if (!auth)
        return reply.sent
          ? undefined
          : reply.code(401).send({ error: "AUTH_REQUIRED" });
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      const parsed = audioClipSaveRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_COMMAND" });
      const saveHash = createHash("sha256")
        .update(
          JSON.stringify([
            request.params.packId,
            parsed.data.candidateId,
            parsed.data.label,
            parsed.data.icon,
            parsed.data.category,
            parsed.data.defaultGain,
            parsed.data.audience,
            parsed.data.sourceNote,
          ]),
        )
        .digest("hex");
      const [prior] = await db
        .select()
        .from(audioClipCandidates)
        .where(
          and(
            eq(audioClipCandidates.campaignId, auth.campaignId),
            eq(audioClipCandidates.saveActionId, parsed.data.actionId),
          ),
        )
        .limit(1);
      if (prior) {
        if (prior.creatorMembershipId !== auth.membershipId)
          return reply.code(404).send({ error: "CANDIDATE_NOT_FOUND" });
        if (prior.saveIntentHash !== saveHash)
          return reply.code(409).send({ error: "ACTION_CONFLICT" });
        const [sound] = prior.savedSoundId
          ? await db
              .select()
              .from(campaignSounds)
              .where(eq(campaignSounds.id, prior.savedSoundId))
              .limit(1)
          : [];
        if (sound)
          return {
            packId: sound.packId,
            sound: {
              id: sound.id,
              packId: sound.packId,
              assetId: sound.assetId,
              label: sound.label,
              icon: sound.icon,
              category: sound.category,
              sortOrder: sound.sortOrder,
              defaultGain: sound.defaultGain,
              audience: sound.audience,
              sourceNote: sound.sourceNote,
            },
            provenance: {
              sourceAssetId: prior.sourceAssetId,
              sourceVersion: prior.sourceVersion,
              startMs: prior.startMs,
              endMs: prior.endMs,
              actualStartFrame: prior.actualStartFrame!,
              actualEndFrame: prior.actualEndFrame!,
              sampleRate: prior.sampleRate!,
            },
          };
        return reply.code(409).send({ error: "ACTION_CONFLICT" });
      }
      try {
        const result = await db.transaction(async (tx) => {
          await lockCampaignMediaQuota(tx, auth.campaignId);
          const [savedAction] = await tx
            .select()
            .from(audioClipCandidates)
            .where(
              and(
                eq(audioClipCandidates.campaignId, auth.campaignId),
                eq(audioClipCandidates.saveActionId, parsed.data.actionId),
              ),
            )
            .limit(1);
          if (savedAction) {
            if (savedAction.creatorMembershipId !== auth.membershipId)
              throw new Error("CANDIDATE_NOT_FOUND");
            if (
              savedAction.saveIntentHash !== saveHash ||
              !savedAction.savedSoundId
            )
              throw new Error("ACTION_CONFLICT");
            const [savedSound] = await tx
              .select()
              .from(campaignSounds)
              .where(eq(campaignSounds.id, savedAction.savedSoundId))
              .limit(1);
            if (!savedSound) throw new Error("ACTION_CONFLICT");
            return {
              replayed: true,
              packId: savedSound.packId,
              sound: savedSound,
              provenance: {
                sourceAssetId: savedAction.sourceAssetId,
                sourceVersion: savedAction.sourceVersion,
                startMs: savedAction.startMs,
                endMs: savedAction.endMs,
                actualStartFrame: savedAction.actualStartFrame!,
                actualEndFrame: savedAction.actualEndFrame!,
                sampleRate: savedAction.sampleRate!,
              },
            };
          }
          const [candidate] = await tx
            .select()
            .from(audioClipCandidates)
            .where(
              and(
                eq(audioClipCandidates.id, parsed.data.candidateId),
                eq(audioClipCandidates.campaignId, auth.campaignId),
                eq(audioClipCandidates.creatorMembershipId, auth.membershipId),
                eq(audioClipCandidates.status, "READY"),
                gt(audioClipCandidates.expiresAt, new Date()),
                isNotNull(audioClipCandidates.storageKey),
              ),
            )
            .for("update")
            .limit(1);
          if (!candidate) throw new Error("CANDIDATE_EXPIRED");
          await requireLiveCampaignMediaReservation(
            tx,
            auth.campaignId,
            `audio-clip:${candidate.actionId}`,
            candidate.sizeBytes ?? 0,
          );
          const [pack] = await tx
            .select()
            .from(campaignSoundPacks)
            .where(
              and(
                eq(campaignSoundPacks.id, request.params.packId),
                eq(campaignSoundPacks.campaignId, auth.campaignId),
              ),
            )
            .limit(1);
          if (!pack) throw new Error("SOURCE_NOT_FOUND");
          const [asset] = await tx
            .insert(assets)
            .values({
              campaignId: auth.campaignId,
              uploadedByMembershipId: auth.membershipId,
              kind: "AUDIO",
              audioPurpose: "SOUND_EFFECT",
              name: parsed.data.label,
              storageKey: candidate.storageKey!,
              mimeType: "audio/wav",
              sizeBytes: candidate.sizeBytes!,
              width: null,
              height: null,
              durationSeconds: candidate.frames! / candidate.sampleRate!,
            })
            .returning();
          const [sound] = await tx
            .insert(campaignSounds)
            .values({
              campaignId: auth.campaignId,
              packId: pack.id,
              assetId: asset!.id,
              label: parsed.data.label,
              icon: parsed.data.icon,
              category: parsed.data.category,
              defaultGain: parsed.data.defaultGain,
              audience: parsed.data.audience,
              sourceNote: parsed.data.sourceNote,
            })
            .returning();
          await tx.insert(audioClipProvenance).values({
            assetId: asset!.id,
            campaignId: auth.campaignId,
            sourceAssetId: candidate.sourceAssetId,
            sourceVersion: candidate.sourceVersion,
            startMs: candidate.startMs,
            endMs: candidate.endMs,
            actualStartFrame: candidate.actualStartFrame!,
            actualEndFrame: candidate.actualEndFrame!,
            sampleRate: candidate.sampleRate!,
            createdByMembershipId: auth.membershipId,
          });
          await tx
            .update(audioClipCandidates)
            .set({
              status: "SAVED",
              reservedBytes: 0,
              storageKey: null,
              savedAssetId: asset!.id,
              savedSoundId: sound!.id,
              saveActionId: parsed.data.actionId,
              saveIntentHash: saveHash,
            })
            .where(eq(audioClipCandidates.id, candidate.id));
          await tx
            .delete(campaignMediaReservations)
            .where(
              and(
                eq(campaignMediaReservations.campaignId, auth.campaignId),
                eq(
                  campaignMediaReservations.requestKey,
                  `audio-clip:${candidate.actionId}`,
                ),
              ),
            );
          return {
            replayed: false,
            packId: pack.id,
            sound: sound!,
            provenance: {
              sourceAssetId: candidate.sourceAssetId,
              sourceVersion: candidate.sourceVersion,
              startMs: candidate.startMs,
              endMs: candidate.endMs,
              actualStartFrame: candidate.actualStartFrame!,
              actualEndFrame: candidate.actualEndFrame!,
              sampleRate: candidate.sampleRate!,
            },
          };
        });
        if (!result.replayed) {
          try {
            io.to(`campaign:${auth.campaignId}`).emit(
              "soundpad:catalog:changed",
            );
          } catch (error) {
            request.log.error(
              { error },
              "audio_clip.catalog_invalidation_failed",
            );
          }
        }
        return reply.code(result.replayed ? 200 : 201).send({
          packId: result.packId,
          sound: {
            id: result.sound.id,
            packId: result.sound.packId,
            assetId: result.sound.assetId,
            label: result.sound.label,
            icon: result.sound.icon,
            category: result.sound.category,
            sortOrder: result.sound.sortOrder,
            defaultGain: result.sound.defaultGain,
            audience: result.sound.audience,
            sourceNote: result.sound.sourceNote,
          },
          provenance: result.provenance,
        });
      } catch (error) {
        const code =
          error instanceof Error &&
          [
            "CANDIDATE_EXPIRED",
            "SOURCE_NOT_FOUND",
            "ACTION_CONFLICT",
            "CANDIDATE_NOT_FOUND",
          ].includes(error.message)
            ? error.message
            : "PROCESSING_BUSY";
        return reply
          .code(
            code === "PROCESSING_BUSY"
              ? 503
              : code === "CANDIDATE_EXPIRED"
                ? 410
                : code === "ACTION_CONFLICT"
                  ? 409
                  : 404,
          )
          .send({ error: code });
      }
    },
  );
}
