import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export function BugIntakeUploadRecovery({ messageId, revision, deliveryId, updatedAt,
  file, onError, onSaved, album = false }: { album?: boolean; messageId: string; revision: number; deliveryId: string;
  updatedAt: string; file: { id: string; sha256: string; sizeBytes: number };
  onError: (error: unknown) => void; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [verified, setVerified] = useState(false);
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
    if (pending.current || !signal || signal.aborted || !verified || !url.trim() || !evidence.trim()) return;
    pending.current = true; setBusy(true); setFailed(false);
    const command = { revision, deliveryId, expectedUpdatedAt: updatedAt,
      file: { id: file.id, sha256: file.sha256, sizeBytes: file.sizeBytes, assetUrl: url.trim() },
      workerTerminationVerified: true, externalBytesVerified: true, evidence: evidence.trim() };
    const fingerprint = JSON.stringify(command);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, id: crypto.randomUUID() };
    try {
      await api(`/api/operator/bug-intake/${encodeURIComponent(messageId)}/${album ? "album-recover-upload" : "recover-upload"}`, {
        method: "POST", signal,
        body: JSON.stringify({ ...command, actionId: retry.current.id }),
      });
      if (!signal.aborted) onSaved();
    } catch (error) {
      if (!signal.aborted) { setFailed(true); onError(error); }
    } finally {
      pending.current = false; if (!signal.aborted) setBusy(false);
    }
  }
  return <fieldset disabled={busy}>
    <legend>Восстановить запись уже загруженного файла</legend>
    <p>Проверьте размер и SHA-256 именно удалённого файла. Наличие ссылки не доказывает
      загрузку. Процесс отправителя должен быть остановлен.</p>
    <label>Постоянная ссылка хранилища Linear
      <input type="url" value={url} maxLength={2048} onChange={(event) => {
        setUrl(event.target.value); setVerified(false);
      }} />
    </label>
    <p>Не вставляйте временную ссылку загрузки, параметры авторизации или токены.</p>
    <label>Как проверены файл и остановка процесса
      <textarea value={evidence} maxLength={2000} onChange={(event) => {
        setEvidence(event.target.value); setVerified(false);
      }} />
    </label>
    <label><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
      Размер и хеш удалённого файла совпали; остановка отправителя подтверждена
    </label>
    <button type="button" disabled={!verified || !url.trim() || !evidence.trim()} onClick={() => void save()}>
      Восстановить запись без повторной загрузки
    </button>
    {failed && <p role="alert">Запись не сохранена или ответ потерян. Повтор использует тот же ID действия; при конфликте обновите карточку.</p>}
  </fieldset>;
}

