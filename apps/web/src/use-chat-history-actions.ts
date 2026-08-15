import { useMemo } from "react";
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
  ) => Promise<{ loaded: number; hasMore: boolean }>;
}

export function useChatHistoryActions(dependencies: {
  /** Stable — `useState`'s setter. */
  setSnapshot: (
    update: (current: GameSnapshot | null) => GameSnapshot | null,
  ) => void;
}): ChatHistoryActions {
  const { setSnapshot } = dependencies;
  return useMemo<ChatHistoryActions>(
    () => ({
      onLoadThreadHistory: async (threadId, before) => {
        const page = await api<{
          messages: ChatMessageDto[];
          hasMore: boolean;
        }>(
          `/api/chat/threads/${threadId}/messages?limit=50` +
            (before === undefined ? "" : `&before=${before}`),
        );
        setSnapshot((current) =>
          current ? mergeChatHistory(current, page.messages) : current,
        );
        return { loaded: page.messages.length, hasMore: page.hasMore };
      },
    }),
    [setSnapshot],
  );
}
