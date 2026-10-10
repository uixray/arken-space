import { and, eq, isNull, sum } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { createGalleryChatShareSchema, type ClientToServerEvents, type ServerToClientEvents } from "@arken/contracts";
import {
  assets,
  chatAttachments,
  chatAttachmentUploads,
  chatMessages,
  characterMedia,
  characters,
  feedbackAttachments,
  gameEvents,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { canViewCharacterMedia } from "./character-media.js";
import { chatMessageDto, ensureStreamThread } from "./chat.js";
import { buildSnapshot } from "./snapshot.js";
import { assertStorageCapacity, readStoredImage, removeStoredUpload, storeUpload } from "./storage.js";
import { publicUploadError } from "./telemetry.js";
import { postgresErrorCode } from "./database-errors.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GalleryShareDto = ReturnType<typeof chatMessageDto> & {
  attachments: Array<{
    contentId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    createdAt: string;
  }>;
};
type SavedGalleryShare = {
  dto: GalleryShareDto;
  event: typeof gameEvents.$inferSelect;
};
const campaignRoom = (campaignId: string) => `campaign:${campaignId}`;

function actionPayload(event: { payload: unknown } | undefined) {
  return event?.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : null;
}

function captionOverride(body: ReturnType<typeof createGalleryChatShareSchema.parse>) {
  return body.caption?.trim() || null;
}

function matchesReplay(
  event: { membershipId: string; type: string; payload: unknown },
  membershipId: string,
  threadId: string,
  body: ReturnType<typeof createGalleryChatShareSchema.parse>,
) {
  const payload = actionPayload(event);
  const provided = Object.hasOwn(body, "caption");
  return (
    event.membershipId === membershipId &&
    event.type === "chat.created" &&
    payload?.threadId === threadId &&
    payload.galleryShareSourceMediaId === body.characterMediaId &&
    payload.galleryShareCaptionProvided === provided &&
    payload.galleryShareCaptionOverride === captionOverride(body)
  );
}

function replayDto(event: { payload: unknown }) {
  const payload = actionPayload(event);
  if (!payload) return null;
  const {
    galleryShareSourceMediaId: _source,
    galleryShareCaptionProvided: _provided,
    galleryShareCaptionOverride: _caption,
    ...dto
  } = payload;
  return dto;
}

export function registerGalleryChatShareRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
) {
  app.post("/api/chat/gallery-shares", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createGalleryChatShareSchema.parse(request.body);
    const thread = await ensureStreamThread(db, auth.campaignId, "TABLE");

    const [existing] = await db
      .select({ membershipId: gameEvents.membershipId, type: gameEvents.type, payload: gameEvents.payload })
      .from(gameEvents)
      .where(and(eq(gameEvents.campaignId, auth.campaignId), eq(gameEvents.actionId, body.actionId)))
      .limit(1);
    if (existing) {
      if (matchesReplay(existing, auth.membershipId, thread.id, body))
        return reply.code(200).send(replayDto(existing));
      return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    }

    let stored: Awaited<ReturnType<typeof storeUpload>> | undefined;
    let committed = false;
    let saved: SavedGalleryShare | undefined;
    try {
      saved = await db.transaction(async (tx) => {
        const [source] = await tx
          .select({
            media: characterMedia,
            ownerMembershipId: characters.ownerMembershipId,
            asset: assets,
          })
          .from(characterMedia)
          .innerJoin(characters, eq(characters.id, characterMedia.characterId))
          .innerJoin(assets, and(eq(assets.id, characterMedia.assetId), eq(assets.campaignId, characterMedia.campaignId)))
          .where(
            and(
              eq(characterMedia.id, body.characterMediaId),
              eq(characterMedia.campaignId, auth.campaignId),
              isNull(characterMedia.detachedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!source) throw new Error("GALLERY_MEDIA_NOT_FOUND");
        if (
          !canViewCharacterMedia(
            { role: auth.role, membershipId: auth.membershipId },
            { visibility: source.media.visibility, characterOwnerMembershipId: source.ownerMembershipId },
          )
        )
          throw new Error("GALLERY_MEDIA_NOT_FOUND");
        if (auth.role !== "GM") {
          const snapshot = await buildSnapshot(tx as unknown as Database, auth);
          if (!snapshot.assets.some((asset) => asset.id === source.asset.id))
            throw new Error("GALLERY_MEDIA_NOT_FOUND");
        }
        if (source.asset.kind !== "IMAGE") throw new Error("GALLERY_IMAGE_REQUIRED");

        const [assetUsage, feedbackUsage, chatUsage] = await Promise.all([
          tx.select({ used: sum(assets.sizeBytes) }).from(assets),
          tx.select({ used: sum(feedbackAttachments.sizeBytes) }).from(feedbackAttachments),
          tx.select({ used: sum(chatAttachmentUploads.sizeBytes) }).from(chatAttachmentUploads),
        ]);
        const usedBytes =
          Number(assetUsage[0]?.used ?? 0) +
          Number(feedbackUsage[0]?.used ?? 0) +
          Number(chatUsage[0]?.used ?? 0);
        await assertStorageCapacity(usedBytes, source.asset.sizeBytes);
        stored = await storeUpload(await readStoredImage(source.asset.storageKey), "image");

        const caption = Object.hasOwn(body, "caption")
          ? captionOverride(body)
          : source.media.caption?.trim() || null;
        const [upload] = await tx
          .insert(chatAttachmentUploads)
          .values({
            campaignId: auth.campaignId,
            uploadedByMembershipId: auth.membershipId,
            fileName: "gallery-image.webp",
            storageKey: stored.storageKey,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            width: stored.width,
            height: stored.height,
            status: "CLAIMED",
            expiresAt: new Date("9999-12-31T23:59:59.000Z"),
          })
          .returning();
        if (!upload) throw new Error("CHAT_ATTACHMENT_CREATE_FAILED");

        const [message] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: null,
            threadId: thread.id,
            body: caption ?? "",
            visibility: "PUBLIC",
          })
          .returning();
        if (!message) throw new Error("MESSAGE_CREATE_FAILED");
        await tx.insert(chatAttachments).values({
          campaignId: auth.campaignId,
          threadId: thread.id,
          messageId: message.id,
          contentId: upload.contentId,
        });

        const dto = {
          ...chatMessageDto(message, auth.displayName, "TABLE" as const),
          attachments: [{
            contentId: upload.contentId,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            width: upload.width,
            height: upload.height,
            createdAt: upload.createdAt.toISOString(),
          }],
        };
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: "chat.created",
            entityType: "chat",
            entityId: message.id,
            payload: {
              ...dto,
              galleryShareSourceMediaId: source.media.id,
              galleryShareCaptionProvided: Object.hasOwn(body, "caption"),
              galleryShareCaptionOverride: captionOverride(body),
            },
          })
          .returning();
        if (!event) throw new Error("EVENT_RECORD_FAILED");
        return { dto, event };
      });
      committed = true;
    } catch (error) {
      if (!committed && stored)
        await removeStoredUpload(stored.storageKey).catch(() => undefined);
      const [winner] = await db
        .select({ membershipId: gameEvents.membershipId, type: gameEvents.type, payload: gameEvents.payload })
        .from(gameEvents)
        .where(and(eq(gameEvents.campaignId, auth.campaignId), eq(gameEvents.actionId, body.actionId)))
        .limit(1);
      if (winner) {
        if (matchesReplay(winner, auth.membershipId, thread.id, body))
          return reply.code(200).send(replayDto(winner));
        return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
      }
      if (error instanceof Error) {
        if (error.message === "GALLERY_MEDIA_NOT_FOUND") return reply.code(404).send({ error: error.message });
        if (error.message === "GALLERY_IMAGE_REQUIRED") return reply.code(415).send({ error: error.message });
        const uploadError = publicUploadError(error);
        if (uploadError !== "UPLOAD_FAILED") return reply.code(400).send({ error: uploadError });
      }
      if (postgresErrorCode(error) === "23505") return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
      throw error;
    }

    if (!saved) throw new Error("GALLERY_SHARE_NOT_COMMITTED");

    const envelope = {
      sequence: Number(saved.event.sequence),
      actionId: body.actionId,
      emittedAt: saved.event.createdAt.toISOString(),
      data: saved.dto,
    };
    try {
      io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
    } catch {
      request.log.warn(
        { errorCode: "CHAT_SHARE_BROADCAST_FAILED" },
        "chat.gallery_share_broadcast_failed",
      );
    }
    return reply.code(201).send(saved.dto);
  });
}
