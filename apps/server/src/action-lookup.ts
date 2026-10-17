import { and, eq } from "drizzle-orm";
import { gameEvents } from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** The game event recorded for a client action id in this campaign, if any. */
export async function findAction(
  db: Database,
  campaignId: string,
  actionId: string,
) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  return event ?? null;
}
