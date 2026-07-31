import type {
  ChatMessageDto,
  ChatThreadStateDto,
  DirectChatContactDto,
  DirectChatThreadDto,
  GameSnapshot,
  MembershipDto,
} from "@arken/contracts";
import { appendChatMessage } from "./chat-state";

export function directThreads(snapshot: GameSnapshot) {
  return (snapshot.chatThreads ?? []).filter(
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

export function directChatContacts(
  snapshot: GameSnapshot,
): DirectChatContactDto[] {
  return [...(snapshot.directChatContacts ?? [])].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "ru"),
  );
}

export function directThreadForPeer(
  snapshot: GameSnapshot,
  peerMembershipId: string,
) {
  return (
    directThreads(snapshot).find((thread) =>
      thread.participants.some(
        (participant) =>
          participant.membershipId === peerMembershipId &&
          participant.membershipId !== snapshot.me.id,
      ),
    ) ?? null
  );
}

export type StoredDirectSelection = Readonly<{
  peerMembershipId: string;
  threadId: string | null;
}>;

export function directSelectionStorageKey(snapshot: GameSnapshot) {
  return `arken.direct-chat.${snapshot.campaign.id}.${snapshot.me.id}`;
}

export function restoreDirectSelection(
  storage: Pick<Storage, "getItem">,
  snapshot: GameSnapshot,
): StoredDirectSelection | null {
  try {
    const raw = storage.getItem(directSelectionStorageKey(snapshot));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredDirectSelection>;
    if (
      typeof value.peerMembershipId !== "string" ||
      !directChatContacts(snapshot).some(
        (contact) => contact.membershipId === value.peerMembershipId,
      )
    )
      return null;
    const thread = directThreadForPeer(snapshot, value.peerMembershipId);
    return {
      peerMembershipId: value.peerMembershipId,
      threadId:
        typeof value.threadId === "string" && thread?.id === value.threadId
          ? value.threadId
          : (thread?.id ?? null),
    };
  } catch {
    return null;
  }
}

export function persistDirectSelection(
  storage: Pick<Storage, "setItem" | "removeItem">,
  snapshot: GameSnapshot,
  selection: StoredDirectSelection | null,
) {
  const key = directSelectionStorageKey(snapshot);
  if (!selection) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(selection));
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
    snapshot.chatThreadStates?.find((state) => state.threadId === threadId)
      ?.unreadCount ?? 0
  );
}

export function upsertDirectThread(
  snapshot: GameSnapshot,
  thread: DirectChatThreadDto,
  initialState?: ChatThreadStateDto,
) {
  const chatThreads = snapshot.chatThreads ?? [];
  const chatThreadStates = snapshot.chatThreadStates ?? [];
  const found = chatThreads.some((item) => item.id === thread.id);
  const stateFound = chatThreadStates.some(
    (state) => state.threadId === thread.id,
  );
  if (found && stateFound) return snapshot;
  return {
    ...snapshot,
    chatThreads: found ? chatThreads : [...chatThreads, thread],
    chatThreadStates: stateFound
      ? chatThreadStates
      : [
          ...chatThreadStates,
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
