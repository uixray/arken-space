import { useEffect, useRef } from "react";
import type { useAbilityArea } from "./use-ability-area";
import "./ability-area.css";

export function AbilityAreaPanel({ area, isGm }: {
  area: ReturnType<typeof useAbilityArea>;
  isGm: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [area.draft?.id]);
  useEffect(() => {
    if (!area.draft || !area.canCancel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        area.cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [area.draft?.id, area.canCancel, area.cancel]);
  const draft = area.draft;
  if (!draft) return null;
  return <section className="ability-area-panel" aria-labelledby="ability-area-heading" aria-busy={area.pending}>
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
    {area.error && <p role="alert">{area.error}</p>}
    {draft.request && !draft.failed && !area.pending && <p role="status">
      Результат ещё не подтверждён. Повтор использует тот же код действия и не применит эффект дважды.
    </p>}
    <div className="ability-area-panel__actions">
      {!draft.failed && <button type="button" disabled={!area.canConfirm} onClick={() => void area.confirm()}>
        {area.pending ? "Применяем…" : draft.request ? "Повторить тот же запрос" : "Бросить 1к6 и применить"}
      </button>}
      <button type="button" disabled={!area.canCancel} onClick={area.cancel}>
        {draft.failed ? "Закрыть" : "Отмена"}
      </button>
    </div>
  </section>;
}
