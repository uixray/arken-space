import { useEffect, useState } from "react";
import { api } from "./api";
import { BugIntakeInterruptedDelivery } from "./BugIntakeInterruptedDelivery";
import { BugIntakeDeliverySnapshot } from "./BugIntakeDeliverySnapshot";

type Page = { items: { id: string; approvedRevision: number; state: string;
  linearIssueId: string | null; failureCode: string | null; updatedAt: string }[];
  nextCursor: string | null };
const labels: Record<string, string> = {
  QUEUED: "В очереди", CLAIMED: "Попытка начата — результат ещё не записан",
  SENT: "Отправлено", UNKNOWN: "Результат неизвестен — нужна сверка",
  CANCELLED: "Отправка отменена",
};

/** Read-only status panel. Parent keys by message/revision and owns auth scope. */
export function BugIntakeDeliveries({ id, revision, onError, onChanged, album = false }: {
  id: string; revision: number; onError: (error: unknown) => void; onChanged: () => void; album?: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setFailed(false);
    const suffix = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
    void api<Page>(`/api/operator/bug-intake/${encodeURIComponent(id)}/${album ? "album-deliveries" : "deliveries"}${suffix}`,
      { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setPage(result);
    }).catch((error) => {
      if (!controller.signal.aborted) { setFailed(true); onError(error); }
    });
    return () => controller.abort();
    // Error handling belongs to the scope-keyed parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cursor, epoch, album]);
  return <section aria-label="История отправок">
    <h3>История отправок</h3>
    <p>«Попытка начата» не подтверждает, что отправитель сейчас работает.
      Неизвестный результат нужно сверить перед повторной отправкой.</p>
    <button type="button" onClick={() => { setCursor(null); setEpoch((n) => n + 1); }}>
      Обновить историю
    </button>
    {failed ? <p role="alert">Не удалось загрузить историю отправок.</p> :
      !page ? <p role="status">Загрузка истории…</p> : <>
        {page.items.length === 0 && <p>На этой странице отправок нет.</p>}
        <ul>{page.items.map((item) => <li key={item.id}>
          Версия {item.approvedRevision}: {labels[item.state] ?? "Неизвестный статус"}
          {item.linearIssueId && <p>ID задачи Linear: {item.linearIssueId}</p>}
          {item.failureCode && <p>Код: {item.failureCode}</p>}
          <small>Обновлено: {item.updatedAt}</small>
          {item.state === "CLAIMED" && <BugIntakeInterruptedDelivery
            key={`${item.id}:${item.updatedAt}`} messageId={id} revision={revision} album={album}
            deliveryId={item.id} updatedAt={item.updatedAt} onError={onError}
            onSaved={() => setEpoch((n) => n + 1)} />}
          {item.state === "UNKNOWN" && <BugIntakeDeliverySnapshot
            key={`confirm:${item.id}:${item.updatedAt}`} messageId={id} revision={revision} album={album}
            deliveryId={item.id} updatedAt={item.updatedAt} onError={onError}
            knownIssueId={item.linearIssueId} onSaved={onChanged} />}
        </li>)}</ul>
        {page.nextCursor && <button type="button" onClick={() => setCursor(page.nextCursor)}>
          Следующая страница
        </button>}
        <p>Порядок по идентификатору, не по времени отправки.</p>
      </>}
  </section>;
}

