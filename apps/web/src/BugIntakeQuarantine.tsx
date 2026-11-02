import { useEffect, useRef, useState } from "react";
import { api } from "./api";

type QuarantinePage = {
  items: {
    id: string;
    reason: string | null;
    messageId: string | null;
    createdAt: string;
  }[];
  nextCursor: string | null;
};
const labels: Record<string, string> = {
  UPDATE_ID_COLLISION:
    "Один идентификатор обновления пришёл с разным содержимым",
  REVISION_COLLISION:
    "Разное содержимое сообщения с одинаковым временем правки",
  INVALID_UPDATE: "Неподдерживаемая структура обновления",
  UNSUPPORTED_CONTENT: "Неподдерживаемое содержимое — требуется ручной разбор",
  UNSUPPORTED_UPDATE: "Неподдерживаемый тип обновления",
  OTHER_CHAT: "Источник больше не соответствует разрешённой группе",
  UNSUPPORTED_CHAT: "Неподдерживаемый тип чата",
};
export function BugIntakeQuarantine({
  onSelect,
  onError,
}: {
  onSelect: (id: string) => void;
  onError: (error: unknown) => void;
}) {
  const [page, setPage] = useState<QuarantinePage | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [failed, setFailed] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setInspectId(null);
    setFailed(false);
    void api<QuarantinePage>(
      `/api/operator/bug-intake-quarantine${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          onError(error);
        }
      });
    return () => controller.abort();
    // Scope-keyed parent callbacks; refetch only on explicit page/refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, epoch]);
  return (
    <section aria-label="Обновления, требующие разбора">
      <h3>Требуют разбора</h3>
      <p>
        Эти обновления не считаются обработанными. Повторная отправка в Linear
        отсюда недоступна.
      </p>
      <button
        type="button"
        onClick={() => {
          setCursor(null);
          setEpoch((v) => v + 1);
        }}
      >
        Обновить
      </button>
      {failed ? (
        <p role="alert">Не удалось загрузить список.</p>
      ) : !page ? (
        <p role="status">Загрузка…</p>
      ) : (
        <>
          {!page.items.length && <p>Нет обновлений, требующих разбора.</p>}
          <ul>
            {page.items.map((item) => (
              <li key={item.id}>
                {labels[item.reason ?? ""] ?? "Требуется разбор оператором"} —{" "}
                {new Date(item.createdAt).toLocaleString("ru-RU")}
                <button type="button" onClick={() => setInspectId(item.id)}>
                  Сравнить сохранённые варианты
                </button>
                {item.messageId && (
                  <button
                    type="button"
                    onClick={() => onSelect(item.messageId!)}
                  >
                    Открыть связанную карточку
                  </button>
                )}
              </li>
            ))}
          </ul>
          {page.nextCursor && (
            <button type="button" onClick={() => setCursor(page.nextCursor)}>
              Следующая страница
            </button>
          )}
        </>
      )}
      {inspectId && (
        <QuarantineVariants
          key={inspectId}
          id={inspectId}
          onError={onError}
          onResolved={() => {
            setInspectId(null);
            setEpoch((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}

function QuarantineVariants({
  id,
  onError,
  onResolved,
}: {
  id: string;
  onError: (error: unknown) => void;
  onResolved: () => void;
}) {
  const [variants, setVariants] = useState<Array<{
    hash: string;
    text: string;
    textTruncated: boolean;
    mediaKinds: string[];
    filenames: string[];
  }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commandFailed, setCommandFailed] = useState(false);
  const sending = useRef(false);
  const scope = useRef<AbortController | null>(null);
  const retry = useRef<{ fingerprint: string; actionId: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    void api<{ variants: NonNullable<typeof variants> }>(
      `/api/operator/bug-intake-quarantine/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setVariants(result.variants);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          onError(error);
        }
      });
    return () => {
      controller.abort();
      scope.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  async function resolve(action: "KEEP_CURRENT" | "RETRY_NORMALIZATION") {
    const signal = scope.current?.signal;
    if (
      !signal ||
      signal.aborted ||
      !variants ||
      !reviewed ||
      !reason.trim() ||
      sending.current
    )
      return;
    const payload = {
      action,
      expectedHashes: variants.map((variant) => variant.hash),
      reason: reason.trim(),
      reviewed: true,
    };
    const fingerprint = JSON.stringify(payload);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, actionId: crypto.randomUUID() };
    sending.current = true;
    setBusy(true);
    setCommandFailed(false);
    try {
      await api(
        `/api/operator/bug-intake-quarantine/${encodeURIComponent(id)}/resolve`,
        {
          method: "POST",
          signal,
          body: JSON.stringify({
            ...payload,
            actionId: retry.current.actionId,
          }),
        },
      );
      if (!signal.aborted) onResolved();
    } catch (error) {
      if (!signal.aborted) {
        setCommandFailed(true);
        onError(error);
      }
    } finally {
      sending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  if (failed) return <p role="alert">Варианты недоступны. Обновите список.</p>;
  if (!variants) return <p role="status">Загрузка вариантов…</p>;
  return (
    <section aria-label="Сохранённые варианты обновления">
      <p>
        Показаны текст и типы вложений, не весь исходный пакет. Одинаковый
        видимый текст не означает одинаковое обновление. Выбор варианта пока
        недоступен.
      </p>
      {variants.map((variant, index) => (
        <article key={variant.hash}>
          <h4>
            {index === 0
              ? "Первый полученный вариант"
              : `Конфликтующий вариант ${index}`}
          </h4>
          <code>{variant.hash}</code>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {variant.text}
          </pre>
          {variant.textTruncated && <p>Текст сокращён.</p>}
          <p>Типы содержимого: {variant.mediaKinds.join(", ") || "нет"}</p>
          <ul>
            {variant.filenames.map((name, i) => (
              <li key={i}>{name}</li>
            ))}
          </ul>
        </article>
      ))}
      <fieldset disabled={busy}>
        <legend>Решение оператора</legend>
        <p>
          «Не применять» сохраняет все варианты, но не меняет карточку бага.
          Повторная обработка доступна только для единственного варианта и не
          выбирает победителя конфликта.
        </p>
        <label>
          Причина
          <textarea
            maxLength={1000}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          Я просмотрел варианты и подтверждаю решение
        </label>
        <button
          type="button"
          disabled={!reviewed || !reason.trim()}
          onClick={() => void resolve("KEEP_CURRENT")}
        >
          Не применять это обновление
        </button>
        <button
          type="button"
          disabled={!reviewed || !reason.trim() || variants.length !== 1}
          onClick={() => void resolve("RETRY_NORMALIZATION")}
        >
          Повторить обработку
        </button>
      </fieldset>
      {commandFailed && (
        <p role="alert">
          Решение не сохранено или ответ потерян. Повтор использует тот же
          идентификатор; при изменении вариантов обновите список.
        </p>
      )}
    </section>
  );
}
