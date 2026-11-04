import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  bugIntakeDeliveries,
  bugIntakeFiles,
  bugIntakeVersions,
} from "@arken/db";
import { readBugAttachment } from "./bug-intake-storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const snapshotSchema = z.object({
  attachments: z
    .array(
      z.object({
        id: z.string().uuid(),
        downloadName: z.string(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        sizeBytes: z.number().int().positive(),
      }),
    )
    .max(20),
});

/** Internal adapter helper. Resolve bytes from the persisted claimed snapshot,
 * not an arbitrary path/file ID provided by a transport. No network or startup.
 * Caller must upload sequentially and release each buffer before reading another.
 */
export async function readClaimedBugAttachment(
  db: Database,
  storage: { root: string; maxBytes: number },
  deliveryId: string,
  claimId: string,
  fileId: string,
) {
  for (const id of [deliveryId, claimId, fileId]) z.string().uuid().parse(id);
  return db.transaction(async (tx) => {
    // SHARE blocks receipt transition during integrity reading. This helper
    // never takes a parent lock, so it cannot reverse parent->delivery ordering.
    const [delivery] = await tx
      .select()
      .from(bugIntakeDeliveries)
      .where(
        and(
          eq(bugIntakeDeliveries.id, deliveryId),
          eq(bugIntakeDeliveries.claimId, claimId),
          eq(bugIntakeDeliveries.state, "CLAIMED"),
        ),
      )
      .for("share");
    if (!delivery) throw new Error("BUG_DELIVERY_NOT_CLAIMED");
    const selected = snapshotSchema
      .parse(delivery.payload)
      .attachments.filter((file) => file.id === fileId);
    if (selected.length !== 1) throw new Error("BUG_FILE_NOT_APPROVED");
    const expected = selected[0]!;
    const [row] = await tx
      .select({ file: bugIntakeFiles })
      .from(bugIntakeFiles)
      .innerJoin(
        bugIntakeVersions,
        eq(bugIntakeFiles.versionId, bugIntakeVersions.id),
      )
      .where(
        and(
          eq(bugIntakeFiles.id, fileId),
          eq(bugIntakeVersions.messageId, delivery.messageId),
        ),
      );
    const file = row?.file;
    if (
      !file ||
      file.state !== "STORED" ||
      !file.storageKey ||
      file.sha256 !== expected.sha256 ||
      file.sizeBytes !== expected.sizeBytes
    )
      throw new Error("BUG_FILE_SNAPSHOT_MISMATCH");
    let bytes: Buffer;
    try {
      bytes = await readBugAttachment(
        storage.root,
        {
          storageKey: file.storageKey,
          sha256: expected.sha256,
          sizeBytes: expected.sizeBytes,
        },
        storage.maxBytes,
      );
    } catch {
      // Filesystem errors may expose private absolute paths.
      throw new Error("BUG_OUTGOING_FILE_UNAVAILABLE");
    }
    return {
      bytes,
      name: `bug-attachment-${fileId}.bin`,
      contentType: "application/octet-stream" as const,
      sha256: expected.sha256,
      sizeBytes: expected.sizeBytes,
    };
  });
}
