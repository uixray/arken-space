import { CreationVersionHistory } from "./CreationVersionHistory";
import { CreationListInput } from "./CreationParts";
import { useEffect, useState } from "react";
import { CREATION_METRICS, CREATION_SLOTS, creationRuleSourceSchema, type CreationKind, type CreationMetrics, type CreationRuleSource } from "@arken/contracts";
import { creationPath, type RulePack } from "./creation-client";
import { useCreationPage, type CreationSession } from "./use-creation-session";
import { metricLabels, PageControls, QueryState } from "./CreationParts";

type Component = CreationRuleSource["components"][number];
type Effect = Component["effects"][number];
type Expression = { base: number; terms: Array<{ parameter: string; scale: number }> };
const zero = (): CreationMetrics => ({ power: 0, priceCopper: 0, craftSp: 0, usageCost: 0 });
const one = (): CreationMetrics => ({ power: 10000, priceCopper: 10000, craftSp: 10000, usageCost: 10000 });
const expr = (base = 0): Expression => ({ base, terms: [] });
const newComponent = (slot: string): Component => ({ id: `c-${crypto.randomUUID().slice(0, 8)}`, name: slot, description: "", slot: slot as Component["slot"],
  tags: [], parameters: [], contribution: null, factorsBasisPoints: one(), requirements: [], materials: [],
  artifact: slot === "BASE" ? { baseItemId: "", category: "RELIC", rarity: "" } : null, effects: [] });
const newRules = (kind: CreationKind): CreationRuleSource => ({ format: 1, kind, name: "", description: "", usageResource: null,
  slots: CREATION_SLOTS[kind].map(slot => ({ slot, min: 1, max: 1 })), components: CREATION_SLOTS[kind].map(newComponent), compatibility: [],
  limits: { power: { min: 0, max: 0 }, priceCopper: { min: 0, max: 0 }, craftSp: { min: 0, max: 0 }, usageCost: { min: 0, max: 0 } },
  manualAdjustment: { power: { min: 0, max: 0 }, priceCopper: { min: 0, max: 0 }, craftSp: { min: 0, max: 0 }, usageCost: { min: 0, max: 0 } } });
export function MetricsFields({ value, onChange }: { value: CreationMetrics; onChange: (value: CreationMetrics) => void }) {
  return <div className="creation-fields">{CREATION_METRICS.map(k => <label key={k}>{metricLabels[k]}<input type="number" step={1} value={value[k]}
    onChange={e => onChange({ ...value, [k]: Number(e.target.value) })} /></label>)}</div>;
}
function ExpressionFields({ value, onChange, parameters }: { value: Expression; onChange: (value: Expression) => void; parameters: Component["parameters"] }) {
  return <div><label>Постоянная часть<input type="number" step={1} value={value.base} onChange={e => onChange({ ...value, base: Number(e.target.value) })} /></label>
    {value.terms.map((t, i) => <div className="creation-fields" key={i}><label>Параметр<select value={t.parameter} onChange={e => onChange({ ...value,
      terms: value.terms.map((v, n) => n === i ? { ...v, parameter: e.target.value } : v) })}><option value="">Выберите параметр</option>
      {parameters.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
      <label>Множитель<input type="number" value={t.scale} onChange={e => onChange({ ...value, terms: value.terms.map((v, n) => n === i ? { ...v, scale: Number(e.target.value) } : v) })} /></label>
      <button type="button" onClick={() => onChange({ ...value, terms: value.terms.filter((_, n) => n !== i) })}>Убрать член выражения</button></div>)}
    <button type="button" disabled={!parameters.length || value.terms.length >= 12} onClick={() => onChange({ ...value, terms: [...value.terms, { parameter: "", scale: 1 }] })}>Добавить параметр в выражение</button>
  </div>;
}
function Effects({ value, parameters, components, onChange }: { value: Effect[]; parameters: Component["parameters"]; components: Component[]; onChange: (value: Effect[]) => void }) {
  const [kind, setKind] = useState<Effect["kind"]>("MANUAL");
  const add = () => {
    const effect: Effect = kind === "ROLL" ? { kind, id: `roll-${crypto.randomUUID().slice(0, 8)}`, label: "Бросок", rollKind: "CUSTOM", sides: 6, count: expr(1), modifier: expr(), characteristic: null }
      : kind === "ROLL_ADJUST" ? { kind, targetComponentId: "", targetRollId: "", countDelta: expr(), modifierDelta: expr() } : kind === "SKILL_VALUE" ? { kind, value: expr() } : kind === "USES" ? { kind, maximum: expr(1), recharge: "DAY" }
      : kind === "MANUAL_TEMPLATE" ? { kind, text: "", when: { allOf: [], anyOf: [], noneOf: [], tags: [] }, values: {} }
      : kind === "RESTORE_MANA_AREA" ? { kind, radiusMillimeters: expr() } : kind === "ACTIVATION" || kind === "CONSUME_ITEM" ? { kind } : { kind: "MANUAL", text: "" };
    onChange([...value, effect]);
  };
  const update = (index: number, effect: Effect) => onChange(value.map((v, i) => i === index ? effect : v));
  return <div>{value.map((e, i) => <fieldset key={i}><legend>{e.kind}</legend>
    {e.kind === "MANUAL" && <label>Действие мастера вручную<textarea value={e.text} maxLength={2000} onChange={v => update(i, { ...e, text: v.target.value })} /></label>}
    {e.kind === "MANUAL_TEMPLATE" && <>
      <label>Ручное описание с подстановками<textarea value={e.text} maxLength={2000} onChange={v => update(i, { ...e, text: v.target.value })} /></label>
      <p>Подстановка — ключ в фигурных скобках, например {"{value1}"}. Числа вычисляются из параметров этого компонента. Это не автоматическое исполнение эффекта.</p>
      {(["allOf", "anyOf", "noneOf"] as const).map(k => <label key={k}>{k === "allOf" ? "Выбраны все компоненты" : k === "anyOf" ? "Выбран любой компонент" : "Не выбран ни один компонент"}
        <CreationListInput value={e.when[k]} onChange={items => update(i, { ...e, when: { ...e.when, [k]: items } })} /></label>)}
      <ConditionParameters value={e.when.parameters ?? []} components={components} onChange={v => update(i, { ...e, when: { ...e.when, parameters: v } })} />
      {!!e.when.tags.length && <p>Также действуют условия тегов из расширенного источника.</p>}
      {Object.entries(e.values).map(([key, expression]) => <fieldset key={key}><legend>{`{${key}}`}</legend>
        <ExpressionFields value={expression} parameters={parameters} onChange={v => update(i, { ...e, values: { ...e.values, [key]: v } })} />
        <button type="button" onClick={() => update(i, { ...e, values: Object.fromEntries(Object.entries(e.values).filter(([k]) => k !== key)) })}>Убрать число</button>
      </fieldset>)}
      <button type="button" disabled={Object.keys(e.values).length >= 8} onClick={() => {
        let n = 1; while (Object.hasOwn(e.values, `value${n}`)) n++;
        update(i, { ...e, values: { ...e.values, [`value${n}`]: expr() } });
      }}>Добавить число в описание</button>
    </>}
    {e.kind === "ROLL" && <><div className="creation-fields"><label>Ключ броска<input value={e.id} onChange={v => update(i, { ...e, id: v.target.value })} /></label>
      <label>Название<input value={e.label} onChange={v => update(i, { ...e, label: v.target.value })} /></label>
      <label>Тип<select value={e.rollKind} onChange={v => update(i, { ...e, rollKind: v.target.value as typeof e.rollKind })}><option value="CUSTOM">Обычный</option><option value="HIT">Попадание</option><option value="DAMAGE">Урон</option></select></label>
      <label>Граней<select value={e.sides} onChange={v => update(i, { ...e, sides: Number(v.target.value) as typeof e.sides })}>{[2, 4, 6, 8, 10, 12, 20, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <label>Ключ характеристики (пусто — без неё)<input value={e.characteristic ?? ""} onChange={v => update(i, { ...e, characteristic: v.target.value || null })} /></label></div>
      <h5>Число костей</h5><ExpressionFields value={e.count} parameters={parameters} onChange={v => update(i, { ...e, count: v })} />
      <h5>Модификатор броска</h5><ExpressionFields value={e.modifier} parameters={parameters} onChange={v => update(i, { ...e, modifier: v })} /></>}
    {e.kind === "ROLL_ADJUST" && <>
      <p>Поправка только к указанному броску выбранного компонента; без цели расчёт запрещён.</p>
      <label>Компонент с броском<select value={e.targetComponentId} onChange={v => update(i, { ...e, targetComponentId: v.target.value, targetRollId: "" })}>
        <option value="">Выберите компонент</option>
        {e.targetComponentId && !components.some(c => c.id === e.targetComponentId && c.effects.some(f => f.kind === "ROLL")) &&
          <option value={e.targetComponentId} disabled>Сохранённая цель недоступна — выберите новую</option>}
        {components.filter(c => c.effects.some(f => f.kind === "ROLL")).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <label>Бросок<select value={e.targetRollId} onChange={v => update(i, { ...e, targetRollId: v.target.value })}>
        <option value="">Выберите бросок</option>
        {e.targetRollId && !components.find(c => c.id === e.targetComponentId)?.effects.some(f => f.kind === "ROLL" && f.id === e.targetRollId) &&
          <option value={e.targetRollId} disabled>Сохранённый бросок недоступен — выберите новый</option>}
        {components.find(c => c.id === e.targetComponentId)?.effects.flatMap(f => f.kind === "ROLL" ?
          [<option key={f.id} value={f.id}>{f.label} · {f.rollKind}</option>] : [])}
      </select></label>
      <details><summary>Альтернативные цели (в сборке выбирается ровно одна)</summary>
        {components.flatMap(c => c.effects.flatMap(f => f.kind === "ROLL" ? [{ component: c, roll: f }] : [])).map(({ component: c, roll: f }) => {
          const primary = c.id === e.targetComponentId && f.id === e.targetRollId;
          const checked = (e.alternatives ?? []).some(t => t.componentId === c.id && t.rollId === f.id);
          return <label className="creation-check" key={`${c.id}:${f.id}`}><input type="checkbox" checked={checked} disabled={primary && !checked || !checked && (e.alternatives?.length ?? 0) >= 15}
            onChange={v => update(i, { ...e, alternatives: v.target.checked ? [...(e.alternatives ?? []), { componentId: c.id, rollId: f.id }] :
              (e.alternatives ?? []).filter(t => t.componentId !== c.id || t.rollId !== f.id) })} />{c.name} · {f.label}{primary ? " · основная цель" : ""}</label>;
        })}
        {(e.alternatives ?? []).filter(t => !components.some(c => c.id === t.componentId && c.effects.some(f => f.kind === "ROLL" && f.id === t.rollId))).map(t =>
          <p key={`${t.componentId}:${t.rollId}`}>Альтернативная цель больше не существует. <button type="button" onClick={() => update(i, { ...e,
            alternatives: (e.alternatives ?? []).filter(v => v.componentId !== t.componentId || v.rollId !== t.rollId) })}>Удалить ссылку</button></p>)}
      </details>
      <h5>Изменение числа костей</h5><ExpressionFields value={e.countDelta} parameters={parameters} onChange={v => update(i, { ...e, countDelta: v })} />
      <h5>Изменение числового модификатора</h5><ExpressionFields value={e.modifierDelta} parameters={parameters} onChange={v => update(i, { ...e, modifierDelta: v })} />
    </>}
    {e.kind === "SKILL_VALUE" && <ExpressionFields value={e.value} parameters={parameters} onChange={v => update(i, { ...e, value: v })} />}
    {e.kind === "USES" && <><ExpressionFields value={e.maximum} parameters={parameters} onChange={v => update(i, { ...e, maximum: v })} />
      <label>Восстановление<select value={e.recharge} onChange={v => update(i, { ...e, recharge: v.target.value as typeof e.recharge })}>
        {[["DAY", "День"], ["BATTLE", "Бой"], ["WEEK", "Неделя"], ["SHORT_REST", "Короткий отдых"]].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></>}
    {e.kind === "RESTORE_MANA_AREA" && <><p>Радиус в миллиметрах; масштаб сцены задаёт GM.</p><ExpressionFields value={e.radiusMillimeters} parameters={parameters} onChange={v => update(i, { ...e, radiusMillimeters: v })} /></>}
    {e.kind === "CONSUME_ITEM" && <p>Расходует весь связанный предмет. Только расходуемая ITEM-основа и одно действие; не восстанавливается отдыхом.</p>}
    {e.kind === "ACTIVATION" && <p>Явное применение со стоимостью из расчёта. Само по себе не исполняет текстовые эффекты.</p>}
    <button type="button" onClick={() => onChange(value.filter((_, n) => n !== i))}>Убрать эффект</button>
  </fieldset>)}<div className="creation-fields"><label>Новый эффект<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
    {[["MANUAL", "Ручное действие мастера"], ["MANUAL_TEMPLATE", "Условное ручное описание"], ["ROLL", "Бросок"], ["ROLL_ADJUST", "Усиление конкретного броска"], ["SKILL_VALUE", "Числовой навык"], ["ACTIVATION", "Применение"], ["CONSUME_ITEM", "Расход предмета при применении"], ["USES", "Использования"], ["RESTORE_MANA_AREA", "Восстановление маны в области"]].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <button type="button" disabled={value.length >= 12} onClick={add}>Добавить эффект</button></div></div>;
}
type ParameterBounds = NonNullable<CreationRuleSource["compatibility"][number]["when"]["parameters"]>;
function ConditionParameters({ value, components, onChange }: {
  value: ParameterBounds; components: Component[]; onChange: (value: ParameterBounds) => void;
}) {
  const choices = components.flatMap(c => c.parameters.map(p => ({ c, p, key: `${c.id}:${p.key}` })));
  const update = (index: number, patch: Partial<ParameterBounds[number]>) => onChange(value.map((v, i) => i === index ? { ...v, ...patch } : v));
  return <div><p>Параметры выбранных компонентов: все условия обязательны. Невыбранный компонент не соответствует условию.</p>
    {value.map((v, i) => <div className="creation-fields" key={i}>
      <label>Параметр<select value={`${v.componentId}:${v.parameter}`} onChange={e => {
        const choice = choices.find(c => c.key === e.target.value);
        if (choice) update(i, { componentId: choice.c.id, parameter: choice.p.key, min: choice.p.min, max: choice.p.max });
      }}>
        {!choices.some(c => c.key === `${v.componentId}:${v.parameter}`) && <option value={`${v.componentId}:${v.parameter}`}>Недоступен: {v.componentId} · {v.parameter}</option>}
        {choices.map(c => <option key={c.key} value={c.key}>{c.c.name} · {c.p.key}</option>)}
      </select></label>
      <label>От<input type="number" step={1} min={-10000} max={10000} value={v.min} onChange={e => update(i, { min: Number(e.target.value) })} /></label>
      <label>До<input type="number" step={1} min={-10000} max={10000} value={v.max} onChange={e => update(i, { max: Number(e.target.value) })} /></label>
      <button type="button" onClick={() => onChange(value.filter((_, n) => n !== i))}>Убрать условие параметра</button>
    </div>)}
    <button type="button" disabled={value.length >= 64 || !choices.some(c => !value.some(v => v.componentId === c.c.id && v.parameter === c.p.key))} onClick={() => {
      const choice = choices.find(c => !value.some(v => v.componentId === c.c.id && v.parameter === c.p.key));
      if (choice) onChange([...value, { componentId: choice.c.id, parameter: choice.p.key, min: choice.p.min, max: choice.p.max }]);
    }}>Добавить условие параметра</button>
  </div>;
}
export function CreationRules({ session: s, packs, active, onDirtyChange }: { session: CreationSession; packs: RulePack[]; active: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [packId, setPackId] = useState<string>(() => crypto.randomUUID()), [revision, setRevision] = useState<number | null>(null);
  const [source, setSource] = useState<CreationRuleSource>(() => newRules("SKILL")), [componentId, setComponentId] = useState("");
  const [baseline, setBaseline] = useState(() => JSON.stringify(source));
  const [enabled, setEnabled] = useState(false), [reason, setReason] = useState(""), [raw, setRaw] = useState("");
  const [rawBaseline, setRawBaseline] = useState("");
  useEffect(() => { onDirtyChange?.(JSON.stringify(source) !== baseline || raw !== rawBaseline || !!reason.trim()); },
    [source, baseline, raw, rawBaseline, reason, onDirtyChange]);
  useEffect(() => {
    const completed = s.completed;
    if (completed?.path === "rules/enabled" && completed.body.packId === packId &&
        completed.body.expectedRevision === revision && typeof completed.body.enabled === "boolean" &&
        typeof completed.receipt.revision === "number") {
      setRevision(completed.receipt.revision); setEnabled(completed.body.enabled); setReason("");
      return;
    }
    if (!completed || completed.path !== "rules/versions" || completed.body.packId !== packId ||
        completed.body.expectedRevision !== revision ||
        typeof completed.receipt.revision !== "number") return;
    const current = creationRuleSourceSchema.safeParse(source);
    const saved = creationRuleSourceSchema.safeParse(completed.body.source);
    if (!current.success || !saved.success || JSON.stringify(current.data) !== JSON.stringify(saved.data)) return;
    // Recovery may complete outside this component's original save callback.
    // Reconcile only the exact open draft that produced the confirmed receipt.
    setRevision(completed.receipt.revision);
    setBaseline(JSON.stringify(source));
    if (completed.body.publish === true) setEnabled(true);
  }, [s.completed, packId, revision, source]);
  const catalog = useCreationPage<{ id: string; name: string }>(s, active ? creationPath("material-catalog") : null);
  const component = source.components.find(c => c.id === componentId) ?? source.components[0];
  const changeComponent = (patch: Partial<Component>) => { if (component) setSource({ ...source,
    components: source.components.map(c => c.id === component.id ? { ...c, ...patch } : c) }); };
  const mayReplace = () => (JSON.stringify(source) === baseline && raw === rawBaseline && !reason.trim()) ||
    window.confirm("Несохранённые изменения правил будут потеряны. Переключить набор?");
  const open = (p: RulePack) => { const v = p.latestVersion ?? p.activeVersion; if (!v || !mayReplace()) return;
    setPackId(p.id); setRevision(p.revision); setSource(v.source); setBaseline(JSON.stringify(v.source)); setEnabled(p.enabled); setComponentId(""); setReason(""); setRaw(""); setRawBaseline(""); };
  const fresh = (kind: CreationKind) => { if (!mayReplace()) return; const next = newRules(kind);
    setPackId(crypto.randomUUID()); setRevision(null); setSource(next); setBaseline(JSON.stringify(next)); setComponentId(""); setEnabled(false); setReason(""); setRaw(""); setRawBaseline(""); };
  const save = async (publish: boolean) => { const result = await s.submit("rules/versions", { packId, expectedRevision: revision, source, publish },
    `${publish ? "Публикация" : "Черновик"} правил «${source.name}»`);
    if (result && typeof result.revision === "number") { setRevision(result.revision); setBaseline(JSON.stringify(source)); if (publish) setEnabled(true); } };
  const toggle = async () => { if (revision === null) return; const result = await s.submit("rules/enabled", { packId, expectedRevision: revision, enabled: !enabled, reason }, "Доступ набора правил", "PUT");
    if (result && typeof result.revision === "number") { setRevision(result.revision); setEnabled(!enabled); setReason(""); } };
  return <section><h3>Правила обоих конструкторов</h3><p>Новый набор — только черновик с неоценёнными компонентами. Вклады, пределы и совместимость задаёт мастер; эти формы не являются утверждённым балансом Аркен-Хара.</p>
    <div className="creation-actions">{packs.map(p => <button type="button" disabled={s.locked} key={p.id} onClick={() => open(p)}>{p.name}{p.enabled ? "" : " · выключен"}</button>)}
      <button type="button" disabled={s.locked} onClick={() => fresh("SKILL")}>Новые правила навыков</button><button type="button" disabled={s.locked} onClick={() => fresh("ARTIFACT")}>Новые правила артефактов</button></div>
    {revision !== null && <CreationVersionHistory key={packId} session={s} id={packId} kind="rules" active={active} />}
    <fieldset disabled={s.locked}><legend>{source.kind === "SKILL" ? "Навыки" : "Артефакты"} · {revision === null ? "новый набор" : `ревизия ${revision}`}</legend>
      <label>Название набора правил<input value={source.name} maxLength={100} onChange={e => setSource({ ...source, name: e.target.value })} /></label>
      <label>Описание<textarea value={source.description} maxLength={4000} onChange={e => setSource({ ...source, description: e.target.value })} /></label>
      <label>Ресурс применения<select value={source.usageResource ?? ""} onChange={e => setSource({ ...source, usageResource: (e.target.value as "magic" | "physical") || null })}>
        <option value="">Без ресурса</option><option value="magic">Магический</option><option value="physical">Физический</option></select></label>
      <details><summary>Шесть слотов и допустимое число компонентов</summary>{source.slots.map((v, i) => <div className="creation-fields" key={v.slot}><strong>{v.slot}</strong>
        {(["min", "max"] as const).map(k => <label key={k}>{k === "min" ? "Минимум" : "Максимум"}<input type="number" min={0} max={16} value={v[k]}
          onChange={e => setSource({ ...source, slots: source.slots.map((a, n) => n === i ? { ...a, [k]: Number(e.target.value) } : a) })} /></label>)}</div>)}</details>
      {(["limits", "manualAdjustment"] as const).map(group => <details key={group}><summary>{group === "limits" ? "Допустимый результат расчёта" : "Разрешённая ручная поправка"}</summary>
        {CREATION_METRICS.map(k => <div className="creation-fields" key={k}><strong>{metricLabels[k]}</strong>{(["min", "max"] as const).map(bound => <label key={bound}>{bound === "min" ? "От" : "До"}<input type="number" value={source[group][k][bound]} onChange={e =>
          setSource({ ...source, [group]: { ...source[group], [k]: { ...source[group][k], [bound]: Number(e.target.value) } } })} /></label>)}</div>)}</details>)}
      <label>Компонент<select value={component?.id ?? ""} onChange={e => setComponentId(e.target.value)}>{source.components.map(c => <option key={c.id} value={c.id}>{c.slot} · {c.name}{c.contribution === null ? " · не оценён" : ""}</option>)}</select></label>
      <div className="creation-actions">{CREATION_SLOTS[source.kind].map(slot => <button type="button" key={slot} disabled={source.components.length >= 128} onClick={() => {
        const c = newComponent(slot); setSource({ ...source, components: [...source.components, c] }); setComponentId(c.id); }}>Добавить: {slot}</button>)}</div>
      {component && <fieldset><legend>{component.name}</legend><div className="creation-fields">
        <label>Ключ<input value={component.id} onChange={e => { const id = e.target.value; changeComponent({ id }); setComponentId(id); }} /></label>
        <label>Название компонента<input value={component.name} maxLength={100} onChange={e => changeComponent({ name: e.target.value })} /></label>
        <label>Теги через запятую<CreationListInput key={component.id} value={component.tags} onChange={tags => changeComponent({ tags })} /></label></div>
        <label>Описание<textarea value={component.description} maxLength={2000} onChange={e => changeComponent({ description: e.target.value })} /></label>
        {component.contribution === null ? <div><p>Вклад ещё не задан. Такой компонент нельзя опубликовать.</p><button type="button" onClick={() => changeComponent({ contribution: zero() })}>Задать числовой вклад</button></div>
          : <><h4>Числовой вклад</h4><MetricsFields value={component.contribution} onChange={v => changeComponent({ contribution: v })} /><button type="button" onClick={() => changeComponent({ contribution: null })}>Снять числовое решение</button></>}
        <details><summary>Множители (10000 = ×1)</summary><MetricsFields value={component.factorsBasisPoints} onChange={v => changeComponent({ factorsBasisPoints: v })} /></details>
        <details><summary>Параметры игрока</summary>{component.parameters.map((p, i) => <fieldset key={i}><legend>{p.label || `Параметр ${i + 1}`}</legend>
          <div className="creation-fields">{(["key", "label", "min", "max", "step", "initial"] as const).map(k => <label key={k}>{({ key: "Ключ", label: "Название", min: "Минимум", max: "Максимум", step: "Шаг", initial: "Начальное" })[k]}
            <input type={k === "key" || k === "label" ? "text" : "number"} value={p[k]} onChange={e => changeComponent({ parameters: component.parameters.map((v, n) => n === i ? { ...v, [k]: k === "key" || k === "label" ? e.target.value : Number(e.target.value) } : v) })} /></label>)}</div>
          <p>Вклад за один шаг от минимального значения</p><MetricsFields value={p.perStep} onChange={v => changeComponent({ parameters: component.parameters.map((a, n) => n === i ? { ...a, perStep: v } : a) })} />
          <button type="button" onClick={() => changeComponent({ parameters: component.parameters.filter((_, n) => n !== i) })}>Удалить параметр</button></fieldset>)}
          <button type="button" disabled={component.parameters.length >= 12} onClick={() => changeComponent({ parameters: [...component.parameters, { key: `p${component.parameters.length + 1}`, label: "Параметр", min: 0, max: 0, step: 1, initial: 0, perStep: zero() }] })}>Добавить параметр</button></details>
        <details><summary>Требования к персонажу</summary>{component.requirements.map((r, i) => <div className="creation-fields" key={i}><label>Ключ характеристики<input value={r.statKey} onChange={e => changeComponent({ requirements: component.requirements.map((v, n) => n === i ? { ...v, statKey: e.target.value } : v) })} /></label>
          <label>Не ниже<input type="number" value={r.minimum} onChange={e => changeComponent({ requirements: component.requirements.map((v, n) => n === i ? { ...v, minimum: Number(e.target.value) } : v) })} /></label>
          <button type="button" onClick={() => changeComponent({ requirements: component.requirements.filter((_, n) => n !== i) })}>Убрать требование</button></div>)}
          <button type="button" onClick={() => changeComponent({ requirements: [...component.requirements, { statKey: "", minimum: 0 }] })}>Добавить требование</button></details>
        <details><summary>Материалы и ITEM-основа</summary><QueryState loading={catalog.loading} error={catalog.error} />
          {component.artifact && <><label>Существующая основа<select value={component.artifact.baseItemId} onChange={e => changeComponent({ artifact: { ...component.artifact!, baseItemId: e.target.value } })}>
            <option value="">Выберите ITEM</option>{component.artifact.baseItemId && !catalog.data?.items.some(m => m.id === component.artifact!.baseItemId) && <option value={component.artifact.baseItemId}>Сохранённая основа</option>}
            {catalog.data?.items.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>Категория<select value={component.artifact.category} onChange={e => changeComponent({ artifact: { ...component.artifact!, category: e.target.value as NonNullable<Component["artifact"]>["category"] } })}>
              {["WEAPON", "ARMOR", "ACCESSORY", "RELIC", "CONSUMABLE"].map(k => <option key={k}>{k}</option>)}</select></label>
            <label>Редкость<input value={component.artifact.rarity} onChange={e => changeComponent({ artifact: { ...component.artifact!, rarity: e.target.value } })} /></label></>}
          {component.materials.map((m, i) => <div className="creation-fields" key={i}><label>Материал<select value={m.worldContentId} onChange={e => changeComponent({ materials: component.materials.map((v, n) => n === i ? { ...v, worldContentId: e.target.value } : v) })}>
            <option value="">Выберите ITEM</option>{m.worldContentId && !catalog.data?.items.some(a => a.id === m.worldContentId) && <option value={m.worldContentId}>Сохранённый материал</option>}{catalog.data?.items.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
            <label>Количество<input type="number" min={1} value={m.quantity} onChange={e => changeComponent({ materials: component.materials.map((v, n) => n === i ? { ...v, quantity: Number(e.target.value) } : v) })} /></label>
            <button type="button" onClick={() => changeComponent({ materials: component.materials.filter((_, n) => n !== i) })}>Убрать материал</button></div>)}
          <button type="button" disabled={component.materials.length >= 8} onClick={() => changeComponent({ materials: [...component.materials, { worldContentId: "", quantity: 1 }] })}>Добавить материал</button>
          <PageControls more={!!catalog.data?.nextAfter} previous={catalog.hasPrevious} disabled={catalog.loading} onNext={catalog.next} onFirst={catalog.first} /></details>
        <h4>Исполняемые и ручные эффекты</h4><Effects value={component.effects} parameters={component.parameters} components={source.components} onChange={v => changeComponent({ effects: v })} />
        <button type="button" disabled={source.components.length <= 1} onClick={() => { setSource({ ...source, components: source.components.filter(c => c.id !== component.id) }); setComponentId(""); }}>Удалить компонент из новой версии правил</button>
      </fieldset>}
      <details><summary>Совместимость компонентов</summary>{source.compatibility.map((c, i) => <fieldset key={i}><legend>{c.id}</legend>
        <label>Сообщение игроку<input value={c.message} maxLength={500} onChange={e => setSource({ ...source, compatibility: source.compatibility.map((v, n) => n === i ? { ...v, message: e.target.value } : v) })} /></label>
        <label>Строгость<select value={c.severity} onChange={e => setSource({ ...source, compatibility: source.compatibility.map((v, n) => n === i ? { ...v, severity: e.target.value as "ERROR" | "WARNING" } : v) })}><option value="ERROR">Запрет</option><option value="WARNING">Предупреждение</option></select></label>
        {(["when", "require"] as const).map(side => <fieldset key={side}><legend>{side === "when" ? "Если состав соответствует" : "То должен соответствовать"}</legend>
          {(["allOf", "anyOf", "noneOf"] as const).map(k => <label key={k}>{k === "allOf" ? "Все ключи" : k === "anyOf" ? "Любой из ключей" : "Ни одного из ключей"} (через запятую)<CreationListInput key={`${c.id}:${side}:${k}`} value={c[side][k]} onChange={items => setSource({ ...source,
            compatibility: source.compatibility.map((v, n) => n === i ? { ...v, [side]: { ...v[side], [k]: items } } : v) })} /></label>)}
          <ConditionParameters value={c[side].parameters ?? []} components={source.components} onChange={parameters => setSource({ ...source,
            compatibility: source.compatibility.map((v, n) => n === i ? { ...v, [side]: { ...v[side], parameters } } : v) })} />
          {!!c[side].tags.length && <p>Также заданы условия по тегам; их можно изменить в расширенном источнике ниже.</p>}</fieldset>)}
        <button type="button" onClick={() => setSource({ ...source, compatibility: source.compatibility.filter((_, n) => n !== i) })}>Убрать ограничение</button></fieldset>)}
        <button type="button" disabled={source.compatibility.length >= 128} onClick={() => setSource({ ...source, compatibility: [...source.compatibility,
          { id: `rule-${crypto.randomUUID().slice(0, 8)}`, when: { allOf: [], anyOf: [], noneOf: [], tags: [] }, require: { allOf: [], anyOf: [], noneOf: [], tags: [] }, severity: "ERROR", message: "" }] })}>Добавить ограничение</button></details>
      <details><summary>Расширенный источник набора</summary><p>Для переноса полного формата, включая условия по тегам. Импорт меняет только форму, не публикует набор.</p>
        <button type="button" onClick={() => { if (raw !== rawBaseline && !window.confirm("Несохранённый текст источника будет потерян. Продолжить?")) return; const value=JSON.stringify(source, null, 2); setRaw(value); setRawBaseline(value); }}>Показать текущий источник</button><textarea rows={8} value={raw} onChange={e => setRaw(e.target.value)} />
        <button type="button" onClick={() => void s.inspect(async () => { const { creationRuleSourceSchema } = await import("@arken/contracts"); setSource(creationRuleSourceSchema.parse(JSON.parse(raw))); setRawBaseline(raw); setComponentId(""); })}>Применить источник к форме</button></details>
      <div className="creation-actions"><button type="button" disabled={!source.name.trim()} onClick={() => void save(false)}>Сохранить черновик правил</button>
        <button type="button" className="creation-primary" disabled={!source.name.trim() || source.components.some(c => c.contribution === null)} onClick={() => void save(true)}>Опубликовать эту версию правил</button></div>
      {revision !== null && <><label>Причина переключения доступа<textarea value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
        <button type="button" disabled={!reason.trim()} onClick={() => void toggle()}>{enabled ? "Выключить набор" : "Включить опубликованный набор"}</button></>}
    </fieldset>
  </section>;
}
