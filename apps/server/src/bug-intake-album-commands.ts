import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { bugIntakeActions, bugIntakeAlbums } from "@arken/db";
import { bugCopyAttachmentError, reviewedBugCopySchema } from "@arken/contracts";
import { readBugAlbumReviewInTransaction } from "./bug-intake-album-review.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export const bugAlbumApprovalSchema = z.object({
  actionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  copy: reviewedBugCopySchema,
}).strict();

/** Records consent for the entire observed album, not its anchor message.
 * Existing action audit anchors navigation only; receipt explicitly identifies
 * the group. No delivery is queued and no network operation is performed. */
export async function approveBugAlbum(db: Database, messageId: string,
  operatorId: string, input: unknown) {
  z.string().uuid().parse(messageId);
  z.string().uuid().parse(operatorId);
  const command = bugAlbumApprovalSchema.parse(input);
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ action: "APPROVE_ALBUM", messageId, command })).digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"bug-review-action:" + command.actionId}, 0))`);
    const [previous] = await tx.select().from(bugIntakeActions)
      .where(eq(bugIntakeActions.actionId, command.actionId));
    if (previous) {
      if (previous.operatorMembershipId !== operatorId || previous.messageId !== messageId ||
          previous.requestHash !== requestHash)
        return { ok: false as const, error: "ACTION_CONFLICT" };
      return { ok: true as const, receipt: previous.receipt, duplicate: true };
    }
    // The snapshot holds the group lock through all member/file reads and CAS.
    const album = await readBugAlbumReviewInTransaction(tx, messageId);
    if (!album.ok) return album;
    if (album.revision !== command.revision || album.fingerprint !== command.fingerprint)
      return { ok: false as const, error: "ALBUM_CHANGED" };
    if (album.state !== "REVIEW")
      return { ok: false as const, error: "INVALID_STATE" };
    const files = album.parts.flatMap((part) => part.files);
    // Parse DB state rather than casting untrusted persisted strings.
    const attachments = z.array(z.object({ id: z.string().uuid(),
      state: z.enum(["MISSING", "STORED", "FAILED", "EXCLUDED"]),
    })).parse(files);
    const error = bugCopyAttachmentError(command.copy, attachments);
    if (error) return { ok: false as const, error };
    if (files.some((file) => command.copy.attachmentIds.includes(file.id) &&
        (!file.sha256 || !/^[a-f0-9]{64}$/.test(file.sha256) ||
          file.sizeBytes === null || !Number.isSafeInteger(file.sizeBytes) ||
          file.sizeBytes <= 0 || file.sizeBytes > 100 * 1024 * 1024)))
      return { ok: false as const, error: "ATTACHMENT_INTEGRITY_MISSING" };
    const revision = album.revision + 1;
    const at = new Date();
    const approval = { operatorId, at: at.toISOString(), revision,
      fingerprint: album.fingerprint, copy: command.copy,
      members: album.parts.map((part) => ({ id: part.id, revision: part.revision })),
      attachments: files.filter((file) => command.copy.attachmentIds.includes(file.id))
        .map((file) => ({ id: file.id, sha256: file.sha256, sizeBytes: file.sizeBytes })),
    };
    await tx.update(bugIntakeAlbums).set({ state: "APPROVED", revision, approval,
      updatedAt: at }).where(eq(bugIntakeAlbums.id, album.albumId));
    const receipt = { albumId: album.albumId, revision, fingerprint: album.fingerprint,
      state: "APPROVED", deliveryQueued: false };
    await tx.insert(bugIntakeActions).values({ actionId: command.actionId,
      messageId, operatorMembershipId: operatorId, action: "APPROVE_ALBUM",
      requestHash, resultingRevision: revision, receipt });
    return { ok: true as const, receipt, duplicate: false };
  });
}
