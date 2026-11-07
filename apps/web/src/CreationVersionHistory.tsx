import { useState } from "react";
import { creationPath } from "./creation-client";
import { useCreationQuery, type CreationSession } from "./use-creation-session";
import { QueryState } from "./CreationParts";

type Version = { id: string; number: number; published: boolean; createdAt: string; source: Record<string, unknown> };
const labels: Record<string, string> = { name: "Название", description: "Описание", kind: "Тип конструктора",
  usageResource: "Ресурс применения", slots: "Слоты", components: "Компоненты", compatibility: "Совместимость",
  limits: "Границы расчёта", manualAdjustment: "Ручные поправки", operation: "Операция", inputs: "Расходуемые объекты",
  output: "Результат", cost: "Стоимость", refund: "Возврат", reason: "Пояснение", format: "Формат" };
/** Read-only history; selecting an old version never republishes or mutates it. */
export function CreationVersionHistory({ session, id, kind, active }: {
  session: CreationSession; id: string; kind: "rules" | "recipes"; active: boolean;
}) {
  const [open, setOpen] = useState(false), [before, setBefore] = useState<string>();
  const [compare, setCompare] = useState<Version | null>(null);
  const query = useCreationQuery<{ items?: Version[]; versions?: Version[]; nextBefore: number | null }>(session,
    open && active ? creationPath(`${kind}/${id}/versions`, { before }) : null);
  const rows = kind === "rules" ? query.data?.items : query.data?.versions;
  return <section aria-label="История правил и рецептов">
    <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? "Скрыть историю" : "История версий"}</button>
    {open && <><p>Просмотр не изменяет текущую форму, опубликованные правила или игровые объекты.</p>
      <QueryState loading={query.loading} error={query.error} />
      {rows?.length === 0 && <p>На этой странице версий нет.</p>}
      {compare && <p role="status">Сравнение с версией {compare.number}. <button type="button" onClick={() => setCompare(null)}>Сбросить сравнение</button></p>}
      {rows?.map(v => {
        const keys = [...new Set([...Object.keys(compare?.source ?? {}), ...Object.keys(v.source)])];
        const changed = compare ? keys.filter(k => JSON.stringify(compare.source[k]) !== JSON.stringify(v.source[k])) : [];
        return <details key={v.id}><summary>Версия {v.number} · {v.published ? "Опубликована" : "Черновик"} · {new Date(v.createdAt).toLocaleString("ru-RU")}</summary>
          <button type="button" onClick={() => setCompare(v)}>Сравнивать с этой версией</button>
          {compare && compare.id !== v.id && <section aria-label="Различия версий">
            {!changed.length && <p>Состав и параметры совпадают.</p>}
            {changed.map(k => <div key={k}><h4>{labels[k] ?? k}</h4><div className="creation-compare">
              <div><strong>Версия {compare.number}</strong><pre>{JSON.stringify(compare.source[k], null, 2) ?? "Отсутствует"}</pre></div>
              <div><strong>Версия {v.number}</strong><pre>{JSON.stringify(v.source[k], null, 2) ?? "Отсутствует"}</pre></div>
            </div></div>)}
          </section>}
          <details><summary>Полный сохранённый состав</summary><pre>{JSON.stringify(v.source, null, 2)}</pre></details>
        </details>;
      })}
      <div className="creation-actions">{before && <button type="button" disabled={query.loading} onClick={() => setBefore(undefined)}>Последние версии</button>}
        {query.data?.nextBefore != null && <button type="button" disabled={query.loading} onClick={() => setBefore(String(query.data!.nextBefore))}>Более ранние версии</button>}</div>
    </>}
  </section>;
}
