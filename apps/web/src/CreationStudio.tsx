import { useEffect, useRef, useState } from "react";
import { CREATION_METRICS, CREATION_SLOTS, creationDesignSchema, evaluateCreationSchema, type CreationDesign, type CreationEvaluation,
  type CreationKind } from "@arken/contracts";
import { creationPath, creationRequest, type Licence, type RulePack, type Template, type TemplateVersion } from "./creation-client";
import { useCreationPage, useCreationQuery, type CreationSession } from "./use-creation-session";
import { Evaluation, metricLabels, PageControls, QueryState, reviewLabel } from "./CreationParts";

const slotLabels: Record<string, string> = { ACTION: "Действие", TARGET: "Цель", SCHOOL: "Школа / стихия", BASE: "Основа",
  MATERIAL: "Материал", CORE: "Ядро / руна", EFFECT: "Эффект", MODIFIER: "Модификатор", LIMITATION: "Цена / ограничение" };
const emptyDesign = (): CreationDesign => ({ name: "", lore: "", appearance: "", selections: [],
  adjustments: { power: 0, priceCopper: 0, craftSp: 0, usageCost: 0 }, adjustmentReason: "" });
type Editor = { id: string; revision: number | null; previousId: string | null; kind: CreationKind; authorId: string;
  ruleId: string; design: CreationDesign; template?: Template };
const editorSignature = (editor: Editor) => JSON.stringify({ ruleId: editor.ruleId, design: editor.design });
export function CreationStudio({ session: s, packs, gm, characterId, active, onDirtyChange }: {
  session: CreationSession; packs: RulePack[]; gm: boolean; characterId: string; active: boolean; onDirtyChange?: (dirty: boolean) => void;
}) {
  const templates = useCreationPage<Template>(s, active ? creationPath("templates") : null);
  const fresh = (kind: CreationKind): Editor => ({ id: crypto.randomUUID(), revision: null, previousId: null,
    kind, authorId: s.context.membershipId, ruleId: "", design: emptyDesign() });
  const [editor, setEditor] = useState<Editor>(() => fresh("SKILL"));
  const [baseline, setBaseline] = useState(() => editorSignature(editor));
  const [calculation, setCalculation] = useState<CreationEvaluation | null>(null), [reviewReason, setReviewReason] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null), [fork, setFork] = useState<Licence | null>(null);
  const [forkName, setForkName] = useState(""), [forkRule, setForkRule] = useState("");
  const generation = useRef(0);
  const observedForkReceipt = useRef<CreationSession["completed"]>(null);
  useEffect(() => { onDirtyChange?.(editorSignature(editor) !== baseline || !!reviewReason.trim() || !!(fork && (forkName.trim() || forkRule))); },
    [editor, baseline, reviewReason, fork, forkName, forkRule, onDirtyChange]);
  const own = editor.authorId === s.context.membershipId;
  const available = packs.filter(p => p.kind === editor.kind && p.enabled && p.activeVersion);
  const rules = available.find(p => p.activeVersion?.id === editor.ruleId)?.activeVersion?.source;
  const change = (next: Editor) => { generation.current++; setEditor(next); setCalculation(null); };
  const designChange = (patch: Partial<CreationDesign>) => change({ ...editor, design: { ...editor.design, ...patch } });
  const mayReplace = () => editorSignature(editor) === baseline ||
    window.confirm("Несохранённый чертёж будет потерян. Продолжить?");
  const open = (t: Template, confirmed = false) => { if (!confirmed && !mayReplace()) return;
    const next = { id: t.id, revision: t.revision, previousId: t.latestVersion.id, kind: t.kind,
      authorId: t.authorMembershipId, ruleId: t.latestVersion.ruleVersionId, design: t.latestVersion.design, template: t };
    change(next); setBaseline(editorSignature(next));
    setCalculation(t.latestVersion.evaluation); setReviewReason(""); };
  useEffect(() => {
    const completed = s.completed;
    if (!completed) return;
    const newForkReceipt = completed.path === "templates/fork" && observedForkReceipt.current !== completed;
    if (completed.path === "templates/fork") observedForkReceipt.current = completed;
    if (newForkReceipt && fork &&
        completed.body.sourceVersionId === fork.version.id && completed.body.ruleVersionId === forkRule &&
        completed.body.name === forkName.trim() && typeof completed.body.templateId === "string" &&
        typeof completed.receipt.versionId === "string" && typeof completed.receipt.revision === "number" &&
        typeof completed.receipt.number === "number" && typeof completed.receipt.versionHash === "string" && completed.receipt.evaluation) {
      const id = completed.body.templateId;
      const version: TemplateVersion = { id: completed.receipt.versionId, templateId: id, ruleVersionId: forkRule,
        number: completed.receipt.number, versionHash: completed.receipt.versionHash,
        design: { ...fork.version.design, name: forkName.trim() }, evaluation: completed.receipt.evaluation as CreationEvaluation };
      open({ id, kind: fork.version.kind, revision: completed.receipt.revision, authorMembershipId: s.context.membershipId,
        latestVersion: version, review: null, origin: { sourceVersionId: fork.version.id, sourceAuthorName: fork.author.displayName } }, true);
      setFork(null);
      return;
    }
    if (completed.path === "reviews" && editor.template &&
        completed.body.versionId === editor.template.latestVersion.id &&
        completed.body.expectedRevision === (editor.template.review?.revision ?? null) &&
        (completed.body.decision === "APPROVED" || completed.body.decision === "REJECTED" || completed.body.decision === "REVOKED") &&
        typeof completed.body.reason === "string" && typeof completed.receipt.revision === "number") {
      const decision = completed.body.decision, reason = completed.body.reason, revision = completed.receipt.revision;
      setEditor(old => old.template ? { ...old, template: { ...old.template, review: { revision, decision, reason } } } : old);
      setReviewReason("");
      return;
    }
    if (completed.path !== "templates/versions" || completed.body.templateId !== editor.id ||
        completed.body.expectedRevision !== editor.revision || completed.body.previousVersionId !== editor.previousId ||
        completed.body.ruleVersionId !== editor.ruleId || typeof completed.receipt.revision !== "number" ||
        typeof completed.receipt.versionId !== "string" || typeof completed.receipt.number !== "number" ||
        typeof completed.receipt.versionHash !== "string" || !completed.receipt.evaluation) return;
    const current = creationDesignSchema.safeParse(editor.design), saved = creationDesignSchema.safeParse(completed.body.design);
    if (!current.success || !saved.success || JSON.stringify(current.data) !== JSON.stringify(saved.data)) return;
    const template: Template = { id: editor.id, authorMembershipId: editor.authorId, kind: editor.kind,
      revision: completed.receipt.revision, review: null, origin: editor.template?.origin,
      latestVersion: { id: completed.receipt.versionId, templateId: editor.id, number: completed.receipt.number,
        ruleVersionId: editor.ruleId, versionHash: completed.receipt.versionHash, design: editor.design,
        evaluation: completed.receipt.evaluation as CreationEvaluation } };
    open(template, true);
  }, [s.completed, editor, fork, forkName, forkRule, s.context.membershipId]);
  const startFresh = (kind: CreationKind) => { if (!mayReplace()) return; const next = fresh(kind);
    change(next); setBaseline(editorSignature(next)); };
  const evaluate = () => s.inspect(async () => {
    const body = evaluateCreationSchema.parse({ ruleVersionId: editor.ruleId, design: editor.design }), epoch = generation.current;
    const value = await creationRequest<{ evaluation: CreationEvaluation }>(s.context, creationPath("evaluate"), body);
    if (epoch === generation.current) setCalculation(value.evaluation);
  });
  const save = async () => {
    const result = await s.submit("templates/versions", { templateId: editor.id, expectedRevision: editor.revision,
      previousVersionId: editor.previousId, ruleVersionId: editor.ruleId, design: editor.design }, `Версия «${editor.design.name}»`);
    if (result && typeof result.versionId === "string" && typeof result.revision === "number") {
      const evaluation = result.evaluation as CreationEvaluation;
      const template: Template = { id: editor.id, authorMembershipId: s.context.membershipId, kind: editor.kind,
        revision: result.revision, review: null, origin: editor.template?.origin,
        latestVersion: { id: result.versionId, templateId: editor.id, number: Number(result.number), ruleVersionId: editor.ruleId,
          versionHash: String(result.versionHash), design: editor.design, evaluation } };
      open(template, true); templates.first();
    }
  };
  const review = async (decision: "APPROVED" | "REJECTED" | "REVOKED") => {
    if (!editor.template) return;
    const result = await s.submit("reviews", { versionId: editor.template.latestVersion.id,
      expectedRevision: editor.template.review?.revision ?? null, decision, reason: reviewReason }, `Решение по «${editor.template.latestVersion.design.name}»`);
    if (result && typeof result.revision === "number") { setEditor(old => ({ ...old, template: old.template ? { ...old.template,
      review: { revision: Number(result.revision), decision, reason: reviewReason } } : undefined })); setReviewReason(""); }
  };
  const forkTemplate = async () => {
    if (!fork || !mayReplace()) return;
    const id = crypto.randomUUID(), result = await s.submit("templates/fork", { templateId: id,
      sourceVersionId: fork.version.id, ruleVersionId: forkRule, name: forkName }, `Новый черновик «${forkName}»`);
    if (result && typeof result.versionId === "string") {
      const version: TemplateVersion = { id: result.versionId, templateId: id, ruleVersionId: forkRule,
        number: 1, versionHash: String(result.versionHash), design: { ...fork.version.design, name: forkName }, evaluation: result.evaluation as CreationEvaluation };
      open({ id, kind: fork.version.kind, revision: 0, authorMembershipId: s.context.membershipId, latestVersion: version,
        review: null, origin: { sourceVersionId: fork.version.id, sourceAuthorName: fork.author.displayName } }, true);
      setFork(null); templates.first();
    }
  };
  return <div className="creation-studio">
    <aside className="creation-library" aria-label="Библиотека чертежей">
      <h3>{gm ? "Чертежи кампании" : "Мои чертежи"}</h3><QueryState loading={templates.loading} error={templates.error} />
      {templates.data?.items.length === 0 && <p>Создайте первый навык или артефакт из опубликованных мастером компонентов.</p>}
      <ul className="creation-record-list">{templates.data?.items.map(t => <li key={t.id}>
        <button type="button" aria-pressed={editor.id === t.id} disabled={s.locked} onClick={() => open(t)}>{t.latestVersion.design.name}</button>
        <small>{t.kind === "SKILL" ? "Навык" : "Артефакт"} · версия {t.latestVersion.number} · {reviewLabel(t.review?.decision)}</small>
        {t.origin && <small>Основа — автор {t.origin.sourceAuthorName}</small>}
        <button type="button" disabled={s.busy} onClick={() => setHistoryId(t.id)}>История и сравнение</button>
      </li>)}</ul><PageControls more={!!templates.data?.nextAfter} previous={templates.hasPrevious}
        disabled={s.busy || templates.loading} onNext={templates.next} onFirst={templates.first} />
    </aside>
    <div className="creation-editor">
      <div className="creation-actions"><button type="button" disabled={s.locked} onClick={() => startFresh("SKILL")}>Новый навык</button>
        <button type="button" disabled={s.locked} onClick={() => startFresh("ARTIFACT")}>Новый артефакт</button></div>
      <h3>{editor.kind === "SKILL" ? "Конструктор навыка" : "Конструктор артефакта"}</h3>
      {!own && <p>Это авторский оригинал другого участника. Здесь доступен просмотр и решение мастера, не редактирование от его имени.</p>}
      <fieldset disabled={s.locked || !own}><legend>Авторская версия</legend>
        <label>Название<input value={editor.design.name} maxLength={100} onChange={e => designChange({ name: e.target.value })} /></label>
        <label>Набор правил<select value={editor.ruleId} onChange={e => change({ ...editor, ruleId: e.target.value })}>
          <option value="">Выберите опубликованный набор</option>
          {editor.ruleId && !rules && <option value={editor.ruleId} disabled>Старая версия правил — выберите текущую</option>}
          {available.map(p => <option key={p.id} value={p.activeVersion!.id}>{p.name} · версия {p.activeVersion!.number}</option>)}</select></label>
        {!available.length && <p>Мастер ещё не опубликовал правила этого конструктора. Черновые числа автоматически не включаются.</p>}
        {rules && CREATION_SLOTS[editor.kind].map(slot => {
          const limits = rules.slots.find(r => r.slot === slot)!, selected = editor.design.selections.filter(c => rules.components.find(r => r.id === c.componentId)?.slot === slot);
          return <fieldset key={slot} className="creation-slot"><legend>{slotLabels[slot]} <small>Выбрать {limits.min}–{limits.max}</small></legend>
            {rules.components.filter(c => c.slot === slot).map(c => {
              const choice = editor.design.selections.find(v => v.componentId === c.id);
              return <div className="creation-component" key={c.id}><label className="creation-check">
                <input type="checkbox" checked={!!choice} disabled={!choice && selected.length >= limits.max} onChange={e => designChange({ selections:
                  e.target.checked ? [...editor.design.selections, { componentId: c.id, parameters: Object.fromEntries(c.parameters.map(p => [p.key, p.initial])) }] :
                    editor.design.selections.filter(v => v.componentId !== c.id) })} /><span>{c.name}</span></label>
                {c.description && <p><small>Базовое описание компонента; итог с модификаторами — в расчёте ниже.</small><br />{c.description}</p>}
                {!!choice && c.parameters.map(p => <label key={p.key}>{p.label}<input type="number" min={p.min} max={p.max} step={p.step}
                  value={choice.parameters[p.key] ?? p.initial} onChange={e => designChange({ selections: editor.design.selections.map(v => v.componentId === c.id
                    ? { ...v, parameters: { ...v.parameters, [p.key]: Number(e.target.value) } } : v) })} /></label>)}
              </div>;
            })}</fieldset>;
        })}
        {rules && editor.design.selections.some(c => !rules.components.some(r => r.id === c.componentId)) && <p role="alert">
          В выбранных правилах нет части прежних компонентов. <button type="button" onClick={() => designChange({ selections: editor.design.selections.filter(c => rules.components.some(r => r.id === c.componentId)) })}>Убрать недоступные компоненты</button></p>}
        <label>Описание и лор<textarea rows={4} maxLength={10000} value={editor.design.lore} onChange={e => designChange({ lore: e.target.value })} /></label>
        <label>Внешний вид<textarea rows={2} maxLength={2000} value={editor.design.appearance} onChange={e => designChange({ appearance: e.target.value })} /></label>
        {rules && <details><summary>Разрешённые ручные поправки</summary><div className="creation-fields">{CREATION_METRICS.map(k => <label key={k}>{metricLabels[k]}
          <input type="number" min={rules.manualAdjustment[k].min} max={rules.manualAdjustment[k].max} step={1} value={editor.design.adjustments[k]}
            onChange={e => designChange({ adjustments: { ...editor.design.adjustments, [k]: Number(e.target.value) } })} /></label>)}</div>
          <label>Причина<textarea value={editor.design.adjustmentReason} maxLength={500} onChange={e => designChange({ adjustmentReason: e.target.value })} /></label></details>}
        <div className="creation-actions"><button type="button" disabled={!rules} onClick={() => void evaluate()}>Рассчитать и проверить состав</button>
          <button type="button" className="creation-primary" disabled={!rules || !editor.design.name.trim()} onClick={() => void save()}>Сохранить новую версию</button></div>
        <p>Сохранение не выдаёт объект и не меняет уже выданные версии.</p>
      </fieldset>
      {calculation && <Evaluation value={calculation} />}
      {gm && editor.template && <fieldset disabled={s.locked}><legend>Допуск именно сохранённой версии {editor.template.latestVersion.number}</legend>
        <p>{reviewLabel(editor.template.review?.decision)}. Несохранённые изменения в форме в решение не входят.</p>
        <details><summary>Карточка, которую получает допуск</summary><Evaluation value={editor.template.latestVersion.evaluation} /></details>
        <label>Причина решения<textarea maxLength={1000} value={reviewReason} onChange={e => setReviewReason(e.target.value)} /></label>
        <div className="creation-actions"><button type="button" disabled={!reviewReason.trim() || !editor.template.latestVersion.evaluation.valid} onClick={() => void review("APPROVED")}>Одобрить версию</button>
          <button type="button" disabled={!reviewReason.trim()} onClick={() => void review("REJECTED")}>Отклонить</button>
          <button type="button" disabled={!reviewReason.trim()} onClick={() => void review("REVOKED")}>Отозвать допуск</button></div></fieldset>}
      {historyId && <TemplateHistory key={historyId} session={s} id={historyId} onClose={() => setHistoryId(null)} />}
    </div>
  </div>;
}
function TemplateHistory({ session, id, onClose }: { session: CreationSession; id: string; onClose: () => void }) {
  const [before, setBefore] = useState<string>(), [compare, setCompare] = useState<TemplateVersion | null>(null);
  const query = useCreationQuery<{ items: TemplateVersion[]; nextBefore: number | null }>(session, creationPath(`templates/${id}/versions`, { before }));
  return <section aria-label="История шаблона"><h3>История и сравнение версий</h3><button type="button" onClick={onClose}>Закрыть историю</button>
    <QueryState loading={query.loading} error={query.error} />
    {query.data?.items.map(v => <details key={v.id}><summary>Версия {v.number}: {v.design.name} · {reviewLabel(v.review?.decision)}</summary>
      <Evaluation value={v.evaluation} /><button type="button" onClick={() => setCompare(v)}>Сравнивать с этой версией</button>
      {compare && compare.id !== v.id && <div><h4>Различия с версией {compare.number}</h4>
        <ul>{(["name", "lore", "appearance", "selections", "adjustments", "adjustmentReason"] as const).filter(k =>
          JSON.stringify(v.design[k as keyof CreationDesign]) !== JSON.stringify(compare.design[k as keyof CreationDesign])).map(k => <li key={k}>
          {({ name: "Название", lore: "Описание", appearance: "Внешний вид", selections: "Состав и параметры", adjustments: "Поправки", adjustmentReason: "Причина поправок" })[k]}
          <div className="creation-compare"><pre>{JSON.stringify(compare.design[k as keyof CreationDesign], null, 2)}</pre><pre>{JSON.stringify(v.design[k as keyof CreationDesign], null, 2)}</pre></div>
        </li>)}</ul></div>}</details>)}
    <div className="creation-actions">{before && <button type="button" onClick={() => setBefore(undefined)}>Последние версии</button>}
      {query.data?.nextBefore != null && <button type="button" onClick={() => setBefore(String(query.data!.nextBefore))}>Более ранние версии</button>}</div>
  </section>;
}
