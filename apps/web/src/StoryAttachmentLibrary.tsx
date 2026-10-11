import { useCallback, useEffect, useRef, useState } from "react";
import type { StoryAttachmentRecord } from "./story-attachment-api";
import {
  deleteStoryAttachment,
  listStoryAttachments,
} from "./story-attachment-api";
import { Button } from "./design-system/Button";
import "./StoryAttachmentLibrary.css";

function usageText(item: StoryAttachmentRecord) {
  const stories = item.storyRevisionCount;
  const direct = item.directChatReferenceCount;
  const storyText =
    stories === 1
      ? "1 сохранённая версия сюжета"
      : `${stories} сохранённых версий сюжета`;
  const directText =
    direct === 0
      ? "личных сообщений: нет"
      : `личные сообщения: ${direct} ссылк${direct === 1 ? "а" : "и"}`;
  return `${storyText} · ${directText}`;
}

const lifecycleLabel = {
  DRAFT: "Черновик",
  PUBLISHED: "Опубликовано",
  CORRECTED: "Исправлено",
  ARCHIVED: "В архиве",
} as const;

export function StoryAttachmentLibrary({
  campaignId,
  isGm,
}: {
  campaignId: string;
  isGm: boolean;
}) {
  const [items, setItems] = useState<StoryAttachmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await listStoryAttachments();
      if (currentRequest === requestId.current) setItems(result.attachments);
    } catch {
      if (currentRequest === requestId.current)
        setError(
          "Не удалось загрузить вложения. Проверьте подключение и повторите.",
        );
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    requestId.current += 1;
    setItems([]);
    setError("");
    if (isGm) void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [campaignId, isGm, refresh]);

  const remove = async (item: StoryAttachmentRecord) => {
    setBusyId(item.contentId);
    setError("");
    try {
      const result = await deleteStoryAttachment(item.contentId);
      await refresh();
      if (!result.deleted)
        setError(
          "Вложение помечено для удаления, но файл пока не очищен. Повторите очистку позже.",
        );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось удалить вложение.",
      );
    } finally {
      setBusyId(null);
    }
  };

  if (!isGm) return null;
  return (
    <section
      className="story-attachment-library"
      aria-labelledby="story-attachment-title"
      data-campaign-id={campaignId}
    >
      <div className="story-attachment-library__header">
        <div>
          <h2 id="story-attachment-title">Вложения сюжетных записей</h2>
          <p className="story-attachment-library__hint">
            Использование показано агрегированно, без содержимого личных
            переписок. Ссылка ведёт к текущему представлению записи, а не к
            редактированию старой версии. Чтобы заменить файл, загрузите новый в
            редакторе записи — история сохранит предыдущую версию.
          </p>
        </div>
        <Button
          type="button"
          view="outlined"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "Загрузка…" : "Обновить"}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {items.length === 0 && !loading && !error && (
        <p>Нет вложений, доступных для управления.</p>
      )}
      <ul className="story-attachment-library__list">
        {items.map((item) => {
          const used =
            item.storyRevisionCount > 0 || item.directChatReferenceCount > 0;
          const cleanup = item.cleanupPending || item.status === "EXPIRED";
          return (
            <li className="story-attachment-library__item" key={item.contentId}>
              <div>
                <strong>{item.fileName}</strong>
                <p>
                  {usageText(item)} · {Math.ceil(item.sizeBytes / 1024)} КБ
                </p>
                {item.storyReferences.map((reference) => (
                  <p key={`${reference.postId}:${reference.revision}`}>
                    <a
                      href={`#story-post-${reference.postId}`}
                      aria-label={`Перейти к записи ${reference.title || "Без заголовка"}; показывается её текущая версия`}
                    >
                      {reference.title || "Без заголовка"} · версия{" "}
                      {reference.revision}
                    </a>
                    {" · "}
                    {reference.isCurrent ? "текущая" : "предыдущая"}
                    {" · "}
                    {reference.visibility === "GM_ONLY"
                      ? "только мастеру"
                      : lifecycleLabel[reference.lifecycle]}
                  </p>
                ))}
                {cleanup && <p>Ожидает очистки файла.</p>}
              </div>
              <Button
                type="button"
                view={used ? "outlined" : "outlined-danger"}
                disabled={busyId !== null || used}
                onClick={() => void remove(item)}
              >
                {busyId === item.contentId
                  ? "Очистка…"
                  : cleanup
                    ? "Повторить очистку"
                    : used
                      ? "Используется"
                      : "Удалить неиспользуемое"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
