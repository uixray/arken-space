import { createChatUploadLease, chatLeaseStorageKey, writeChatUploadLease } from "./chat-upload-lease.js";
import { finishChatUploadFileLease } from "./chat-upload-reconcile.js";
import { reconcileChatUploadFile } from "./chat-upload-reconcile.js";
import { publicUploadError } from "./telemetry.js";
import { sum, sql } from "drizzle-orm";
import { assets, feedbackAttachments, chatAttachmentUploads } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { env } from "./env.js";
import {
  assertStorageCapacity,
  prepareUpload,
  mediaRoot,
  type StoredUpload,
} from "./storage.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
/** Shared staging for bounded HTTP and authenticated direct-channel uploads.
 * The caller owns transport framing; storage validates actual image bytes. */
export async function stageChatAttachment(
  db: Database,
  auth: AuthContext,
  buffer: Buffer,
  fileName: string,
  onStored?: (key: string) => void,
) {
  if (!buffer.length) throw Error("UPLOAD_REQUIRED");
  if (buffer.length > env.MAX_IMAGE_BYTES) throw Error("IMAGE_TOO_LARGE");
  let stored: StoredUpload | undefined;
  try {
    const result = await db.transaction(async (transaction) => {
      const db = transaction as unknown as Database;
      await db.execute(
        sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`,
      );
      const [assetUsage, feedbackUsage, chatUsage] = await Promise.all([
        db.select({ used: sum(assets.sizeBytes) }).from(assets),
        db
          .select({ used: sum(feedbackAttachments.sizeBytes) })
          .from(feedbackAttachments),
        db
          .select({ used: sum(chatAttachmentUploads.sizeBytes) })
          .from(chatAttachmentUploads),
      ]);
      const usedBytes =
        Number(assetUsage[0]?.used ?? 0) +
        Number(feedbackUsage[0]?.used ?? 0) +
        Number(chatUsage[0]?.used ?? 0);
      await assertStorageCapacity(usedBytes, buffer.length);
      let prepared: Awaited<ReturnType<typeof prepareUpload>>;
      try {
        prepared = await prepareUpload(buffer, "image");
      } catch (error) {
        if (
          publicUploadError(error) !== "UPLOAD_FAILED" ||
          (error && typeof error === "object" && "code" in error)
        )
          throw error;
        throw Error("INVALID_IMAGE");
      }
      const lease = await createChatUploadLease(mediaRoot(), auth.campaignId);
      stored = { ...prepared.upload, storageKey: chatLeaseStorageKey(lease.id) };
      onStored?.(stored.storageKey);
      await writeChatUploadLease(mediaRoot(), lease, prepared.bytes);
      const [upload] = await db
        .insert(chatAttachmentUploads)
        .values({
          campaignId: auth.campaignId,
          uploadedByMembershipId: auth.membershipId,
          fileName: fileName.slice(0, 255),
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          width: stored.width,
          height: stored.height,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .returning();
      if (!upload) throw new Error("UPLOAD_FAILED");
      return {
        contentId: upload.contentId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        width: upload.width,
        height: upload.height,
        createdAt: upload.createdAt.toISOString(),
      };
    });
    if (stored && !onStored) await finishChatUploadFileLease(stored.storageKey);
    return result;
  } catch (error) {
    // An outer peer transaction owns reconciliation until its outcome is known.
    if (stored && !onStored)
      await reconcileChatUploadFile(db, auth.campaignId, stored.storageKey);
    throw error;
  }
}
