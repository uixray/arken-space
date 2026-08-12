import {
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  ChatAttachmentMetadata,
  ChatMessageDto,
  ChatReadCursorDto,
  ChatStream,
  DirectChatThreadDto,
  GameSnapshot,
  MessageVisibility,
} from "@arken/contracts";
import { api } from "./api";
import { appendChatMessage, reconcileChatRead } from "./chat-state";
import {
  appendDirectMessageResponse,
  upsertDirectThread,
} from "./direct-chat-state";

/**
 * UIX-398 — chat commands.
 *
 * Third ref-domain. Only two handlers read live state, and both for the same
 * narrow reason: a message sent without an explicit character is attributed
 * to the sender's own one, which lives on the snapshot.
 *
 * Everything else here works through `setSnapshot`'s updater form, which
 * receives the current value as an argument — so those handlers never needed
 * to close over `snapshot` at all and are stable for free. Worth noticing,
 * because it is the same shape the remaining domains are in: reading state
 * through the updater rather than the closure is what keeps a handler stable
 * without any indirection.
 *
 * `knownChatMessageIdsRef` and `activeChatThreadIdRef` are already refs owned
 * by App, so they pass through unchanged.
 */
export interface ChatActions {
  onChat: (
    body: string,
    visibility: MessageVisibility,
    stream: ChatStream,
    characterId?: string | null,
  ) => Promise<void>;
  onSticker: (
    target: { threadId: string } | { stream: "TABLE" | "STORY" },
    stickerId: string,
  ) => Promise<void>;
  onCreateDirectThread: (
    participantMembershipId: string,
  ) => Promise<DirectChatThreadDto>;
  onDirectChat: (
    threadId: string,
    body: string,
    attachmentContentIds: string[],
  ) => Promise<void>;
  onUploadChatAttachment: (file: File) => Promise<ChatAttachmentMetadata>;
  onActiveChatThreadChange: (threadId: string | null) => void;
  onMarkChatRead: (threadId: string, sequence: number) => Promise<void>;
}

export function useChatActions(dependencies: {
  /** Stable — see `use-mutation-runners.ts`. */
  run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<GameSnapshot | null>>;
  snapshotRef: MutableRefObject<GameSnapshot | null>;
  knownChatMessageIdsRef: MutableRefObject<Set<string>>;
  activeChatThreadIdRef: MutableRefObject<string | null>;
}): ChatActions {
  const {
    run,
    setSnapshot,
    snapshotRef,
    knownChatMessageIdsRef,
    activeChatThreadIdRef,
  } = dependencies;

  return useMemo<ChatActions>(
    () => ({
      onChat: (body, visibility, stream, characterId) =>
        run(() =>
          api("/api/chat", {
            method: "POST",
            body: JSON.stringify({
              actionId: crypto.randomUUID(),
              body,
              visibility,
              stream,
              characterId:
                characterId ?? snapshotRef.current?.me.characterId ?? null,
            }),
          }),
        ),

      onSticker: async (target, stickerId) => {
        const message = await api<ChatMessageDto>("/api/chat/stickers", {
          method: "POST",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            stickerId,
            ...target,
          }),
        });
        // Remember it before applying, so the echo arriving over the socket
        // is recognised as our own and not appended a second time.
        knownChatMessageIdsRef.current.add(message.id);
        setSnapshot((current) => {
          if (!current) return current;
          return "threadId" in target
            ? appendDirectMessageResponse(current, message, {
                activeThreadId: activeChatThreadIdRef.current,
                ownMembershipId: current.me.id,
              })
            : appendChatMessage(current, message, message.sequence, {
                activeThreadId: message.threadId,
                ownMembershipId: current.me.id,
              });
        });
      },

      onCreateDirectThread: async (participantMembershipId) => {
        const thread = await api<DirectChatThreadDto>("/api/chat/direct", {
          method: "POST",
          body: JSON.stringify({ participantMembershipId }),
        });
        setSnapshot((current) =>
          current ? upsertDirectThread(current, thread) : current,
        );
        return thread;
      },

      onDirectChat: async (threadId, body, attachmentContentIds) => {
        const message = await api<ChatMessageDto>("/api/chat/direct/messages", {
          method: "POST",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            threadId,
            body,
            characterId: snapshotRef.current?.me.characterId ?? null,
            attachmentContentIds,
          }),
        });
        knownChatMessageIdsRef.current.add(message.id);
        setSnapshot((current) =>
          current
            ? appendDirectMessageResponse(current, message, {
                activeThreadId: activeChatThreadIdRef.current,
                ownMembershipId: current.me.id,
              })
            : current,
        );
      },

      onUploadChatAttachment: (file) => {
        const form = new FormData();
        form.append("file", file);
        return api<ChatAttachmentMetadata>("/api/chat/attachments", {
          method: "POST",
          body: form,
        });
      },

      onActiveChatThreadChange: (threadId) => {
        activeChatThreadIdRef.current = threadId;
      },

      onMarkChatRead: async (threadId, sequence) => {
        const cursor = await api<ChatReadCursorDto>("/api/chat/read", {
          method: "POST",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            threadId,
            sequence,
          }),
        });
        setSnapshot((current) =>
          current ? reconcileChatRead(current, cursor) : current,
        );
      },
    }),
    [
      run,
      setSnapshot,
      snapshotRef,
      knownChatMessageIdsRef,
      activeChatThreadIdRef,
    ],
  );
}
