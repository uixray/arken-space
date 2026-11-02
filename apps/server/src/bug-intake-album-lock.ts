import { and, eq, sql } from "drizzle-orm";
import { bugIntakeAlbums, bugIntakeMessages, bugIntakeAlbumDeliveries } from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Acquire before any member row lock. Group operations must use this same
 * identity even before the first group row exists. Caller owns validation. */
export async function lockBugAlbum(tx: Transaction,
  source: { provider: string; chatId: string; albumId: string | null }) {
  if (!source.albumId) return null;
  const identity = JSON.stringify([source.provider, source.chatId, source.albumId]);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"bug-album:" + identity}, 0))`);
  await tx.insert(bugIntakeAlbums).values({ provider: source.provider,
    chatId: source.chatId, albumId: source.albumId }).onConflictDoNothing();
  const [album] = await tx.select().from(bugIntakeAlbums).where(and(
    eq(bugIntakeAlbums.provider, source.provider), eq(bugIntakeAlbums.chatId, source.chatId),
    eq(bugIntakeAlbums.albumId, source.albumId),
  )).for("update");
  if (!album) throw new Error("BUG_ALBUM_MISSING");
  return album;
}

/** Membership identity is immutable once a canonical source exists. Lookup is
 * intentionally unlocked; call before subsequently locking the member row. */
export async function lockBugMessageAlbum(tx: Transaction, messageId: string) {
  const [message] = await tx.select({ provider: bugIntakeMessages.provider,
    chatId: bugIntakeMessages.chatId, albumId: bugIntakeMessages.albumId,
  }).from(bugIntakeMessages).where(eq(bugIntakeMessages.id, messageId));
  return message ? lockBugAlbum(tx, message) : null;
}

export async function invalidateBugAlbum(tx: Transaction, albumId: string) {
  // Source/file edits revoke pending delivery immediately, not only when a
  // future sender eventually attempts to claim the obsolete snapshot.
  await tx.update(bugIntakeAlbumDeliveries).set({ state: "CANCELLED", updatedAt: new Date() })
    .where(and(eq(bugIntakeAlbumDeliveries.albumId, albumId),
      eq(bugIntakeAlbumDeliveries.state, "QUEUED")));
  await tx.update(bugIntakeAlbums).set({ state: "REVIEW", approval: null,
    revision: sql`${bugIntakeAlbums.revision} + 1`, updatedAt: new Date(),
  }).where(eq(bugIntakeAlbums.id, albumId));
}

/** Caller holds the album lock. No timeout can make a claim safe to bypass. */
export async function bugAlbumDeliveryInFlight(tx: Transaction, albumId: string) {
  const [delivery] = await tx.select({ id: bugIntakeAlbumDeliveries.id })
    .from(bugIntakeAlbumDeliveries).where(and(
      eq(bugIntakeAlbumDeliveries.albumId, albumId),
      eq(bugIntakeAlbumDeliveries.state, "CLAIMED"))).limit(1);
  return Boolean(delivery);
}
