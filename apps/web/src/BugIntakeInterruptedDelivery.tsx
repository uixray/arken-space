import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export function BugIntakeInterruptedDelivery({ messageId, revision, deliveryId,
  updatedAt, onError, onSaved, confirmSent = false, confirmNotSent = false, knownIssueId, album = false }: { album?: boolean; messageId: string; revision: number;
  deliveryId: string; updatedAt: string; onError: (error: unknown) => void;
  onSaved: () => void; confirmSent?: boolean; confirmNotSent?: boolean; knownIssueId?: string | null }) {
  const [evidence, setEvidence] = useState("");
  const [verified, setVerified] = useState(false);
  const [contentVerified, setContentVerified] = useState(false);
  const [issueId, setIssueId] = useState(knownIssueId ?? "");
  const issueValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issueId.trim());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const retry = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  async function save() {
    const signal = lifetime.current?.signal;
    if (pending.current || !verified || !evidence.trim() || !signal || signal.aborted) return;
    if (confirmSent && (!contentVerified || !issueValid)) return;
    if (confirmNotSent && !contentVerified) return;
    pending.current = true; setBusy(true); setFailed(false);
    const command = { action: album ? (confirmSent ? "CONFIRM_SENT" : confirmNotSent ? "CONFIRM_NOT_SENT" : "MARK_INTERRUPTED") : (confirmSent ? "CONFIRM_DELIVERY_SENT" : confirmNotSent ? "CONFIRM_DELIVERY_NOT_SENT" : "MARK_INTERRUPTED_DELIVERY_UNKNOWN"), revision,
      deliveryId, expectedUpdatedAt: updatedAt, workerTerminationVerified: true,
      evidence: evidence.trim(), ...(confirmSent ? {
        linearIssueId: issueId.trim(), externalContentVerified: true,
      } : confirmNotSent ? { externalAbsenceVerified: true } : {}) };
    const fingerprint = JSON.stringify(command);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, id: crypto.randomUUID() };
    try {
      await api(`/api/operator/bug-intake/${encodeURIComponent(messageId)}/${album ? "album-reconcile" : "commands"}`, {
        method: "POST", signal,
        body: JSON.stringify({ ...command, actionId: retry.current.id }),
      });
      if (!signal.aborted) onSaved();
    } catch (error) {
      if (!signal.aborted) { setFailed(true); onError(error); }
    } finally {
      pending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  return <fieldset disabled={busy}>
    <legend>{confirmSent ? "Подтвердить доставку после сверки" : confirmNotSent ? "Подтвердить отсутствие результата" : "Зафиксировать прерванную попытку"}</legend>
    <p>Сначала проверьте остановку процесса отправителя. Давность записи или
      отсутствие ответа не доказывают остановку. Секреты в обоснование не вставляйте.</p>
    <label>Результаты проверки и обоснование
      <textarea value={evidence} maxLength={2000} onChange={(event) => {
        setEvidence(event.target.value); setVerified(false); setContentVerified(false);
      }} />
    </label>
    <label><input type="checkbox" checked={verified}
      onChange={(event) => setVerified(event.target.checked)} />
      Остановка отправителя подтверждена по состоянию процесса</label>
    {confirmSent && <>
      <label>UUID существующей задачи Linear
        <input value={issueId} readOnly={Boolean(knownIssueId)} maxLength={36}
          onChange={(event) => { setIssueId(event.target.value); setContentVerified(false); }} />
      </label>
      <label><input type="checkbox" checked={contentVerified}
        onChange={(event) => setContentVerified(event.target.checked)} />
        В Linear проверены текст и все вложения именно этой отправленной версии
      </label>
      <p>Для изменения существующего бага проверьте комментарий, а не только наличие задачи.</p>
    </>}
    {confirmNotSent && <>
      <p>Отсутствие ответа или результата поиска недостаточно. Нужны проверяемые
        основания, что эта попытка не создала задачу или комментарий. Если результат
        частичный или неизвестен — оставьте неопределённый статус.</p>
      <label><input type="checkbox" checked={contentVerified}
        onChange={(event) => setContentVerified(event.target.checked)} />
        Проверено отсутствие результата именно этой попытки, обоснование указано выше
      </label>
      <p>Отчёт вернётся на ручную проверку. Автоматической повторной отправки не будет.</p>
    </>}
    <button type="button" disabled={!verified || !evidence.trim() ||
      (confirmSent && (!contentVerified || !issueValid)) || (confirmNotSent && !contentVerified)} onClick={() => void save()}>
      {confirmSent ? "Зафиксировать подтверждённую доставку" : confirmNotSent ? "Отменить попытку и вернуть отчёт на проверку" : "Отметить результат как неизвестный"}
    </button>
    <p>Это не повторная отправка и не подтверждение отсутствия задачи в Linear.</p>
    {failed && <p role="alert">Не удалось сохранить решение. При конфликте обновите историю.</p>}
  </fieldset>;
}

