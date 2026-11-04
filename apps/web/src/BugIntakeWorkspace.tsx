import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { BugIntakeApprovedPreview } from "./BugIntakeApprovedPreview";
import { BugIntakeDeliveries } from "./BugIntakeDeliveries";
import { BugIntakeAlbumReview } from "./BugIntakeAlbumReview";
import { BugIntakeQuarantine } from "./BugIntakeQuarantine";
import {
  BugIntakeReviewForm,
  type BugReviewDetail,
} from "./BugIntakeReviewForm";

type QueueItem = { id: string; state: string; revision: number };
type Page = { items: QueueItem[]; nextCursor: string | null };

/** Mount only for an authorized operator; scopeKey changes on account/campaign
 * session changes. Not yet connected to application navigation. */
export function BugIntakeWorkspace({ scopeKey }: { scopeKey: string }) {
  return <Queue key={scopeKey} />;
}
function Queue() {
  const [page, setPage] = useState<Page>({ items: [], nextCursor: null });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BugReviewDetail | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [detailEpoch, setDetailEpoch] = useState(0);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [showQuarantine, setShowQuarantine] = useState(false);
  const revoked = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  function handleFailure(error: unknown) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      revoked.current = true;
      lifetime.current?.abort();
      setDenied(true);
      setPage({ items: [], nextCursor: null });
      setSelected(null);
      setDetail(null);
    }
    setFailed(true);
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      lifetime.current = null;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setFailed(false);
    setPage({ items: [], nextCursor: null });
    setSelected(null);
    setDetail(null);
    const query = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
    void api<Page>(`/api/operator/bug-intake${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted && !revoked.current) setPage(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) handleFailure(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [cursor, epoch]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    if (selected)
      void api<BugReviewDetail>(`/api/operator/bug-intake/${selected}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted && !revoked.current) setDetail(result);
        })
        .catch((error) => {
          if (!controller.signal.aborted) handleFailure(error);
        });
    return () => controller.abort();
  }, [selected, detailEpoch]);
  if (denied)
    return (
      <p role="alert">
        Доступ к очереди недоступен. Закройте окно и войдите с правами
        оператора.
      </p>
    );
  return (
    <section aria-label="Очередь багов Telegram">
      <h2>Очередь багов</h2>
      <button
        type="button"
        aria-expanded={showQuarantine}
        onClick={() => setShowQuarantine((value) => !value)}
      >
        Обновления, требующие разбора
      </button>
      {showQuarantine && (
        <BugIntakeQuarantine
          onError={handleFailure}
          onSelect={(id) => {
            setDetail(null);
            setSelected(id);
            setDetailEpoch((value) => value + 1);
          }}
        />
      )}
      <p>
        Локальная подготовка отчётов. Автоматическая отправка в Linear не
        подключена.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setCursor(null);
          setEpoch((value) => value + 1);
        }}
      >
        Обновить с начала
      </button>
      {busy && <p role="status">Загрузка очереди…</p>}
      {failed && (
        <p role="alert">
          Не удалось загрузить очередь или карточку. Обновите список.
        </p>
      )}
      {!busy && !failed && !page.items.length && <p>Сообщений нет.</p>}
      <ul>
        {page.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={selected === item.id}
              onClick={() => {
                setFailed(false);
                setDetail(null);
                setSelected(item.id);
                setDetailEpoch((value) => value + 1);
              }}
            >
              {item.id.slice(0, 8)} — {item.state}
            </button>
          </li>
        ))}
      </ul>
      {page.nextCursor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setCursor(page.nextCursor)}
        >
          Следующая страница
        </button>
      )}
      {detail?.albumId && (
        <nav aria-label="Части альбома">
          <h3>Сообщения того же альбома</h3>
          <p>
            Подтверждение относится только к открытой карточке. Другие части
            проверяются отдельно; список не гарантирует, что весь альбом уже
            получен.
          </p>
          {detail.albumItems?.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={detail.id === item.id}
              onClick={() => {
                setDetail(null);
                setSelected(item.id);
                setDetailEpoch((value) => value + 1);
              }}
            >
              {item.id.slice(0, 8)} — {item.state}
            </button>
          ))}
          {detail.albumTruncated && (
            <p role="status">
              Показаны первые 50 частей. Альбом требует дополнительного разбора.
            </p>
          )}
        </nav>
      )}
      {detail?.state === "APPROVED" && (
        <BugIntakeApprovedPreview
          key={`${detail.id}:${detail.revision}`}
          id={detail.id}
          revision={detail.revision}
          onError={handleFailure}
        />
      )}
      {detail?.albumId && (
        <BugIntakeAlbumReview
          key={`album:${detail.id}:${detail.revision}`}
          messageId={detail.id}
          onError={handleFailure}
        />
      )}
      {detail && (
        <BugIntakeDeliveries
          key={`deliveries:${detail.id}:${detail.revision}`}
          id={detail.id}
          revision={detail.revision}
          onError={handleFailure}
          onChanged={() => {
            setDetail(null);
            setSelected(null);
            setEpoch((value) => value + 1);
          }}
        />
      )}
      {detail && (
        <BugIntakeReviewForm
          key={`${detail.id}:${detail.revision}`}
          detail={detail}
          onCommand={async (command) => {
            const signal = lifetime.current?.signal;
            if (!signal || signal.aborted) throw new Error("STALE_SCOPE");
            try {
              await api(`/api/operator/bug-intake/${detail.id}/commands`, {
                method: "POST",
                body: JSON.stringify(command),
                signal,
              });
            } catch (error) {
              if (!signal.aborted) handleFailure(error);
              throw error;
            }
            if (!signal.aborted) {
              setDetail(null);
              setSelected(null);
              setEpoch((value) => value + 1);
            }
          }}
        />
      )}
    </section>
  );
}

/** Capability is checked only while the operator workspace is open. */
export function OptionalBugIntakeWorkspace() {
  const [enabled, setEnabled] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ allowed: boolean; bugIntakeEnabled?: boolean }>(
      "/api/operator/feedback/capability",
      { signal: controller.signal },
    )
      .then((capability) => {
        if (!controller.signal.aborted)
          setEnabled(
            capability.allowed && capability.bugIntakeEnabled === true,
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setEnabled(false);
      });
    return () => controller.abort();
  }, []);
  if (!enabled) return null;
  return (
    <section>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        Очередь багов Telegram
      </button>
      {expanded && <BugIntakeWorkspace scopeKey="operator-session" />}
    </section>
  );
}
