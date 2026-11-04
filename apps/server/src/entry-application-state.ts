import { sql } from "drizzle-orm";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Apply and cancellation use the same transaction barrier. */
export async function lockEntryApplication(tx: Transaction, campaignId: string, actionId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`entry:${campaignId}:${actionId}`}, 0))`);
}
