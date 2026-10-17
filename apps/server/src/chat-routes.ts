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
        const claimNow = new Date();
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
                  gt(chatAttachmentUploads.expiresAt, claimNow),
                  inArray(chatAttachmentUploads.contentId, attachmentIds),
                ),
              )
              .for("update")
          : [];
        if (staged.length !== attachmentIds.length)
          throw new Error("CHAT_ATTACHMENT_NOT_FOUND");
        if (staged.length) {
          // Serialize claims against lifecycle deletion. The lock prevents a
          // DELETE from expiring/removing the blob between validation and ref
          // insertion; the guarded update also rejects stale/non-owned rows.
          const claimed = await tx
            .update(chatAttachmentUploads)
            .set({ status: "CLAIMED" })
            .where(
              and(
                eq(chatAttachmentUploads.campaignId, auth.campaignId),
                eq(
                  chatAttachmentUploads.uploadedByMembershipId,
                  auth.membershipId,
                ),
                eq(chatAttachmentUploads.status, "STAGED"),
                gt(chatAttachmentUploads.expiresAt, claimNow),
                inArray(chatAttachmentUploads.contentId, attachmentIds),
              ),
            )
            .returning({ contentId: chatAttachmentUploads.contentId });
          if (claimed.length !== attachmentIds.length)
            throw new Error("CHAT_ATTACHMENT_NOT_FOUND");
        }
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
    const params = z
      .object({ threadId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);

    const memberRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.campaignId, auth.campaignId));
    const visibleRequests = await listVisiblePlayerRequests(db, auth);

    reply.header("Cache-Control", "private, no-store");
    return loadThreadHistory(db, auth, {
      threadId: params.threadId,
      before: query.before,
      limit: query.limit,
      memberNameById: new Map(
        memberRows.map((member) => [member.id, member.displayName]),
      ),
      visiblePlayerRequestIds: new Set(
        visibleRequests.map((item: { id: string }) => item.id),
      ),
    });
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
      if (!character || !(await canAccessCharacter(db, auth, character)))
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
    const visiblePlayerRequestIds = new Set(
      (await listVisiblePlayerRequests(db, auth)).map((item) => item.id),
    );
    const [latest] = await db
      .select({ sequence: chatMessages.sequence })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.campaignId, auth.campaignId),
          eq(chatMessages.threadId, thread.id),
          fullChatVisibilityFilter(auth, visiblePlayerRequestIds),
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
}
