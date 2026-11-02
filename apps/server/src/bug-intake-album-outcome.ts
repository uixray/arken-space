import { eq } from "drizzle-orm";
import { z } from "zod";
import { bugIntakeAlbums, bugIntakeAlbumDeliveries } from "@arken/db";
import { lockBugAlbum } from "./bug-intake-album-lock.js";
import { deliveryOutcomeSchema } from "./bug-intake-outbox.js";
import { bugUploadsComplete } from "./bug-intake-upload-receipt.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Trusted one-shot sender result, not a user endpoint. Group mapping belongs
 * to the stable album, so late parts cannot create an independent issue.
 * Lost/ambiguous responses require operator reconciliation, never resend. */
export async function recordBugAlbumDeliveryOutcome(db: Database, id: string,
  claimId: string, input: unknown) {
  z.string().uuid().parse(id); z.string().uuid().parse(claimId);
  const outcome = deliveryOutcomeSchema.parse(input);
  return db.transaction(async (tx) => {
    const [identity] = await tx.select({ provider: bugIntakeAlbums.provider,
      chatId: bugIntakeAlbums.chatId, albumId: bugIntakeAlbums.albumId,
    }).from(bugIntakeAlbumDeliveries).innerJoin(bugIntakeAlbums,
      eq(bugIntakeAlbums.id, bugIntakeAlbumDeliveries.albumId))
      .where(eq(bugIntakeAlbumDeliveries.id, id));
    if (!identity) return { ok: false as const, error: "NOT_FOUND" };
    const album = await lockBugAlbum(tx, identity);
    const [delivery] = await tx.select().from(bugIntakeAlbumDeliveries)
      .where(eq(bugIntakeAlbumDeliveries.id, id)).for("update");
    if (!album || !delivery || delivery.claimId !== claimId)
      return { ok: false as const, error: "CLAIM_MISMATCH" };
    if (delivery.state === "SENT") {
      if (outcome.state !== "SENT" || outcome.linearIssueId !== delivery.linearIssueId)
        return { ok: false as const, error: "RECEIPT_CONFLICT" };
      return { ok: true as const, state: "SENT" as const, duplicate: true };
    }
    if (delivery.state === "UNKNOWN") {
      if (outcome.state === "UNKNOWN" && outcome.failureCode === delivery.failureCode &&
          (outcome.linearIssueId ?? null) === delivery.linearIssueId)
        return { ok: true as const, state: "UNKNOWN" as const, duplicate: true };
      return { ok: false as const, error: "RECONCILIATION_REQUIRED" };
    }
    if (delivery.state !== "CLAIMED")
      return { ok: false as const, error: "NOT_CLAIMED" };
    const mapped = z.string().uuid().nullable().safeParse(delivery.payload.existingLinearIssueId);
    if (!mapped.success) return { ok: false as const, error: "INVALID_SNAPSHOT" };
    if ((album.linearIssueId && mapped.data && album.linearIssueId !== mapped.data) ||
        (outcome.linearIssueId && [album.linearIssueId, mapped.data, delivery.linearIssueId]
          .some((known) => known && known !== outcome.linearIssueId)))
      return { ok: false as const, error: "ISSUE_MAPPING_CONFLICT" };
    if (outcome.state === "SENT") {
      if (!bugUploadsComplete(delivery.payload, delivery.uploadReceipts))
        return { ok: false as const, error: "UPLOAD_RECEIPTS_INCOMPLETE" };
      if (album.state !== "APPROVED" || album.revision !== delivery.approvedRevision)
        return { ok: false as const, error: "ALBUM_CONSENT_CHANGED" };
    }
    const now = new Date();
    await tx.update(bugIntakeAlbumDeliveries).set({ state: outcome.state,
      linearIssueId: outcome.linearIssueId ?? null,
      failureCode: outcome.state === "UNKNOWN" ? outcome.failureCode : null,
      updatedAt: now }).where(eq(bugIntakeAlbumDeliveries.id, id));
    if (outcome.state === "SENT") {
      await tx.update(bugIntakeAlbums).set({ state: "LINKED", approval: null,
        linearIssueId: outcome.linearIssueId, revision: album.revision + 1, updatedAt: now,
      }).where(eq(bugIntakeAlbums.id, album.id));
    } else if (outcome.linearIssueId) {
      // Preserve partial external identity even when delivery remains ambiguous.
      // Consent is not renewed and UNKNOWN still blocks every subsequent enqueue.
      await tx.update(bugIntakeAlbums).set({ linearIssueId: outcome.linearIssueId,
        updatedAt: now }).where(eq(bugIntakeAlbums.id, album.id));
    }
    return { ok: true as const, state: outcome.state, duplicate: false };
  });
}
