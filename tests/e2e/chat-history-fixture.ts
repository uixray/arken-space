import { and, eq } from "drizzle-orm";
import {
  chatMessages,
  chatThreads,
  memberships,
} from "../../packages/db/src/schema.js";
import type { createDatabase } from "../../packages/db/src/index.js";

export const historyMessageBody = (index: number) =>
  `Запись журнала ${index} — ${"достаточно длинная, чтобы занять высоту и переполнить ленту событий. ".repeat(4)}`;

/** Test-only history preparation; caller owns freshly-created campaign/membership. */
export async function insertOwnedChatHistory(
  db: ReturnType<typeof createDatabase>["db"],
  owner: { campaignId: string; membershipId: string },
  count: number,
) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100)
    throw new Error("Invalid history count");
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, owner.membershipId),
          eq(memberships.campaignId, owner.campaignId),
          eq(memberships.role, "GM"),
        ),
      )
      .limit(1);
    if (!member) throw new Error("History owner must be the campaign GM");
    await tx
      .insert(chatThreads)
      .values({ campaignId: owner.campaignId, type: "STREAM", stream: "TABLE" })
      .onConflictDoNothing();
    const [thread] = await tx
      .select()
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.campaignId, owner.campaignId),
          eq(chatThreads.type, "STREAM"),
          eq(chatThreads.stream, "TABLE"),
        ),
      )
      .limit(1);
    if (!thread) throw new Error("Owned campaign TABLE thread missing");
    const rows = await tx
      .insert(chatMessages)
      .values(
        Array.from({ length: count }, (_, index) => ({
          campaignId: owner.campaignId,
          membershipId: owner.membershipId,
          threadId: thread.id,
          kind: "TEXT" as const,
          visibility: "PUBLIC" as const,
          body: historyMessageBody(index),
        })),
      )
      .returning({ id: chatMessages.id, sequence: chatMessages.sequence });
    if (rows.length !== count)
      throw new Error("History fixture row count mismatch");
    return rows;
  });
}
