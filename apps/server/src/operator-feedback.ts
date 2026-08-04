import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, eq, gt, gte, lt, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  feedbackAttachments,
  feedbackOperatorAudits,
  feedbackReports,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { env } from "./env.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type FeedbackStatus = typeof feedbackReports.$inferSelect.status;

const idSchema = z.string().uuid();
const kindSchema = z.enum(["SUGGESTION", "BUG", "IDEA"]);
const statusSchema = z.enum([
  "NEW",
  "ACKNOWLEDGED",
  "LINKED",
  "RESOLVED",
  "DISMISSED",
]);
const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.string().max(512).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    kind: kindSchema.optional(),
    status: statusSchema.optional(),
    build: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
const detailQuerySchema = z
  .object({
    reveal: z.enum(["true", "false"]).optional(),
  })
  .strict();
const linearKeySchema = z.string().regex(/^UIX-[1-9]\d*$/);
const linearUrlSchema = z
  .string()
  .url()
  .max(500)
  .refine((url) => {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "linear.app";
  });
function linearUrlMatchesKey(url: string, key: string) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const issueIndex = parts.findIndex((part) => part.toLowerCase() === "issue");
  const slug = issueIndex >= 0 ? parts[issueIndex + 1] : undefined;
  return slug === key || slug?.startsWith(`${key}-`) === true;
}

const updateSchema = z
  .object({
    status: statusSchema,
    linearKey: linearKeySchema.optional(),
    linearUrl: linearUrlSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "LINKED") {
      if (!value.linearKey || !value.linearUrl)
        context.addIssue({ code: "custom", message: "LINK_REQUIRED" });
      else if (!linearUrlMatchesKey(value.linearUrl, value.linearKey))
        context.addIssue({ code: "custom", message: "LINEAR_LINK_MISMATCH" });
    } else if (value.linearKey || value.linearUrl) {
      context.addIssue({ code: "custom", message: "LINK_ONLY_FOR_LINKED" });
    }
  });

const transitions: Record<FeedbackStatus, readonly FeedbackStatus[]> = {
  NEW: ["ACKNOWLEDGED", "DISMISSED"],
  ACKNOWLEDGED: ["LINKED", "RESOLVED", "DISMISSED"],
  LINKED: ["RESOLVED", "DISMISSED"],
  RESOLVED: [],
  DISMISSED: [],
};

const safeAttachmentMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function operatorIds() {
  return new Set(
    env.OPERATOR_MEMBERSHIP_IDS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

async function requireOperator(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
) {
  const auth = await requireAuth(request, reply, db);
  if (!auth) return null;
  if (!operatorIds().has(auth.membershipId)) {
    await reply.code(403).send({ error: "OPERATOR_REQUIRED" });
    return null;
  }
  return auth;
}

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString(
    "base64url",
  );
}

function decodeCursor(value: string) {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error();
    const createdAt = z.coerce.date().parse(parsed[0]);
    const id = idSchema.parse(parsed[1]);
    return { createdAt, id };
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

const feedbackListColumns = {
  id: feedbackReports.id,
  kind: feedbackReports.kind,
  status: feedbackReports.status,
  buildVersion: feedbackReports.buildVersion,
  buildRevision: feedbackReports.buildRevision,
  linearKey: feedbackReports.linearKey,
  linearUrl: feedbackReports.linearUrl,
  createdAt: feedbackReports.createdAt,
  updatedAt: feedbackReports.updatedAt,
};
const feedbackExportColumns = {
  ...feedbackListColumns,
  title: feedbackReports.title,
  description: feedbackReports.description,
};
const feedbackDetailColumns = {
  ...feedbackExportColumns,
  contact: feedbackReports.contact,
  diagnostics: feedbackReports.diagnostics,
};
type FeedbackListRow = Pick<
  typeof feedbackReports.$inferSelect,
  keyof typeof feedbackListColumns
>;
type FeedbackExportRow = Pick<
  typeof feedbackReports.$inferSelect,
  keyof typeof feedbackExportColumns
>;

export function feedbackListProjection(row: FeedbackListRow) {
  return { ...row };
}

const sensitiveText =
  /(?:bearer\s+\S+|(?:token|cookie|authorization)\s*[:=]|private\s+chat|(?:[a-z]:\\|\/(?:home|users?|var|etc|srv|opt)\/)|https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?)/i;

export function redactOperatorText(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => (sensitiveText.test(line) ? "[REDACTED]" : line))
    .join("\n");
}

export function redactedFeedbackCopy(row: FeedbackExportRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: redactOperatorText(row.title),
    description: redactOperatorText(row.description),
    buildVersion: row.buildVersion,
    buildRevision: row.buildRevision,
    linearKey: row.linearKey,
    linearUrl: row.linearUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
async function audit(
  db: Database,
  request: FastifyRequest,
  reportId: string,
  operatorMembershipId: string,
  action: string,
) {
  const [row] = await db
    .insert(feedbackOperatorAudits)
    .values({ reportId, operatorMembershipId, action })
    .returning({ id: feedbackOperatorAudits.id });
  request.log.info(
    { auditId: row?.id, reportId, operatorMembershipId, action },
    "feedback.operator_action",
  );
}

export const operatorFeedbackRateLimit = () => ({
  config: {
    rateLimit: {
      max: env.OPERATOR_FEEDBACK_RATE_LIMIT_MAX,
      timeWindow: "1 minute",
    },
  },
});

export function registerOperatorFeedbackRoutes(
  app: FastifyInstance,
  db: Database,
) {
  app.get(
    "/api/operator/feedback/capability",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      return { allowed: true };
    },
  );

  app.get(
    "/api/operator/feedback",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      let query: z.infer<typeof listQuerySchema>;
      try {
        query = listQuerySchema.parse(request.query);
      } catch {
        return reply.code(400).send({ error: "INVALID_FILTERS" });
      }
      const filters: SQL[] = [];
      if (query.from) filters.push(gte(feedbackReports.createdAt, query.from));
      if (query.to) filters.push(lte(feedbackReports.createdAt, query.to));
      if (query.kind) filters.push(eq(feedbackReports.kind, query.kind));
      if (query.status) filters.push(eq(feedbackReports.status, query.status));
      if (query.build)
        filters.push(
          or(
            eq(feedbackReports.buildVersion, query.build),
            eq(feedbackReports.buildRevision, query.build),
          )!,
        );
      if (query.cursor) {
        let cursor: ReturnType<typeof decodeCursor>;
        try {
          cursor = decodeCursor(query.cursor);
        } catch {
          return reply.code(400).send({ error: "INVALID_CURSOR" });
        }
        filters.push(
          or(
            gt(feedbackReports.createdAt, cursor.createdAt),
            and(
              eq(feedbackReports.createdAt, cursor.createdAt),
              gt(feedbackReports.id, cursor.id),
            ),
          )!,
        );
      }
      const rows = await db
        .select(feedbackListColumns)
        .from(feedbackReports)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(feedbackReports.createdAt), asc(feedbackReports.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const items = rows.slice(0, query.limit);
      const last = items.at(-1);
      return {
        items: items.map(feedbackListProjection),
        nextCursor:
          hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    },
  );

  app.get(
    "/api/operator/feedback/:id",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = z.object({ id: idSchema }).safeParse(request.params);
      const query = detailQuerySchema.safeParse(request.query);
      const reveal = query.success && query.data.reveal === "true";
      if (!params.success || !query.success)
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      const [row] = await db
        .select(feedbackDetailColumns)
        .from(feedbackReports)
        .where(eq(feedbackReports.id, params.data.id))
        .limit(1);
      if (!row) return reply.code(404).send({ error: "FEEDBACK_NOT_FOUND" });
      const attachments = await db
        .select({
          id: feedbackAttachments.id,
          kind: feedbackAttachments.kind,
          mimeType: feedbackAttachments.mimeType,
          sizeBytes: feedbackAttachments.sizeBytes,
          width: feedbackAttachments.width,
          height: feedbackAttachments.height,
        })
        .from(feedbackAttachments)
        .where(eq(feedbackAttachments.reportId, row.id));
      await audit(
        db,
        request,
        row.id,
        auth.membershipId,
        reveal ? "DETAIL_REVEAL" : "DETAIL_VIEW",
      );
      return {
        ...redactedFeedbackCopy(row),
        attachments,
        ...(reveal
          ? { contact: row.contact, diagnostics: row.diagnostics }
          : {}),
      };
    },
  );

  app.get(
    "/api/operator/feedback/:id/export",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = z.object({ id: idSchema }).safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      const [row] = await db
        .select(feedbackExportColumns)
        .from(feedbackReports)
        .where(eq(feedbackReports.id, params.data.id))
        .limit(1);
      if (!row) return reply.code(404).send({ error: "FEEDBACK_NOT_FOUND" });
      await audit(db, request, row.id, auth.membershipId, "REDACTED_EXPORT");
      return redactedFeedbackCopy(row);
    },
  );

  app.get(
    "/api/operator/feedback/:id/attachments/:attachmentId",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ id: idSchema, attachmentId: idSchema })
        .safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      const [attachment] = await db
        .select({
          id: feedbackAttachments.id,
          reportId: feedbackAttachments.reportId,
          storageKey: feedbackAttachments.storageKey,
          mimeType: feedbackAttachments.mimeType,
        })
        .from(feedbackAttachments)
        .where(
          and(
            eq(feedbackAttachments.id, params.data.attachmentId),
            eq(feedbackAttachments.reportId, params.data.id),
          ),
        )
        .limit(1);
      if (!attachment)
        return reply.code(404).send({ error: "ATTACHMENT_NOT_FOUND" });
      if (!safeAttachmentMimeTypes.has(attachment.mimeType))
        return reply.code(415).send({ error: "ATTACHMENT_TYPE_NOT_ALLOWED" });
      if (basename(attachment.storageKey) !== attachment.storageKey)
        return reply.code(500).send({ error: "ATTACHMENT_UNAVAILABLE" });
      let bytes: Buffer;
      try {
        bytes = await readFile(resolve(env.MEDIA_ROOT, attachment.storageKey));
      } catch {
        return reply.code(404).send({ error: "ATTACHMENT_NOT_FOUND" });
      }
      await audit(
        db,
        request,
        params.data.id,
        auth.membershipId,
        "ATTACHMENT_VIEW",
      );
      return reply
        .type(attachment.mimeType)
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Disposition", "inline; filename=feedback-image")
        .send(bytes);
    },
  );

  app.patch(
    "/api/operator/feedback/:id",
    operatorFeedbackRateLimit(),
    async (request, reply) => {
      const auth = await requireOperator(request, reply, db);
      if (!auth) return;
      const params = z.object({ id: idSchema }).safeParse(request.params);
      const body = updateSchema.safeParse(request.body);
      if (!params.success || !body.success)
        return reply.code(400).send({ error: "INVALID_FEEDBACK_UPDATE" });
      const [current] = await db
        .select({
          id: feedbackReports.id,
          status: feedbackReports.status,
          linearKey: feedbackReports.linearKey,
          linearUrl: feedbackReports.linearUrl,
        })
        .from(feedbackReports)
        .where(eq(feedbackReports.id, params.data.id))
        .limit(1);
      if (!current)
        return reply.code(404).send({ error: "FEEDBACK_NOT_FOUND" });
      if (!transitions[current.status].includes(body.data.status))
        return reply.code(409).send({ error: "INVALID_STATUS_TRANSITION" });
      const [updated] = await db
        .update(feedbackReports)
        .set({
          status: body.data.status,
          linearKey:
            body.data.status === "LINKED"
              ? body.data.linearKey
              : current.linearKey,
          linearUrl:
            body.data.status === "LINKED"
              ? body.data.linearUrl
              : current.linearUrl,
          updatedAt: new Date(),
        })
        .where(eq(feedbackReports.id, current.id))
        .returning(feedbackExportColumns);
      await audit(
        db,
        request,
        current.id,
        auth.membershipId,
        `STATUS_${body.data.status}`,
      );
      return redactedFeedbackCopy(updated!);
    },
  );
}
