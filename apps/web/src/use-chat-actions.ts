import {
  useMemo,
  useRef,
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
    scope?: "GLOBAL_PUBLIC",
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
  // An ambiguous response must not mint a new ID for the same retry. The
  // entry is scoped to campaign/member and retained only in this mounted app.
  const pendingMessages = useRef(new Map<string, string[]>());
  const takeMessageAction = (key: string) => {
    const queue = pendingMessages.current.get(key);
    const actionId = queue?.shift() ?? crypto.randomUUID();
    if (queue && !queue.length) pendingMessages.current.delete(key);
    return actionId;
  };
  const keepMessageAction = (key: string, actionId: string) => {
    const queue = pendingMessages.current.get(key) ?? [];
    if (!queue.includes(actionId)) queue.push(actionId);
    pendingMessages.current.set(key, queue);
  };

  return useMemo<ChatActions>(
    () => ({
      onChat: async (body, visibility, stream, characterId) => {
        const snapshot = snapshotRef.current;
        if (!snapshot) throw new Error("Нет активной игровой сессии.");
        const values = {
          body,
          visibility,
          stream,
          characterId: characterId ?? snapshot.me.characterId ?? null,
        };
        const key = JSON.stringify([
          snapshot.campaign.id,
          snapshot.me.id,
          values,
        ]);
        const actionId = takeMessageAction(key);
        try {
          await run(() =>
            api("/api/chat", {
              method: "POST",
              body: JSON.stringify({ actionId, ...values }),
            }),
          );
        } catch (error) {
          keepMessageAction(key, actionId);
          throw error;
        }
      },

      onSticker: async (target, stickerId, scope) => {
        const message = await api<ChatMessageDto>("/api/chat/stickers", {
          method: "POST",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            ...(scope === "GLOBAL_PUBLIC"
              ? { scope: "GLOBAL", globalStickerId: stickerId }
              : { stickerId }),
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
        const snapshot = snapshotRef.current;
        if (!snapshot) throw new Error("Нет активной игровой сессии.");
        const values = {
          threadId,
          body,
          characterId: snapshot.me.characterId ?? null,
          attachmentContentIds,
        };
        const key = JSON.stringify([
          snapshot.campaign.id,
          snapshot.me.id,
          "DIRECT",
          values,
        ]);
        const actionId = takeMessageAction(key);
        let message: ChatMessageDto;
        try {
          message = await api<ChatMessageDto>("/api/chat/direct/messages", {
            method: "POST",
            body: JSON.stringify({ actionId, ...values }),
          });
        } catch (error) {
          keepMessageAction(key, actionId);
          throw error;
        }
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
