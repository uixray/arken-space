import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { CreationEvaluation, CreationPaidBasis } from "@arken/contracts";
import { creationPath, type Material, type Page } from "./creation-client";
import { useCreationPage, type CreationSession } from "./use-creation-session";

const MaterialNames = createContext<{ names: Record<string, string | null>; request: (ids: string[]) => void }>({ names: {}, request: () => {} });
/** Batch labels across cards/history instead of issuing one request per cost row.
 * Cache is local to this campaign/member workspace and invalidated after writes. */
export function CreationMaterialNames({ session: s, children }: { session: CreationSession; children: ReactNode }) {
  const [need, setNeed] = useState<{ epoch: number; ids: Set<string> }>({ epoch: s.epoch, ids: new Set() });
  const [resolved, setResolved] = useState<{ epoch: number; names: Record<string, string | null>; error: string }>({ epoch: s.epoch, names: {}, error: "" });
  const names = resolved.epoch === s.epoch ? resolved.names : {};
  const request = useCallback((ids: string[]) => setNeed(old => {
    const current = old.epoch === s.epoch ? old.ids : new Set<string>();
    if (old.epoch === s.epoch && ids.every(id => current.has(id))) return old;
    return { epoch: s.epoch, ids: new Set([...current, ...ids]) };
  }), [s.epoch]);
  useEffect(() => {
    if (need.epoch !== s.epoch) return;
    const ids = [...need.ids].filter(id => !Object.prototype.hasOwnProperty.call(names, id)).sort().slice(0, 128);
    if (!ids.length) return;
    const abort = new AbortController(), timer = window.setTimeout(() => {
      void s.read<Page<{ id: string; name: string }>>(creationPath("material-catalog", { ids: ids.join(",") }), { signal: abort.signal })
        .then(value => { if (!abort.signal.aborted) setResolved(old => ({ epoch: s.epoch, error: old.epoch === s.epoch ? old.error : "",
          names: { ...(old.epoch === s.epoch ? old.names : {}), ...Object.fromEntries(ids.map(id => [id, value.items.find(v => v.id === id)?.name ?? null])) } })); })
        .catch(() => { if (!abort.signal.aborted) setResolved(old => ({ epoch: s.epoch,
          error: "Не удалось загрузить часть названий материалов. Обновите мастерскую перед подтверждением состава.",
          names: { ...(old.epoch === s.epoch ? old.names : {}), ...Object.fromEntries(ids.map(id => [id, null])) } })); });
    }, 0);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [need, resolved, s.epoch, s.read]);
  return <MaterialNames.Provider value={{ names, request }}>{resolved.epoch === s.epoch && resolved.error && <p role="alert">{resolved.error}</p>}{children}</MaterialNames.Provider>;
}

/** Keep the raw comma-separated draft while updating the structured value.
 * Normalising on every keystroke would erase the separator before the next tag. */
export function CreationListInput({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const canonical = value.join(", ");
  const [draft, setDraft] = useState({ canonical, text: canonical });
  const text = draft.canonical === canonical ? draft.text : canonical;
  return <input value={text} onChange={e => {
    const next = [...new Set(e.target.value.split(",").map(v => v.trim()).filter(Boolean))];
    setDraft({ canonical: next.join(", "), text: e.target.value }); onChange(next);
  }} onBlur={() => setDraft({ canonical, text: canonical })} />;
}

export const metricLabels = { power: "Сила", priceCopper: "Оценка, медные", craftSp: "Изготовление, SP", usageCost: "За применение" };
export const stageLabels: Record<string, string> = { CRAFTED: "Создан", EVOLVING: "Развивается", MASTERWORK: "Шедевр", FORGED: "Закалён" };
export const operationLabels: Record<string, string> = { CRAFT: "Изготовление", UPGRADE: "Развитие", MERGE: "Слияние", DISASSEMBLE: "Разбор" };
export const reviewLabel = (value?: string | null) => value === "APPROVED" ? "Одобрено мастером" : value === "REVOKED" ? "Допуск отозван" : value === "REJECTED" ? "Отклонено" : "Ожидает решения мастера";
export function useQuoteExpired(expiresAt?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setNow(Date.now()); if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer);
  }, [expiresAt]);
  return !!expiresAt && Date.parse(expiresAt) <= now;
}
export function QueryState({ loading, error }: { loading: boolean; error: string }) {
  return <>{loading && <p role="status">Загружаем мастерскую…</p>}{error && <p role="alert">{error}</p>}</>;
}
export function PageControls({ more, previous, disabled, onNext, onFirst }: { more: boolean; previous: boolean; disabled?: boolean; onNext: () => void; onFirst: () => void }) {
  return more || previous ? <div className="creation-actions" aria-label="Страницы списка">
    {previous && <button type="button" disabled={disabled} onClick={onFirst}>К началу списка</button>}
    {more && <button type="button" disabled={disabled} onClick={onNext}>Следующая страница</button>}
  </div> : null;
}
export function Cost({ session, value, title = "Стоимость" }: { session: CreationSession; value: CreationPaidBasis; title?: string }) {
  const ids = [...new Set(value.materials.map(m => m.worldContentId))].sort();
  const { names, request } = useContext(MaterialNames), identity = ids.join(",");
  useEffect(() => { if (identity) request(identity.split(",")); }, [identity, request, session.epoch]);
  return <div className="creation-cost"><strong>{title}</strong><span>{value.copper.toLocaleString("ru-RU")} медных · {value.sp} SP</span>
    {!!value.materials.length && <ul>{value.materials.map(m => <li key={m.worldContentId}>
      {names[m.worldContentId] ?? (names[m.worldContentId] === undefined ? "Название загружается" : "Материал недоступен")}: {m.quantity}
    </li>)}</ul>}</div>;
}
export function Evaluation({ value }: { value: CreationEvaluation }) {
  return <section className="creation-evaluation" aria-label="Расчёт версии">
    <h3>{value.card.name || "Карточка результата"}</h3>
    <p className="creation-prose">{value.card.description || "Описание ещё не задано."}</p>
    {value.card.appearance && <p className="creation-prose">{value.card.appearance}</p>}
    {value.card.artifact && <p>{value.card.artifact.category} · {value.card.artifact.rarity}</p>}
    {value.totals && <dl className="creation-metrics">{Object.entries(metricLabels).map(([key, label]) =>
      <div key={key}><dt>{label}</dt><dd>{value.totals![key as keyof typeof metricLabels].toLocaleString("ru-RU")}</dd></div>)}</dl>}
    <p>Расчётная оценка не равна цене покупки. Допуск мастера и стоимость рецепта проверяются отдельно.</p>
    {!!value.errors.length && <ul role="alert">{value.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>}
    {!!value.warnings.length && <ul>{value.warnings.map((e, i) => <li key={i}>{e.message}</li>)}</ul>}
    {!!value.card.requirements.length && <p>Требования: {value.card.requirements.map(r => `${r.statKey} ≥ ${r.minimum}`).join(" · ")}</p>}
    {!!value.card.manualEffects.length && <details><summary>Что выполняет мастер вручную</summary><ul>{value.card.manualEffects.map((m, i) => <li key={i}>{m}</li>)}</ul></details>}
    <details><summary>Из чего складывается расчёт</summary><div className="creation-table-scroll"><table>
      <thead><tr><th>Компонент</th>{Object.values(metricLabels).map(m => <th key={m}>{m}</th>)}</tr></thead>
      <tbody>{value.breakdown.map(r => <tr key={r.componentId}><th scope="row">{r.name}</th>{Object.keys(metricLabels).map(k =>
        <td key={k}>{r.contribution[k as keyof typeof metricLabels]} умножить на {r.factorsBasisPoints[k as keyof typeof metricLabels] / 10000}</td>)}</tr>)}</tbody>
    </table></div></details>
  </section>;
}
export function MaterialPicker({ session, characterId, picks, onChange, disabled }: {
  session: CreationSession; characterId: string; picks: Array<{ instanceId: string; quantity: number }>;
  onChange: (picks: Array<{ instanceId: string; quantity: number }>) => void; disabled: boolean;
}) {
  const query = useCreationPage<Material>(session, characterId ? creationPath("materials", { characterId }) : null);
  return <fieldset disabled={disabled || query.loading}><legend>Материалы из инвентаря</legend>
    <p>Укажите точные стопки. Созданные объекты, товары магазина и вещи на карте сюда не включены.</p>
    <QueryState loading={query.loading} error={query.error} />
    {query.data?.items.length === 0 && <p>Свободных материалов на этой странице нет.</p>}
    {query.data?.items.map(m => <label className="creation-material-row" key={m.id}>
      <span>{m.name} <small>{m.canonicalName} · доступно {m.quantity}</small></span>
      <input type="number" min={0} max={m.quantity} step={1} value={picks.find(p => p.instanceId === m.id)?.quantity ?? 0}
        onChange={e => { const quantity = Number(e.target.value); onChange([...picks.filter(p => p.instanceId !== m.id),
          ...(Number.isInteger(quantity) && quantity > 0 ? [{ instanceId: m.id, quantity }] : [])]); }} />
    </label>)}
    <p>Выбрано стопок: {picks.length}. Выбор сохраняется при смене страницы.</p>
    {!!picks.length && <button type="button" onClick={() => onChange([])}>Очистить выбор материалов</button>}
    <PageControls more={!!query.data?.nextAfter} previous={query.hasPrevious} disabled={query.loading}
      onNext={query.next} onFirst={query.first} />
  </fieldset>;
}
