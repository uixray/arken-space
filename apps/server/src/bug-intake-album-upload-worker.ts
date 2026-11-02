import { readClaimedBugAlbumAttachment } from "./bug-intake-album-outgoing-file.js";
import { uploadBugFileToLinear } from "./bug-intake-linear-upload.js";
import { recordBugAlbumUploadReceipt } from "./bug-intake-upload-receipt.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Internal single-attempt worker, only inside a freshly acquired send claim.
 * Never use as a public endpoint or resume a claim by calling this again.
 * Once a claim is interrupted, reconciliation (not another upload) is required.
 * One buffer at a time; caller awaits completion before the next file.
 */
export async function uploadClaimedBugAlbumFileOnce(
  db: Database,
  storage: Parameters<typeof readClaimedBugAlbumAttachment>[1],
  request: Parameters<typeof uploadBugFileToLinear>[0],
  policy: Parameters<typeof uploadBugFileToLinear>[1],
  deliveryId: string,
  claimId: string,
  fileId: string,
) {
  let uploaded: Awaited<ReturnType<typeof uploadBugFileToLinear>>;
  try {
    const file = await readClaimedBugAlbumAttachment(db, storage, deliveryId, claimId, fileId);
    uploaded = await uploadBugFileToLinear(request, policy, { id: fileId,
      bytes: file.bytes, sha256: file.sha256, sizeBytes: file.sizeBytes });
  } catch {
    // Do not expose paths, credential-bearing URLs or database error details.
    return { ok: false as const, error: "FILE_ATTEMPT_REQUIRES_RECONCILIATION" };
  }
  if (!uploaded.ok) return uploaded;
  try {
    const persisted = await recordBugAlbumUploadReceipt(db, policy.assetOrigins,
      deliveryId, claimId, uploaded.receipt);
    if (persisted.ok) return { ok: true as const, fileId, assetUrl: uploaded.receipt.assetUrl };
  } catch {
    // Upload succeeded; only retry the DB receipt, never the transfer.
  }
  return { ok: false as const, error: "UPLOAD_RECEIPT_RECONCILIATION_REQUIRED",
    // Internal recovery evidence, not a client DTO or a log payload.
    recovery: { deliveryId, claimId, receipt: uploaded.receipt } };
}

