import { useLayoutEffect, useRef, useState } from "react";
import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";
import { useCampaignActions } from "./campaign-actions-context";
import { formatApiError } from "./api";

const HISTORY_TOP_THRESHOLD_PX = 32;

/**
 * История загружается только после реального движения вверх к началу списка.
 * Это не даёт программному initial scroll или короткому не-scrollable списку
 * самопроизвольно выкачать всю историю; явная кнопка остаётся fallback.
 */
export function shouldLoadOlderAfterScroll(input: {
  previousScrollTop: number | null;
  scrollTop: number;
  hasMore: boolean;
  pending: boolean;
}) {
  return (
    input.hasMore &&
    !input.pending &&
    input.previousScrollTop !== null &&
    input.scrollTop < input.previousScrollTop &&
    input.scrollTop <= HISTORY_TOP_THRESHOLD_PX
  );
}

/**
 * UIX-450 — состояние подгрузки старых сообщений одного потока.
 *
 * Отдельным хуком, а не внутри панели, по двум причинам. Во-первых, панелей
 * две (общая лента и личные диалоги), и обе делают одно и то же. Во-вторых,
 * тут есть решение, которое стоит держать в одном месте: `hasMore` изначально
 * **истина**.
 *
 * Иначе кнопка «показать более ранние» не появлялась бы никогда, пока человек
 * не нажмёт её хоть раз, — а нажать нечего. Сервер отвечает на этот вопрос
 * только после первого запроса, значит до него надо предполагать, что история
 * есть: пустой поток покажет кнопку один раз и уберёт её, а это гораздо
 * меньшая беда, чем недоступная история.
 */
export function useThreadHistory(
  authority: GameSnapshot | null,
  threadId: string | null | undefined,
  messages: readonly ChatMessageDto[],
) {
  const { chatHistory } = useCampaignActions();
  const [hasMore, setHasMore] = useState(Boolean(threadId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [commitEvidence, setCommitEvidence] = useState<{
    generation: number;
    authority: GameSnapshot;
    campaignId: string;
    membershipId: string;
    threadId: string;
    messageIds: string[];
    hasMore: boolean;
  } | null>(null);
  const activeThreadRef = useRef(threadId);
  const generationRef = useRef(0);
  const pendingRef = useRef(false);
  const commitResolverRef = useRef<{
    generation: number;
    resolve: () => void;
  } | null>(null);
  let messageCount = 0;
  let oldestSequence: number | undefined;
  for (const message of messages) {
    if (message.threadId !== threadId) continue;
    messageCount += 1;
    if (oldestSequence === undefined || message.sequence < oldestSequence)
      oldestSequence = message.sequence;
  }
  const historyWindowRef = useRef({
    threadId,
    messageCount,
    oldestSequence,
  });

  // Layout effect фиксирует новый generation в той же commit-фазе, до того
  // как поздний HTTP callback сможет обновить уже показанный другой диалог.
  useLayoutEffect(() => {
    commitResolverRef.current?.resolve();
    commitResolverRef.current = null;
    activeThreadRef.current = threadId;
    generationRef.current += 1;
    pendingRef.current = false;
    setHasMore(Boolean(threadId));
    setPending(false);
    setError("");
    setCommitEvidence(null);
    return () => {
      commitResolverRef.current?.resolve();
      commitResolverRef.current = null;
      generationRef.current += 1;
      pendingRef.current = false;
    };
  }, [threadId]);

  // Full snapshots intentionally replace loaded history with their latest
  // bounded window. If the same thread suddenly becomes shorter (or its
  // oldest sequence moves forward), the previous `hasMore=false` no longer
  // describes what is on screen. Invalidate any in-flight page and make the
  // explicit history control available again instead of merging pages from
  // the superseded authoritative snapshot.
  useLayoutEffect(() => {
    const previous = historyWindowRef.current;
    const truncated =
      Boolean(threadId) &&
      previous.threadId === threadId &&
      (messageCount < previous.messageCount ||
        (previous.oldestSequence !== undefined &&
          oldestSequence !== undefined &&
          oldestSequence > previous.oldestSequence));
    historyWindowRef.current = { threadId, messageCount, oldestSequence };
    if (!truncated) return;

    commitResolverRef.current?.resolve();
    commitResolverRef.current = null;
    generationRef.current += 1;
    pendingRef.current = false;
    setHasMore(true);
    setPending(false);
    setError("");
    setCommitEvidence(null);
  }, [threadId, messageCount, oldestSequence]);

  // `setSnapshot` is asynchronous: an accepted guarded updater is not proof
  // that it won React's queue. Wait for a committed authority object. A real
  // merge contains every returned message ID; a queued replacement followed
  // by the guarded no-op does not. Empty/duplicate pages still force a fresh
  // snapshot object in the action, so they cross the same commit boundary.
  useLayoutEffect(() => {
    if (!commitEvidence) return;
    if (
      generationRef.current !== commitEvidence.generation ||
      activeThreadRef.current !== commitEvidence.threadId
    ) {
      commitResolverRef.current?.resolve();
      commitResolverRef.current = null;
      setCommitEvidence(null);
      return;
    }
    if (authority === commitEvidence.authority) return;

    const committedMessageIds = new Set(
      messages
        .filter((message) => message.threadId === commitEvidence.threadId)
        .map((message) => message.id),
    );
    const applied =
      authority !== null &&
      authority.campaign.id === commitEvidence.campaignId &&
      authority.me.id === commitEvidence.membershipId &&
      authority.chatThreads.some(
        (thread) => thread.id === commitEvidence.threadId,
      ) &&
      commitEvidence.messageIds.every((id) => committedMessageIds.has(id));

    setHasMore(applied ? commitEvidence.hasMore : Boolean(threadId));
    pendingRef.current = false;
    setPending(false);
    setCommitEvidence(null);
    if (commitResolverRef.current?.generation === commitEvidence.generation) {
      commitResolverRef.current.resolve();
      commitResolverRef.current = null;
    }
  }, [authority, commitEvidence, messages, threadId]);

  const loadOlder = async () => {
    if (!threadId || pendingRef.current) return;
    const generation = generationRef.current;
    pendingRef.current = true;
    setPending(true);
    setError("");
    const authorityAtRequest = authority;
    let awaitingCommit = false;
    try {
      // Курсор — номер самого старого из уже показанных: страница берётся
      // строго до него, поэтому пересечений не бывает даже если в это время
      // пришло новое сообщение.
      const oldest = messages
        .filter((message) => message.threadId === threadId)
        .reduce<number | undefined>(
          (min, message) =>
            min === undefined || message.sequence < min
              ? message.sequence
              : min,
          undefined,
        );
      const page = await chatHistory.onLoadThreadHistory(threadId, oldest);
      if (
        generationRef.current !== generation ||
        activeThreadRef.current !== threadId
      )
        return;
      // A response rejected before queueing its guarded update cannot answer
      // whether the replacement window has more history.
      if (!page.accepted || !authorityAtRequest) {
        setHasMore(Boolean(threadId));
        return;
      }
      awaitingCommit = true;
      const committed = new Promise<void>((resolve) => {
        commitResolverRef.current = { generation, resolve };
      });
      setCommitEvidence({
        generation,
        authority: authorityAtRequest,
        campaignId: authorityAtRequest.campaign.id,
        membershipId: authorityAtRequest.me.id,
        threadId,
        messageIds: page.messageIds,
        hasMore: page.hasMore,
      });
      await committed;
    } catch (reason) {
      if (
        generationRef.current !== generation ||
        activeThreadRef.current !== threadId
      )
        return;
      setError(formatApiError(reason, "Не удалось загрузить старые сообщения"));
    } finally {
      if (
        generationRef.current === generation &&
        activeThreadRef.current === threadId &&
        !awaitingCommit
      ) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };

  return { hasMore, pending, error, loadOlder };
}
