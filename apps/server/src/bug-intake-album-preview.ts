import { eq } from "drizzle-orm";
import { z } from "zod";
import { bugIntakeAlbums } from "@arken/db";
import { bugAttachmentStateSchema, bugCopyAttachmentError, reviewedBugCopySchema } from "@arken/contracts";
import { readBugAlbumReviewInTransaction } from "./bug-intake-album-review.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const approvalSchema = z.object({
  operatorId: z.string().uuid(), at: z.string().datetime(),
  revision: z.number().int().nonnegative(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  copy: reviewedBugCopySchema,
  members: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative() }).strict()).min(1).max(50),
  attachments: z.array(z.object({ id: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
  }).strict()).max(20),
}).strict();

/** Shared by preview and future enqueue/claim. Group lock stays held throughout.
 * Caller receives only reviewed outgoing fields, never source text or handles. */
export async function previewApprovedBugAlbumInTransaction(tx: Transaction, messageId: string) {
  const current = await readBugAlbumReviewInTransaction(tx, messageId);
  if (!current.ok) return current;
  const [row] = await tx.select({ approval: bugIntakeAlbums.approval })
    .from(bugIntakeAlbums).where(eq(bugIntakeAlbums.id, current.albumId));
  const parsed = approvalSchema.safeParse(row?.approval);
  if (current.state !== "APPROVED" || !parsed.success)
    return { ok: false as const, error: "ALBUM_APPROVAL_REQUIRED" };
  const approval = parsed.data;
  if (approval.revision !== current.revision || approval.fingerprint !== current.fingerprint ||
      approval.members.length !== current.parts.length ||
      new Set(approval.members.map((part) => part.id)).size !== approval.members.length ||
      approval.members.some((part) => !current.parts.some((entry) =>
        entry.id === part.id && entry.revision === part.revision)))
    return { ok: false as const, error: "ALBUM_CONSENT_CHANGED" };
  const files = current.parts.flatMap((part) => part.files);
  const error = bugCopyAttachmentError(approval.copy, files.map((file) => ({
    id: file.id, state: bugAttachmentStateSchema.parse(file.state),
  })));
  if (error) return { ok: false as const, error };
  const selected = new Set(approval.copy.attachmentIds);
  if (approval.attachments.length !== selected.size ||
      new Set(approval.attachments.map((file) => file.id)).size !== selected.size ||
      approval.attachments.some((file) => !selected.has(file.id) || !files.some((entry) =>
        entry.id === file.id && entry.sha256 === file.sha256 && entry.sizeBytes === file.sizeBytes)))
    return { ok: false as const, error: "ALBUM_ATTACHMENT_CHANGED" };
  const mapping = z.string().uuid().nullable().safeParse(current.linearIssueId);
  if (!mapping.success) return { ok: false as const, error: "INVALID_ISSUE_MAPPING" };
  return { ok: true as const, albumId: current.albumId, revision: current.revision,
    fingerprint: current.fingerprint, title: approval.copy.title,
    description: approval.copy.description,
    attachments: [...approval.attachments].sort((a, b) => a.id.localeCompare(b.id))
      .map((file) => ({ ...file, downloadName: `bug-attachment-${file.id}.bin` })),
    existingLinearIssueId: mapping.data };
}

export async function previewApprovedBugAlbum(db: Database, messageId: string) {
  return db.transaction((tx) => previewApprovedBugAlbumInTransaction(tx, messageId));
}
