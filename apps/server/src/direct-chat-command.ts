import { and, eq, gt, inArray, sql } from "drizzle-orm";
import {
  memberships,
  chatMessages,
  chatAttachmentUploads,
  chatAttachments,
  gameEvents,
} from "@arken/db";
import {
  createOrGetDirectChatThreadSchema,
  createDirectChatMessageSchema,
  type ChatMessageDto,
} from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import {
  createOrGetDirectThread,
  directThreadMemberIds,
  resolveChatThread,
  chatMessageDto,
} from "./chat.js";
import { findAction } from "./action-lookup.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export class DirectChatError extends Error {
  constructor(
    readonly status: 404 | 409,
    code: string,
  ) {
    super(code);
  }
}
export async function openDirectChat(
  db: Database,
  auth: AuthContext,
  input: unknown,
) {
  const body = createOrGetDirectChatThreadSchema.parse(input);
  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(
      sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`,
    );
    const [participant] = await tx
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
      throw new DirectChatError(404, "CHAT_THREAD_NOT_FOUND");
    const { thread, created } = await createOrGetDirectThread(
      tx,
      auth,
      participant.id,
    );
    const participantIds = directThreadMemberIds(thread);
    const participantRows = await tx
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
    return { dto, created, participantIds };
  });
}
function matchesDirectReplay(
  event: NonNullable<Awaited<ReturnType<typeof findAction>>>,
  auth: AuthContext,
  body: ReturnType<typeof createDirectChatMessageSchema.parse>,
) {
  const dto = event.payload as ChatMessageDto;
  return (
    event.membershipId === auth.membershipId &&
    event.type === "chat.created" &&
    dto?.threadId === body.threadId &&
    dto.body === body.body &&
    JSON.stringify(
      (dto.attachments ?? []).map((item) => item.contentId).sort(),
    ) === JSON.stringify([...body.attachmentContentIds].sort())
  );
}
export async function submitDirectChat(
  db: Database,
  auth: AuthContext,
  input: unknown,
) {
  const body = createDirectChatMessageSchema.parse(input);
  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(
      sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`,
    );
    let thread;
    try {
      thread = await resolveChatThread(
        tx,
        auth,
        { threadId: body.threadId },
        [],
        { allowDirect: true },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "CHAT_THREAD_NOT_FOUND",
          "CHAT_THREAD_FORBIDDEN",
          "CHAT_STREAM_FORBIDDEN",
        ].includes(error.message)
      )
        throw new DirectChatError(404, "CHAT_THREAD_NOT_FOUND");
      throw error;
    }
    if (thread.type !== "DIRECT")
      throw new DirectChatError(404, "CHAT_THREAD_NOT_FOUND");
    const duplicate = await findAction(tx, auth.campaignId, body.actionId);
    if (duplicate) {
      if (!matchesDirectReplay(duplicate, auth, body))
        throw new DirectChatError(409, "ACTION_ID_CONFLICT");
      return {
        duplicate: true as const,
        dto: duplicate.payload as ChatMessageDto,
        participantIds: directThreadMemberIds(thread),
      };
    }
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
      throw new DirectChatError(404, "CHAT_ATTACHMENT_NOT_FOUND");
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
            eq(chatAttachmentUploads.uploadedByMembershipId, auth.membershipId),
            eq(chatAttachmentUploads.status, "STAGED"),
            gt(chatAttachmentUploads.expiresAt, claimNow),
            inArray(chatAttachmentUploads.contentId, attachmentIds),
          ),
        )
        .returning({ contentId: chatAttachmentUploads.contentId });
      if (claimed.length !== attachmentIds.length)
        throw new DirectChatError(404, "CHAT_ATTACHMENT_NOT_FOUND");
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
    return {
      duplicate: false as const,
      dto,
      event,
      participantIds: directThreadMemberIds(thread),
    };
  });
}
