import { useRef, useState } from "react";
import type { ReviewedBugCopy, BugAttachmentState } from "@arken/contracts";

export type BugReviewDetail = {
  id: string;
  revision: number;
  state: string;
  originalText: string;
  authorLabel: string | null;
  sourceUrl: string | null;
  albumId?: string | null;
  albumItems?: { id: string; state: string }[];
  albumTruncated?: boolean;
  files: {
    id: string;
    name: string;
    state: BugAttachmentState;
    exclusionReason: string | null;
    failureCode: string | null;
  }[];
};
export type BugReviewAction =
  | { action: "APPROVE"; copy: ReviewedBugCopy }
  | { action: "DISMISS" }
  | { action: "REOPEN" }
  | { action: "ENQUEUE" }
  | { action: "RETRY_FILE"; fileId: string }
  | { action: "EXCLUDE_FILE"; fileId: string; reason: string };

/** Parent must key by authenticated scope + id + revision. Source is plain text,
 * never HTML. Approval means prepared for transfer, not sent to Linear. */
export function BugIntakeReviewForm({
  detail,
  onCommand,
}: {
  detail: BugReviewDetail;
  onCommand: (
    command: BugReviewAction & { actionId: string; revision: number },
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState(detail.originalText);
  const [reviewed, setReviewed] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const retry = useRef<{ fingerprint: string; actionId: string } | null>(null);
  const unresolved = detail.files.some(
    (file) => file.state !== "STORED" && file.state !== "EXCLUDED",
  );
  async function send(action: BugReviewAction) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    const fingerprint = JSON.stringify({
      id: detail.id,
      revision: detail.revision,
      action,
    });
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, actionId: crypto.randomUUID() };
    try {
      await onCommand({
        ...action,
        revision: detail.revision,
        actionId: retry.current.actionId,
      });
      retry.current = null;
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function invalidateConsent() {
    setReviewed(false);
    setTransfer(false);
  }
  return (
    <section aria-label="Проверка сообщения о баге">
      <h3>Исходное сообщение</h3>
      <p>{detail.authorLabel ?? "Автор не указан"}</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {detail.originalText}
      </pre>
      <p>
        Состояние: {detail.state}. Подтверждение ниже не отправляет сообщение в
        Linear.
      </p>
      <fieldset disabled={busy || detail.state !== "REVIEW"}>
        <legend>Текст для передачи</legend>
        <label>
          Заголовок
          <input
            value={title}
            maxLength={200}
            onChange={(event) => {
              setTitle(event.target.value);
              invalidateConsent();
            }}
          />
        </label>
        <label>
          Описание
          <textarea
            value={description}
            maxLength={50000}
            onChange={(event) => {
              setDescription(event.target.value);
              invalidateConsent();
            }}
          />
        </label>
        <h4>Вложения</h4>
        <p>
          Сохранённые файлы войдут в передачу. Для пропуска укажите причину и
          исключите файл.
        </p>
        {detail.files.map((file) => (
          <div key={file.id}>
            <p>
              {file.name} — {file.state}
              {file.failureCode ? ` (${file.failureCode})` : ""}
            </p>
            {file.state === "STORED" && (
              <a
                href={`/api/operator/bug-intake/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(file.id)}`}
                download
                rel="noreferrer"
              >
                Скачать для проверки
              </a>
            )}
            {file.state === "FAILED" && (
              <button
                type="button"
                onClick={() =>
                  void send({ action: "RETRY_FILE", fileId: file.id })
                }
              >
                Вернуть в очередь загрузки
              </button>
            )}
            {file.state === "EXCLUDED" ? (
              <p>Причина: {file.exclusionReason}</p>
            ) : (
              <>
                <label>
                  Причина исключения {file.name}
                  <input
                    maxLength={1000}
                    value={reasons[file.id] ?? ""}
                    onChange={(event) =>
                      setReasons((previous) => ({
                        ...previous,
                        [file.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={!reasons[file.id]?.trim()}
                  onClick={() =>
                    void send({
                      action: "EXCLUDE_FILE",
                      fileId: file.id,
                      reason: (reasons[file.id] ?? "").trim(),
                    })
                  }
                >
                  Исключить файл
                </button>
              </>
            )}
          </div>
        ))}
        {unresolved && (
          <p role="status">
            Есть незагруженные вложения: дождитесь загрузки или явно исключите
            их.
          </p>
        )}
        <label>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          Я проверил текст и содержимое вложений
        </label>
        <label>
          <input
            type="checkbox"
            checked={transfer}
            onChange={(event) => setTransfer(event.target.checked)}
          />
          Разрешаю передачу выбранного содержания в Linear
        </label>
        <button
          type="button"
          disabled={
            !title.trim() ||
            !description.trim() ||
            !reviewed ||
            !transfer ||
            unresolved
          }
          onClick={() =>
            void send({
              action: "APPROVE",
              copy: {
                title: title.trim(),
                description: description.trim(),
                attachmentIds: detail.files
                  .filter((file) => file.state === "STORED")
                  .map((file) => file.id),
                reviewed: true,
                transferApproved: true,
              },
            })
          }
        >
          Подтвердить подготовленный отчёт
        </button>
        <button type="button" onClick={() => void send({ action: "DISMISS" })}>
          Отклонить сообщение
        </button>
      </fieldset>
      {detail.state === "APPROVED" && (
        <section aria-label="Постановка отчёта в очередь">
          <p>
            В очередь попадёт подтверждённая версия из предпросмотра, а не поля
            формы. Постановка в очередь не означает, что отчёт уже отправлен.
            Для связанной задачи изменения будут добавлены комментарием.
          </p>
          {detail.albumId && <p>Для альбома сначала требуется общая проверка всех частей.
            Отправка отдельной части пока недоступна.</p>}
          <button type="button" disabled={busy || Boolean(detail.albumId)}
            onClick={() => void send({ action: "ENQUEUE" })}>
            Поставить подтверждённый отчёт в очередь
          </button>
          <p>Результат смотрите в истории отправок. Повтор этой команды не
            перезапускает завершённую или неопределённую отправку.</p>
        </section>
      )}
      {detail.state !== "REVIEW" && (
        <>
          <p>
            Повторная проверка отменит прежнее согласие. Связь с существующей
            задачей сохранится; текст потребуется проверить заново.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send({ action: "REOPEN" })}
          >
            Вернуть на проверку
          </button>
        </>
      )}
      {failed && (
        <p role="alert">
          Команда не выполнена или ответ не получен. Повтор использует тот же
          идентификатор; при конфликте обновите карточку.
        </p>
      )}
    </section>
  );
}
