import {useGameReadOnly} from "./game-read-only";
import type { useEntryApplication } from "./use-entry-application";
import "./entry-application.css";

export function EntryApplicationRecovery({
  application,
}: {
  application: ReturnType<typeof useEntryApplication>;
}) {
  const readOnly=useGameReadOnly();
  if (!application.pending && !application.error && !application.notice)
    return null;
  return (
    <section
      className="entry-application-recovery"
      aria-labelledby="entry-application-heading"
      aria-busy={application.busy}
    >
      <h2 id="entry-application-heading">Результат применения</h2>
      {application.pending && (
        <>
          <p>{application.pending.label}</p>
          <p>
            {application.pending.cancellationRequested
              ? "Запрос отмены сохранён. Восстановление повторяет отмену, а не применение. Уже выполненный эффект не откатывается."
              : "Команда сохранена. Восстановление отправляет тот же запрос, а не новое применение."}
          </p>
          <small>Код действия: {application.pending.body.actionId}</small>
          <button
            type="button"
            disabled={readOnly || application.busy}
            onClick={() => void application.recover().catch(() => undefined)}
          >
            {application.busy
              ? "Ожидаем ответ…"
              : application.pending.cancellationRequested
                ? "Восстановить отмену"
                : "Восстановить результат"}
          </button>
          <button
            type="button"
            disabled={
              readOnly || application.busy || application.pending.cancellationRequested
            }
            onClick={() => {
              if (
                window.confirm(
                  "Отменить только ещё не выполненную команду? Если сервер уже применил её, будет восстановлен результат без отката.",
                )
              )
                void application.cancel().catch(() => undefined);
            }}
          >
            Отменить невыполненную команду
          </button>
        </>
      )}
      {application.notice && (
        <div role="status">
          <p>{application.notice}</p>
          <button type="button" onClick={application.dismissNotice}>
            Понятно
          </button>
        </div>
      )}
      {application.error && <p role="alert">{application.error}</p>}
    </section>
  );
}
