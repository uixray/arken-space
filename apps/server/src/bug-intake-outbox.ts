import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { bugIntakeMessages, bugIntakeDeliveries } from "@arken/db";
import { previewApprovedBugInTransaction } from "./bug-intake-preview.js";
import { bugUploadsComplete } from "./bug-intake-upload-receipt.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Internal enqueue only. No external transfer. Current persisted approval is the
 * sole source of outgoing content; caller cannot supply replacement text/files. */
export async function enqueueApprovedBug(
  db: Database,
  id: string,
  revision: number,
) {
  z.string().uuid().parse(id);
  z.number().int().nonnegative().parse(revision);
  return db.transaction((tx) => enqueueApprovedBugInTransaction(tx, id, revision));
}

export async function enqueueApprovedBugInTransaction(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  id: string,
  revision: number,
) {
    const [message] = await tx
      .select()
      .from(bugIntakeMessages)
      .where(eq(bugIntakeMessages.id, id))
      .for("update");
    if (!message) return { ok: false as const, error: "NOT_FOUND" };
    const [existing] = await tx
      .select()
      .from(bugIntakeDeliveries)
      .where(
        and(
          eq(bugIntakeDeliveries.messageId, id),
          eq(bugIntakeDeliveries.approvedRevision, revision),
        ),
      );
    // Return the actual durable state, never turn UNKNOWN/CANCELLED into queued.
    if (existing)
      return {
        ok: true as const,
        id: existing.id,
        state: existing.state,
        duplicate: true,
      };
    if (message.revision !== revision)
      return { ok: false as const, error: "REVISION_CONFLICT" };
    const [ambiguous] = await tx
      .select({ id: bugIntakeDeliveries.id })
      .from(bugIntakeDeliveries)
      .where(
        and(
          eq(bugIntakeDeliveries.messageId, id),
          inArray(bugIntakeDeliveries.state, ["CLAIMED", "UNKNOWN"]),
        ),
      );
    if (ambiguous)
      return { ok: false as const, error: "DELIVERY_RECONCILIATION_REQUIRED" };
    const preview = await previewApprovedBugInTransaction(tx, id);
    if (!preview.ok) return preview;
    // Per-message consent cannot authorize all parts of an album. Keep grouped
    // delivery gated until its reviewed membership/snapshot protocol is implemented.
    if (message.albumId)
      return { ok: false as const, error: "ALBUM_REVIEW_REQUIRED" };
    const payload = {
      title: preview.title,
      description: preview.description,
      attachments: [...preview.attachments].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      existingLinearIssueId: preview.existingLinearIssueId,
    };
    if (
      payload.attachments.some(
        (file) => file.sha256 === null || file.sizeBytes === null,
      )
    )
      return { ok: false as const, error: "INVALID_FILE_METADATA" };
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    // Cancel old unclaimed revisions, retaining their immutable evidence.
    await tx
      .update(bugIntakeDeliveries)
      .set({ state: "CANCELLED", updatedAt: new Date() })
      .where(
        and(
          eq(bugIntakeDeliveries.messageId, id),
          eq(bugIntakeDeliveries.state, "QUEUED"),
        ),
      );
    const [delivery] = await tx
      .insert(bugIntakeDeliveries)
      .values({
        messageId: id,
        approvedRevision: revision,
        payload,
        payloadHash,
      })
      .returning({
        id: bugIntakeDeliveries.id,
        state: bugIntakeDeliveries.state,
      });
    if (!delivery) throw new Error("DELIVERY_ENQUEUE_FAILED");
    return { ok: true as const, ...delivery, duplicate: false };
}

/** Claim is durable and has no automatic expiry/replay. Crash after claim requires
 * reconciliation; a timeout is not evidence that Linear received nothing. */
export async function claimBugDelivery(
  db: Database,
  id: string,
  claimId: string,
) {
  z.string().uuid().parse(id);
  z.string().uuid().parse(claimId);
  return db.transaction(async (tx) => {
    const [lookup] = await tx
      .select({ messageId: bugIntakeDeliveries.messageId })
      .from(bugIntakeDeliveries)
      .where(eq(bugIntakeDeliveries.id, id));
    if (!lookup) return { ok: false as const, error: "NOT_FOUND" };
    const [message] = await tx
      .select()
      .from(bugIntakeMessages)
      .where(eq(bugIntakeMessages.id, lookup.messageId))
      .for("update");
    const [delivery] = await tx
      .select()
      .from(bugIntakeDeliveries)
      .where(eq(bugIntakeDeliveries.id, id))
      .for("update");
    if (!message || !delivery || delivery.state !== "QUEUED")
      return { ok: false as const, error: "NOT_QUEUED" };
    const [other] = await tx
      .select({ id: bugIntakeDeliveries.id })
      .from(bugIntakeDeliveries)
      .where(
        and(
          eq(bugIntakeDeliveries.messageId, message.id),
          inArray(bugIntakeDeliveries.state, ["CLAIMED", "UNKNOWN"]),
        ),
      );
    if (other)
      return { ok: false as const, error: "DELIVERY_RECONCILIATION_REQUIRED" };
    if (
      message.state !== "APPROVED" ||
      message.revision !== delivery.approvedRevision ||
      message.albumId
    ) {
      await tx
        .update(bugIntakeDeliveries)
        .set({ state: "CANCELLED", updatedAt: new Date() })
        .where(eq(bugIntakeDeliveries.id, id));
      return { ok: false as const, error: "CONSENT_CHANGED" };
    }
    const preview = await previewApprovedBugInTransaction(tx, message.id);
    if (!preview.ok) return preview;
    const payload = {
      title: preview.title,
      description: preview.description,
      attachments: [...preview.attachments].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      existingLinearIssueId: preview.existingLinearIssueId,
    };
    const hash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    if (hash !== delivery.payloadHash)
      return { ok: false as const, error: "PAYLOAD_CHANGED" };
    await tx
      .update(bugIntakeDeliveries)
      .set({ state: "CLAIMED", claimId, updatedAt: new Date() })
      .where(eq(bugIntakeDeliveries.id, id));
    return { ok: true as const, id, claimId, payload };
  });
}

export const deliveryOutcomeSchema = z.discriminatedUnion("state", [
  z
    .object({ state: z.literal("SENT"), linearIssueId: z.string().uuid() })
    .strict(),
  z
    .object({
      state: z.literal("UNKNOWN"),
      linearIssueId: z.string().uuid().optional(),
      failureCode: z.enum([
        "TIMEOUT",
        "NETWORK_ERROR",
        "EXTERNAL_RESULT_UNKNOWN",
        "RECEIPT_LOST",
      ]),
    })
    .strict(),
]);

/** Trusted worker receipt only, not a public endpoint. SENT means all selected
 * attachments and reviewed text were delivered, not merely issueCreate success.
 * UNKNOWN never queues a new send; external reconciliation is separate. */
export async function recordBugDeliveryOutcome(
  db: Database,
  id: string,
  claimId: string,
  input: unknown,
) {
  z.string().uuid().parse(id);
  z.string().uuid().parse(claimId);
  const outcome = deliveryOutcomeSchema.parse(input);
  return db.transaction(async (tx) => {
    const [lookup] = await tx
      .select({ messageId: bugIntakeDeliveries.messageId })
      .from(bugIntakeDeliveries)
      .where(eq(bugIntakeDeliveries.id, id));
    if (!lookup) return { ok: false as const, error: "NOT_FOUND" };
    const [message] = await tx
      .select()
      .from(bugIntakeMessages)
      .where(eq(bugIntakeMessages.id, lookup.messageId))
      .for("update");
    const [delivery] = await tx
      .select()
      .from(bugIntakeDeliveries)
      .where(eq(bugIntakeDeliveries.id, id))
      .for("update");
    if (!message || !delivery || delivery.claimId !== claimId)
      return { ok: false as const, error: "CLAIM_MISMATCH" };
    if (delivery.state === "SENT") {
      if (
        outcome.state !== "SENT" ||
        outcome.linearIssueId !== delivery.linearIssueId
      )
        return { ok: false as const, error: "RECEIPT_CONFLICT" };
      return { ok: true as const, duplicate: true, state: "SENT" as const };
    }
    if (delivery.state === "UNKNOWN") {
      // Even a late successful response must use explicit reconciliation, so a
      // background retry cannot silently rewrite an operator-visible ambiguity.
      if (
        outcome.state === "UNKNOWN" &&
        outcome.failureCode === delivery.failureCode &&
        (outcome.linearIssueId ?? null) === delivery.linearIssueId
      )
        return {
          ok: true as const,
          duplicate: true,
          state: "UNKNOWN" as const,
        };
      return { ok: false as const, error: "RECONCILIATION_REQUIRED" };
    }
    if (delivery.state !== "CLAIMED")
      return { ok: false as const, error: "NOT_CLAIMED" };
    if (outcome.state === "SENT" &&
        !bugUploadsComplete(delivery.payload, delivery.uploadReceipts))
      return { ok: false as const, error: "UPLOAD_RECEIPTS_INCOMPLETE" };
    if (
      outcome.state === "SENT" &&
      message.linearIssueId &&
      message.linearIssueId !== outcome.linearIssueId
    )
      return { ok: false as const, error: "ISSUE_MAPPING_CONFLICT" };
    await tx
      .update(bugIntakeDeliveries)
      .set({
        state: outcome.state,
        linearIssueId: outcome.linearIssueId ?? null,
        failureCode: outcome.state === "UNKNOWN" ? outcome.failureCode : null,
        updatedAt: new Date(),
      })
      .where(eq(bugIntakeDeliveries.id, id));
    if (outcome.state === "SENT") {
      if (
        message.revision !== delivery.approvedRevision ||
        message.state !== "APPROVED"
      )
        throw new Error("DELIVERY_CONSENT_INVARIANT_FAILED");
      await tx
        .update(bugIntakeMessages)
        .set({
          linearIssueId: outcome.linearIssueId,
          state: "LINKED",
          approval: null,
          revision: message.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(bugIntakeMessages.id, message.id));
    }
    return { ok: true as const, duplicate: false, state: outcome.state };
  });
}

