import { and, desc, eq, sql } from "drizzle-orm";
import { chatMessages, chatReadCursors, memberships } from "@arken/db";
import {
  localChatHistorySchema,
  markChatThreadReadSchema,
} from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { fullChatVisibilityFilter, loadThreadHistory } from "./chat-history.js";
import { listVisiblePlayerRequests } from "./player-requests.js";
import { resolveChatThread, clampReadSequence } from "./chat.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export class ChatReadError extends Error {
  constructor(
    readonly status: 403 | 404,
    code: string,
  ) {
    super(code);
  }
}
export async function readChatHistory(
  db: Database,
  auth: AuthContext,
  input: unknown,
) {
  const query = localChatHistorySchema.parse(input);
  const memberRows = await db
    .select()
    .from(memberships)
    .where(eq(memberships.campaignId, auth.campaignId));
  const requests = await listVisiblePlayerRequests(db, auth);
  return loadThreadHistory(db, auth, {
    ...query,
    memberNameById: new Map(
      memberRows.map((member) => [member.id, member.displayName]),
    ),
    visiblePlayerRequestIds: new Set(requests.map((item) => item.id)),
  });
}
export async function markChatRead(
  db: Database,
  auth: AuthContext,
  input: unknown,
) {
  const body = markChatThreadReadSchema.parse(input);
  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(
      sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`,
    );
    let thread;
    try {
      thread = await resolveChatThread(
        tx,
        auth,
        { threadId: body.threadId },
        ["ROLLS", "STORY", "TABLE"],
        { allowDirect: true },
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (
        ![
          "CHAT_THREAD_NOT_FOUND",
          "CHAT_THREAD_FORBIDDEN",
          "CHAT_STREAM_FORBIDDEN",
        ].includes(code)
      )
        throw error;
      throw new ChatReadError(
        code === "CHAT_THREAD_NOT_FOUND" ? 404 : 403,
        code,
      );
    }
    const visiblePlayerRequestIds = new Set(
      (await listVisiblePlayerRequests(tx, auth)).map((item) => item.id),
    );
    const [latest] = await tx
      .select({ sequence: chatMessages.sequence })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.campaignId, auth.campaignId),
          eq(chatMessages.threadId, thread.id),
          fullChatVisibilityFilter(auth, visiblePlayerRequestIds),
        ),
      )
      .orderBy(desc(chatMessages.sequence))
      .limit(1);
    const [previousCursor] = await tx
      .select({ lastReadSequence: chatReadCursors.lastReadSequence })
      .from(chatReadCursors)
      .where(
        and(
          eq(chatReadCursors.membershipId, auth.membershipId),
          eq(chatReadCursors.threadId, thread.id),
        ),
      )
      .limit(1);
    const nextSequence = clampReadSequence(
      previousCursor?.lastReadSequence ?? 0,
      body.sequence,
      latest?.sequence ?? 0,
    );
    const [cursor] = await tx
      .insert(chatReadCursors)
      .values({
        campaignId: auth.campaignId,
        membershipId: auth.membershipId,
        threadId: thread.id,
        lastReadSequence: nextSequence,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [chatReadCursors.membershipId, chatReadCursors.threadId],
        set: {
          lastReadSequence: sql`greatest(${chatReadCursors.lastReadSequence}, ${nextSequence})`,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!cursor) throw new Error("CHAT_CURSOR_UPDATE_FAILED");
    return {
      campaignId: cursor.campaignId,
      threadId: cursor.threadId,
      lastReadSequence: cursor.lastReadSequence,
      updatedAt: cursor.updatedAt.toISOString(),
    };
  });
}
