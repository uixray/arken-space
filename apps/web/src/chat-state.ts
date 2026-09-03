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
  TABLE: "Стол",
  STORY: "Сюжет",
  ROLLS: "Броски",
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

/**
 * Сколько сообщений потока клиент держит в памяти при **автоматическом**
 * пополнении — то есть когда приходит новое сообщение.
 *
 * UIX-450: ограничение существует, чтобы длинная сессия не растила состояние
 * бесконечно, и относится только к тому, что приходит само. Историю, которую
 * человек подгрузил прокруткой, оно не трогает: она ограничена его терпением,
 * а выбросить её при первом же чужом сообщении значило бы вернуть прокрутку
 * в начало ровно в тот момент, когда за столом что-то происходит.
 */
export const MAX_AUTO_THREAD_MESSAGES = 500;

/**
 * UIX-450 — подшивает подгруженную страницу истории.
 *
 * Дедупликация по `id`, а не по номеру: страница может пересечься с тем, что
 * уже пришло событием `chat:created`, и совпадение по номеру между потоками
 * ничего не значит.
 */
export function mergeChatHistory(
  snapshot: GameSnapshot,
  history: readonly ChatMessageDto[],
): GameSnapshot {
  const known = new Set(snapshot.messages.map((item) => item.id));
  const added = history.filter((item) => !known.has(item.id));
  if (added.length === 0) return snapshot;
  return {
    ...snapshot,
    messages: [...snapshot.messages, ...added].sort(
      (left, right) => left.sequence - right.sequence,
    ),
  };
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
    .slice(-MAX_AUTO_THREAD_MESSAGES);
  if (!threadMessages.some((item) => item.id === message.id)) return snapshot;
  const messages = [...otherThreads, ...threadMessages].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const chatThreadStates = (snapshot.chatThreadStates ?? []).map((state) =>
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
  const chatThreadStates = (snapshot.chatThreadStates ?? []).map((state) =>
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
    (state, index) => state === snapshot.chatThreadStates?.[index],
  )
    ? snapshot
    : { ...snapshot, chatThreadStates };
}

export function unreadCountForStream(
  snapshot: GameSnapshot,
  stream: ChatStream,
) {
  return (
    snapshot.chatThreadStates?.find((state) => state.stream === stream)
      ?.unreadCount ?? 0
  );
}

export function threadForStream(snapshot: GameSnapshot, stream: ChatStream) {
  return (
    snapshot.chatThreads?.find((thread) => thread.stream === stream) ?? null
  );
}
