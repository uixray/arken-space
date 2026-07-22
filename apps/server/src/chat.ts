import { and, eq, or } from "drizzle-orm";
import type { ChatStream } from "@arken/contracts";
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

type ThreadRow = typeof chatThreads.$inferSelect;

/** Direct threads are participant-only. A GM who is not A/B gets no bypass. */
export function canAccessChatThread(auth: AuthContext, thread: ThreadRow) {
  if (thread.type === "STREAM") return true;
  return (
    thread.participantAMembershipId === auth.membershipId ||
    thread.participantBMembershipId === auth.membershipId
  );
}

export function directThreadMemberIds(thread: ThreadRow): string[] {
  if (
    thread.type !== "DIRECT" ||
    !thread.participantAMembershipId ||
    !thread.participantBMembershipId
  )
    return [];
  return [
    ...new Set([
      thread.participantAMembershipId,
      thread.participantBMembershipId,
    ]),
  ];
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
  options: { allowDirect?: boolean } = {},
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
  if (thread.type === "DIRECT") {
    if (!options.allowDirect || !canAccessChatThread(auth, thread))
      throw new Error("CHAT_THREAD_NOT_FOUND");
  } else {
    if (!thread.stream || !allowedStreams.includes(thread.stream))
      throw new Error("CHAT_STREAM_FORBIDDEN");
    if (!canAccessStream(auth, thread.stream))
      throw new Error("CHAT_THREAD_FORBIDDEN");
  }
  return thread;
}

/** Caller must first verify that otherMembershipId belongs to auth.campaignId. */
export async function createOrGetDirectThread(
  db: Database,
  auth: AuthContext,
  otherMembershipId: string,
) {
  if (otherMembershipId === auth.membershipId)
    throw new Error("CHAT_THREAD_NOT_FOUND");
  const pair = [auth.membershipId, otherMembershipId].sort();
  const participantA = pair[0]!;
  const participantB = pair[1]!;
  const inserted = await db
    .insert(chatThreads)
    .values({
      campaignId: auth.campaignId,
      type: "DIRECT",
      stream: null,
      participantAMembershipId: participantA,
      participantBMembershipId: participantB,
    })
    .onConflictDoNothing()
    .returning({ id: chatThreads.id });
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.campaignId, auth.campaignId),
        eq(chatThreads.participantAMembershipId, participantA),
        eq(chatThreads.participantBMembershipId, participantB),
      ),
    )
    .limit(1);
  if (!thread) throw new Error("CHAT_THREAD_NOT_FOUND");
  return { thread, created: inserted.length === 1 };
}

export function chatMessageDto(
  row: MessageRow,
  displayName: string,
  stream: ChatStream | null,
) {
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
    stickerId: row.stickerId,
    stickerPresentation: row.stickerPresentation,
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
