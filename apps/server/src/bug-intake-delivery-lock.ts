import { and, eq } from "drizzle-orm";
import { bugIntakeDeliveries } from "@arken/db";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Caller holds parent message lock; all claim/mutation paths use parent first. */
export async function bugDeliveryInFlight(tx: Transaction, messageId: string) {
  const [claim] = await tx
    .select({ id: bugIntakeDeliveries.id })
    .from(bugIntakeDeliveries)
    .where(
      and(
        eq(bugIntakeDeliveries.messageId, messageId),
        eq(bugIntakeDeliveries.state, "CLAIMED"),
      ),
    )
    .limit(1);
  return !!claim;
}
