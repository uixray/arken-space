import { eq } from "drizzle-orm";
import { z } from "zod";
import { bugIntakeDeliveries, bugIntakeAlbumDeliveries } from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const fileSchema = z.object({
  id: z.string().uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
});
const receiptSchema = fileSchema.extend({ assetUrl: z.string().url().max(2048) }).strict();

/** Completion guard, not proof of issue linking: the adapter must additionally
 * confirm that the reviewed text and asset links were accepted by Linear. */
export function bugUploadsComplete(payload: unknown, receipts: unknown): boolean {
  const selected = z.object({ attachments: z.array(fileSchema).max(20) }).safeParse(payload);
  const saved = z.record(z.string().uuid(), z.object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().positive(),
    assetUrl: z.string().url().max(2048),
    completedAt: z.string().datetime(),
  }).strict()).safeParse(receipts);
  if (!selected.success || !saved.success) return false;
  const files = selected.data.attachments;
  if (new Set(files.map((file) => file.id)).size !== files.length ||
      Object.keys(saved.data).length !== files.length) return false;
  return files.every((file) => {
    const receipt = saved.data[file.id];
    if (!receipt || receipt.sha256 !== file.sha256 ||
        receipt.sizeBytes !== file.sizeBytes) return false;
    const url = new URL(receipt.assetUrl);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.search && !url.hash;
  });
}

/** Trusted worker only. Store permanent asset URLs, never signed PUT URLs.
 * Allowed origins are explicit deployment configuration, not caller-supplied
 * request data. No external requests, no replacement of conflicting receipts.
 */
export async function recordBugUploadReceipt(
  db: Database,
  allowedAssetOrigins: ReadonlySet<string>,
  deliveryId: string,
  claimId: string,
  input: unknown,
) {
  return recordUploadReceipt(db, bugIntakeDeliveries, allowedAssetOrigins, deliveryId, claimId, input);
}

export async function recordBugAlbumUploadReceipt(
  db: Database, allowedAssetOrigins: ReadonlySet<string>, deliveryId: string,
  claimId: string, input: unknown,
) {
  return recordUploadReceipt(db, bugIntakeAlbumDeliveries, allowedAssetOrigins, deliveryId, claimId, input);
}

async function recordUploadReceipt(
  db: Database, table: typeof bugIntakeDeliveries | typeof bugIntakeAlbumDeliveries,
  allowedAssetOrigins: ReadonlySet<string>, deliveryId: string, claimId: string, input: unknown,
) {
  z.string().uuid().parse(deliveryId);
  z.string().uuid().parse(claimId);
  const receipt = receiptSchema.parse(input);
  const url = new URL(receipt.assetUrl);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || !allowedAssetOrigins.has(url.origin))
    return { ok: false as const, error: "UNTRUSTED_ASSET_URL" };
  return db.transaction(async (tx) => {
    // Only this row is locked; never acquire parent afterwards.
    const [delivery] = await tx.select().from(table)
      .where(eq(table.id, deliveryId)).for("update");
    if (!delivery || delivery.claimId !== claimId)
      return { ok: false as const, error: "CLAIM_MISMATCH" };
    const payload = z.object({ attachments: z.array(fileSchema).max(20) })
      .safeParse(delivery.payload);
    if (!payload.success) return { ok: false as const, error: "INVALID_SNAPSHOT" };
    const selected = payload.data.attachments.filter((file) => file.id === receipt.id);
    if (selected.length !== 1 || selected[0]!.sha256 !== receipt.sha256 ||
        selected[0]!.sizeBytes !== receipt.sizeBytes)
      return { ok: false as const, error: "FILE_NOT_APPROVED" };
    const prior = delivery.uploadReceipts[receipt.id];
    if (prior) {
      if (prior.sha256 !== receipt.sha256 || prior.sizeBytes !== receipt.sizeBytes ||
          prior.assetUrl !== receipt.assetUrl)
        return { ok: false as const, error: "UPLOAD_RECEIPT_CONFLICT" };
      // Receipt-only retries remain safe after the final delivery transition.
      return { ok: true as const, duplicate: true };
    }
    if (delivery.state !== "CLAIMED")
      return { ok: false as const, error: "RECONCILIATION_REQUIRED" };
    await tx.update(table).set({
      uploadReceipts: { ...delivery.uploadReceipts, [receipt.id]: {
        sha256: receipt.sha256,
        sizeBytes: receipt.sizeBytes,
        assetUrl: receipt.assetUrl,
        completedAt: new Date().toISOString(),
      } },
      updatedAt: new Date(),
    }).where(eq(table.id, deliveryId));
    return { ok: true as const, duplicate: false };
  });
}
