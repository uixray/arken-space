import { and, eq, sql } from "drizzle-orm";
import { actionJournal } from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function invalidateRedoBranch(
  tx: Transaction,
  auth: { campaignId: string; membershipId: string; role: "GM" | "PLAYER" },
  sceneId: string,
) {
  await tx
    .update(actionJournal)
    .set({
      status: "INVALIDATED",
      transitionSequence: sql`nextval(pg_get_serial_sequence('action_journal', 'transition_sequence'))`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(actionJournal.campaignId, auth.campaignId),
        eq(actionJournal.sceneId, sceneId),
        eq(actionJournal.status, "UNDONE"),
        auth.role === "GM"
          ? undefined
          : eq(actionJournal.actorMembershipId, auth.membershipId),
      ),
    );
}
