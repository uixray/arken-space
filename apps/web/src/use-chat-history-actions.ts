import {
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";
import { api } from "./api";
import { mergeChatHistory } from "./chat-state";

/**
 * UIX-450 — подгрузка старых сообщений.
 *
 * Появилась затем, чтобы снапшот перестал возить историю всем при каждом
 * действии: до этого взять её было неоткуда, и он вёз по 200 сообщений на
 * поток семь раз за одно движение токена — две трети всего трафика рассылки.
 *
 * Возвращает, есть ли ещё страницы: без этого лента не знает, показывать ли
 * кнопку, и либо теряет доступ к истории, либо предлагает несуществующее.
 */
export interface ChatHistoryActions {
  onLoadThreadHistory: (
    threadId: string,
    before?: number,
  ) => Promise<{
    loaded: number;
    hasMore: boolean;
    /** The guarded updater was queued; committed message IDs are final proof. */
    accepted: boolean;
    messageIds: string[];
  }>;
}

export function useChatHistoryActions(dependencies: {
  /** Stable — `useState`'s setter. */
  setSnapshot: Dispatch<SetStateAction<GameSnapshot | null>>;
  /** Latest committed authority; a history page may never cross its boundary. */
  snapshotRef: MutableRefObject<GameSnapshot | null>;
}): ChatHistoryActions {
  const { setSnapshot, snapshotRef } = dependencies;
  return useMemo<ChatHistoryActions>(
    () => ({
      onLoadThreadHistory: async (threadId, before) => {
        // Capture the exact authoritative object, identity and thread before
        // the request leaves. A hand-off, logout/login or full snapshot may
        // replace it while HTTP is in flight; that old page must then become
        // inert rather than enter the new user's global messages/activity.
        const capturedSnapshot = snapshotRef.current;
        const capturedThread = capturedSnapshot?.chatThreads.find(
          (thread) => thread.id === threadId,
        );
        if (!capturedSnapshot || !capturedThread)
          return {
            loaded: 0,
            hasMore: true,
            accepted: false,
            messageIds: [],
          };
        const capturedCampaignId = capturedSnapshot.campaign.id;
        const capturedMembershipId = capturedSnapshot.me.id;

        const page = await api<{
          messages: ChatMessageDto[];
          hasMore: boolean;
        }>(
          `/api/chat/threads/${threadId}/messages?limit=50` +
            (before === undefined ? "" : `&before=${before}`),
        );
        const authorityAfterRequest = snapshotRef.current;
        if (
          authorityAfterRequest !== capturedSnapshot ||
          authorityAfterRequest.campaign.id !== capturedCampaignId ||
          authorityAfterRequest.me.id !== capturedMembershipId ||
          !authorityAfterRequest.chatThreads.some(
            (thread) => thread === capturedThread && thread.id === threadId,
          )
        )
          return {
            loaded: 0,
            hasMore: page.hasMore,
            accepted: false,
            messageIds: page.messages.map((message) => message.id),
          };

        const mergedSnapshot = mergeChatHistory(
          capturedSnapshot,
          page.messages,
        );
        setSnapshot((current) => {
          if (
            current !== capturedSnapshot ||
            snapshotRef.current !== capturedSnapshot ||
            current.campaign.id !== capturedCampaignId ||
            current.me.id !== capturedMembershipId ||
            !current.chatThreads.some(
              (thread) => thread === capturedThread && thread.id === threadId,
            )
          )
            return current;
          // Even an empty/duplicate page needs a commit boundary: the hook
          // only trusts `hasMore` after it observes the queued guarded update.
          return mergedSnapshot === current ? { ...current } : mergedSnapshot;
        });
        return {
          loaded: page.messages.length,
          hasMore: page.hasMore,
          accepted: true,
          messageIds: page.messages.map((message) => message.id),
        };
      },
    }),
    [setSnapshot, snapshotRef],
  );
}
