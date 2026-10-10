import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import {
  chatAttachmentUploads,
  chatAttachments,
  gameEvents,
  storyPostMedia,
  storyPostRevisions,
  storyPosts,
} from "@arken/db";
import {
  storyAttachmentDeleteSchema,
  storyAttachmentListSchema,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";
import { removeStoredUpload } from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const error = (
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  status: number,
  code: string,
) => reply.code(status).send({ error: code });

function deleteCommandHash(contentId: string) {
  return createHash("sha256")
    .update(JSON.stringify({ operation: "delete-story-attachment", contentId }))
    .digest("hex");
}

export function registerStoryAttachmentLifecycleRoutes(
  app: FastifyInstance,
  db: Database,
) {
  app.get("/api/story/attachments", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return error(reply, 403, "GM_REQUIRED");

    const rows = await db
      .select({
        contentId: chatAttachmentUploads.contentId,
        fileName: chatAttachmentUploads.fileName,
        mimeType: chatAttachmentUploads.mimeType,
        sizeBytes: chatAttachmentUploads.sizeBytes,
        status: chatAttachmentUploads.status,
        storyRevisionCount: count(storyPostMedia.contentId),
        directChatReferenceCount: sql<number>`(select count(*)::int from chat_attachments ca where ca.campaign_id = ${auth.campaignId} and ca.content_id = ${chatAttachmentUploads.contentId})`,
      })
      .from(chatAttachmentUploads)
      .leftJoin(
        storyPostMedia,
        and(
          eq(storyPostMedia.campaignId, auth.campaignId),
          eq(storyPostMedia.contentId, chatAttachmentUploads.contentId),
        ),
      )
      .where(
        and(
          eq(chatAttachmentUploads.campaignId, auth.campaignId),
          sql`(${storyPostMedia.contentId} is not null or (${chatAttachmentUploads.uploadedByMembershipId} = ${auth.membershipId} and ${chatAttachmentUploads.status} in ('STAGED', 'EXPIRED')))`,
        ),
      )
      .groupBy(
        chatAttachmentUploads.contentId,
        chatAttachmentUploads.fileName,
        chatAttachmentUploads.mimeType,
        chatAttachmentUploads.sizeBytes,
        chatAttachmentUploads.status,
      );
    const references = rows.length
      ? await db
          .select({
            contentId: storyPostMedia.contentId,
            postId: storyPostMedia.postId,
            revision: storyPostMedia.revision,
            title: storyPostRevisions.title,
            lifecycle: storyPostRevisions.lifecycle,
            // Revisions persist lifecycle rather than visibility. Story transition code maps
            // published/corrected snapshots to PUBLIC and draft/archived snapshots to GM_ONLY.
            visibility: sql<
              "PUBLIC" | "GM_ONLY"
            >`case when ${storyPostRevisions.lifecycle} in ('PUBLISHED', 'CORRECTED') then 'PUBLIC' else 'GM_ONLY' end`,
            isCurrent: sql<boolean>`${storyPostMedia.revision} = ${storyPosts.revision}`,
          })
          .from(storyPostMedia)
          .innerJoin(
            storyPostRevisions,
            and(
              eq(storyPostRevisions.campaignId, storyPostMedia.campaignId),
              eq(storyPostRevisions.postId, storyPostMedia.postId),
              eq(storyPostRevisions.revision, storyPostMedia.revision),
            ),
          )
          .innerJoin(
            storyPosts,
            and(
              eq(storyPosts.campaignId, storyPostMedia.campaignId),
              eq(storyPosts.id, storyPostMedia.postId),
            ),
          )
          .where(
            and(
              eq(storyPostMedia.campaignId, auth.campaignId),
              inArray(
                storyPostMedia.contentId,
                rows.map((row) => row.contentId),
              ),
            ),
          )
      : [];
    const referencesByContentId = new Map<string, typeof references>();
    for (const reference of references) {
      referencesByContentId.set(reference.contentId, [
        ...(referencesByContentId.get(reference.contentId) ?? []),
        reference,
      ]);
    }
    const attachments = rows.map((row) => ({
      ...row,
      storyRevisionCount: Number(row.storyRevisionCount),
      storyReferences: (referencesByContentId.get(row.contentId) ?? []).map(
        ({ contentId: _contentId, ...reference }) => reference,
      ),
      directChatReferenceCount: Number(row.directChatReferenceCount),
      cleanupPending: row.status === "EXPIRED",
    }));
    return storyAttachmentListSchema.parse({ attachments });
  });

  app.delete<{ Params: { contentId: string } }>(
    "/api/story/attachments/:contentId",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (auth.role !== "GM") return error(reply, 403, "GM_REQUIRED");
      const parsed = storyAttachmentDeleteSchema.safeParse(request.body);
      if (!parsed.success) return error(reply, 400, "INVALID_REQUEST");
      const { contentId } = request.params;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          contentId,
        )
      )
        return error(reply, 400, "INVALID_REQUEST");
      const commandHash = deleteCommandHash(contentId);
      const [prior] = await db
        .select()
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.campaignId, auth.campaignId),
            eq(gameEvents.actionId, parsed.data.actionId),
          ),
        )
        .limit(1);
      let priorResponse: {
        deleted: boolean;
        cleanupPending?: boolean;
        contentId: string;
      } | null = null;
      if (prior) {
        const payload = prior.payload as {
          commandHash?: unknown;
          response?: unknown;
        } | null;
        if (
          prior.membershipId !== auth.membershipId ||
          prior.type !== "STORY_ATTACHMENT_DELETE_REQUESTED" ||
          payload?.commandHash !== commandHash ||
          !payload.response ||
          typeof payload.response !== "object"
        )
          return error(reply, 409, "ACTION_ID_CONFLICT");
        priorResponse = payload.response as {
          deleted: boolean;
          cleanupPending?: boolean;
          contentId: string;
        };
        if (priorResponse.deleted) return reply.code(200).send(priorResponse);
      }
      let storageKey: string | null = null;
      let result:
        "NOT_FOUND" | "IN_USE" | { sequence: number; completed?: true };
      try {
        result = await db.transaction(async (tx) => {
          const [upload] = await tx
            .select()
            .from(chatAttachmentUploads)
            .where(
              and(
                eq(chatAttachmentUploads.campaignId, auth.campaignId),
                eq(chatAttachmentUploads.contentId, contentId),
                eq(
                  chatAttachmentUploads.uploadedByMembershipId,
                  auth.membershipId,
                ),
              ),
            )
            .for("update")
            .limit(1);
          const [concurrentEvent] = await tx
            .select()
            .from(gameEvents)
            .where(
              and(
                eq(gameEvents.campaignId, auth.campaignId),
                eq(gameEvents.actionId, parsed.data.actionId),
              ),
            )
            .for("update")
            .limit(1);
          if (concurrentEvent) {
            const payload = concurrentEvent.payload as {
              commandHash?: unknown;
              response?: unknown;
            } | null;
            if (
              concurrentEvent.membershipId !== auth.membershipId ||
              concurrentEvent.type !== "STORY_ATTACHMENT_DELETE_REQUESTED" ||
              payload?.commandHash !== commandHash ||
              !payload.response ||
              typeof payload.response !== "object"
            )
              throw new Error("ACTION_ID_CONFLICT");
            const response = payload.response as {
              deleted: boolean;
              cleanupPending?: boolean;
              contentId: string;
            };
            if (response.deleted)
              return {
                sequence: concurrentEvent.sequence,
                completed: true as const,
              };
          }
          if (!upload) return "NOT_FOUND" as const;
          storageKey = upload.storageKey;
          const [storyUse] = await tx
            .select({ uses: count() })
            .from(storyPostMedia)
            .where(
              and(
                eq(storyPostMedia.campaignId, auth.campaignId),
                eq(storyPostMedia.contentId, contentId),
              ),
            );
          const [chatUse] = await tx
            .select({ uses: count() })
            .from(chatAttachments)
            .where(
              and(
                eq(chatAttachments.campaignId, auth.campaignId),
                eq(chatAttachments.contentId, contentId),
              ),
            );
          if (Number(storyUse?.uses ?? 0) || Number(chatUse?.uses ?? 0))
            return "IN_USE" as const;
          if (!concurrentEvent && upload.status !== "EXPIRED") {
            await tx
              .update(chatAttachmentUploads)
              .set({ status: "EXPIRED" })
              .where(eq(chatAttachmentUploads.id, upload.id));
          }
          if (concurrentEvent) return { sequence: concurrentEvent.sequence };
          const [event] = await tx
            .insert(gameEvents)
            .values({
              campaignId: auth.campaignId,
              actionId: parsed.data.actionId,
              membershipId: auth.membershipId,
              type: "STORY_ATTACHMENT_DELETE_REQUESTED",
              entityType: "STORY_ATTACHMENT",
              entityId: upload.id,
              payload: {
                contentId,
                commandHash,
                response: { deleted: false, cleanupPending: true, contentId },
              },
            })
            .returning({ sequence: gameEvents.sequence });
          if (!event) throw new Error("STORY_ATTACHMENT_AUDIT_FAILED");
          return { sequence: event.sequence };
        });
      } catch {
        const [concurrentEvent] = await db
          .select()
          .from(gameEvents)
          .where(
            and(
              eq(gameEvents.campaignId, auth.campaignId),
              eq(gameEvents.actionId, parsed.data.actionId),
            ),
          )
          .limit(1);
        if (concurrentEvent) {
          const payload = concurrentEvent.payload as {
            commandHash?: unknown;
            response?: unknown;
          } | null;
          if (
            concurrentEvent.membershipId !== auth.membershipId ||
            concurrentEvent.type !== "STORY_ATTACHMENT_DELETE_REQUESTED" ||
            payload?.commandHash !== commandHash
          )
            return error(reply, 409, "ACTION_ID_CONFLICT");
          const response = payload.response as {
            deleted: boolean;
            cleanupPending?: boolean;
            contentId: string;
          };
          if (response?.deleted) return reply.code(200).send(response);
          priorResponse = response;
          const [upload] = await db
            .select({ storageKey: chatAttachmentUploads.storageKey })
            .from(chatAttachmentUploads)
            .where(
              and(
                eq(chatAttachmentUploads.campaignId, auth.campaignId),
                eq(chatAttachmentUploads.contentId, contentId),
                eq(
                  chatAttachmentUploads.uploadedByMembershipId,
                  auth.membershipId,
                ),
                eq(chatAttachmentUploads.status, "EXPIRED"),
              ),
            )
            .limit(1);
          if (upload) {
            storageKey = upload.storageKey;
            result = { sequence: concurrentEvent.sequence };
          } else {
            return reply.code(202).send(priorResponse);
          }
        } else {
          return reply.code(500).send({ error: "ATTACHMENT_LIFECYCLE_FAILED" });
        }
      }
      if (typeof result === "object" && result.completed)
        return reply.code(200).send({ deleted: true, contentId });
      if (result === "NOT_FOUND")
        return error(reply, 404, "ATTACHMENT_NOT_FOUND");
      if (result === "IN_USE") return error(reply, 409, "ATTACHMENT_IN_USE");
      try {
        await removeStoredUpload(storageKey!);
        await db.transaction(async (tx) => {
          await tx
            .delete(chatAttachmentUploads)
            .where(
              and(
                eq(chatAttachmentUploads.campaignId, auth.campaignId),
                eq(chatAttachmentUploads.contentId, contentId),
                eq(
                  chatAttachmentUploads.uploadedByMembershipId,
                  auth.membershipId,
                ),
                eq(chatAttachmentUploads.status, "EXPIRED"),
              ),
            );
          await tx
            .update(gameEvents)
            .set({
              payload: {
                contentId,
                commandHash,
                response: { deleted: true, contentId },
              },
            })
            .where(eq(gameEvents.sequence, result.sequence));
        });
        return { deleted: true, contentId };
      } catch {
        return reply
          .code(202)
          .send({ deleted: false, cleanupPending: true, contentId });
      }
    },
  );
}
