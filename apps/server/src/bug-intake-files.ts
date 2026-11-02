import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  bugIntakeMessages,
  bugIntakeVersions,
  bugIntakeFiles,
} from "@arken/db";
import { readBugAttachment } from "./bug-intake-storage.js";
import { lockBugMessageAlbum, invalidateBugAlbum, bugAlbumDeliveryInFlight } from "./bug-intake-album-lock.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const targetSchema = z
  .object({
    messageId: z.string().uuid(),
    fileId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const storedSchema = z
  .object({
    storageKey: z.string().regex(/^[0-9a-f-]{36}\.blob$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    mimeType: z.literal("application/octet-stream"),
  })
  .strict();
const failureSchema = z.enum([
  "DOWNLOAD_FAILED",
  "TOO_LARGE",
  "EMPTY",
  "INTEGRITY_FAILED",
  "STORAGE_FAILED",
]);

/** Internal worker seam, never accepts arbitrary client paths or remote URLs.
 * Verify completed bytes before marking STORED. Caller authenticates source and
 * owns the trusted private root. No file deletion on ambiguous DB outcome. */
export async function completeBugAttachment(
  db: Database,
  targetInput: unknown,
  root: string,
  storedInput: unknown,
  maxBytes: number,
) {
  const target = targetSchema.parse(targetInput);
  const stored = storedSchema.parse(storedInput);
  // Bounded integrity check; no source MIME execution or image decoding.
  await readBugAttachment(root, stored, maxBytes);
  return transitionFile(db, target, { state: "STORED", ...stored });
}

/** Error codes only, never HTTP URLs containing tokens, source text or stack traces. */
export async function failBugAttachment(
  db: Database,
  targetInput: unknown,
  failure: unknown,
) {
  const target = targetSchema.parse(targetInput);
  return transitionFile(db, target, {
    state: "FAILED",
    failureCode: failureSchema.parse(failure),
  });
}

type Target = z.infer<typeof targetSchema>;
type Result =
  | ({ state: "STORED" } & z.infer<typeof storedSchema>)
  | { state: "FAILED"; failureCode: z.infer<typeof failureSchema> };
async function transitionFile(db: Database, target: Target, result: Result) {
  return db.transaction(async (tx) => {
    const album = await lockBugMessageAlbum(tx, target.messageId);
    const [message] = await tx
      .select()
      .from(bugIntakeMessages)
      .where(eq(bugIntakeMessages.id, target.messageId))
      .for("update");
    if (!message) return { ok: false as const, error: "NOT_FOUND" };
    const [version] = await tx
      .select({ id: bugIntakeVersions.id })
      .from(bugIntakeVersions)
      .where(
        and(
          eq(bugIntakeVersions.messageId, message.id),
          eq(bugIntakeVersions.sourceHash, message.sourceHash),
        ),
      );
    if (!version) throw new Error("BUG_INTAKE_VERSION_MISSING");
    const [file] = await tx
      .select()
      .from(bugIntakeFiles)
      .where(
        and(
          eq(bugIntakeFiles.id, target.fileId),
          eq(bugIntakeFiles.versionId, version.id),
        ),
      );
    if (!file) return { ok: false as const, error: "STALE_FILE" };
    // Exact completed retry is harmless, even after another file advanced revision.
    if (
      result.state === "STORED" &&
      file.state === "STORED" &&
      file.storageKey === result.storageKey &&
      file.sha256 === result.sha256 &&
      file.sizeBytes === result.sizeBytes
    )
      return { ok: true as const, duplicate: true, revision: message.revision };
    if (message.revision !== target.revision)
      return { ok: false as const, error: "REVISION_CONFLICT" };
    if (album && await bugAlbumDeliveryInFlight(tx, album.id))
      return { ok: false as const, error: "ALBUM_DELIVERY_IN_FLIGHT" };
    // Do not revive an operator-excluded file or overwrite already accepted bytes.
    if (file.state !== "MISSING" && file.state !== "FAILED")
      return { ok: false as const, error: "INVALID_FILE_STATE" };
    if (message.state !== "REVIEW")
      return { ok: false as const, error: "INVALID_STATE" };
    await tx
      .update(bugIntakeFiles)
      .set({
        ...result,
        failureCode: result.state === "FAILED" ? result.failureCode : null,
        exclusionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(bugIntakeFiles.id, file.id));
    await tx
      .update(bugIntakeMessages)
      .set({
        revision: message.revision + 1,
        approval: null,
        state: "REVIEW",
        updatedAt: new Date(),
      })
      .where(eq(bugIntakeMessages.id, message.id));
    if (album) await invalidateBugAlbum(tx, album.id);
    return {
      ok: true as const,
      duplicate: false,
      revision: message.revision + 1,
    };
  });
}
