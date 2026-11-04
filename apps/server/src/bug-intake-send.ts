import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  claimBugDelivery,
  recordBugDeliveryOutcome,
  deliveryOutcomeSchema,
} from "./bug-intake-outbox.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Claim = Extract<
  Awaited<ReturnType<typeof claimBugDelivery>>,
  { ok: true }
>;
type Outcome = z.infer<typeof deliveryOutcomeSchema>;

/** Dormant orchestration seam, no scheduler or transport instantiated here.
 * The adapter must deliver every selected attachment before returning SENT,
 * report a known partial issue ID via UNKNOWN, and never retry issue creation
 * after an ambiguous response. It owns bounded network timeouts and cleanup.
 * No Promise.race: recording UNKNOWN while a detached sender still runs would
 * release the mutation interlock before the external operation has terminated.
 */
export async function sendQueuedBugOnce(
  db: Database,
  deliveryId: string,
  send: (claim: Readonly<Claim>) => Promise<Outcome>,
) {
  z.string().uuid().parse(deliveryId);
  const claimId = randomUUID();
  let claim: Awaited<ReturnType<typeof claimBugDelivery>>;
  try {
    claim = await claimBugDelivery(db, deliveryId, claimId);
  } catch {
    // A commit may have succeeded despite a lost DB response. Never call the
    // adapter or reclaim automatically; preserve the identity for reconciliation.
    return { state: "RECONCILIATION_REQUIRED" as const, deliveryId, claimId };
  }
  if (!claim.ok) return { state: "NOT_SENT" as const, error: claim.error };

  let outcome: Outcome;
  try {
    // Validate before the receipt-write boundary. A malformed adapter response
    // must never become SENT or leave the claim unresolved merely by throwing
    // a schema error inside the DB receipt handler.
    outcome = deliveryOutcomeSchema.parse(await send(claim));
  } catch {
    // Exception strings can contain credentials, URLs and private content.
    outcome = { state: "UNKNOWN", failureCode: "EXTERNAL_RESULT_UNKNOWN" };
  }
  try {
    const receipt = await recordBugDeliveryOutcome(
      db,
      deliveryId,
      claimId,
      outcome,
    );
    if (receipt.ok) return { state: receipt.state, deliveryId };
  } catch {
    // Do not resend after a failed receipt write, even if external work succeeded.
  }
  // Internal recovery evidence, not an API DTO or log line. Retain the known
  // external identity when DB receipt persistence fails; recovery may retry
  // recordBugDeliveryOutcome with this exact receipt, NEVER the network send.
  return {
    state: "RECONCILIATION_REQUIRED" as const,
    deliveryId,
    claimId,
    receiptCandidate: outcome,
  };
}
