import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bugIntakeActions,
  bugIntakeAlbums,
  bugIntakeAlbumDeliveries,
} from "@arken/db";
import { lockBugMessageAlbum } from "./bug-intake-album-lock.js";
import { bugUploadsComplete } from "./bug-intake-upload-receipt.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const base = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    deliveryId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
    workerTerminationVerified: z.literal(true),
    evidence: z.string().trim().min(1).max(2000),
  })
  .strict();
export const bugAlbumRecoverySchema = z.discriminatedUnion("action", [
  base.extend({ action: z.literal("MARK_INTERRUPTED") }),
  base.extend({
    action: z.literal("CONFIRM_SENT"),
    linearIssueId: z.string().uuid(),
    externalContentVerified: z.literal(true),
  }),
  base.extend({
    action: z.literal("CONFIRM_NOT_SENT"),
    externalAbsenceVerified: z.literal(true),
  }),
]);

/** Operator evidence is mandatory. This never stops a process, checks Linear,
 * uploads, resends or assumes that elapsed time proves termination/absence. */
export async function reconcileBugAlbumDelivery(
  db: Database,
  messageId: string,
  operatorId: string,
  input: unknown,
) {
  z.string().uuid().parse(messageId);
  z.string().uuid().parse(operatorId);
  const command = bugAlbumRecoverySchema.parse(input);
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        domain: "ALBUM_RECOVERY",
        messageId,
        command,
      }),
    )
    .digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"bug-review-action:" + command.actionId}, 0))`,
    );
    const [prior] = await tx
      .select()
      .from(bugIntakeActions)
      .where(eq(bugIntakeActions.actionId, command.actionId));
    if (prior) {
      if (
        prior.operatorMembershipId !== operatorId ||
        prior.messageId !== messageId ||
        prior.requestHash !== requestHash
      )
        return { ok: false as const, error: "ACTION_CONFLICT" };
      return { ok: true as const, receipt: prior.receipt, duplicate: true };
    }
    const album = await lockBugMessageAlbum(tx, messageId);
    if (!album) return { ok: false as const, error: "NOT_AN_ALBUM" };
    if (album.revision !== command.revision)
      return { ok: false as const, error: "ALBUM_CHANGED" };
    const [delivery] = await tx
      .select()
      .from(bugIntakeAlbumDeliveries)
      .where(
        and(
          eq(bugIntakeAlbumDeliveries.id, command.deliveryId),
          eq(bugIntakeAlbumDeliveries.albumId, album.id),
        ),
      )
      .for("update");
    if (
      !delivery ||
      delivery.updatedAt.toISOString() !== command.expectedUpdatedAt ||
      delivery.state !==
        (command.action === "MARK_INTERRUPTED" ? "CLAIMED" : "UNKNOWN")
    )
      return { ok: false as const, error: "DELIVERY_CHANGED" };
    const mapped = z
      .string()
      .uuid()
      .nullable()
      .safeParse(delivery.payload.existingLinearIssueId);
    if (!mapped.success)
      return { ok: false as const, error: "INVALID_SNAPSHOT" };
    const now = new Date();
    let state: "UNKNOWN" | "SENT" | "CANCELLED";
    let revision = album.revision;
    if (command.action === "MARK_INTERRUPTED") {
      state = "UNKNOWN";
      await tx
        .update(bugIntakeAlbumDeliveries)
        .set({ state, failureCode: "RECEIPT_LOST", updatedAt: now })
        .where(eq(bugIntakeAlbumDeliveries.id, delivery.id));
    } else {
      if (command.action === "CONFIRM_SENT") {
        if (
          [album.linearIssueId, delivery.linearIssueId, mapped.data].some(
            (known) => known && known !== command.linearIssueId,
          )
        )
          return { ok: false as const, error: "ISSUE_MAPPING_CONFLICT" };
        if (!bugUploadsComplete(delivery.payload, delivery.uploadReceipts))
          return { ok: false as const, error: "UPLOAD_RECEIPTS_INCOMPLETE" };
        state = "SENT";
      } else {
        // A known newly-created issue contradicts an assertion of no external
        // result. For mapped edits the absence refers to this comment only.
        if ((delivery.linearIssueId || album.linearIssueId) && !mapped.data)
          return { ok: false as const, error: "KNOWN_EXTERNAL_RESULT" };
        state = "CANCELLED";
      }
      revision += 1;
      await tx
        .update(bugIntakeAlbumDeliveries)
        .set({
          state,
          ...(command.action === "CONFIRM_SENT"
            ? { linearIssueId: command.linearIssueId }
            : {}),
          failureCode:
            command.action === "CONFIRM_NOT_SENT"
              ? "OPERATOR_VERIFIED_NOT_SENT"
              : null,
          updatedAt: now,
        })
        .where(eq(bugIntakeAlbumDeliveries.id, delivery.id));
      await tx
        .update(bugIntakeAlbums)
        .set({
          revision,
          approval: null,
          updatedAt: now,
          state:
            command.action === "CONFIRM_SENT" &&
            album.revision === delivery.approvedRevision
              ? "LINKED"
              : "REVIEW",
          ...(command.action === "CONFIRM_SENT"
            ? { linearIssueId: command.linearIssueId }
            : {}),
        })
        .where(eq(bugIntakeAlbums.id, album.id));
    }
    const receipt = {
      albumId: album.id,
      revision,
      deliveryId: delivery.id,
      state,
      evidence: command.evidence,
      workerTerminationVerified: true,
      ...(command.action === "CONFIRM_SENT"
        ? {
            linearIssueId: command.linearIssueId,
            externalContentVerified: true,
          }
        : {}),
      ...(command.action === "CONFIRM_NOT_SENT"
        ? { externalAbsenceVerified: true }
        : {}),
    };
    await tx
      .insert(bugIntakeActions)
      .values({
        actionId: command.actionId,
        messageId,
        operatorMembershipId: operatorId,
        action: `ALBUM_${command.action}`,
        requestHash,
        resultingRevision: revision,
        receipt,
      });
    return { ok: true as const, receipt, duplicate: false };
  });
}
