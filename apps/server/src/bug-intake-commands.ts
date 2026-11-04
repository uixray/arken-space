import { createHash } from "node:crypto";
import { bugDeliveryInFlight } from "./bug-intake-delivery-lock.js";
import { enqueueApprovedBugInTransaction } from "./bug-intake-outbox.js";
import { bugUploadsComplete } from "./bug-intake-upload-receipt.js";
import {
  lockBugMessageAlbum,
  invalidateBugAlbum,
  bugAlbumDeliveryInFlight,
} from "./bug-intake-album-lock.js";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bugIntakeMessages,
  bugIntakeVersions,
  bugIntakeFiles,
  bugIntakeActions,
  bugIntakeDeliveries,
} from "@arken/db";
import {
  approveBugCopySchema,
  bugQueueCommandSchema,
  bugQueueStateSchema,
  bugAttachmentStateSchema,
} from "@arken/contracts";
import {
  approveBugReview,
  dismissBugReview,
  invalidateBugReview,
  type BugReviewRecord,
} from "./bug-intake-review.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const commandSchema = z.discriminatedUnion("action", [
  approveBugCopySchema.extend({ action: z.literal("APPROVE") }),
  bugQueueCommandSchema.extend({ action: z.literal("DISMISS") }),
  bugQueueCommandSchema.extend({ action: z.literal("REOPEN") }),
  bugQueueCommandSchema.extend({ action: z.literal("ENQUEUE") }),
  bugQueueCommandSchema.extend({
    action: z.literal("CONFIRM_DELIVERY_NOT_SENT"),
    deliveryId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
    workerTerminationVerified: z.literal(true),
    externalAbsenceVerified: z.literal(true),
    evidence: z.string().trim().min(1).max(2000),
  }),
  bugQueueCommandSchema.extend({
    action: z.literal("CONFIRM_DELIVERY_SENT"),
    deliveryId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
    linearIssueId: z.string().uuid(),
    workerTerminationVerified: z.literal(true),
    externalContentVerified: z.literal(true),
    evidence: z.string().trim().min(1).max(2000),
  }),
  bugQueueCommandSchema.extend({
    action: z.literal("MARK_INTERRUPTED_DELIVERY_UNKNOWN"),
    deliveryId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
    workerTerminationVerified: z.literal(true),
    evidence: z.string().trim().min(1).max(2000),
  }),
  bugQueueCommandSchema.extend({
    action: z.literal("RETRY_FILE"),
    fileId: z.string().uuid(),
  }),
  bugQueueCommandSchema.extend({
    action: z.literal("EXCLUDE_FILE"),
    fileId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
  }),
]);

/** Internal service; routes must requireOperator before invoking, including retries.
 * Approval only records consent. No external issue or attachment is transmitted. */
export async function applyBugReviewCommand(
  db: Database,
  messageId: string,
  operatorId: string,
  input: unknown,
) {
  z.string().uuid().parse(messageId);
  z.string().uuid().parse(operatorId);
  const command = commandSchema.parse(input);
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ messageId, command }))
    .digest("hex");
  return db.transaction(async (tx) => {
    // Same action ID reused across different queue items must serialize as well.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"bug-review-action:" + command.actionId}, 0))`,
    );
    const [previous] = await tx
      .select()
      .from(bugIntakeActions)
      .where(eq(bugIntakeActions.actionId, command.actionId));
    if (previous) {
      if (
        previous.operatorMembershipId !== operatorId ||
        previous.messageId !== messageId ||
        previous.requestHash !== requestHash
      )
        return { ok: false as const, error: "ACTION_CONFLICT" };
      // Return original receipt, not a newer state disguised as original success.
      return { ok: true as const, receipt: previous.receipt, duplicate: true };
    }
    const album = await lockBugMessageAlbum(tx, messageId);
    if (album && (await bugAlbumDeliveryInFlight(tx, album.id)))
      return { ok: false as const, error: "ALBUM_DELIVERY_IN_FLIGHT" };
    const [message] = await tx
      .select()
      .from(bugIntakeMessages)
      .where(eq(bugIntakeMessages.id, messageId))
      .for("update");
    if (!message) return { ok: false as const, error: "NOT_FOUND" };
    if (command.action === "MARK_INTERRUPTED_DELIVERY_UNKNOWN") {
      if (message.revision !== command.revision)
        return { ok: false as const, error: "REVISION_CONFLICT" };
      const [delivery] = await tx
        .select()
        .from(bugIntakeDeliveries)
        .where(
          and(
            eq(bugIntakeDeliveries.id, command.deliveryId),
            eq(bugIntakeDeliveries.messageId, messageId),
          ),
        )
        .for("update");
      if (
        !delivery ||
        delivery.state !== "CLAIMED" ||
        delivery.updatedAt.toISOString() !== command.expectedUpdatedAt
      )
        return { ok: false as const, error: "DELIVERY_CHANGED" };
      // Operator must inspect authoritative worker/process state, not elapsed
      // time. This only acknowledges ambiguity; it does NOT authorize resend.
      await tx
        .update(bugIntakeDeliveries)
        .set({
          state: "UNKNOWN",
          failureCode: "RECEIPT_LOST",
          updatedAt: new Date(),
        })
        .where(eq(bugIntakeDeliveries.id, delivery.id));
      const receipt = {
        messageId,
        revision: message.revision,
        state: message.state,
        deliveryId: delivery.id,
        deliveryState: "UNKNOWN",
        workerTerminationVerified: true,
        evidence: command.evidence,
      };
      await tx.insert(bugIntakeActions).values({
        actionId: command.actionId,
        messageId,
        operatorMembershipId: operatorId,
        action: command.action,
        requestHash,
        resultingRevision: message.revision,
        receipt,
      });
      return { ok: true as const, receipt, duplicate: false };
    }
    if (await bugDeliveryInFlight(tx, messageId))
      return { ok: false as const, error: "DELIVERY_IN_FLIGHT" };
    if (message.revision !== command.revision)
      return { ok: false as const, error: "REVISION_CONFLICT" };
    if (command.action === "CONFIRM_DELIVERY_SENT") {
      const [delivery] = await tx
        .select()
        .from(bugIntakeDeliveries)
        .where(
          and(
            eq(bugIntakeDeliveries.id, command.deliveryId),
            eq(bugIntakeDeliveries.messageId, messageId),
          ),
        )
        .for("update");
      if (
        !delivery ||
        delivery.state !== "UNKNOWN" ||
        delivery.updatedAt.toISOString() !== command.expectedUpdatedAt
      )
        return { ok: false as const, error: "DELIVERY_CHANGED" };
      if (
        (message.linearIssueId &&
          message.linearIssueId !== command.linearIssueId) ||
        (delivery.linearIssueId &&
          delivery.linearIssueId !== command.linearIssueId)
      )
        return { ok: false as const, error: "ISSUE_MAPPING_CONFLICT" };
      if (!bugUploadsComplete(delivery.payload, delivery.uploadReceipts))
        return { ok: false as const, error: "UPLOAD_RECEIPTS_INCOMPLETE" };
      const sameRevision =
        message.revision === delivery.approvedRevision &&
        message.state === "APPROVED";
      const state = sameRevision
        ? "LINKED"
        : message.state === "APPROVED"
          ? "REVIEW"
          : message.state;
      // Confirm only the historical snapshot. A newer source/edit must not be
      // declared delivered, and stale consent must not create a second issue.
      await tx
        .update(bugIntakeDeliveries)
        .set({
          state: "SENT",
          linearIssueId: command.linearIssueId,
          failureCode: null,
          updatedAt: new Date(),
        })
        .where(eq(bugIntakeDeliveries.id, delivery.id));
      await tx
        .update(bugIntakeMessages)
        .set({
          state,
          linearIssueId: command.linearIssueId,
          approval: null,
          revision: message.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(bugIntakeMessages.id, messageId));
      const receipt = {
        messageId,
        revision: message.revision + 1,
        state,
        deliveryId: delivery.id,
        deliveryState: "SENT",
        linearIssueId: command.linearIssueId,
        workerTerminationVerified: true,
        externalContentVerified: true,
        evidence: command.evidence,
      };
      await tx.insert(bugIntakeActions).values({
        actionId: command.actionId,
        messageId,
        operatorMembershipId: operatorId,
        action: command.action,
        requestHash,
        resultingRevision: message.revision + 1,
        receipt,
      });
      return { ok: true as const, receipt, duplicate: false };
    }
    if (command.action === "CONFIRM_DELIVERY_NOT_SENT") {
      const [delivery] = await tx
        .select()
        .from(bugIntakeDeliveries)
        .where(
          and(
            eq(bugIntakeDeliveries.id, command.deliveryId),
            eq(bugIntakeDeliveries.messageId, messageId),
          ),
        )
        .for("update");
      if (
        !delivery ||
        delivery.state !== "UNKNOWN" ||
        delivery.updatedAt.toISOString() !== command.expectedUpdatedAt
      )
        return { ok: false as const, error: "DELIVERY_CHANGED" };
      const snapshot = z
        .object({ existingLinearIssueId: z.string().uuid().nullable() })
        .safeParse(delivery.payload);
      if (!snapshot.success)
        return { ok: false as const, error: "INVALID_SNAPSHOT" };
      // A known newly created issue contradicts 'not sent'. For mapped edits,
      // operator verifies absence of this comment, not absence of the whole issue.
      if (
        delivery.linearIssueId &&
        delivery.linearIssueId !== snapshot.data.existingLinearIssueId
      )
        return { ok: false as const, error: "KNOWN_EXTERNAL_RESULT" };
      await tx
        .update(bugIntakeDeliveries)
        .set({
          state: "CANCELLED",
          failureCode: "OPERATOR_VERIFIED_NOT_SENT",
          updatedAt: new Date(),
        })
        .where(eq(bugIntakeDeliveries.id, delivery.id));
      await tx
        .update(bugIntakeMessages)
        .set({
          state: "REVIEW",
          approval: null,
          revision: message.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(bugIntakeMessages.id, messageId));
      const receipt = {
        messageId,
        revision: message.revision + 1,
        state: "REVIEW",
        deliveryId: delivery.id,
        deliveryState: "CANCELLED",
        workerTerminationVerified: true,
        externalAbsenceVerified: true,
        evidence: command.evidence,
      };
      await tx.insert(bugIntakeActions).values({
        actionId: command.actionId,
        messageId,
        operatorMembershipId: operatorId,
        action: command.action,
        requestHash,
        resultingRevision: message.revision + 1,
        receipt,
      });
      return { ok: true as const, receipt, duplicate: false };
    }
    if (command.action === "ENQUEUE") {
      const queued = await enqueueApprovedBugInTransaction(
        tx,
        messageId,
        command.revision,
      );
      if (!queued.ok) return queued;
      const receipt = {
        messageId,
        revision: message.revision,
        state: message.state,
        deliveryId: queued.id,
        deliveryState: queued.state,
      };
      await tx.insert(bugIntakeActions).values({
        actionId: command.actionId,
        messageId,
        operatorMembershipId: operatorId,
        action: command.action,
        requestHash,
        resultingRevision: message.revision,
        receipt,
      });
      return { ok: true as const, receipt, duplicate: false };
    }
    const [version] = await tx
      .select({ id: bugIntakeVersions.id })
      .from(bugIntakeVersions)
      .where(
        and(
          eq(bugIntakeVersions.messageId, messageId),
          eq(bugIntakeVersions.sourceHash, message.sourceHash),
        ),
      );
    if (!version) throw new Error("BUG_INTAKE_VERSION_MISSING");
    const files = await tx
      .select({ id: bugIntakeFiles.id, state: bugIntakeFiles.state })
      .from(bugIntakeFiles)
      .where(eq(bugIntakeFiles.versionId, version.id));
    // File writers MUST lock parent message before mutating files, then bump its
    // revision/revoke approval. This shared order prevents approve/download races.
    const current: BugReviewRecord = {
      revision: message.revision,
      state: bugQueueStateSchema.parse(message.state),
      attachments: files.map((file) => ({
        id: file.id,
        state: bugAttachmentStateSchema.parse(file.state),
      })),
      approval: null, // transitions do not consume old approval JSON
      linearIssueId: message.linearIssueId,
    };
    if (command.action === "RETRY_FILE") {
      const file = current.attachments.find(
        (item) => item.id === command.fileId,
      );
      if (!file) return { ok: false as const, error: "UNKNOWN_ATTACHMENT" };
      if (current.state !== "REVIEW" || file.state !== "FAILED")
        return { ok: false as const, error: "INVALID_STATE" };
      await tx
        .update(bugIntakeFiles)
        .set({ state: "MISSING", failureCode: null, updatedAt: new Date() })
        .where(
          and(
            eq(bugIntakeFiles.id, file.id),
            eq(bugIntakeFiles.versionId, version.id),
          ),
        );
      file.state = "MISSING";
    }
    if (command.action === "EXCLUDE_FILE") {
      const file = current.attachments.find(
        (item) => item.id === command.fileId,
      );
      if (!file) return { ok: false as const, error: "UNKNOWN_ATTACHMENT" };
      await tx
        .update(bugIntakeFiles)
        .set({
          state: "EXCLUDED",
          exclusionReason: command.reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(bugIntakeFiles.id, command.fileId),
            eq(bugIntakeFiles.versionId, version.id),
          ),
        );
      // Retain original file bytes/history. Exclusion is a review decision, not deletion.
      file.state = "EXCLUDED";
    }
    const next =
      command.action === "APPROVE"
        ? approveBugReview(
            current,
            command.revision,
            command.copy,
            operatorId,
            new Date().toISOString(),
          )
        : command.action === "EXCLUDE_FILE" ||
            command.action === "RETRY_FILE" ||
            command.action === "REOPEN"
          ? invalidateBugReview(current, command.revision, current.attachments)
          : dismissBugReview(current, command.revision);
    if (!next.ok) return next;
    const [updated] = await tx
      .update(bugIntakeMessages)
      .set({
        revision: next.record.revision,
        state: next.record.state,
        approval: next.record.approval,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bugIntakeMessages.id, messageId),
          eq(bugIntakeMessages.revision, command.revision),
        ),
      )
      .returning({ id: bugIntakeMessages.id });
    if (!updated) throw new Error("BUG_INTAKE_CAS_FAILED");
    if (album) await invalidateBugAlbum(tx, album.id);
    const receipt = {
      messageId,
      revision: next.record.revision,
      state: next.record.state,
      ...(command.action === "EXCLUDE_FILE"
        ? { fileId: command.fileId, reason: command.reason }
        : {}),
    };
    await tx.insert(bugIntakeActions).values({
      actionId: command.actionId,
      messageId,
      operatorMembershipId: operatorId,
      action: command.action,
      requestHash,
      resultingRevision: next.record.revision,
      receipt,
    });
    return { ok: true as const, receipt, duplicate: false };
  });
}
