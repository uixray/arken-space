import type {
  ChatMessageDto,
  ChatReadCursorDto,
  ChatStream,
  GameSnapshot,
  ChatThreadDto,
} from "@arken/contracts";

export const CHAT_STREAM_ORDER: readonly ChatStream[] = [
  "TABLE",
  "STORY",
  "ROLLS",
];
export const CHAT_STREAM_LABEL: Record<ChatStream, string> = {
  TABLE: "\u0421\u0442\u043e\u043b",
  STORY: "\u0421\u044e\u0436\u0435\u0442",
  ROLLS: "\u0411\u0440\u043e\u0441\u043a\u0438",
};

export function messagesForStream(
  messages: readonly ChatMessageDto[],
  stream: ChatStream,
  threads: readonly ChatThreadDto[] = [],
) {
  const directThreadIds = new Set(
    threads
      .filter((thread) => thread.type === "DIRECT")
      .map((thread) => thread.id),
  );
  return messages
    .filter(
      (message) =>
        !directThreadIds.has(message.threadId) &&
        (message.stream ?? "TABLE") === stream,
    )
    .sort((a, b) => a.sequence - b.sequence);
}

export function streamForMessage(
  messages: readonly ChatMessageDto[],
  messageId: string,
  threads: readonly ChatThreadDto[] = [],
) {
  const message = messages.find((item) => item.id === messageId);
  if (!message) return null;
  if (
    threads.some(
      (thread) => thread.type === "DIRECT" && thread.id === message.threadId,
    )
  )
    return null;
  return message.stream ?? "TABLE";
}

export function nextChatStream(
  current: ChatStream,
  key: string,
): ChatStream | null {
  const index = CHAT_STREAM_ORDER.indexOf(current);
  if (key === "Home") return CHAT_STREAM_ORDER[0] ?? null;
  if (key === "End") return CHAT_STREAM_ORDER.at(-1) ?? null;
  if (key === "ArrowRight")
    return CHAT_STREAM_ORDER[(index + 1) % CHAT_STREAM_ORDER.length] ?? null;
  if (key === "ArrowLeft")
    return (
      CHAT_STREAM_ORDER[
        (index - 1 + CHAT_STREAM_ORDER.length) % CHAT_STREAM_ORDER.length
      ] ?? null
    );
  return null;
}

export function appendChatMessage(
  snapshot: GameSnapshot,
  message: ChatMessageDto,
  sequence: number,
  context: {
    activeThreadId?: string | null;
    ownMembershipId?: string | null;
  } = {},
) {
  if (snapshot.messages.some((item) => item.id === message.id)) return snapshot;
  const otherThreads = snapshot.messages.filter(
    (item) => item.threadId !== message.threadId,
  );
  const threadMessages = [
    ...snapshot.messages.filter((item) => item.threadId === message.threadId),
    message,
  ]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-200);
  if (!threadMessages.some((item) => item.id === message.id)) return snapshot;
  const messages = [...otherThreads, ...threadMessages].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const chatThreadStates = snapshot.chatThreadStates.map((state) =>
    state.threadId !== message.threadId
      ? state
      : {
          ...state,
          latestSequence: Math.max(state.latestSequence, message.sequence),
          unreadCount:
            message.membershipId !== context.ownMembershipId &&
            context.activeThreadId !== message.threadId
              ? state.unreadCount + 1
              : state.unreadCount,
        },
  );
  return {
    ...snapshot,
    snapshotVersion: Math.max(snapshot.snapshotVersion, sequence),
    messages,
    chatThreadStates,
  };
}

export function reconcileChatRead(
  snapshot: GameSnapshot,
  cursor: ChatReadCursorDto,
) {
  const chatThreadStates = snapshot.chatThreadStates.map((state) =>
    state.threadId === cursor.threadId
      ? {
          ...state,
          lastReadSequence: Math.max(
            state.lastReadSequence,
            cursor.lastReadSequence,
          ),
          unreadCount: Math.max(
            0,
            state.latestSequence - cursor.lastReadSequence,
          ),
        }
      : state,
  );
  return chatThreadStates.every(
    (state, index) => state === snapshot.chatThreadStates[index],
  )
    ? snapshot
    : { ...snapshot, chatThreadStates };
}

export function unreadCountForStream(
  snapshot: GameSnapshot,
  stream: ChatStream,
) {
  return (
    snapshot.chatThreadStates.find((state) => state.stream === stream)
      ?.unreadCount ?? 0
  );
}

export function threadForStream(snapshot: GameSnapshot, stream: ChatStream) {
  return (
    snapshot.chatThreads.find((thread) => thread.stream === stream) ?? null
  );
}
