import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bugIntakeActions,
  bugIntakeDeliveries,
  bugIntakeMessages,
} from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const fileSchema = z.object({
  id: z.string().uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
});
const commandSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    deliveryId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
    file: fileSchema.extend({ assetUrl: z.string().url().max(2048) }).strict(),
    workerTerminationVerified: z.literal(true),
    externalBytesVerified: z.literal(true),
    evidence: z.string().trim().min(1).max(2000),
  })
  .strict();

/** Authenticated-operator service, not registered as an endpoint. Missing
 * receipt repair only after external byte/hash verification; never reuploads.
 * Trusted configured origins cannot come from the command/request itself.
 */
export async function recoverBugUploadReceipt(
  db: Database,
  origins: ReadonlySet<string>,
  messageId: string,
  operatorId: string,
  input: unknown,
) {
  z.string().uuid().parse(messageId);
  z.string().uuid().parse(operatorId);
  const command = commandSchema.parse(input);
  const url = new URL(command.file.assetUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !origins.has(url.origin)
  )
    return { ok: false as const, error: "UNTRUSTED_ASSET_URL" };
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ messageId, command }))
    .digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"bug-review-action:" + command.actionId}, 0))`,
    );
    const [previous] = await tx
      .select()
      .from(bugIntakeActions)
      .where(eq(bugIntakeActions.actionId, command.actionId));
    if (previous) {
      if (
        previous.operatorMembershipId !== operatorId ||
        previous.messageId !== messageId ||
        previous.action !== "RECOVER_UPLOAD_RECEIPT" ||
        previous.requestHash !== requestHash
      )
        return { ok: false as const, error: "ACTION_CONFLICT" };
      return { ok: true as const, duplicate: true, receipt: previous.receipt };
    }
    const [message] = await tx
      .select()
      .from(bugIntakeMessages)
      .where(eq(bugIntakeMessages.id, messageId))
      .for("update");
    if (!message || message.revision !== command.revision)
      return { ok: false as const, error: "REVISION_CONFLICT" };
    const [delivery] = await tx
      .select()
      .from(bugIntakeDeliveries)
      .where(
        and(
          eq(bugIntakeDeliveries.id, command.deliveryId),
          eq(bugIntakeDeliveries.messageId, messageId),
        ),
      )
      .for("update");
    if (
      !delivery ||
      delivery.state !== "UNKNOWN" ||
      delivery.updatedAt.toISOString() !== command.expectedUpdatedAt
    )
      return { ok: false as const, error: "DELIVERY_CHANGED" };
    const snapshot = z
      .object({ attachments: z.array(fileSchema).max(20) })
      .safeParse(delivery.payload);
    const files = snapshot.success
      ? snapshot.data.attachments.filter((file) => file.id === command.file.id)
      : [];
    if (
      files.length !== 1 ||
      files[0]!.sha256 !== command.file.sha256 ||
      files[0]!.sizeBytes !== command.file.sizeBytes
    )
      return { ok: false as const, error: "FILE_NOT_APPROVED" };
    if (delivery.uploadReceipts[command.file.id])
      return { ok: false as const, error: "RECEIPT_ALREADY_EXISTS" };
    const { id: fileId, ...file } = command.file;
    await tx
      .update(bugIntakeDeliveries)
      .set({
        uploadReceipts: {
          ...delivery.uploadReceipts,
          [fileId]: { ...file, completedAt: new Date().toISOString() },
        },
        updatedAt: new Date(),
      })
      .where(eq(bugIntakeDeliveries.id, delivery.id));
    const receipt = {
      messageId,
      deliveryId: delivery.id,
      fileId,
      revision: message.revision,
      state: "UNKNOWN",
      evidence: command.evidence,
      externalBytesVerified: true,
      workerTerminationVerified: true,
    };
    await tx
      .insert(bugIntakeActions)
      .values({
        actionId: command.actionId,
        messageId,
        operatorMembershipId: operatorId,
        action: "RECOVER_UPLOAD_RECEIPT",
        requestHash,
        resultingRevision: message.revision,
        receipt,
      });
    return { ok: true as const, duplicate: false, receipt };
  });
}
