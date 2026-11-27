import {stageChatAttachment} from "./chat-attachment-upload.js";
import {readChatHistory,markChatRead,ChatReadError} from "./chat-read-command.js";
import {openDirectChat,submitDirectChat,DirectChatError} from "./direct-chat-command.js";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { and, desc, eq, gt, inArray, lt, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import {
  createChatMessageSchema,
  createStickerMessageSchema,
  createDirectChatMessageSchema,
  createOrGetDirectChatThreadSchema,
  markChatThreadReadSchema,
} from "@arken/contracts";
import {
  assets,
  characters,
  chatMessages,
  globalStickerPacks,
  globalStickers,
  globalStickerMedia,
  chatReadCursors,
  chatAttachments,
  chatAttachmentUploads,
  stickerPackEntitlements,
  feedbackAttachments,
  gameEvents,
  memberships,
} from "@arken/db";
import {submitStreamChat,StreamChatError} from "./stream-chat-command.js";
import { requireAuth } from "./auth.js";
import { env } from "./env.js";
import { fullChatVisibilityFilter, loadThreadHistory } from "./chat-history.js";
import { listVisiblePlayerRequests } from "./player-requests.js";
import { findAction } from "./action-lookup.js";
import { campaignRoom, gmRoom, memberRoom } from "./rooms.js";
import { canAccessCharacter } from "./character-access.js";
import {
  canPostToStream,
  createOrGetDirectThread,
  directThreadMemberIds,
  chatBroadcastAudience,
  chatMessageDto,
  clampReadSequence,
  resolveChatThread,
} from "./chat.js";
import {
  canMemberSendPack,
  canMembersViewPack,
  resolveSticker,
  isMatchingStickerReplay,
  stickerMessageVisibility,
  stickerPresentation,
} from "./sticker-access.js";
import { publicUploadError } from "./telemetry.js";
import {
  assertStorageCapacity,
  removeStoredUpload,
  storeUpload,
} from "./storage.js";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * Chat: table and direct threads, messages, stickers in chat, attachments,
 * thread history and read cursors. Moved out of routes.ts unchanged
 * (legacy cleanup after the 15.10 audit).
 */
export function registerChatRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
) {
  app.post("/api/chat/stickers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createStickerMessageSchema.parse(request.body);
    const globalRequest = "scope" in body;
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
    if (duplicate && globalRequest) {
      const payload = duplicate.payload as Record<string, unknown>;
      return duplicate.membershipId === auth.membershipId &&
        duplicate.type === "chat.created" &&
        payload.threadId === thread.id &&
        payload.globalStickerId === body.globalStickerId
        ? reply.code(200).send(duplicate.payload)
        : reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    }
    if (duplicate && !globalRequest)
      return isMatchingStickerReplay(duplicate, {
        membershipId: auth.membershipId,
        threadId: thread.id,
        stickerId: body.stickerId,
      })
        ? reply.code(200).send(duplicate.payload)
        : reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    if (globalRequest) {
      if (!env.GLOBAL_STICKERS_ENABLED)
        return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
      const [resolved] = await db
        .select({
          sticker: globalStickers,
          pack: globalStickerPacks,
          media: globalStickerMedia,
        })
        .from(globalStickers)
        .innerJoin(
          globalStickerPacks,
          eq(globalStickerPacks.id, globalStickers.packId),
        )
        .innerJoin(
          globalStickerMedia,
          eq(globalStickerMedia.id, globalStickers.mediaId),
        )
        .where(
          and(
            eq(globalStickers.id, body.globalStickerId),
            eq(globalStickerPacks.lifecycle, "ACTIVE"),
          ),
        )
        .limit(1);
      if (!resolved)
        return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
      const viewers =
        thread.type === "DIRECT" ? directThreadMemberIds(thread) : [];
      const presentation = {
        name: resolved.sticker.name,
        altText: resolved.sticker.altText,
        assetUrl: `/api/global-stickers/${resolved.sticker.id}/content`,
        width: resolved.media.width,
        height: resolved.media.height,
      };
      const audienceMembershipIds = thread.type === "DIRECT" ? viewers : null;
      let saved;
      try {
        saved = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(chatMessages)
            .values({
              campaignId: auth.campaignId,
              membershipId: auth.membershipId,
              characterId: null,
              kind: "TEXT",
              threadId: thread.id,
              visibility: "PUBLIC",
              body: "",
              globalStickerId: resolved.sticker.id,
              stickerId: null,
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
      } catch (error) {
        // Concurrent retries can both pass the initial lookup; the action
        // unique constraint elects one winner and the loser replays it.
        const winner = await findAction(db, auth.campaignId, body.actionId);
        if (winner) {
          const payload = winner.payload as Record<string, unknown>;
          return winner.membershipId === auth.membershipId &&
            winner.type === "chat.created" &&
            payload.threadId === thread.id &&
            payload.globalStickerId === body.globalStickerId
            ? reply.code(200).send(winner.payload)
            : reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
        }
        throw error;
      }
      const envelope = {
        sequence: Number(saved.event.sequence),
        actionId: body.actionId,
        emittedAt: saved.event.createdAt.toISOString(),
        data: saved.dto,
      };
      if (audienceMembershipIds)
        for (const membershipId of audienceMembershipIds)
          io.to(memberRoom(membershipId)).emit("chat:created", envelope);
      else io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      return reply.code(201).send(saved.dto);
    }
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
    try {
      return reply.code(201).send(await stageChatAttachment(db,auth,buffer,file.filename));
    } catch(error) {
      return reply.code(400).send({error:publicUploadError(error)});
    }
  });

  app.post("/api/chat/direct", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    let saved;
    try{saved=await openDirectChat(db,auth,request.body);}catch(error){if(error instanceof DirectChatError)return reply.code(error.status).send({error:error.message});throw error;}
    const {dto,created,participantIds}=saved;
    const thread=dto;
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
    const body=createDirectChatMessageSchema.parse(request.body);
    let saved;
    try{saved=await submitDirectChat(db,auth,body);}catch(error){if(error instanceof DirectChatError)return reply.code(error.status).send({error:error.message});throw error;}
    if(saved.duplicate)return reply.code(200).send(saved.dto);
    const envelope = {
      sequence: Number(saved.event.sequence),
      actionId: body.actionId,
      emittedAt: saved.event.createdAt.toISOString(),
      data: saved.dto,
    };
    for (const membershipId of saved.participantIds)
      io.to(memberRoom(membershipId)).emit("chat:created", envelope);
    return reply.code(201).send(saved.dto);
  });

  /**
   * UIX-450 — страница истории одного потока.
   *
   * До этого маршрута истории неоткуда было взяться, кроме снапшота, и именно
   * поэтому снапшот вёз по 200 сообщений на поток каждому при каждом действии:
   * две трети всего трафика рассылки (1 726 КБ из 2 580 на боевых данных).
   *
   * Проекция — общая с снапшотом (`projectChatMessages`), включая проверки
   * видимости стикеров, вложений и заявок. Своей копии здесь нет намеренно:
   * разойдясь, она разошлась бы в сторону «показали лишнее».
   */
  app.get("/api/chat/threads/:threadId/messages", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const params=z.object({threadId:z.string().uuid()}).parse(request.params);
    reply.header("Cache-Control","private, no-store");
    const query=z.object({before:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query);
    return readChatHistory(db,auth,{...query,threadId:params.threadId});
  });

  app.post("/api/chat", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    let saved;
    try{saved=await submitStreamChat(db,auth,request.body);}catch(error){
      if(error instanceof StreamChatError)return reply.code(error.status).send({error:error.message});
      throw error;
    }
    if(saved.duplicate)return reply.code(200).send({duplicate:true});
    const {row,dto,event}=saved;
    const body=createChatMessageSchema.parse(request.body);
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
    try{return await markChatRead(db,auth,request.body);}catch(error){if(error instanceof ChatReadError)return reply.code(error.status).send({error:error.message});throw error;}
  });
}
