import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { bugIntakeUpdates, bugIntakeUpdateActions } from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const commandSchema = z
  .object({
    actionId: z.string().uuid(),
    action: z.enum(["KEEP_CURRENT", "RETRY_NORMALIZATION"]),
    expectedHashes: z
      .array(z.string().regex(/^[0-9a-f]{64}$/))
      .min(1)
      .max(9),
    reason: z.string().trim().min(1).max(1000),
    reviewed: z.literal(true),
  })
  .strict();

/** No force overwrite. KEEP_CURRENT records conscious exclusion of this update;
 * RETRY only retries the original payload, and refuses multi-variant ambiguity. */
export async function resolveBugQuarantine(
  db: Database,
  id: string,
  operatorId: string,
  input: unknown,
) {
  z.string().uuid().parse(id);
  z.string().uuid().parse(operatorId);
  const command = commandSchema.parse(input);
  const hashes = [...new Set(command.expectedHashes)].sort();
  if (hashes.length !== command.expectedHashes.length)
    return { ok: false as const, error: "INVALID_HASHES" };
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ id, ...command, expectedHashes: hashes }))
    .digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"bug-quarantine-action:" + command.actionId}, 0))`,
    );
    const [previous] = await tx
      .select()
      .from(bugIntakeUpdateActions)
      .where(eq(bugIntakeUpdateActions.actionId, command.actionId));
    if (previous) {
      if (
        previous.operatorMembershipId !== operatorId ||
        previous.updateRowId !== id ||
        previous.requestHash !== requestHash
      )
        return { ok: false as const, error: "ACTION_CONFLICT" };
      return { ok: true as const, duplicate: true, receipt: previous.receipt };
    }
    const [row] = await tx
      .select()
      .from(bugIntakeUpdates)
      .where(eq(bugIntakeUpdates.id, id))
      .for("update");
    if (!row) return { ok: false as const, error: "NOT_FOUND" };
    if (row.state !== "QUARANTINED")
      return { ok: false as const, error: "INVALID_STATE" };
    const actual = [
      row.payloadHash,
      ...row.conflictingPayloads.map((variant) => variant.hash),
    ].sort();
    if (JSON.stringify(hashes) !== JSON.stringify(actual))
      return { ok: false as const, error: "EVIDENCE_CHANGED" };
    if (
      command.action === "RETRY_NORMALIZATION" &&
      row.conflictingPayloads.length
    )
      return { ok: false as const, error: "AMBIGUOUS_VARIANTS" };
    const state = command.action === "KEEP_CURRENT" ? "PROCESSED" : "PENDING";
    await tx
      .update(bugIntakeUpdates)
      .set({
        state,
        reason:
          command.action === "KEEP_CURRENT" ? "OPERATOR_KEPT_CURRENT" : null,
        updatedAt: new Date(),
      })
      .where(eq(bugIntakeUpdates.id, id));
    const receipt = {
      id,
      state,
      action: command.action,
      reason: command.reason,
      evidenceHashes: hashes,
    };
    await tx
      .insert(bugIntakeUpdateActions)
      .values({
        actionId: command.actionId,
        updateRowId: id,
        operatorMembershipId: operatorId,
        action: command.action,
        requestHash,
        receipt,
      });
    return { ok: true as const, duplicate: false, receipt };
  });
}
