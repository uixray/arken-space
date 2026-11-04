import { useEffect, useRef } from "react";
import type { useAbilityArea } from "./use-ability-area";
import "./ability-area.css";

export function AbilityAreaPanel({ area, isGm, recoveryOnly = false }: {
  area: ReturnType<typeof useAbilityArea>;
  isGm: boolean;
  recoveryOnly?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const visibleDraft = Boolean(area.draft && recoveryOnly === Boolean(area.draft.request));
  useEffect(() => { if (visibleDraft) heading.current?.focus(); }, [area.draft?.id, visibleDraft]);
  useEffect(() => {
    if (!visibleDraft || !area.draft || area.draft.request || !area.canCancel) return;
    const onKey = (event: KeyboardEvent) => {
      // Native select popups consume Escape differently across browsers.
      // Other dialogs and open popup lists also own their Escape gesture.
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === "Escape" && !event.defaultPrevented &&
          !(target instanceof HTMLSelectElement) &&
          !target?.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="combobox"][aria-expanded="true"]')) {
        event.preventDefault();
        area.cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [area.draft?.id, area.canCancel, area.cancel, visibleDraft]);
  const draft = area.draft;
  if (!draft) return recoveryOnly && (area.storageError || area.notice) ? <section className="ability-area-panel ability-area-panel--recovery">
    {area.storageError && <p role="alert">{area.storageError}</p>}
    {area.notice && <div role="status"><p>{area.notice}</p><button type="button" onClick={area.dismissNotice}>Понятно</button></div>}
  </section> : null;
  if (recoveryOnly !== Boolean(draft.request)) return null;
  return <section className={`ability-area-panel${recoveryOnly ? " ability-area-panel--recovery" : ""}`} aria-labelledby="ability-area-heading" aria-busy={area.pending}>
    <h2 id="ability-area-heading" tabIndex={-1} ref={heading}>{draft.name} · радиус {draft.radiusMeters} м</h2>
    <p>Круг от центра фигурки. Все персонажи игроков внутри, включая применяющего персонажа игрока, получают один общий бросок 1к6 маны.</p>
    {area.tokens.length > 0 && <label>
      Фигурка применяющего
      <select value={draft.tokenId} disabled={Boolean(draft.request) || area.pending}
        onChange={(event) => area.selectOrigin(event.target.value)}>
        <option value="" disabled>Выберите фигурку</option>
        {area.tokens.map((token, index) => <option key={token.id} value={token.id}>
          {token.name}{area.tokens.length > 1 ? ` · № ${index + 1} (${Math.round(token.x)}, ${Math.round(token.y)})` : ""}
        </option>)}
      </select>
    </label>}
    <p className="muted">Цели определяются сервером в момент применения. Скрытые фигурки не раскрываются.
      {isGm ? " Бросок мастера записывается только в журнал мастера." : ""}</p>
    {!draft.request && area.blocked && <p role="status">{area.blocked}</p>}
    {area.storageError && <p role="alert">{area.storageError}</p>}
    {area.error && <p role="alert">{area.error}</p>}
    {draft.request && <p className="muted">Сохранена исходная команда: {draft.request.actionId}. Смена сцены не меняет её параметры.</p>}
    {draft.request && !draft.failed && !area.pending && <p role="status">
      {draft.cancellationRequested
        ? "Сохранён запрос отмены. Восстановление повторит отмену, а не применение. Уже выполненный эффект не откатывается."
        : "Результат ещё не подтверждён. Повтор использует тот же код действия и не применит эффект дважды."}
    </p>}
    <div className="ability-area-panel__actions">
      {!draft.failed && <button type="button" disabled={!area.canConfirm} onClick={() => void area.confirm()}>
        {area.pending ? "Подтверждаем результат…" : draft.cancellationRequested ? "Восстановить отмену" : draft.request ? "Повторить тот же запрос" : "Бросить 1к6 и применить"}
      </button>}
      <button type="button" disabled={!area.canCancel} onClick={area.cancel}>
        {draft.request ? "Отменить невыполненную команду" : "Отмена"}
      </button>
    </div>
  </section>;
}
