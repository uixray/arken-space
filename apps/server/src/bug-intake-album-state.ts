import { createHash } from "node:crypto";
import { z } from "zod";

const albumSnapshotSchema = z.object({
  provider: z.literal("TELEGRAM"),
  chatId: z.string().regex(/^-?[1-9][0-9]*$/),
  albumId: z.string().min(1).max(128),
  members: z.array(z.object({
    id: z.string().uuid(),
    messageId: z.string().regex(/^[1-9][0-9]*$/),
    revision: z.number().int().nonnegative(),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()).min(1).max(50),
}).strict();

/** Fingerprint of the observed membership, NOT a claim that Telegram finished
 * delivering the album. Late members and any source/file-review revision change
 * invalidate grouped consent. Caller must supply the complete bounded DB set,
 * never a truncated page. No runtime or database side effects.
 */
export function bugAlbumSnapshot(input: unknown) {
  const snapshot = albumSnapshotSchema.parse(input);
  if (new Set(snapshot.members.map((member) => member.id)).size !== snapshot.members.length ||
      new Set(snapshot.members.map((member) => member.messageId)).size !== snapshot.members.length)
    throw new Error("DUPLICATE_ALBUM_MEMBER");
  const members = [...snapshot.members].sort((a, b) =>
    BigInt(a.messageId) < BigInt(b.messageId) ? -1 : 1);
  const identity = JSON.stringify([snapshot.provider, snapshot.chatId, snapshot.albumId]);
  const fingerprint = createHash("sha256").update(JSON.stringify({ identity, members })).digest("hex");
  return { identity, fingerprint, members };
}
