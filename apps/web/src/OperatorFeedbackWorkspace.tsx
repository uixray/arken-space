import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./design-system/Button";
import { ArkenDialog } from "./ui/ArkenDialog";
import { ApiError } from "./api";
import { OperatorFeedbackFilters } from "./OperatorFeedbackFilters";
import {
  fetchAttachment,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUS_LABELS,
  fetchFeedbackDetail,
  fetchFeedbackList,
  fetchRedactedExport,
  OPERATOR_FEEDBACK_TITLE,
  transitionPayload,
  transitions,
  updateFeedback,
  type FeedbackDetail,
  type FeedbackListItem,
  type FeedbackStatus,
  type FeedbackListQuery,
} from "./operator-feedback";
import "./OperatorFeedbackWorkspace.css";

const safeError = "Операция не выполнена. Попробуйте снова.";

/**
 * UIX-395: memoized since this panel is self-fetching (fetches its own list
 * via `refreshList`/`fetchFeedbackDetail` on `open`, not driven by
 * `GameSnapshot`) — only `open`/`onClose` come from the parent, so a stable
 * `onClose` (see `closeWorkspace` in `Sidebar.tsx`) lets this panel skip
 * re-rendering on every unrelated realtime snapshot event.
 */
export const OperatorFeedbackWorkspace = memo(
  function OperatorFeedbackWorkspace({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) {
    const [items, setItems] = useState<FeedbackListItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [listBusy, setListBusy] = useState(false);
    const [listError, setListError] = useState(false);
    const filters = useRef<FeedbackListQuery>({});
    const retryCursor = useRef<string | undefined>(undefined);
    const [detail, setDetail] = useState<FeedbackDetail | null>(null);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [linearKey, setLinearKey] = useState("");
    const [linearUrl, setLinearUrl] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const scope = useRef(0);
    const image = useRef<string | null>(null);
    const detailHeading = useRef<HTMLHeadingElement | null>(null);
    const selectedReportId = detail?.id;
    useEffect(() => {
      if (selectedReportId) detailHeading.current?.focus();
    }, [selectedReportId]);

    const closeImage = useCallback(() => {
      if (image.current) URL.revokeObjectURL(image.current);
      image.current = null;
      setImageUrl(null);
    }, []);
    const clearSensitive = useCallback(() => {
      scope.current += 1;
      setDetail(null);
      setLinearKey("");
      setLinearUrl("");
      setBusy(false);
      closeImage();
    }, [closeImage]);
    const closeIfUnauthorized = useCallback(
      (reason: unknown) => {
        if (
          !(reason instanceof ApiError) ||
          ![401, 403].includes(reason.status)
        )
          return false;
        clearSensitive();
        setItems([]);
        setNextCursor(null);
        setListBusy(false);
        setListError(false);
        setError("");
        setNotice("");
        onClose();
        return true;
      },
      [clearSensitive, onClose],
    );
    const refreshList = useCallback(async (cursor?: string) => {
      const requestScope = scope.current;
      setListBusy(true);
      setListError(false);
      retryCursor.current = cursor;
      try {
        const response = await fetchFeedbackList({
          ...filters.current,
          ...(cursor ? { cursor } : {}),
        });
        if (requestScope !== scope.current) return;
        setItems((current) =>
          cursor
            ? [
                ...current,
                ...response.items.filter(
                  (item) =>
                    !current.some((existing) => existing.id === item.id),
                ),
              ]
            : response.items,
        );
        setNextCursor(response.nextCursor);
      } finally {
        if (requestScope === scope.current) setListBusy(false);
      }
    }, []);
    const loadList = useCallback(
      (cursor?: string) => {
        const requestScope = scope.current;
        void refreshList(cursor).catch((reason) => {
          if (requestScope !== scope.current) return;
          if (!closeIfUnauthorized(reason)) setListError(true);
        });
      },
      [refreshList, closeIfUnauthorized],
    );
    useEffect(
      () => () => {
        scope.current += 1;
        if (image.current) URL.revokeObjectURL(image.current);
        image.current = null;
      },
      [],
    );
    useEffect(() => {
      if (!open) {
        clearSensitive();
        filters.current = {};
        setItems([]);
        setNextCursor(null);
        setListBusy(false);
        setListError(false);
        return;
      }
      setError("");
      loadList();
    }, [open, loadList, clearSensitive]);

    async function select(id: string) {
      clearSensitive();
      const requestScope = scope.current;
      setError("");
      setNotice("");
      setBusy(true);
      try {
        const next = await fetchFeedbackDetail(id);
        if (requestScope === scope.current) setDetail(next);
      } catch (reason) {
        if (requestScope === scope.current && !closeIfUnauthorized(reason))
          setError(safeError);
      } finally {
        if (requestScope === scope.current) setBusy(false);
      }
    }
    async function transition(status: FeedbackStatus) {
      if (!detail) return;
      const payload = transitionPayload(status, linearKey, linearUrl);
      if (!payload) {
        setError("Укажите корректные ключ и URL задачи Linear.");
        return;
      }
      const id = detail.id;
      const requestScope = scope.current;
      setBusy(true);
      setError("");
      setNotice("");
      closeImage();
      try {
        await updateFeedback(id, payload);
        if (requestScope !== scope.current) return;
        const next = await fetchFeedbackDetail(id);
        if (requestScope !== scope.current) return;
        setDetail(next);
        await refreshList();
        if (requestScope !== scope.current) return;
        setLinearKey("");
        setLinearUrl("");
      } catch (reason) {
        if (requestScope !== scope.current) return;
        if (closeIfUnauthorized(reason)) return;
        setDetail(null);
        setError(safeError);
      } finally {
        if (requestScope === scope.current) setBusy(false);
      }
    }
    async function reveal() {
      if (!detail) return;
      const requestScope = scope.current;
      setBusy(true);
      setError("");
      closeImage();
      try {
        const next = await fetchFeedbackDetail(detail.id, true);
        if (requestScope === scope.current) setDetail(next);
      } catch (reason) {
        if (requestScope !== scope.current) return;
        if (closeIfUnauthorized(reason)) return;
        setDetail(null);
        setError(safeError);
      } finally {
        if (requestScope === scope.current) setBusy(false);
      }
    }
    async function copy() {
      if (!detail) return;
      const requestScope = scope.current;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const data = await fetchRedactedExport(detail.id);
        if (requestScope !== scope.current) return;
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        if (requestScope === scope.current)
          setNotice("Обезличенная копия скопирована.");
      } catch (reason) {
        if (requestScope === scope.current && !closeIfUnauthorized(reason))
          setError("Не удалось скопировать. Попробуйте снова.");
      } finally {
        if (requestScope === scope.current) setBusy(false);
      }
    }
    async function openAttachment(attachmentId: string) {
      if (!detail) return;
      const requestScope = scope.current;
      closeImage();
      setBusy(true);
      setError("");
      try {
        const blob = await fetchAttachment(detail.id, attachmentId);
        if (requestScope !== scope.current) return;
        image.current = URL.createObjectURL(blob);
        setImageUrl(image.current);
      } catch (reason) {
        if (requestScope === scope.current && !closeIfUnauthorized(reason))
          setError("Не удалось открыть изображение.");
      } finally {
        if (requestScope === scope.current) setBusy(false);
      }
    }

    return (
      <ArkenDialog
        open={open}
        title={OPERATOR_FEEDBACK_TITLE}
        variant="workspace"
        footer={false}
        className="operator-feedback"
        onClose={() => {
          clearSensitive();
          onClose();
        }}
      >
        <div className="operator-feedback__grid">
          <nav aria-label={OPERATOR_FEEDBACK_TITLE}>
            <OperatorFeedbackFilters
              disabled={busy || listBusy}
              onApply={(query) => {
                clearSensitive();
                filters.current = query;
                setItems([]);
                setNextCursor(null);
                loadList();
              }}
            />
            {listError && (
              <div role="alert">
                <p>Не удалось загрузить обращения.</p>
                <Button
                  disabled={listBusy}
                  onClick={() => loadList(retryCursor.current)}
                >
                  Повторить загрузку
                </Button>
              </div>
            )}
            <p role="status">
              {listBusy ? "Загрузка обращений…" : `Загружено: ${items.length}`}
            </p>
            {!listBusy && !listError && items.length === 0 && (
              <p>По выбранным фильтрам обращений нет.</p>
            )}
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={busy || listBusy}
                onClick={() => void select(item.id)}
              >
                <b>{FEEDBACK_KIND_LABELS[item.kind]}</b>
                <span>
                  {FEEDBACK_STATUS_LABELS[item.status]} /{" "}
                  {new Date(item.createdAt).toLocaleString("ru-RU")}
                </span>
                <small>
                  Сборка:{" "}
                  {item.buildVersion ?? item.buildRevision ?? "Не указана"}
                </small>
              </button>
            ))}
            {nextCursor && (
              <Button
                disabled={busy || listBusy}
                onClick={() => loadList(nextCursor)}
              >
                Загрузить ещё
              </Button>
            )}
          </nav>
          <section>
            {error && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
            {detail ? (
              <>
                <h3 ref={detailHeading} tabIndex={-1}>
                  {detail.title}
                </h3>
                <p>{detail.description}</p>
                <p>Статус: {FEEDBACK_STATUS_LABELS[detail.status]}</p>
                {transitions[detail.status].includes("LINKED") && (
                  <div>
                    <label>
                      Ключ Linear
                      <input
                        value={linearKey}
                        onChange={(event) => setLinearKey(event.target.value)}
                        placeholder="UIX-318"
                      />
                    </label>
                    <label>
                      URL задачи Linear
                      <input
                        value={linearUrl}
                        onChange={(event) => setLinearUrl(event.target.value)}
                        placeholder="https://linear.app/.../issue/UIX-318/..."
                      />
                    </label>
                  </div>
                )}
                <div>
                  {transitions[detail.status].map((status) => {
                    const payload = transitionPayload(
                      status,
                      linearKey,
                      linearUrl,
                    );
                    return (
                      <Button
                        key={status}
                        disabled={busy || payload === null}
                        onClick={() => void transition(status)}
                      >
                        {FEEDBACK_STATUS_LABELS[status]}
                      </Button>
                    );
                  })}
                </div>
                <Button disabled={busy} onClick={() => void reveal()}>
                  Показать чувствительные данные
                </Button>
                <Button disabled={busy} onClick={() => void copy()}>
                  Копировать обезличенную версию
                </Button>
                {detail.contact !== undefined && (
                  <pre>
                    {detail.contact}
                    {"\n"}
                    {JSON.stringify(detail.diagnostics, null, 2)}
                  </pre>
                )}
                {detail.attachments.map((attachment) => (
                  <Button
                    disabled={busy}
                    key={attachment.id}
                    onClick={() => void openAttachment(attachment.id)}
                  >
                    Открыть изображение
                  </Button>
                ))}
                {imageUrl && (
                  <img src={imageUrl} alt="Вложение обратной связи" />
                )}
              </>
            ) : (
              <p>
                {busy
                  ? "Загрузка…"
                  : "Выберите сообщение. Детали по умолчанию скрыты."}
              </p>
            )}
          </section>
        </div>
      </ArkenDialog>
    );
  },
);
