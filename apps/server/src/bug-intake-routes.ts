import { readBugAttachment } from "./bug-intake-storage.js";
import { registerBugAlbumRoutes } from "./bug-intake-album-routes.js";
import { previewApprovedBug } from "./bug-intake-preview.js";
import { quarantineVariantPreview } from "./bug-intake-quarantine.js";
import { resolveBugQuarantine } from "./bug-intake-resolution.js";
import { recoverBugUploadReceipt } from "./bug-intake-upload-recovery.js";
import { readBugAlbumReview } from "./bug-intake-album-review.js";
import { previewApprovedBugAlbum } from "./bug-intake-album-preview.js";
import {
  approveBugAlbum,
  bugAlbumApprovalSchema,
} from "./bug-intake-album-commands.js";
import type { FastifyInstance } from "fastify";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import {
  bugIntakeMessages,
  bugIntakeVersions,
  bugIntakeFiles,
  bugIntakeUpdates,
  bugIntakeDeliveries,
} from "@arken/db";
import { bugQueueStateSchema, bugSourceMessageSchema } from "@arken/contracts";
import { requireOperator } from "./auth.js";
import { operatorFeedbackRateLimit } from "./operator-feedback.js";
import { applyBugReviewCommand } from "./bug-intake-commands.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const listSchema = z
  .object({
    state: bugQueueStateSchema.optional(),
    after: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();

/** Not registered until queue migration/configuration and UI are integrated.
 * No source ingestion or automatic outgoing transfer endpoint. */
export function registerBugIntakeRoutes(
  app: FastifyInstance,
  db: Database,
  storage: {
    root: string;
    maxBytes: number;
    assetOrigins?: ReadonlySet<string>;
  },
) {
  // Bound concurrent verified buffers per process, separately from request rate.
  let activeDownloads = 0;
  registerBugAlbumRoutes(app, db, storage.assetOrigins ?? new Set<string>());
  app.get(
    "/api/operator/bug-intake/:id/album-approved-preview",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      const result = await previewApprovedBugAlbum(db, params.data.id);
      return result.ok ? result : reply.code(409).send(result);
    },
  );
  app.post(
    "/api/operator/bug-intake/:id/album-approval",
    { ...operatorFeedbackRateLimit(), bodyLimit: 256 * 1024 },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      const body = bugAlbumApprovalSchema.safeParse(request.body);
      if (!params.success || !body.success)
        return reply.code(400).send({ error: "INVALID_ALBUM_APPROVAL" });
      try {
        const result = await approveBugAlbum(
          db,
          params.data.id,
          auth.membershipId,
          body.data,
        );
        return result.ok ? result : reply.code(409).send(result);
      } catch {
        return reply.code(500).send({ error: "ALBUM_APPROVAL_UNAVAILABLE" });
      }
    },
  );
  app.get(
    "/api/operator/bug-intake/:id/album-review",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      const result = await readBugAlbumReview(db, params.data.id);
      return result.ok ? result : reply.code(409).send(result);
    },
  );
  app.post(
    "/api/operator/bug-intake/:id/recover-upload",
    { ...operatorFeedbackRateLimit(), bodyLimit: 8192 },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      if (!storage.assetOrigins?.size)
        return reply.code(409).send({ error: "ASSET_RECOVERY_NOT_CONFIGURED" });
      try {
        const result = await recoverBugUploadReceipt(
          db,
          storage.assetOrigins,
          params.data.id,
          auth.membershipId,
          request.body,
        );
        return result.ok ? result : reply.code(409).send(result);
      } catch (error) {
        if (error instanceof z.ZodError)
          return reply.code(400).send({ error: "INVALID_RECOVERY_COMMAND" });
        return reply.code(500).send({ error: "RECOVERY_RESULT_UNKNOWN" });
      }
    },
  );
  app.get(
    "/api/operator/bug-intake/:id/deliveries/:deliveryId",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ id: z.string().uuid(), deliveryId: z.string().uuid() })
        .strict()
        .safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      const [delivery] = await db
        .select()
        .from(bugIntakeDeliveries)
        .where(
          and(
            eq(bugIntakeDeliveries.id, params.data.deliveryId),
            eq(bugIntakeDeliveries.messageId, params.data.id),
          ),
        );
      if (!delivery) return reply.code(404).send({ error: "NOT_FOUND" });
      const snapshot = z
        .object({
          title: z.string().max(200),
          description: z.string().max(50000),
          attachments: z
            .array(
              z.object({
                id: z.string().uuid(),
                sha256: z.string().regex(/^[0-9a-f]{64}$/),
                sizeBytes: z.number().int().positive(),
              }),
            )
            .max(20),
        })
        .safeParse(delivery.payload);
      if (!snapshot.success)
        return reply.code(409).send({ error: "INVALID_SNAPSHOT" });
      // Historical reviewed content, not the current source/review form. Never
      // spread payload/receipts: they may include private URLs or internal fields.
      return {
        id: delivery.id,
        revision: delivery.approvedRevision,
        uploadRecoveryAvailable: Boolean(storage.assetOrigins?.size),
        state: delivery.state,
        updatedAt: delivery.updatedAt,
        title: snapshot.data.title,
        description: snapshot.data.description,
        attachments: snapshot.data.attachments.map((file) => ({
          id: file.id,
          name: `bug-attachment-${file.id}.bin`,
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
          uploadRecorded:
            delivery.uploadReceipts[file.id]?.sha256 === file.sha256 &&
            delivery.uploadReceipts[file.id]?.sizeBytes === file.sizeBytes,
        })),
      };
    },
  );
  app.get(
    "/api/operator/bug-intake/:id/deliveries",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      const query = z
        .object({
          after: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(25),
        })
        .strict()
        .safeParse(request.query);
      if (!params.success || !query.success)
        return reply.code(400).send({ error: "INVALID_DELIVERY_QUERY" });
      const [message] = await db
        .select({ id: bugIntakeMessages.id })
        .from(bugIntakeMessages)
        .where(eq(bugIntakeMessages.id, params.data.id));
      if (!message) return reply.code(404).send({ error: "NOT_FOUND" });
      const rows = await db
        .select({
          id: bugIntakeDeliveries.id,
          approvedRevision: bugIntakeDeliveries.approvedRevision,
          state: bugIntakeDeliveries.state,
          linearIssueId: bugIntakeDeliveries.linearIssueId,
          failureCode: bugIntakeDeliveries.failureCode,
          createdAt: bugIntakeDeliveries.createdAt,
          updatedAt: bugIntakeDeliveries.updatedAt,
        })
        .from(bugIntakeDeliveries)
        .where(
          and(
            eq(bugIntakeDeliveries.messageId, params.data.id),
            query.data.after
              ? gt(bugIntakeDeliveries.id, query.data.after)
              : undefined,
          ),
        )
        .orderBy(asc(bugIntakeDeliveries.id))
        .limit(query.data.limit + 1);
      const more = rows.length > query.data.limit;
      const items = rows.slice(0, query.data.limit);
      // Identity-order pagination, not chronological order. No reviewed/raw text,
      // claim capabilities, private asset URLs, signed tickets or storage paths.
      return { items, nextCursor: more ? items[items.length - 1]!.id : null };
    },
  );
  app.post(
    "/api/operator/bug-intake-quarantine/:id/resolve",
    { ...operatorFeedbackRateLimit(), bodyLimit: 8192 },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      try {
        const result = await resolveBugQuarantine(
          db,
          params.data.id,
          auth.membershipId,
          request.body,
        );
        if (!result.ok)
          return reply
            .code(result.error === "NOT_FOUND" ? 404 : 409)
            .send(result);
        return result;
      } catch (error) {
        if (error instanceof z.ZodError)
          return reply.code(400).send({ error: "INVALID_COMMAND" });
        throw error;
      }
    },
  );
  app.get(
    "/api/operator/bug-intake-quarantine/:id",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      const [row] = await db
        .select()
        .from(bugIntakeUpdates)
        .where(
          and(
            eq(bugIntakeUpdates.id, params.data.id),
            eq(bugIntakeUpdates.state, "QUARANTINED"),
          ),
        );
      if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
      return {
        id: row.id,
        updatedAt: row.updatedAt,
        reason: row.reason,
        variants: [
          quarantineVariantPreview(row.payloadHash, row.payload),
          ...row.conflictingPayloads
            .slice(0, 8)
            .map((variant) =>
              quarantineVariantPreview(variant.hash, variant.payload),
            ),
        ],
      };
    },
  );
  app.get(
    "/api/operator/bug-intake-quarantine",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const query = z
        .object({
          after: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(25),
        })
        .strict()
        .safeParse(request.query);
      if (!query.success)
        return reply.code(400).send({ error: "INVALID_FILTERS" });
      const rows = await db
        .select({
          id: bugIntakeUpdates.id,
          reason: bugIntakeUpdates.reason,
          messageId: bugIntakeUpdates.messageId,
          createdAt: bugIntakeUpdates.createdAt,
        })
        .from(bugIntakeUpdates)
        .where(
          and(
            eq(bugIntakeUpdates.state, "QUARANTINED"),
            query.data.after
              ? gt(bugIntakeUpdates.id, query.data.after)
              : undefined,
          ),
        )
        .orderBy(asc(bugIntakeUpdates.id))
        .limit(query.data.limit + 1);
      const items = rows.slice(0, query.data.limit);
      return {
        items,
        nextCursor: rows.length > query.data.limit ? items.at(-1)!.id : null,
      };
    },
  );
  app.get(
    "/api/operator/bug-intake/:id/approved-preview",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      const result = await previewApprovedBug(db, params.data.id);
      if (!result.ok)
        return reply
          .code(result.error === "NOT_FOUND" ? 404 : 409)
          .send(result);
      return result;
    },
  );
  app.get(
    "/api/operator/bug-intake/:id/files/:fileId",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Security-Policy", "sandbox; default-src 'none'");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ id: z.string().uuid(), fileId: z.string().uuid() })
        .strict()
        .safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      // Resolve only a file from the message's CURRENT version. No arbitrary path,
      // historical file ID, Telegram URL or public media route is accepted.
      const [file] = await db
        .select({
          storageKey: bugIntakeFiles.storageKey,
          sha256: bugIntakeFiles.sha256,
          sizeBytes: bugIntakeFiles.sizeBytes,
        })
        .from(bugIntakeMessages)
        .innerJoin(
          bugIntakeVersions,
          and(
            eq(bugIntakeVersions.messageId, bugIntakeMessages.id),
            eq(bugIntakeVersions.sourceHash, bugIntakeMessages.sourceHash),
          ),
        )
        .innerJoin(
          bugIntakeFiles,
          eq(bugIntakeFiles.versionId, bugIntakeVersions.id),
        )
        .where(
          and(
            eq(bugIntakeMessages.id, params.data.id),
            eq(bugIntakeFiles.id, params.data.fileId),
            eq(bugIntakeFiles.state, "STORED"),
          ),
        );
      if (!file?.storageKey || !file.sha256 || file.sizeBytes === null)
        return reply.code(404).send({ error: "FILE_NOT_AVAILABLE" });
      if (activeDownloads >= 2)
        return reply.code(429).send({ error: "DOWNLOAD_BUSY" });
      activeDownloads += 1;
      let released = false;
      let reading = true;
      let responseEnded = false;
      const release = () => {
        if (!released && !reading && responseEnded) {
          released = true;
          activeDownloads -= 1;
        }
      };
      const endResponse = () => {
        responseEnded = true;
        release();
      };
      reply.raw.once("finish", endResponse);
      reply.raw.once("close", endResponse);
      try {
        const bytes = await readBugAttachment(
          storage.root,
          {
            storageKey: file.storageKey,
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
          },
          storage.maxBytes,
        );
        reading = false;
        if (reply.raw.destroyed) {
          endResponse();
          return;
        }
        reply.type("application/octet-stream");
        // Generated filename prevents header injection and executable original extensions.
        reply.header(
          "Content-Disposition",
          'attachment; filename="bug-attachment-' +
            params.data.fileId +
            '.bin"',
        );
        return reply.send(bytes);
      } catch {
        reading = false;
        endResponse();
        // Never leak local paths, source handles or filesystem exception messages.
        return reply.code(409).send({ error: "FILE_UNAVAILABLE_OR_CHANGED" });
      }
    },
  );
  app.get(
    "/api/operator/bug-intake",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const query = listSchema.safeParse(request.query);
      if (!query.success)
        return reply.code(400).send({ error: "INVALID_FILTERS" });
      const { state, after, limit } = query.data;
      const rows = await db
        .select({
          id: bugIntakeMessages.id,
          state: bugIntakeMessages.state,
          revision: bugIntakeMessages.revision,
          createdAt: bugIntakeMessages.createdAt,
          updatedAt: bugIntakeMessages.updatedAt,
          linearIssueId: bugIntakeMessages.linearIssueId,
        })
        .from(bugIntakeMessages)
        .where(
          and(
            state ? eq(bugIntakeMessages.state, state) : undefined,
            after ? gt(bugIntakeMessages.id, after) : undefined,
          ),
        )
        .orderBy(asc(bugIntakeMessages.id))
        .limit(limit + 1);
      const items = rows.slice(0, limit);
      return {
        items,
        nextCursor: rows.length > limit ? items.at(-1)!.id : null,
      };
    },
  );

  app.get(
    "/api/operator/bug-intake/:id",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      const detail = await db.transaction(async (tx) => {
        // Parent SHARE lock makes source and its file list a consistent review copy.
        const [row] = await tx
          .select()
          .from(bugIntakeMessages)
          .where(eq(bugIntakeMessages.id, params.data.id))
          .for("share");
        if (!row) return null;
        const source = bugSourceMessageSchema.parse(row.source);
        const [version] = await tx
          .select({ id: bugIntakeVersions.id })
          .from(bugIntakeVersions)
          .where(
            and(
              eq(bugIntakeVersions.messageId, row.id),
              eq(bugIntakeVersions.sourceHash, row.sourceHash),
            ),
          );
        if (!version) throw new Error("BUG_INTAKE_VERSION_MISSING");
        const files = await tx
          .select({
            id: bugIntakeFiles.id,
            name: bugIntakeFiles.name,
            state: bugIntakeFiles.state,
            sizeBytes: bugIntakeFiles.sizeBytes,
            failureCode: bugIntakeFiles.failureCode,
            exclusionReason: bugIntakeFiles.exclusionReason,
          })
          .from(bugIntakeFiles)
          .where(eq(bugIntakeFiles.versionId, version.id));
        const albumRows = row.albumId
          ? await tx
              .select({
                id: bugIntakeMessages.id,
                state: bugIntakeMessages.state,
              })
              .from(bugIntakeMessages)
              .where(
                and(
                  eq(bugIntakeMessages.provider, row.provider),
                  eq(bugIntakeMessages.chatId, row.chatId),
                  eq(bugIntakeMessages.albumId, row.albumId),
                ),
              )
              .orderBy(
                asc(bugIntakeMessages.createdAt),
                asc(bugIntakeMessages.id),
              )
              .limit(51)
          : [];
        // No storage paths, source file handles, internal chat IDs or raw approval JSON.
        return {
          id: row.id,
          revision: row.revision,
          state: row.state,
          originalText: source.originalText,
          authorLabel: source.authorLabel,
          sourceUrl: source.sourceUrl,
          albumId: source.albumId,
          albumItems: albumRows.slice(0, 50),
          albumTruncated: albumRows.length > 50,
          sourceRevisionAt: source.sourceRevisionAt,
          linearIssueId: row.linearIssueId,
          files,
        };
      });
      if (!detail) return reply.code(404).send({ error: "NOT_FOUND" });
      return detail;
    },
  );

  app.post(
    "/api/operator/bug-intake/:id/commands",
    { ...operatorFeedbackRateLimit(), bodyLimit: 256 * 1024 },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      try {
        const result = await applyBugReviewCommand(
          db,
          params.data.id,
          auth.membershipId,
          request.body,
        );
        if (!result.ok)
          return reply
            .code(result.error === "NOT_FOUND" ? 404 : 409)
            .send(result);
        return result;
      } catch (error) {
        if (error instanceof z.ZodError)
          return reply.code(400).send({ error: "INVALID_COMMAND" });
        throw error;
      }
    },
  );
}
