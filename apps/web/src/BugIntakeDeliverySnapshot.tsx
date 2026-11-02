import { useEffect, useState } from "react";
import { api } from "./api";
import { BugIntakeInterruptedDelivery } from "./BugIntakeInterruptedDelivery";
import { BugIntakeUploadRecovery } from "./BugIntakeUploadRecovery";

type Snapshot = { id: string; revision: number; state: string; updatedAt: string; uploadRecoveryAvailable: boolean;
  title: string; description: string; attachments: { id: string; name: string;
    sha256: string; sizeBytes: number; uploadRecorded: boolean }[] };
export function BugIntakeDeliverySnapshot(props: {
  album?: boolean; messageId: string; revision: number; deliveryId: string; updatedAt: string;
  knownIssueId: string | null; onError: (error: unknown) => void; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSnapshot(null); setFailed(false);
    if (!open) return;
    const controller = new AbortController();
    void api<Snapshot>(`/api/operator/bug-intake/${encodeURIComponent(props.messageId)}/${props.album ? "album-deliveries" : "deliveries"}/${encodeURIComponent(props.deliveryId)}`,
      { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      if (value.id !== props.deliveryId || value.updatedAt !== props.updatedAt || value.state !== "UNKNOWN") {
        setFailed(true); return;
      }
      setSnapshot(value);
    }).catch((error) => {
      if (!controller.signal.aborted) { setFailed(true); props.onError(error); }
    });
    return () => controller.abort();
    // Parent keys by authenticated scope/message/delivery timestamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, props.messageId, props.deliveryId, props.updatedAt, props.album]);
  return <section aria-label="Сверка исторической отправки">
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? "Закрыть сверку" : "Открыть отправленную версию для сверки"}
    </button>
    {open && (failed ? <p role="alert">Снимок недоступен или состояние изменилось. Обновите историю.</p> :
      !snapshot ? <p role="status">Загрузка снимка…</p> : <>
        <h4>Снимок версии {snapshot.revision}: {snapshot.title}</h4>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{snapshot.description}</pre>
        <ul>{snapshot.attachments.map((file) => <li key={file.id}>
          {file.name} — {file.sizeBytes} байт
          <div style={{ overflowWrap: "anywhere" }}>SHA-256: {file.sha256}</div>
          <p>{file.uploadRecorded ? "Загрузка записана" : "Запись загрузки отсутствует — сначала требуется восстановление"}</p>
          {!file.uploadRecorded && (snapshot.uploadRecoveryAvailable
            ? <BugIntakeUploadRecovery {...props} key={`${file.id}:${snapshot.updatedAt}`} file={file} />
            : <p>Восстановление недоступно: адреса хранилища ещё не настроены.</p>)}
        </li>)}</ul>
        <p>Это исторический снимок, не текущий текст карточки. Сверьте его с задачей или комментарием в Linear.</p>
        {snapshot.attachments.every((file) => file.uploadRecorded) &&
          <BugIntakeInterruptedDelivery {...props} confirmSent />}
        <BugIntakeInterruptedDelivery {...props} confirmNotSent />
      </>)}
  </section>;
}

