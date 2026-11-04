import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export function BugIntakeAlbumActions({
  messageId,
  revision,
  state,
  onError,
  onSaved,
}: {
  messageId: string;
  revision: number;
  state: string;
  onError: (error: unknown) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const actions = useRef<Partial<Record<"enqueue" | "reopen", string>>>({});
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  async function act(action: "enqueue" | "reopen") {
    const signal = lifetime.current?.signal;
    if (pending.current || !signal || signal.aborted) return;
    pending.current = true;
    setBusy(true);
    setNotice("");
    const actionId = actions.current[action] ?? crypto.randomUUID();
    actions.current[action] = actionId;
    try {
      await api(
        `/api/operator/bug-intake/${encodeURIComponent(messageId)}/album-${action}`,
        {
          method: "POST",
          signal,
          body: JSON.stringify({ revision, actionId }),
        },
      );
      if (!signal.aborted) onSaved();
    } catch (error) {
      if (!signal.aborted) {
        setNotice(
          "Результат не подтверждён. Неизменённый повтор использует тот же ID. При конфликте обновите альбом; неизвестную доставку сначала сверьте по истории.",
        );
        onError(error);
      }
    } finally {
      pending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy}>
      <legend>Действия с общей копией</legend>
      {state === "APPROVED" && (
        <button type="button" onClick={() => void act("enqueue")}>
          Поставить подтверждённый альбом в очередь
        </button>
      )}
      <button type="button" onClick={() => void act("reopen")}>
        Вернуть альбом на редактирование
      </button>
      <p>
        Очередь не запускает отправитель. Возврат отменяет только ещё не начатые
        отправки; при неизвестном результате нужна сверка. Связь с задачей
        Linear сохраняется.
      </p>
      {notice && <p role="alert">{notice}</p>}
    </fieldset>
  );
}
