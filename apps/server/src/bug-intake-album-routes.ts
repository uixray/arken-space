import type { FastifyInstance } from "fastify";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import {
  bugIntakeAlbums,
  bugIntakeMessages,
  bugIntakeAlbumDeliveries,
} from "@arken/db";
import { requireOperator } from "./auth.js";
import { operatorFeedbackRateLimit } from "./operator-feedback.js";
import {
  enqueueBugAlbum,
  enqueueBugAlbumSchema,
  reopenBugAlbum,
} from "./bug-intake-album-outbox.js";
import {
  reconcileBugAlbumDelivery,
  bugAlbumRecoverySchema,
} from "./bug-intake-album-recovery.js";
import {
  recoverBugAlbumUploadReceipt,
  albumUploadRecoverySchema,
} from "./bug-intake-album-upload-recovery.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/** Called only inside the disabled-by-default operator queue registration.
 * Queue/reconciliation only: none of these endpoints starts a sender. */
export function registerBugAlbumRoutes(
  app: FastifyInstance,
  db: Database,
  origins: ReadonlySet<string>,
) {
  const commands = [
    {
      path: "album-reopen",
      schema: enqueueBugAlbumSchema,
      run: (id: string, actor: string, body: unknown) =>
        reopenBugAlbum(db, id, actor, body),
    },
    {
      path: "album-enqueue",
      schema: enqueueBugAlbumSchema,
      run: (id: string, actor: string, body: unknown) =>
        enqueueBugAlbum(db, id, actor, body),
    },
    {
      path: "album-reconcile",
      schema: bugAlbumRecoverySchema,
      run: (id: string, actor: string, body: unknown) =>
        reconcileBugAlbumDelivery(db, id, actor, body),
    },
    {
      path: "album-recover-upload",
      schema: albumUploadRecoverySchema,
      run: (id: string, actor: string, body: unknown) =>
        recoverBugAlbumUploadReceipt(db, origins, id, actor, body),
    },
  ];
  app.get(
    "/api/operator/bug-intake/:id/album-deliveries/:deliveryId",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema
        .extend({ deliveryId: z.string().uuid() })
        .safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      const [row] = await db
        .select({ delivery: bugIntakeAlbumDeliveries })
        .from(bugIntakeMessages)
        .innerJoin(
          bugIntakeAlbums,
          and(
            eq(bugIntakeMessages.provider, bugIntakeAlbums.provider),
            eq(bugIntakeMessages.chatId, bugIntakeAlbums.chatId),
            eq(bugIntakeMessages.albumId, bugIntakeAlbums.albumId),
          ),
        )
        .innerJoin(
          bugIntakeAlbumDeliveries,
          eq(bugIntakeAlbumDeliveries.albumId, bugIntakeAlbums.id),
        )
        .where(
          and(
            eq(bugIntakeMessages.id, params.data.id),
            eq(bugIntakeAlbumDeliveries.id, params.data.deliveryId),
          ),
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
      const delivery = row.delivery;
      const snapshot = z
        .object({
          title: z.string().max(200),
          description: z.string().max(50000),
          attachments: z
            .array(
              z.object({
                id: z.string().uuid(),
                sha256: z.string().regex(/^[a-f0-9]{64}$/),
                sizeBytes: z
                  .number()
                  .int()
                  .positive()
                  .max(100 * 1024 * 1024),
              }),
            )
            .max(20),
        })
        .safeParse(delivery.payload);
      if (!snapshot.success)
        return reply.code(409).send({ error: "INVALID_SNAPSHOT" });
      return {
        id: delivery.id,
        revision: delivery.approvedRevision,
        state: delivery.state,
        updatedAt: delivery.updatedAt,
        title: snapshot.data.title,
        description: snapshot.data.description,
        uploadRecoveryAvailable: origins.size > 0,
        attachments: snapshot.data.attachments.map((file) => {
          const receipt = delivery.uploadReceipts[file.id];
          return {
            ...file,
            name: `bug-attachment-${file.id}.bin`,
            uploadRecorded: Boolean(
              receipt &&
              receipt.sha256 === file.sha256 &&
              receipt.sizeBytes === file.sizeBytes,
            ),
          };
        }),
      };
    },
  );
  for (const command of commands) {
    app.post(
      `/api/operator/bug-intake/:id/${command.path}`,
      { ...operatorFeedbackRateLimit(), bodyLimit: 8192 },
      async (request, reply) => {
        reply.header("Cache-Control", "private, no-store");
        const auth = await requireOperator(request, reply, db);
        if (!auth) return;
        const params = paramsSchema.safeParse(request.params);
        const body = command.schema.safeParse(request.body);
        if (!params.success || !body.success)
          return reply.code(400).send({ error: "INVALID_ALBUM_COMMAND" });
        if (command.path === "album-recover-upload" && !origins.size)
          return reply
            .code(409)
            .send({ error: "ASSET_RECOVERY_NOT_CONFIGURED" });
        try {
          const result = await command.run(
            params.data.id,
            auth.membershipId,
            body.data,
          );
          return result.ok ? result : reply.code(409).send(result);
        } catch {
          return reply.code(500).send({ error: "ALBUM_COMMAND_UNAVAILABLE" });
        }
      },
    );
  }
  app.get(
    "/api/operator/bug-intake/:id/album-deliveries",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      const query = z
        .object({ after: z.string().uuid().optional() })
        .strict()
        .safeParse(request.query);
      if (!params.success || !query.success)
        return reply.code(400).send({ error: "INVALID_QUERY" });
      const [album] = await db
        .select({ id: bugIntakeAlbums.id, revision: bugIntakeAlbums.revision })
        .from(bugIntakeMessages)
        .innerJoin(
          bugIntakeAlbums,
          and(
            eq(bugIntakeMessages.provider, bugIntakeAlbums.provider),
            eq(bugIntakeMessages.chatId, bugIntakeAlbums.chatId),
            eq(bugIntakeMessages.albumId, bugIntakeAlbums.albumId),
          ),
        )
        .where(eq(bugIntakeMessages.id, params.data.id))
        .limit(1);
      if (!album) return reply.code(404).send({ error: "NOT_AN_ALBUM" });
      const rows = await db
        .select({
          id: bugIntakeAlbumDeliveries.id,
          approvedRevision: bugIntakeAlbumDeliveries.approvedRevision,
          state: bugIntakeAlbumDeliveries.state,
          linearIssueId: bugIntakeAlbumDeliveries.linearIssueId,
          failureCode: bugIntakeAlbumDeliveries.failureCode,
          createdAt: bugIntakeAlbumDeliveries.createdAt,
          updatedAt: bugIntakeAlbumDeliveries.updatedAt,
        })
        .from(bugIntakeAlbumDeliveries)
        .where(
          and(
            eq(bugIntakeAlbumDeliveries.albumId, album.id),
            ...(query.data.after
              ? [gt(bugIntakeAlbumDeliveries.id, query.data.after)]
              : []),
          ),
        )
        .orderBy(asc(bugIntakeAlbumDeliveries.id))
        .limit(26);
      const items = rows.slice(0, 25);
      return {
        albumId: album.id,
        revision: album.revision,
        items,
        nextCursor: rows.length > 25 ? items[items.length - 1]!.id : null,
        uploadRecoveryAvailable: origins.size > 0,
      };
    },
  );
}
