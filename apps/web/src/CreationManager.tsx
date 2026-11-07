import { CreationVersionHistory } from "./CreationVersionHistory";
import { useEffect, useState } from "react";
import { creationRecipeSourceSchema, type CreationKind, type CreationPoint, type CreationRecipeSource } from "@arken/contracts";
import { creationPath, type Recipe, type RecipePage, type RulePack, type Template } from "./creation-client";
import { useCreationPage, useCreationQuery, type CreationSession } from "./use-creation-session";
import { CreationRules } from "./CreationRules";
import { operationLabels, PageControls, QueryState, stageLabels } from "./CreationParts";

export function CreationManager({ session, packs, active, onRulesDirtyChange, onRecipesDirtyChange }: { session: CreationSession; packs: RulePack[]; active: boolean; onRulesDirtyChange?: (dirty: boolean) => void; onRecipesDirtyChange?: (dirty: boolean) => void }) {
  const [tab, setTab] = useState<"rules" | "recipes">("rules");
  return <div><div className="creation-tabs" aria-label="Настройки мастера">{([["rules", "Правила конструкторов"], ["recipes", "Рецепты изготовления"]] as const).map(([key, label]) =>
    <button type="button" key={key} disabled={session.busy} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
    <div hidden={tab !== "rules"}><CreationRules session={session} packs={packs} active={active && tab === "rules"} onDirtyChange={onRulesDirtyChange} /></div>
    <div hidden={tab !== "recipes"}><RecipeEditor session={session} active={active && tab === "recipes"} onDirtyChange={onRecipesDirtyChange} /></div>
  </div>;
}
const point = (): CreationPoint => ({ versionId: "", level: 1, stage: "CRAFTED" });
const newRecipe = (): CreationRecipeSource => ({ format: 1, name: "", reason: "", kind: "SKILL", operation: "CRAFT", inputs: [], output: point(),
  cost: { copper: 0, sp: 0, materials: [] }, refund: null });
function RecipeEditor({ session: s, active, onDirtyChange }: { session: CreationSession; active: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const recipes = useCreationQuery<RecipePage>(s, active ? creationPath("recipes") : null);
  const templates = useCreationPage<Template>(s, active ? creationPath("templates") : null);
  const materials = useCreationPage<{ id: string; name: string }>(s, active ? creationPath("material-catalog") : null);
  const [id, setId] = useState<string>(() => crypto.randomUUID()), [revision, setRevision] = useState<number | null>(null);
  const [source, setSource] = useState<CreationRecipeSource>(newRecipe), [enabled, setEnabled] = useState(false), [reason, setReason] = useState("");
  const [baseline, setBaseline] = useState(() => JSON.stringify(newRecipe()));
  const [raw, setRaw] = useState(""), [rawBaseline, setRawBaseline] = useState("");
  useEffect(() => { onDirtyChange?.(JSON.stringify(source) !== baseline || raw !== rawBaseline || !!reason.trim()); },
    [source, baseline, raw, rawBaseline, reason, onDirtyChange]);
  useEffect(() => {
    const completed = s.completed;
    if (!completed || completed.body.recipeId !== id || completed.body.expectedRevision !== revision ||
        typeof completed.receipt.revision !== "number") return;
    if (completed.path === "recipes/enabled" && typeof completed.body.enabled === "boolean") {
      setRevision(completed.receipt.revision); setEnabled(completed.body.enabled); setReason(""); return;
    }
    if (completed.path !== "recipes/versions") return;
    const current = creationRecipeSourceSchema.safeParse(source), saved = creationRecipeSourceSchema.safeParse(completed.body.source);
    if (!current.success || !saved.success || JSON.stringify(current.data) !== JSON.stringify(saved.data)) return;
    setRevision(completed.receipt.revision);
    setBaseline(JSON.stringify(source));
    if (completed.body.publish === true) setEnabled(true);
  }, [s.completed, id, revision, source]);
  const mayReplace = () => (JSON.stringify(source) === baseline && raw === rawBaseline && !reason.trim()) ||
    window.confirm("Несохранённые изменения рецепта будут потеряны. Продолжить?");
  const open = (r: Recipe) => { if (!mayReplace()) return; setId(r.recipe.id); setRevision(r.recipe.revision); setEnabled(r.recipe.enabled); setSource(r.source); setBaseline(JSON.stringify(r.source)); setReason(""); setRaw(""); setRawBaseline(""); };
  const fresh = () => { if (!mayReplace()) return; const next = newRecipe(); setId(crypto.randomUUID()); setRevision(null); setSource(next); setBaseline(JSON.stringify(next)); setEnabled(false); setReason(""); setRaw(""); setRawBaseline(""); };
  const options = templates.data?.items.filter(t => t.kind === source.kind && t.review?.decision === "APPROVED") ?? [];
  const pointFields = (p: CreationPoint, change: (p: CreationPoint) => void, label: string) => <fieldset><legend>{label}</legend><div className="creation-fields">
    <label>Одобренная версия<select value={p.versionId} onChange={e => change({ ...p, versionId: e.target.value })}><option value="">Выберите шаблон</option>
      {p.versionId && !options.some(t => t.latestVersion.id === p.versionId) && <option value={p.versionId}>Зафиксированная версия {p.versionId.slice(0, 8)}</option>}
      {options.map(t => <option key={t.id} value={t.latestVersion.id}>{t.latestVersion.design.name} · версия {t.latestVersion.number}</option>)}</select></label>
    <label>Уровень<input type="number" min={1} max={1000} value={p.level} onChange={e => change({ ...p, level: Number(e.target.value) })} /></label>
    <label>Этап<select value={p.stage} onChange={e => change({ ...p, stage: e.target.value as typeof p.stage })}>{Object.entries(stageLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
  </div></fieldset>;
  const operation = (value: CreationRecipeSource["operation"]) => setSource({ ...source, operation: value,
    inputs: value === "CRAFT" ? [] : value === "MERGE" ? [point(), point()] : [point()],
    output: value === "DISASSEMBLE" ? null : point(), refund: value === "DISASSEMBLE" ? { copperBasisPoints: 0, spBasisPoints: 0, materialsBasisPoints: 0 } : null });
  const save = async (publish: boolean) => { const result = await s.submit("recipes/versions", { recipeId: id, expectedRevision: revision, source, publish },
    `${publish ? "Публикация" : "Черновик"} рецепта «${source.name}»`);
    if (result && typeof result.revision === "number") { setRevision(result.revision); setBaseline(JSON.stringify(source)); if (publish) setEnabled(true); } };
  const toggle = async () => { const result = await s.submit("recipes/enabled", { recipeId: id, expectedRevision: revision, enabled: !enabled, reason }, "Доступ рецепта", "PUT");
    if (result && typeof result.revision === "number") { setRevision(result.revision); setEnabled(!enabled); setReason(""); } };
  return <section><h3>Рецепты изготовления</h3>
    <QueryState loading={recipes.loading || templates.loading} error={recipes.error || templates.error} />
    <div className="creation-actions">{[...(recipes.data?.recipes ?? []), ...(recipes.data?.drafts ?? [])].filter(r => r.source.operation === "CRAFT").map(r => <button type="button" disabled={s.locked}
      key={r.version.id} onClick={() => open(r)}>{r.source.name}{r.version.published ? "" : " · черновик"}</button>)}<button type="button" disabled={s.locked} onClick={fresh}>Новый рецепт</button></div>
    {revision !== null && <CreationVersionHistory key={id} session={s} id={id} kind="recipes" active={active} />}
    <fieldset disabled={s.locked}><legend>Точная версия перехода</legend><label>Название<input value={source.name} maxLength={100} onChange={e => setSource({ ...source, name: e.target.value })} /></label>
      <label>Публичное пояснение / причина<textarea value={source.reason} maxLength={2000} onChange={e => setSource({ ...source, reason: e.target.value })} /></label>
      <div className="creation-fields"><label>Конструктор<select value={source.kind} onChange={e => setSource({ ...newRecipe(), name: source.name, reason: source.reason, kind: e.target.value as CreationKind })}>
        <option value="SKILL">Навык</option><option value="ARTIFACT">Артефакт</option></select></label>
        <label>Операция<select value={source.operation} onChange={e => operation(e.target.value as CreationRecipeSource["operation"])}>{Object.entries(operationLabels).filter(([key]) => key === "CRAFT").map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label></div>
      {source.inputs.map((p, i) => <div key={i}>{pointFields(p, v => setSource({ ...source, inputs: source.inputs.map((a, n) => n === i ? v : a) }), `Расходуемый вход ${i + 1}`)}
        {source.operation === "MERGE" && source.inputs.length > 2 && <button type="button" onClick={() => setSource({ ...source, inputs: source.inputs.filter((_, n) => n !== i) })}>Убрать вход</button>}</div>)}
      {source.operation === "MERGE" && <button type="button" disabled={source.inputs.length >= 8} onClick={() => setSource({ ...source, inputs: [...source.inputs, point()] })}>Добавить отдельный вход</button>}
      {source.output && pointFields(source.output, v => setSource({ ...source, output: v }), "Новый объект")}
      <PageControls more={!!templates.data?.nextAfter} previous={templates.hasPrevious} disabled={templates.loading} onNext={templates.next} onFirst={templates.first} />
      <p>Первое изготовление — уровень 1, этап «Создан».</p>
      <div className="creation-fields"><label>Потратить медных<input type="number" min={0} max={1e12} value={source.cost.copper} onChange={e => setSource({ ...source, cost: { ...source.cost, copper: Number(e.target.value) } })} /></label>
        <label>Потратить SP<input type="number" min={0} max={1e9} value={source.cost.sp} onChange={e => setSource({ ...source, cost: { ...source.cost, sp: Number(e.target.value) } })} /></label></div>
      <p>SP должны покрывать состав нового выхода за вычетом полностью расходуемых входов; материалы включают реальную ITEM-основу.</p>
      <QueryState loading={materials.loading} error={materials.error} />
      {source.cost.materials.map((m, i) => <div className="creation-fields" key={i}><label>Материал<select value={m.worldContentId} onChange={e => setSource({ ...source,
        cost: { ...source.cost, materials: source.cost.materials.map((a, n) => n === i ? { ...a, worldContentId: e.target.value } : a) } })}><option value="">Выберите ITEM</option>
        {m.worldContentId && !materials.data?.items.some(a => a.id === m.worldContentId) && <option value={m.worldContentId}>Сохранённый материал</option>}
        {materials.data?.items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Количество<input type="number" min={1} max={1e6} value={m.quantity} onChange={e => setSource({ ...source,
          cost: { ...source.cost, materials: source.cost.materials.map((a, n) => n === i ? { ...a, quantity: Number(e.target.value) } : a) } })} /></label>
        <button type="button" onClick={() => setSource({ ...source, cost: { ...source.cost, materials: source.cost.materials.filter((_, n) => n !== i) } })}>Убрать материал</button></div>)}
      <button type="button" disabled={source.cost.materials.length >= 128} onClick={() => setSource({ ...source, cost: { ...source.cost, materials: [...source.cost.materials, { worldContentId: "", quantity: 1 }] } })}>Добавить материал</button>
      <PageControls more={!!materials.data?.nextAfter} previous={materials.hasPrevious} disabled={materials.loading} onNext={materials.next} onFirst={materials.first} />
      {source.refund && <fieldset><legend>Частичный возврат фактически оплаченного (100 = 1%)</legend><div className="creation-fields">
        {(["copperBasisPoints", "spBasisPoints", "materialsBasisPoints"] as const).map(k => <label key={k}>{k === "copperBasisPoints" ? "Монеты" : k === "spBasisPoints" ? "SP" : "Материалы"}
          <input type="number" min={0} max={9999} value={source.refund![k]} onChange={e => setSource({ ...source, refund: { ...source.refund!, [k]: Number(e.target.value) } })} /></label>)}</div>
        <p>Каждый возврат округляется вниз. Продажная цена и комиссия не возвращаются.</p></fieldset>}
      <details><summary>Расширенный источник рецепта / старые версии входов</summary><p>Позволяет перенести точные идентификаторы ранее одобренных версий. Сервер проверит каждую из них.</p>
        <button type="button" onClick={() => { if (raw !== rawBaseline && !window.confirm("Несохранённый текст источника будет потерян. Продолжить?")) return; const value = JSON.stringify(source, null, 2); setRaw(value); setRawBaseline(value); }}>Показать источник</button><textarea rows={8} value={raw} onChange={e => setRaw(e.target.value)} />
        <button type="button" onClick={() => void s.inspect(async () => { setSource(creationRecipeSourceSchema.parse(JSON.parse(raw))); setRawBaseline(raw); })}>Применить к форме</button></details>
      <div className="creation-actions"><button type="button" onClick={() => void save(false)}>Сохранить черновик рецепта</button><button type="button" className="creation-primary" onClick={() => void save(true)}>Опубликовать рецепт</button></div>
      {revision !== null && <><label>Причина переключения<textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label><button type="button" disabled={!reason.trim()} onClick={() => void toggle()}>{enabled ? "Выключить рецепт" : "Включить опубликованный рецепт"}</button></>}
    </fieldset>
  </section>;
}
