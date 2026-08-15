import { useEffect, useState } from "react";
import type { ChatMessageDto } from "@arken/contracts";
import { useCampaignActions } from "./campaign-actions-context";
import { formatApiError } from "./api";

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
export function useThreadHistory(messages: readonly ChatMessageDto[]) {
  const { chatHistory } = useCampaignActions();
  const [hasMore, setHasMore] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  // Смена потока — это другая история: чужой ответ «страниц больше нет»
  // запретил бы подгрузку там, где она есть.
  const threadId = messages.at(-1)?.threadId;
  useEffect(() => {
    setHasMore(true);
    setError("");
  }, [threadId]);

  const loadOlder = async (thread: string) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      // Курсор — номер самого старого из уже показанных: страница берётся
      // строго до него, поэтому пересечений не бывает даже если в это время
      // пришло новое сообщение.
      const oldest = messages
        .filter((message) => message.threadId === thread)
        .reduce<number | undefined>(
          (min, message) =>
            min === undefined || message.sequence < min
              ? message.sequence
              : min,
          undefined,
        );
      const page = await chatHistory.onLoadThreadHistory(thread, oldest);
      setHasMore(page.hasMore);
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось загрузить старые сообщения"));
    } finally {
      setPending(false);
    }
  };

  return { hasMore, pending, error, loadOlder };
}
