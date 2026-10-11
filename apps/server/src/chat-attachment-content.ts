import type { FastifyInstance } from "fastify";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { chatAttachments, chatAttachmentUploads, chatMessages, chatThreads } from "@arken/db";
import { requireAuth } from "./auth.js";
import { fullChatVisibilityFilter } from "./chat-history.js";
import { listVisiblePlayerRequests } from "./player-requests.js";
import { openStoredFile } from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export function registerChatAttachmentContentRoute(app: FastifyInstance, db: Database) {
  app.get("/api/chat/attachments/:contentId/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { contentId } = z.object({ contentId: z.string().uuid() }).parse(request.params);
    const visiblePlayerRequestIds = new Set(
      (await listVisiblePlayerRequests(db, auth)).map((item) => item.id),
    );
    const [item] = await db
      .select({ upload: chatAttachmentUploads, thread: chatThreads })
      .from(chatAttachments)
      .innerJoin(chatAttachmentUploads, and(
        eq(chatAttachmentUploads.campaignId, chatAttachments.campaignId),
        eq(chatAttachmentUploads.contentId, chatAttachments.contentId),
      ))
      .innerJoin(chatThreads, and(
        eq(chatThreads.campaignId, chatAttachments.campaignId),
        eq(chatThreads.id, chatAttachments.threadId),
      ))
      .innerJoin(chatMessages, and(
        eq(chatMessages.campaignId, chatAttachments.campaignId),
        eq(chatMessages.threadId, chatAttachments.threadId),
        eq(chatMessages.id, chatAttachments.messageId),
      ))
      .where(and(
        eq(chatAttachments.campaignId, auth.campaignId),
        eq(chatAttachments.contentId, contentId),
        fullChatVisibilityFilter(auth, visiblePlayerRequestIds),
        or(
          eq(chatThreads.type, "STREAM"),
          eq(chatThreads.participantAMembershipId, auth.membershipId),
          eq(chatThreads.participantBMembershipId, auth.membershipId),
        ),
      ))
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
  });
}
