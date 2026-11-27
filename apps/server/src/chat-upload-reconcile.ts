import { finishChatUploadLease } from "./chat-upload-lease.js";
import { eq, sql } from "drizzle-orm";
import { chatAttachmentUploads } from "@arken/db";
import { mediaRoot, removeStoredUpload } from "./storage.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
let lastWarning = 0;
/** Only keys newly allocated by chat staging. Never scan or delete other media.
 * A lost COMMIT acknowledgement is not proof of rollback: acquire the writer's
 * campaign fence and then read with a fresh READ COMMITTED statement snapshot. */
export async function reconcileChatUploadFile(
  db: Database,
  campaignId: string,
  storageKey: string,
): Promise<"REMOVED" | "REFERENCED" | "PENDING"> {
  try {
    const result = await db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '1000ms'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
        await tx.execute(
          sql`SELECT id FROM campaigns WHERE id=${campaignId} FOR UPDATE`,
        );
        const [reference] = await tx
          .select({ id: chatAttachmentUploads.id })
          .from(chatAttachmentUploads)
          .where(eq(chatAttachmentUploads.storageKey, storageKey))
          .limit(1);
        if (reference) return "REFERENCED" as const;
        await removeStoredUpload(storageKey);
        return "REMOVED" as const;
      },
      { isolationLevel: "read committed" },
    );
    await finishChatUploadFileLease(storageKey);
    return result;
  } catch {
    // Unknown database/filesystem state: preserve the file, not a fabricated cleanup.
    if (Date.now() - lastWarning > 60000) {
      lastWarning = Date.now();
      process.emitWarning("chat_upload.cleanup_pending", {
        code: "ARKEN_CHAT_UPLOAD_CLEANUP_PENDING",
      });
    }
    return "PENDING";
  }
}

/** Cleanup failure must never turn an already committed upload into a failed ACK.
 * The retained journal is retried by recovery. Legacy flat keys have no lease. */
export async function finishChatUploadFileLease(storageKey: string) {
  const match = /^chat-files\/([0-9a-f-]{36})\/content\.webp$/.exec(storageKey);
  if (!match) return;
  try { await finishChatUploadLease(mediaRoot(), match[1]!); }
  catch { process.emitWarning("chat_upload.lease_pending", { code: "ARKEN_CHAT_UPLOAD_LEASE_PENDING" }); }
}
