import { useEffect, useState } from "react";
import { api } from "./api";

type Preview = {
  messageId?: string;
  albumId?: string;
  fingerprint?: string;
  revision: number;
  title: string;
  description: string;
  attachments: {
    id: string;
    downloadName: string;
    sizeBytes: number;
    sha256: string;
  }[];
};
/** Display only. No clipboard, localStorage or external transfer side effects. */
export function BugIntakeApprovedPreview({
  id,
  revision,
  onError,
  album,
}: {
  id: string;
  revision: number;
  onError: (error: unknown) => void;
  album?: { id: string; fingerprint: string };
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setFailed(false);
    void api<Preview>(
      `/api/operator/bug-intake/${encodeURIComponent(id)}/${album ? "album-approved-preview" : "approved-preview"}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        if ((album
          ? result.albumId !== album.id || result.fingerprint !== album.fingerprint
          : result.messageId !== id) || result.revision !== revision) {
          setFailed(true);
          return;
        }
        setPreview(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          onError(error);
        }
      });
    return () => controller.abort();
    // onError belongs to the scope-keyed parent; do not refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, revision, album?.id, album?.fingerprint]);
  if (failed)
    return (
      <p role="alert">
        Подтверждённая версия недоступна или изменилась. Обновите карточку.
      </p>
    );
  if (!preview) return <p role="status">Загрузка подтверждённого отчёта…</p>;
  return (
    <section aria-label="Подтверждённый отчёт">
      <h3>Подтверждённая версия отчёта</h3>
      <h4>{preview.title}</h4>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {preview.description}
      </pre>
      <ul>
        {preview.attachments.map((file) => (
          <li key={file.id}>
            {file.downloadName} — {file.sizeBytes} байт
          </li>
        ))}
      </ul>
      <p>
        Это снимок подтверждённой версии, а не подтверждение отправки или её
        отсутствия. Результат смотрите в истории отправок. Перед началом отправки
        согласие проверяется повторно.
      </p>
    </section>
  );
}
