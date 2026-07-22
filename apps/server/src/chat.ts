import { and, eq, or } from "drizzle-orm";
import type { ChatMessageDto, ChatStream } from "@arken/contracts";
import { chatMessages, chatThreads } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { normalizeDiceResult } from "./dice-result.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type MessageRow = typeof chatMessages.$inferSelect;

export function chatVisibilityFilter(auth: AuthContext) {
  if (auth.role === "GM") return undefined;
  return or(
    eq(chatMessages.visibility, "PUBLIC"),
    eq(chatMessages.membershipId, auth.membershipId),
  );
}

export function canAccessStream(_auth: AuthContext, _stream: ChatStream) {
  return true;
}

export function canPostToStream(auth: AuthContext, stream: ChatStream) {
  return stream !== "STORY" || auth.role === "GM";
}

export async function ensureStreamThread(
  db: Database,
  campaignId: string,
  stream: ChatStream,
) {
  await db
    .insert(chatThreads)
    .values({ campaignId, stream, type: "STREAM" })
    .onConflictDoNothing({
      target: [chatThreads.campaignId, chatThreads.stream],
    });
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.campaignId, campaignId),
        eq(chatThreads.stream, stream),
      ),
    )
    .limit(1);
  if (!thread) throw new Error("CHAT_THREAD_NOT_FOUND");
  return thread;
}

export async function resolveChatThread(
  db: Database,
  auth: AuthContext,
  input: { threadId?: string; stream?: ChatStream },
  allowedStreams: readonly ChatStream[],
) {
  const thread = input.threadId
    ? (
        await db
          .select()
          .from(chatThreads)
          .where(
            and(
              eq(chatThreads.campaignId, auth.campaignId),
              eq(chatThreads.id, input.threadId),
            ),
          )
          .limit(1)
      )[0]
    : await ensureStreamThread(
        db,
        auth.campaignId,
        input.stream ?? allowedStreams[0] ?? "TABLE",
      );
  if (!thread) throw new Error("CHAT_THREAD_NOT_FOUND");
  if (!allowedStreams.includes(thread.stream))
    throw new Error("CHAT_STREAM_FORBIDDEN");
  if (!canAccessStream(auth, thread.stream))
    throw new Error("CHAT_THREAD_FORBIDDEN");
  return thread;
}

export function chatMessageDto(
  row: MessageRow,
  displayName: string,
  stream: ChatStream,
): ChatMessageDto {
  return {
    id: row.id,
    sequence: row.sequence,
    membershipId: row.membershipId,
    displayName,
    characterId: row.characterId,
    body: row.body,
    visibility: row.visibility,
    kind: row.kind,
    threadId: row.threadId,
    stream,
    dice: normalizeDiceResult(row.dice),
    createdAt: row.createdAt.toISOString(),
  };
}

export function clampReadSequence(
  previous: number,
  requested: number,
  latest: number,
) {
  return Math.max(previous, Math.min(requested, latest));
}

export function chatBroadcastAudience(
  visibility: "PUBLIC" | "GM_ONLY",
): "CAMPAIGN" | "GM_AND_AUTHOR" {
  return visibility === "PUBLIC" ? "CAMPAIGN" : "GM_AND_AUTHOR";
}

export const unknownPlayerDisplayName =
  "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0439 \u0438\u0433\u0440\u043e\u043a";
