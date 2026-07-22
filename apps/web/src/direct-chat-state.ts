import type {
  ChatMessageDto,
  ChatThreadStateDto,
  DirectChatThreadDto,
  GameSnapshot,
  MembershipDto,
} from "@arken/contracts";
import { appendChatMessage } from "./chat-state";

export function directThreads(snapshot: GameSnapshot) {
  return snapshot.chatThreads.filter(
    (thread): thread is DirectChatThreadDto => thread.type === "DIRECT",
  );
}

export function directThreadPeer(
  thread: DirectChatThreadDto,
  ownMembershipId: string,
) {
  return (
    thread.participants.find(
      (participant) => participant.membershipId !== ownMembershipId,
    ) ?? null
  );
}

export function directThreadLabel(
  thread: DirectChatThreadDto,
  ownMembershipId: string,
) {
  return (
    directThreadPeer(thread, ownMembershipId)?.displayName ??
    "Недоступный участник"
  );
}

export function eligibleDirectRecipients(
  members: readonly MembershipDto[],
  ownMembershipId: string,
) {
  return members
    .filter((member) => member.id !== ownMembershipId)
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "ru"),
    );
}

export function messagesForDirectThread(
  snapshot: GameSnapshot,
  threadId: string,
) {
  return snapshot.messages
    .filter(
      (message) => message.threadId === threadId && message.stream === null,
    )
    .sort((left, right) => left.sequence - right.sequence);
}

export function directUnreadCount(snapshot: GameSnapshot, threadId: string) {
  return (
    snapshot.chatThreadStates.find((state) => state.threadId === threadId)
      ?.unreadCount ?? 0
  );
}

export function upsertDirectThread(
  snapshot: GameSnapshot,
  thread: DirectChatThreadDto,
  initialState?: ChatThreadStateDto,
) {
  const found = snapshot.chatThreads.some((item) => item.id === thread.id);
  const stateFound = snapshot.chatThreadStates.some(
    (state) => state.threadId === thread.id,
  );
  if (found && stateFound) return snapshot;
  return {
    ...snapshot,
    chatThreads: found
      ? snapshot.chatThreads
      : [...snapshot.chatThreads, thread],
    chatThreadStates: stateFound
      ? snapshot.chatThreadStates
      : [
          ...snapshot.chatThreadStates,
          initialState ?? {
            threadId: thread.id,
            stream: null,
            lastReadSequence: 0,
            latestSequence: 0,
            unreadCount: 0,
          },
        ],
  };
}

/** Applies an HTTP response when the participant-scoped socket delivery was lost. */
export function appendDirectMessageResponse(
  snapshot: GameSnapshot,
  message: ChatMessageDto,
  context: { activeThreadId?: string | null; ownMembershipId: string },
) {
  return appendChatMessage(snapshot, message, message.sequence, context);
}
