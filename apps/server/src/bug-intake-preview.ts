import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  bugIntakeMessages,
  bugIntakeVersions,
  bugIntakeFiles,
} from "@arken/db";
import {
  reviewedBugCopySchema,
  bugCopyAttachmentError,
  bugAttachmentStateSchema,
} from "@arken/contracts";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const approvalSchema = z
  .object({
    operatorId: z.string().uuid(),
    at: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    copy: reviewedBugCopySchema,
  })
  .strict();

/** Operator preview only, not an external-send claim. Re-read and claim the
 * revision transactionally before future delivery; this snapshot may go stale. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function previewApprovedBug(db: Database, id: string) {
  return db.transaction((tx) => previewApprovedBugInTransaction(tx, id));
}
export async function previewApprovedBugInTransaction(
  tx: Transaction,
  id: string,
) {
  z.string().uuid().parse(id);
  const [message] = await tx
    .select()
    .from(bugIntakeMessages)
    .where(eq(bugIntakeMessages.id, id))
    .for("share");
  if (!message) return { ok: false as const, error: "NOT_FOUND" };
  const approval = approvalSchema.safeParse(message.approval);
  if (
    message.state !== "APPROVED" ||
    !approval.success ||
    approval.data.revision !== message.revision
  )
    return { ok: false as const, error: "APPROVAL_REQUIRED" };
  const [version] = await tx
    .select({ id: bugIntakeVersions.id })
    .from(bugIntakeVersions)
    .where(
      and(
        eq(bugIntakeVersions.messageId, id),
        eq(bugIntakeVersions.sourceHash, message.sourceHash),
      ),
    );
  if (!version) throw new Error("BUG_INTAKE_VERSION_MISSING");
  const files = await tx
    .select({
      id: bugIntakeFiles.id,
      state: bugIntakeFiles.state,
      sizeBytes: bugIntakeFiles.sizeBytes,
      sha256: bugIntakeFiles.sha256,
    })
    .from(bugIntakeFiles)
    .where(eq(bugIntakeFiles.versionId, version.id));
  const error = bugCopyAttachmentError(
    approval.data.copy,
    files.map((file) => ({
      id: file.id,
      state: bugAttachmentStateSchema.parse(file.state),
    })),
  );
  if (error) return { ok: false as const, error };
  const selected = new Set(approval.data.copy.attachmentIds);
  // Allowlist only reviewed text and selected file metadata. Never automatically
  // append raw text, authors, source URLs, chat IDs or local storage paths.
  return {
    ok: true as const,
    messageId: id,
    revision: message.revision,
    title: approval.data.copy.title,
    description: approval.data.copy.description,
    attachments: files
      .filter((file) => selected.has(file.id))
      .map((file) => ({
        id: file.id,
        downloadName: `bug-attachment-${file.id}.bin`,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      })),
    existingLinearIssueId: message.linearIssueId,
  };
}
