import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { bugIntakeMessages, bugIntakeVersions, bugIntakeFiles } from "@arken/db";
import { bugSourceMessageSchema } from "@arken/contracts";
import { lockBugMessageAlbum } from "./bug-intake-album-lock.js";
import { bugAlbumSnapshot } from "./bug-intake-album-state.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Internal grouped review snapshot. Group lock precedes member locks and is
 * held through current-version file reads. No source is approved or transmitted.
 */
export async function readBugAlbumReviewInTransaction(tx: Transaction, messageId: string) {
  z.string().uuid().parse(messageId);
  const album = await lockBugMessageAlbum(tx, messageId);
  if (!album) return { ok: false as const, error: "NOT_AN_ALBUM" };
  const members = await tx.select().from(bugIntakeMessages).where(and(
    eq(bugIntakeMessages.provider, album.provider),
    eq(bugIntakeMessages.chatId, album.chatId), eq(bugIntakeMessages.albumId, album.albumId),
  )).orderBy(asc(bugIntakeMessages.id)).limit(51).for("share");
  if (!members.length || members.length > 50)
    return { ok: false as const, error: "ALBUM_MEMBERSHIP_LIMIT" };
  const snapshot = bugAlbumSnapshot({ provider: album.provider, chatId: album.chatId,
    albumId: album.albumId, members: members.map((member) => ({ id: member.id,
      messageId: member.messageId, revision: member.revision, sourceHash: member.sourceHash })) });
  const parts = [];
  let textBytes = 0;
  for (const identity of snapshot.members) {
    const member = members.find((entry) => entry.id === identity.id)!;
    const source = bugSourceMessageSchema.parse(member.source);
    textBytes += Buffer.byteLength(source.originalText, "utf8");
    if (textBytes > 512 * 1024)
      return { ok: false as const, error: "ALBUM_TEXT_LIMIT" };
    const [version] = await tx.select({ id: bugIntakeVersions.id }).from(bugIntakeVersions)
      .where(and(eq(bugIntakeVersions.messageId, member.id),
        eq(bugIntakeVersions.sourceHash, member.sourceHash)));
    if (!version) return { ok: false as const, error: "ALBUM_VERSION_MISSING" };
    const files = await tx.select({ id: bugIntakeFiles.id, name: bugIntakeFiles.name,
      state: bugIntakeFiles.state, sha256: bugIntakeFiles.sha256,
      sizeBytes: bugIntakeFiles.sizeBytes, failureCode: bugIntakeFiles.failureCode,
      exclusionReason: bugIntakeFiles.exclusionReason,
    }).from(bugIntakeFiles).where(eq(bugIntakeFiles.versionId, version.id))
      .orderBy(asc(bugIntakeFiles.id)).limit(21);
    if (files.length > 20) return { ok: false as const, error: "ALBUM_FILE_LIMIT" };
    parts.push({ id: member.id, revision: member.revision, state: member.state,
      text: source.originalText, sourceUrl: source.sourceUrl, files });
  }
  return { ok: true as const, albumId: album.id, revision: album.revision,
    state: album.state, fingerprint: snapshot.fingerprint,
    linearIssueId: album.linearIssueId, parts };
}

export async function readBugAlbumReview(db: Database, messageId: string) {
  return db.transaction((tx) => readBugAlbumReviewInTransaction(tx, messageId));
}
