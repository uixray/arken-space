import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { bugIntakeActions, bugIntakeAlbumDeliveries, bugIntakeAlbums, bugIntakeMessages } from "@arken/db";
import { lockBugAlbum, lockBugMessageAlbum } from "./bug-intake-album-lock.js";
import { previewApprovedBugAlbumInTransaction } from "./bug-intake-album-preview.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export const enqueueBugAlbumSchema = z.object({ actionId: z.string().uuid(),
  revision: z.number().int().nonnegative() }).strict();

/** Revoke group consent and cancel only unclaimed queues; preserve mapping. */
export async function reopenBugAlbum(db: Database, messageId: string, operatorId: string, input: unknown) {
  z.string().uuid().parse(messageId); z.string().uuid().parse(operatorId);
  const command = enqueueBugAlbumSchema.parse(input);
  const requestHash = createHash("sha256").update(JSON.stringify({ action: "REOPEN_ALBUM", messageId, command })).digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"bug-review-action:" + command.actionId}, 0))`);
    const [prior] = await tx.select().from(bugIntakeActions).where(eq(bugIntakeActions.actionId, command.actionId));
    if (prior) {
      if (prior.operatorMembershipId !== operatorId || prior.messageId !== messageId || prior.requestHash !== requestHash)
        return { ok: false as const, error: "ACTION_CONFLICT" };
      return { ok: true as const, receipt: prior.receipt, duplicate: true };
    }
    const album = await lockBugMessageAlbum(tx, messageId);
    if (!album || album.revision !== command.revision)
      return { ok: false as const, error: "ALBUM_CHANGED" };
    const [unresolved] = await tx.select({ id: bugIntakeAlbumDeliveries.id }).from(bugIntakeAlbumDeliveries)
      .where(and(eq(bugIntakeAlbumDeliveries.albumId, album.id),
        inArray(bugIntakeAlbumDeliveries.state, ["CLAIMED", "UNKNOWN"]))).limit(1);
    if (unresolved) return { ok: false as const, error: "DELIVERY_RECONCILIATION_REQUIRED" };
    const revision = album.revision + 1;
    const now = new Date();
    await tx.update(bugIntakeAlbumDeliveries).set({ state: "CANCELLED", updatedAt: now })
      .where(and(eq(bugIntakeAlbumDeliveries.albumId, album.id), eq(bugIntakeAlbumDeliveries.state, "QUEUED")));
    await tx.update(bugIntakeAlbums).set({ state: "REVIEW", approval: null, revision, updatedAt: now })
      .where(eq(bugIntakeAlbums.id, album.id));
    const receipt = { albumId: album.id, revision, state: "REVIEW" };
    await tx.insert(bugIntakeActions).values({ actionId: command.actionId, messageId,
      operatorMembershipId: operatorId, action: "REOPEN_ALBUM", requestHash, resultingRevision: revision, receipt });
    return { ok: true as const, receipt, duplicate: false };
  });
}

/** Explicit audited enqueue; approval alone never queues a transfer.
 * Identity and revision belong to the album, irrespective of the clicked part.
 * No transport/claim path is enabled by this operation. */
export async function enqueueBugAlbum(db: Database, messageId: string,
  operatorId: string, input: unknown) {
  z.string().uuid().parse(messageId); z.string().uuid().parse(operatorId);
  const command = enqueueBugAlbumSchema.parse(input);
  const requestHash = createHash("sha256").update(JSON.stringify({
    action: "ENQUEUE_ALBUM", messageId, command })).digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"bug-review-action:" + command.actionId}, 0))`);
    const [prior] = await tx.select().from(bugIntakeActions)
      .where(eq(bugIntakeActions.actionId, command.actionId));
    if (prior) {
      if (prior.operatorMembershipId !== operatorId || prior.messageId !== messageId || prior.requestHash !== requestHash)
        return { ok: false as const, error: "ACTION_CONFLICT" };
      return { ok: true as const, receipt: prior.receipt, duplicate: true };
    }
    const album = await lockBugMessageAlbum(tx, messageId);
    if (!album) return { ok: false as const, error: "NOT_AN_ALBUM" };
    const [existing] = await tx.select().from(bugIntakeAlbumDeliveries).where(and(
      eq(bugIntakeAlbumDeliveries.albumId, album.id),
      eq(bugIntakeAlbumDeliveries.approvedRevision, command.revision)));
    let receipt: { albumId: string; revision: number; deliveryId: string; state: string };
    if (existing) {
      // Return actual state; UNKNOWN/CANCELLED are never reset for retry.
      receipt = { albumId: album.id, revision: command.revision,
        deliveryId: existing.id, state: existing.state };
    } else {
      if (album.revision !== command.revision)
        return { ok: false as const, error: "ALBUM_CHANGED" };
      const [ambiguous] = await tx.select({ id: bugIntakeAlbumDeliveries.id })
        .from(bugIntakeAlbumDeliveries).where(and(
          eq(bugIntakeAlbumDeliveries.albumId, album.id),
          inArray(bugIntakeAlbumDeliveries.state, ["CLAIMED", "UNKNOWN"]))).limit(1);
      if (ambiguous) return { ok: false as const, error: "DELIVERY_RECONCILIATION_REQUIRED" };
      const preview = await previewApprovedBugAlbumInTransaction(tx, messageId);
      if (!preview.ok) return preview;
      const { ok: _ok, ...payload } = preview;
      const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      await tx.update(bugIntakeAlbumDeliveries).set({ state: "CANCELLED", updatedAt: new Date() })
        .where(and(eq(bugIntakeAlbumDeliveries.albumId, album.id),
          eq(bugIntakeAlbumDeliveries.state, "QUEUED")));
      const [delivery] = await tx.insert(bugIntakeAlbumDeliveries).values({
        albumId: album.id, approvedRevision: command.revision, payload, payloadHash,
      }).returning({ id: bugIntakeAlbumDeliveries.id, state: bugIntakeAlbumDeliveries.state });
      if (!delivery) throw new Error("ALBUM_ENQUEUE_FAILED");
      receipt = { albumId: album.id, revision: command.revision,
        deliveryId: delivery.id, state: delivery.state };
    }
    await tx.insert(bugIntakeActions).values({ actionId: command.actionId,
      messageId, operatorMembershipId: operatorId, action: "ENQUEUE_ALBUM",
      requestHash, resultingRevision: command.revision, receipt });
    return { ok: true as const, receipt, duplicate: Boolean(existing) };
  });
}

/** Internal one-shot claim, not wired to a worker. No claim expiry or replay.
 * Order: album identity/row -> member snapshot -> delivery row. */
export async function claimBugAlbumDelivery(db: Database, id: string, claimId: string) {
  z.string().uuid().parse(id); z.string().uuid().parse(claimId);
  return db.transaction(async (tx) => {
    const [lookup] = await tx.select({ provider: bugIntakeAlbums.provider,
      chatId: bugIntakeAlbums.chatId, albumId: bugIntakeAlbums.albumId,
    }).from(bugIntakeAlbumDeliveries).innerJoin(bugIntakeAlbums,
      eq(bugIntakeAlbums.id, bugIntakeAlbumDeliveries.albumId))
      .where(eq(bugIntakeAlbumDeliveries.id, id));
    if (!lookup) return { ok: false as const, error: "NOT_FOUND" };
    const album = await lockBugAlbum(tx, lookup);
    if (!album) return { ok: false as const, error: "NOT_FOUND" };
    const [delivery] = await tx.select().from(bugIntakeAlbumDeliveries)
      .where(eq(bugIntakeAlbumDeliveries.id, id)).for("update");
    if (!delivery || delivery.state !== "QUEUED")
      return { ok: false as const, error: "NOT_QUEUED" };
    const [ambiguous] = await tx.select({ id: bugIntakeAlbumDeliveries.id })
      .from(bugIntakeAlbumDeliveries).where(and(
        eq(bugIntakeAlbumDeliveries.albumId, album.id),
        inArray(bugIntakeAlbumDeliveries.state, ["CLAIMED", "UNKNOWN"]))).limit(1);
    if (ambiguous) return { ok: false as const, error: "DELIVERY_RECONCILIATION_REQUIRED" };
    const [anchor] = await tx.select({ id: bugIntakeMessages.id }).from(bugIntakeMessages)
      .where(and(eq(bugIntakeMessages.provider, album.provider),
        eq(bugIntakeMessages.chatId, album.chatId), eq(bugIntakeMessages.albumId, album.albumId)))
      .limit(1);
    const preview = anchor ? await previewApprovedBugAlbumInTransaction(tx, anchor.id) : null;
    if (!preview?.ok || album.revision !== delivery.approvedRevision) {
      await tx.update(bugIntakeAlbumDeliveries).set({ state: "CANCELLED", updatedAt: new Date() })
        .where(eq(bugIntakeAlbumDeliveries.id, id));
      return { ok: false as const, error: "ALBUM_CONSENT_CHANGED" };
    }
    const { ok: _ok, ...payload } = preview;
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    if (hash !== delivery.payloadHash)
      return { ok: false as const, error: "PAYLOAD_CHANGED" };
    await tx.update(bugIntakeAlbumDeliveries).set({ state: "CLAIMED", claimId, updatedAt: new Date() })
      .where(eq(bugIntakeAlbumDeliveries.id, id));
    return { ok: true as const, id, claimId, payload };
  });
}
