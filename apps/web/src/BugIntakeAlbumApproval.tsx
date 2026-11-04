import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Keyed by album revision/fingerprint: no consent survives a new snapshot. */
export function BugIntakeAlbumApproval({
  messageId,
  revision,
  fingerprint,
  files,
  onError,
  onSaved,
}: {
  messageId: string;
  revision: number;
  fingerprint: string;
  files: { id: string; name: string; state: string }[];
  onError: (error: unknown) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const retry = useRef<{ content: string; actionId: string } | null>(null);
  const selected = files.filter((file) => file.state === "STORED");
  const unresolved = files.some(
    (file) => file.state !== "STORED" && file.state !== "EXCLUDED",
  );
  const ready =
    reviewed &&
    approved &&
    !!title.trim() &&
    !!description.trim() &&
    !unresolved &&
    selected.length <= 20;
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  function revokeConsent() {
    setReviewed(false);
    setApproved(false);
  }
  async function save() {
    const signal = lifetime.current?.signal;
    if (!ready || pending.current || !signal || signal.aborted) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    const command = {
      revision,
      fingerprint,
      copy: {
        title: title.trim(),
        description: description.trim(),
        attachmentIds: selected.map((file) => file.id),
        reviewed: true,
        transferApproved: true,
      },
    };
    const content = JSON.stringify(command);
    if (retry.current?.content !== content)
      retry.current = { content, actionId: crypto.randomUUID() };
    try {
      await api(
        `/api/operator/bug-intake/${encodeURIComponent(messageId)}/album-approval`,
        {
          method: "POST",
          signal,
          body: JSON.stringify({
            ...command,
            actionId: retry.current.actionId,
          }),
        },
      );
      if (!signal.aborted) onSaved();
    } catch (error) {
      if (!signal.aborted) {
        setFailed(true);
        onError(error);
      }
    } finally {
      pending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy}>
      <legend>Подтвердить один баг из всего альбома</legend>
      <p>
        Подготовьте общий текст вручную после просмотра всех частей. В него не
        копируются автоматически авторы, ссылки и исходные сообщения.
      </p>
      <label>
        Заголовок
        <input
          value={title}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
            revokeConsent();
          }}
        />
      </label>
      <label>
        Проверенный общий текст
        <textarea
          value={description}
          maxLength={50000}
          onChange={(event) => {
            setDescription(event.target.value);
            revokeConsent();
          }}
        />
      </label>
      <p>В копию войдут все {selected.length} сохранённых вложений:</p>
      <ul>
        {selected.map((file) => (
          <li key={file.id}>{file.name}</li>
        ))}
      </ul>
      <p>
        Чтобы исключить файл с указанием причины или повторить его загрузку,
        откройте карточку соответствующей части. Затем обновите состав альбома.
      </p>
      {unresolved && (
        <p role="alert">
          Сначала разрешите все отсутствующие или ошибочные вложения.
        </p>
      )}
      {selected.length > 20 && (
        <p role="alert">
          Поддерживается не более 20 вложений в одной копии. Альбом не будет
          отправлен частично.
        </p>
      )}
      <label>
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(event) => {
            setReviewed(event.target.checked);
            setApproved(false);
          }}
        />
        Я просмотрел все части и вложения, проверил текст и удалил лишние личные
        данные
      </label>
      <label>
        <input
          type="checkbox"
          checked={approved}
          disabled={!reviewed}
          onChange={(event) => setApproved(event.target.checked)}
        />
        Разрешаю передачу этой общей копии и перечисленных вложений в Linear
      </label>
      <button type="button" disabled={!ready} onClick={() => void save()}>
        Сохранить подтверждение альбома
      </button>
      <p>Это не отправка: групповая доставка пока выключена.</p>
      {failed && (
        <p role="alert">
          Подтверждение не сохранено или ответ потерян. Неизменённый повтор
          использует тот же ID; при изменении альбома обновите состав и
          проверьте его заново.
        </p>
      )}
    </fieldset>
  );
}
