import type { FastifyInstance } from "fastify";
import { and, eq, sum } from "drizzle-orm";
import { z } from "zod";
import {
  actionIdSchema,
  assetKindSchema,
  audioPurposeSchema,
  generateTokenAssetSchema,
} from "@arken/contracts";
import {
  assets,
  campaignMediaReservations,
  campaignSounds,
  campaignSoundPacks,
  gameEvents,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { env } from "./env.js";
import { buildSnapshot } from "./snapshot.js";
import {
  lockCampaignMediaQuota,
  releaseCampaignMediaBytes,
  reserveCampaignMediaBytes,
  requireLiveCampaignMediaReservation,
} from "./media-quota-reservations.js";
import {
  assetContentVersion,
  assetDto,
  assetUploadActionMatches,
} from "./asset-lifecycle.js";
import { findAction } from "./action-lookup.js";
import { errorMessage } from "./error-message.js";
import { publicUploadError } from "./telemetry.js";
import {
  assertStorageQuota,
  displayNameFromUpload,
  openStoredFile,
  readStoredImage,
  removeStoredUpload,
  renderTokenAsset,
  storeGeneratedToken,
  prepareUpload,
  storeDiceFrame,
  storePreparedUpload,
  type StoredUpload,
} from "./storage.js";
import { prepareDiceFrame } from "./dice-frame-codec.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/**
 * Campaign assets: upload, content delivery and creating a token from an
 * image. Moved out of routes.ts unchanged (legacy cleanup after the 15.10
 * audit).
 */
export function registerAssetRoutes(
  app: FastifyInstance,
  db: Database,
  { broadcast }: { broadcast: (campaignId: string) => Promise<void> },
) {
  app.get("/api/assets/upload-actions/:actionId", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { actionId } = z
      .object({ actionId: actionIdSchema })
      .parse(request.params);
    const event = await findAction(db, auth.campaignId, actionId);
    if (
      !event ||
      event.type !== "asset.created" ||
      event.entityType !== "asset" ||
      !event.entityId ||
      !event.payload ||
      typeof event.payload !== "object" ||
      !("assetId" in event.payload) ||
      event.payload.assetId !== event.entityId ||
      !("kind" in event.payload) ||
      event.payload.kind !== "IMAGE"
    )
      return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, event.entityId))
      .limit(1);
    if (
      !asset ||
      asset.campaignId !== auth.campaignId ||
      asset.kind !== "IMAGE" ||
      !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType)
    )
      return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    return reply.send(assetDto(asset));
  });

  app.post("/api/assets/:sourceAssetId/token", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { sourceAssetId } = z
      .object({ sourceAssetId: z.string().uuid() })
      .parse(request.params);
    const actionId = actionIdSchema.parse(request.headers["x-action-id"]);
    const body = generateTokenAssetSchema.parse(request.body);

    const replayAsset = async () => {
      const event = await findAction(db, auth.campaignId, actionId);
      if (
        !event ||
        event.membershipId !== auth.membershipId ||
        event.type !== "asset.created" ||
        event.entityType !== "asset" ||
        !event.entityId ||
        !event.payload ||
        typeof event.payload !== "object" ||
        !("sourceAssetId" in event.payload) ||
        event.payload.sourceAssetId !== sourceAssetId
      )
        return null;
      const [asset] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, event.entityId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      return asset ?? null;
    };
    const dto = assetDto;

    const replay = await replayAsset();
    if (replay) return reply.code(200).send(dto(replay));
    if (await findAction(db, auth.campaignId, actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });

    const [source] = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, sourceAssetId),
          eq(assets.campaignId, auth.campaignId),
          eq(assets.kind, "IMAGE"),
        ),
      )
      .limit(1);
    if (!source)
      return reply.code(404).send({ error: "SOURCE_IMAGE_NOT_FOUND" });

    let stored: Awaited<ReturnType<typeof storeGeneratedToken>> | undefined;
    let committed = false;
    const reservationKey = `asset-token:${actionId}`;
    let reserved = false;
    try {
      const sourceBuffer = await readStoredImage(source.storageKey);
      const rendered = await renderTokenAsset(sourceBuffer, body);
      await reserveCampaignMediaBytes(
        db,
        auth.campaignId,
        reservationKey,
        rendered.length,
      );
      reserved = true;
      stored = await storeGeneratedToken(rendered);
      const created = await db.transaction(async (tx) => {
        await lockCampaignMediaQuota(tx, auth.campaignId);
        await requireLiveCampaignMediaReservation(
          tx,
          auth.campaignId,
          reservationKey,
          stored!.sizeBytes,
        );
        const [lockedUsage] = await tx
          .select({ used: sum(assets.sizeBytes) })
          .from(assets)
          .where(eq(assets.campaignId, auth.campaignId));
        const [reservations] = await tx
          .select({ used: sum(campaignMediaReservations.reservedBytes) })
          .from(campaignMediaReservations)
          .where(eq(campaignMediaReservations.campaignId, auth.campaignId));
        assertStorageQuota(
          Number(lockedUsage?.used ?? 0) + Number(reservations?.used ?? 0),
          0,
        );
        const [asset] = await tx
          .insert(assets)
          .values({
            campaignId: auth.campaignId,
            uploadedByMembershipId: auth.membershipId,
            kind: "TOKEN",
            name:
              body.name ?? `${source.name.slice(0, 94)} token`.slice(0, 100),
            ...stored!,
          })
          .returning();
        if (!asset) throw new Error("ASSET_CREATE_FAILED");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "asset.created",
          entityType: "asset",
          entityId: asset.id,
          payload: {
            assetId: asset.id,
            kind: asset.kind,
            sourceAssetId,
            transform: body,
          },
        });
        return asset;
      });
      committed = true;
      await broadcast(auth.campaignId);
      return reply.code(201).send(dto(created));
    } catch (error) {
      // Once the transaction commits, the file is authoritative media and
      // must survive best-effort realtime notification failures.
      if (committed) throw error;
      if (stored) await removeStoredUpload(stored.storageKey);
      const concurrentReplay = await replayAsset();
      if (concurrentReplay) return reply.code(200).send(dto(concurrentReplay));
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return reply
          .code(404)
          .send({ error: "SOURCE_IMAGE_CONTENT_NOT_FOUND" });
      const errorCode = publicUploadError(error);
      request.log.warn(
        { errorCode, actionId },
        "asset.token_generation_rejected",
      );
      return reply.code(400).send({ error: errorCode });
    } finally {
      if (reserved)
        await releaseCampaignMediaBytes(db, auth.campaignId, reservationKey);
    }
  });

  app.post("/api/assets", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = z
      .object({
        kind: assetKindSchema,
        audioPurpose: audioPurposeSchema.optional(),
      })
      .parse(request.query);
    if (query.kind !== "AUDIO" && query.audioPurpose !== undefined)
      return reply.code(400).send({ error: "AUDIO_PURPOSE_REQUIRES_AUDIO" });
    if (auth.role !== "GM" && !["TOKEN", "PORTRAIT"].includes(query.kind))
      return reply.code(403).send({ error: "ASSET_FORBIDDEN" });
    const actionId = actionIdSchema.parse(request.headers["x-action-id"]);
    const duplicate = await findAction(db, auth.campaignId, actionId);
    if (duplicate?.entityId) {
      const requestedPurpose =
        query.kind === "AUDIO" ? (query.audioPurpose ?? "MUSIC") : null;
      const priorPayload = duplicate.payload as {
        kind?: string;
        audioPurpose?: string | null;
      } | null;
      if (!assetUploadActionMatches(priorPayload, query.kind, requestedPurpose))
        return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
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
    const reservationKey = `asset-upload:${actionId}`;
    let reserved = false;
    try {
      // UIX-457: рамка броска идёт своим конвейером — общий теряет анимацию.
      let stored: StoredUpload;
      let poster: { posterStorageKey: string; posterSizeBytes: number } | null =
        null;
      if (query.kind === "DICE_FRAME") {
        if (buffer.length > env.MAX_IMAGE_BYTES)
          throw new Error("IMAGE_TOO_LARGE");
        const encoded = await prepareDiceFrame(buffer);
        await reserveCampaignMediaBytes(
          db,
          auth.campaignId,
          reservationKey,
          encoded.animated.length + encoded.poster.length,
        );
        reserved = true;
        const frame = await storeDiceFrame(encoded);
        stored = frame.upload;
        poster = {
          posterStorageKey: frame.posterStorageKey,
          posterSizeBytes: frame.posterSizeBytes,
        };
      } else {
        const prepared = await prepareUpload(
          buffer,
          query.kind === "AUDIO" ? "audio" : "image",
        );
        await reserveCampaignMediaBytes(
          db,
          auth.campaignId,
          reservationKey,
          prepared.upload.sizeBytes,
        );
        reserved = true;
        stored = await storePreparedUpload(prepared);
      }
      const asset = await db
        .transaction(async (tx) => {
          await lockCampaignMediaQuota(tx, auth.campaignId);
          await requireLiveCampaignMediaReservation(
            tx,
            auth.campaignId,
            reservationKey,
            stored.sizeBytes,
          );
          const [created] = await tx
            .insert(assets)
            .values({
              campaignId: auth.campaignId,
              uploadedByMembershipId: auth.membershipId,
              kind: query.kind,
              audioPurpose:
                query.kind === "AUDIO" ? (query.audioPurpose ?? "MUSIC") : null,
              name: displayNameFromUpload(file.filename),
              ...stored,
              ...poster,
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
            payload: {
              assetId: created.id,
              kind: created.kind,
              audioPurpose: created.audioPurpose,
            },
          });
          return created;
        })
        .catch(async (error) => {
          await removeStoredUpload(stored.storageKey);
          if (poster) await removeStoredUpload(poster.posterStorageKey);
          throw error;
        });
      await broadcast(auth.campaignId);
      return reply.code(201).send(asset);
    } catch (error) {
      const errorCode = publicUploadError(error);
      request.log.warn({ errorCode, actionId }, "asset.upload_rejected");
      return reply.code(400).send({ error: errorCode });
    } finally {
      if (reserved)
        await releaseCampaignMediaBytes(db, auth.campaignId, reservationKey);
    }
  });

  app.get("/api/assets/:id/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { variant } = z
      .object({ variant: z.literal("poster").optional() })
      .passthrough()
      .parse(request.query);
    const [asset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
      .limit(1);
    if (!asset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    // UIX-457: постер есть только у рамки броска; остальным — честный 404.
    const storageKey =
      variant === "poster" ? asset.posterStorageKey : asset.storageKey;
    if (!storageKey) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    if (auth.role !== "GM") {
      const [soundUse] = await db
        .select({ id: campaignSounds.id })
        .from(campaignSounds)
        .innerJoin(
          campaignSoundPacks,
          eq(campaignSoundPacks.id, campaignSounds.packId),
        )
        .where(
          and(
            eq(campaignSounds.campaignId, auth.campaignId),
            eq(campaignSounds.assetId, asset.id),
          ),
        )
        .limit(1);
      if (soundUse) {
        const [publicSoundUse] = await db
          .select({ id: campaignSounds.id })
          .from(campaignSounds)
          .innerJoin(
            campaignSoundPacks,
            eq(campaignSoundPacks.id, campaignSounds.packId),
          )
          .where(
            and(
              eq(campaignSounds.campaignId, auth.campaignId),
              eq(campaignSounds.assetId, asset.id),
              eq(campaignSounds.audience, "ALL_MEMBERS"),
              eq(campaignSoundPacks.published, true),
              eq(campaignSoundPacks.audience, "ALL_MEMBERS"),
            ),
          )
          .limit(1);
        if (!publicSoundUse)
          return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      }
      const snapshot = await buildSnapshot(db, auth);
      if (!snapshot.assets.some((visible) => visible.id === asset.id))
        return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    }
    try {
      const file = await openStoredFile(storageKey, request.headers.range);
      const etag = assetContentVersion(storageKey);
      reply.header("ETag", etag);
      reply.header("Cache-Control", "private, no-cache");
      if (request.headers["if-none-match"] === etag) {
        file.stream.destroy();
        return reply.code(304).send();
      }
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Type", asset.mimeType);
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
      // UIX-474: строка в `assets` есть, файла по ней нет. Клиенту это по-
      // прежнему 404 — показать нечего, — но в журнале сервера случай обязан
      // быть отличим от «такого ассета нет». Именно из-за неразличимости
      // вопрос «битая запись или потерянный файл» пришлось разбирать в
      // браузере: снаружи оба ответа выглядели одинаково.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        request.log.warn(
          { assetId: asset.id, storageKey },
          "asset.content_missing",
        );
        return reply.code(404).send({ error: "ASSET_CONTENT_NOT_FOUND" });
      }
      // Отказ прав, каталог вместо файла, сбой диска — это не «нет файла».
      // Раньше всё это превращалось в 404, и авария хранилища выглядела
      // потерянным ассетом: чинили бы не то.
      request.log.error(
        { assetId: asset.id, storageKey, error },
        "asset.content_unreadable",
      );
      return reply.code(500).send({ error: "ASSET_CONTENT_UNREADABLE" });
    }
  });
}
