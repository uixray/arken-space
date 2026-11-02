import { useEffect, useState } from "react";
import { api } from "./api";
import { BugIntakeAlbumApproval } from "./BugIntakeAlbumApproval";
import { BugIntakeApprovedPreview } from "./BugIntakeApprovedPreview";
import { BugIntakeDeliveries } from "./BugIntakeDeliveries";
import { BugIntakeAlbumActions } from "./BugIntakeAlbumActions";

type Album = { albumId: string; revision: number; state: string; fingerprint: string;
  linearIssueId: string | null; parts: { id: string; revision: number; state: string;
    text: string; sourceUrl: string | null; files: { id: string; name: string;
      state: string; sizeBytes: number | null; exclusionReason: string | null }[] }[] };

/** Group snapshot display; approval and grouped delivery are separate stages. */
export function BugIntakeAlbumReview({ messageId, onError }: {
  messageId: string; onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [album, setAlbum] = useState<Album | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setAlbum(null); setFailed(false);
    if (!open) return;
    const controller = new AbortController();
    void api<Album>(`/api/operator/bug-intake/${encodeURIComponent(messageId)}/album-review`,
      { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setAlbum(value);
    }).catch((error) => {
      if (!controller.signal.aborted) { setFailed(true); onError(error); }
    });
    return () => controller.abort();
    // Parent controls authenticated scope and callback lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, epoch, messageId]);
  return <section aria-label="Общий просмотр альбома">
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? "Закрыть альбом" : "Посмотреть все части альбома"}
    </button>
    {open && <>
      <p>Один альбом — один баг. Показаны полученные части; новые части или правки
        потребуют нового подтверждения. Общая отправка пока недоступна.</p>
      <button type="button" onClick={() => setEpoch((value) => value + 1)}>Обновить состав</button>
      {failed ? <p role="alert">Не удалось получить полный снимок альбома. Частичный набор не показан.</p> :
        !album ? <p role="status">Загрузка альбома…</p> : <>
          <h3>Альбом: {album.parts.length} частей, версия {album.revision}</h3>
          <p>Состояние: {album.state}. Подтверждение не означает отправку.</p>
          {album.state !== "REVIEW" && <BugIntakeAlbumActions
            key={`actions:${album.albumId}:${album.revision}`} messageId={messageId}
            revision={album.revision} state={album.state} onError={onError}
            onSaved={() => { setAlbum(null); setEpoch((value) => value + 1); }} />}
          <BugIntakeDeliveries key={`history:${album.albumId}:${album.revision}`}
            id={messageId} revision={album.revision} album onError={onError}
            onChanged={() => { setAlbum(null); setEpoch((value) => value + 1); }} />
          {album.state === "APPROVED" && <BugIntakeApprovedPreview
            id={messageId} revision={album.revision}
            album={{ id: album.albumId, fingerprint: album.fingerprint }} onError={onError} />}
          {album.linearIssueId && <p>Связанная задача: {album.linearIssueId}. Изменения добавятся комментарием.</p>}
          {album.parts.map((part, index) => <section key={part.id} aria-label={`Часть ${index + 1}`}>
            <h4>Часть {index + 1}, версия {part.revision}</h4>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{part.text}</pre>
            {part.sourceUrl && <p>Источник: {part.sourceUrl}</p>}
            <ul>{part.files.map((file) => <li key={file.id}>
              {file.name} — {file.state}{file.sizeBytes !== null ? `, ${file.sizeBytes} байт` : ""}
              {file.exclusionReason && <p>Исключено: {file.exclusionReason}</p>}
            </li>)}</ul>
          </section>)}
          {album.state === "REVIEW" && <BugIntakeAlbumApproval
            key={`${album.albumId}:${album.revision}:${album.fingerprint}`}
            messageId={messageId} revision={album.revision} fingerprint={album.fingerprint}
            files={album.parts.flatMap((part) => part.files)} onError={onError}
            onSaved={() => { setAlbum(null); setEpoch((value) => value + 1); }} />}
        </>}
    </>}
  </section>;
}
