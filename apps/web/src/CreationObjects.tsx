import type { CreationAncestor } from "./creation-client";
import { useEffect, useRef, useState } from "react";
import type { CreationOperationQuote } from "@arken/contracts";
import { creationPath, creationRequest, type CreationCharacter, type CreationObject, type OperationRow, type RecipePage } from "./creation-client";
import { useCreationPage, useCreationQuery, type CreationSession } from "./use-creation-session";
import { Cost, MaterialPicker, operationLabels, PageControls, QueryState, reviewLabel, stageLabels, useQuoteExpired } from "./CreationParts";
const artifactCategoryLabels: Record<string, string> = { WEAPON: "Оружие", ARMOR: "Броня", ACCESSORY: "Аксессуар", RELIC: "Реликвия", CONSUMABLE: "Расходуемый предмет" };

export function CreationObjects({ session: s, character, characters, gm, active, onCraftSettled }: { session: CreationSession;
  character: CreationCharacter | null; characters: CreationCharacter[]; gm: boolean; active: boolean; onCraftSettled?: () => void }) {
  const characterId = character?.id ?? "";
  const objects = useCreationPage<CreationObject>(s, active && characterId ? creationPath("objects", { characterId }) : null);
  const recipes = useCreationQuery<RecipePage>(s, active && characterId ? creationPath("recipes", { characterId }) : null);
  const history = useCreationPage<OperationRow>(s, active && characterId ? creationPath("operations", { characterId }) : null);
  const [recipeId, setRecipeId] = useState(""), [inputs, setInputs] = useState<CreationObject[]>([]);
  const [picks, setPicks] = useState<Array<{ instanceId: string; quantity: number }>>([]);
  const [quote, setQuote] = useState<{ value: CreationOperationQuote; epoch: number } | null>(null);
  const [lineage, setLineage] = useState<string | null>(null), [transfer, setTransfer] = useState<CreationObject | null>(null);
  const [target, setTarget] = useState(""), [reason, setReason] = useState("");
  const generation = useRef(0), recipe = recipes.data?.recipes.find(r => r.version.id === recipeId);
  const clearQuote = () => { generation.current++; setQuote(null); };
  const observedCompletion = useRef(s.completed);
  useEffect(() => {
    const completed = s.completed;
    if (!completed || completed === observedCompletion.current) return;
    observedCompletion.current = completed;
    if (completed.path === "operations/commit" && quote?.value.id === completed.body.quoteId) {
      generation.current++; setQuote(null); setInputs([]); setPicks([]);
      onCraftSettled?.();
    }
    if (completed.path === "objects/transfer" && transfer?.id === completed.body.objectId &&
        target === completed.body.characterId && reason.trim() === completed.body.reason) {
      setTransfer(null); setTarget(""); setReason("");
      generation.current++; setQuote(null); setInputs([]);
    }
  }, [s.completed, quote, transfer, target, reason, onCraftSettled]);
  const liveQuote = quote?.epoch === s.epoch ? quote.value : null, expired = useQuoteExpired(liveQuote?.expiresAt);
  const getQuote = () => s.inspect(async () => {
    if (!recipe || !characterId) return;
    const epoch = generation.current, response = await creationRequest<CreationOperationQuote>(s.context, creationPath("operations/quote"), {
      characterId, recipeVersionId: recipe.version.id, inputObjectIds: inputs.map(o => o.id), materialPicks: picks });
    if (!response || response.characterId !== characterId || response.recipeVersionId !== recipe.version.id ||
        typeof response.id !== "string" || !Number.isFinite(Date.parse(response.expiresAt)))
      throw new Error("Сервер не подтвердил расчёт для выбранного персонажа и рецепта. Получите новую котировку.");
    if (epoch === generation.current) setQuote({ value: response, epoch: s.epoch });
  });
  const commit = async () => {
    if (!liveQuote || Date.parse(liveQuote.expiresAt) <= Date.now()) return;
    const result = await s.submit("operations/commit", { quoteId: liveQuote.id }, `${operationLabels[liveQuote.operation]} · ${character?.name}`);
    if (result) { clearQuote(); setInputs([]); setPicks([]); onCraftSettled?.(); objects.first(); history.first(); }
  };
  const move = async () => {
    if (!transfer) return;
    const result = await s.submit("objects/transfer", { objectId: transfer.id, expectedRevision: transfer.revision,
      characterId: target, reason }, `Передача «${transfer.snapshot.name}»`);
    if (result) { setTransfer(null); setTarget(""); setReason(""); clearQuote(); setInputs([]); }
  };
  return <div className="creation-studio">
    <div><h3>Объекты {character ? `· ${character.name}` : "персонажа"}</h3>
      {!characterId && <p>Сначала выберите доступного персонажа.</p>}<QueryState loading={objects.loading} error={objects.error} />
      {objects.data?.items.length === 0 && <p>Созданных объектов пока нет. Выберите рецепт изготовления.</p>}
      <ul className="creation-record-list">{objects.data?.items.map(o => {
        const selected = inputs.some(i => i.id === o.id), matches = recipe?.source.inputs.some(p => p.versionId === o.versionId && p.level === o.level && p.stage === o.stage);
        return <li key={o.id}><h4>{o.snapshot.name}</h4><small>{stageLabels[o.stage]} · уровень {o.level} · {reviewLabel(o.review?.decision)}</small>
          <p className="creation-prose">{o.snapshot.description}</p><small>Автор: {o.author?.displayName ?? "не указан"}</small>
          {o.artifact && <p>Категория: {artifactCategoryLabels[o.artifact.category] ?? o.artifact.category} · редкость: {o.artifact.rarity}</p>}
          {!!o.requirements?.length && <p>Требования при изготовлении: {o.requirements.map(r => `${r.statKey} ≥ ${r.minimum}`).join(" · ")}</p>}
          {o.metadataAvailable === false && <p>Сведения о требованиях и редкости недоступны для этой версии.</p>}
          {!o.rulesEnabled && <p>Правила выключены. Механика сохранена, новое применение требует допуска.</p>}
          {recipe && <label className="creation-check"><input type="checkbox" checked={selected}
            disabled={s.locked || (!selected && (!matches || inputs.length >= recipe.source.inputs.length))} onChange={e => {
              clearQuote(); setInputs(e.target.checked ? [...inputs, o] : inputs.filter(i => i.id !== o.id)); }} />Расходовать в выбранном рецепте</label>}
          <div className="creation-actions"><button type="button" onClick={() => setLineage(o.id)}>Вся история происхождения</button>
            </div>
        </li>;
      })}</ul><PageControls more={!!objects.data?.nextAfter} previous={objects.hasPrevious} disabled={objects.loading || s.busy}
        onNext={objects.next} onFirst={objects.first} />
      {lineage && <Lineage key={lineage} session={s} id={lineage} onClose={() => setLineage(null)} />}
    </div>
    <div>
      <fieldset disabled={s.locked || !characterId || recipes.loading}><legend>Изготовление</legend>
        <QueryState loading={recipes.loading} error={recipes.error} />
        <label>Рецепт мастера<select value={recipeId} onChange={e => { clearQuote(); setRecipeId(e.target.value); setInputs([]); setPicks([]); }}>
          <option value="">Выберите действие</option>{recipes.data?.recipes.filter(r => r.source.operation === "CRAFT").map(r => <option key={r.version.id} value={r.version.id}>
            {operationLabels[r.source.operation]} — {r.source.name}</option>)}</select></label>
        {recipes.data?.recipes.length === 0 && <p>Нет доступных опубликованных рецептов изготовления.</p>}
        {recipe && <><p>{recipe.source.reason}</p><Cost session={s} value={recipe.source.cost} />
          <p>Расходуется объектов: {recipe.source.inputs.length}. Выбрано: {inputs.length}.</p>
          {!!inputs.length && <ul>{inputs.map(o => <li key={o.id}>{o.snapshot.name} · уровень {o.level} <button type="button" onClick={() => {
            clearQuote(); setInputs(inputs.filter(v => v.id !== o.id)); }}>Не расходовать</button></li>)}</ul>}
          {recipe.source.refund && <p>Разбор вернёт часть фактически оплаченных ресурсов. Точная сумма — в котировке сервера, цена витрины не учитывается.</p>}
          {recipe.source.output && <p>Выход: уровень {recipe.source.output.level} · {stageLabels[recipe.source.output.stage]}.</p>}
          {!!recipe.source.cost.materials.length && <MaterialPicker session={s} characterId={characterId} picks={picks}
            onChange={v => { clearQuote(); setPicks(v); }} disabled={s.locked} />}
          <button type="button" disabled={inputs.length !== recipe.source.inputs.length} onClick={() => void getQuote()}>Получить точный расчёт</button></>}
      </fieldset>
      {liveQuote && <section className="creation-confirm" aria-label="Подтверждение операции"><h3>{operationLabels[liveQuote.operation]} · {character?.name}</h3>
        <p>{liveQuote.recipeName} — результат: {liveQuote.output?.name ?? "Разбор без нового объекта"}</p>
        <Cost session={s} value={liveQuote.spend} title="Будет потрачено" /><Cost session={s} value={liveQuote.returns} title="Будет возвращено" />
        <p>{expired ? "Котировка истекла. Получите новую." : `Действует до ${new Date(liveQuote.expiresAt).toLocaleTimeString("ru-RU")}`}</p>
        {!liveQuote.affordable && <p>Не хватает монет или SP. Возврат не оплачивает операцию заранее.</p>}
        <button type="button" className="creation-primary" disabled={s.locked || expired || !liveQuote.affordable} onClick={() => void commit()}>Подтвердить расход и результат</button>
      </section>}
      {gm && transfer && <fieldset disabled={s.locked}><legend>Передать предмет: {transfer.snapshot.name}</legend>
        <label>Получатель<select value={target} onChange={e => setTarget(e.target.value)}><option value="">Выберите персонажа</option>
          {characters.filter(c => c.id !== characterId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Причина<textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
        <p>Версия, остатки использований и происхождение сохранятся.</p><div className="creation-actions">
          <button type="button" disabled={!target || !reason.trim()} onClick={() => void move()}>Подтвердить передачу</button>
          <button type="button" onClick={() => setTransfer(null)}>Отмена</button></div></fieldset>}
      <details><summary>Операции мастерской и SP {gm ? "кампании" : "моих действий"}</summary>
        <QueryState loading={history.loading} error={history.error} />
        {history.data?.items.length === 0 && <p>Операций с этим персонажем пока нет.</p>}
        <ol className="creation-record-list">{history.data?.items.map(r => <li key={r.id}><strong>{operationLabels[r.receipt.operation]}</strong>
          <small>{new Date(r.createdAt).toLocaleString("ru-RU")}</small>
          <Cost session={s} value={r.receipt.spent} title="Потрачено" /><Cost session={s} value={r.receipt.returned} title="Возвращено" />
          <small>Код действия: {r.receipt.actionId}</small></li>)}</ol>
        <PageControls more={!!history.data?.nextAfter} previous={history.hasPrevious} disabled={history.loading || s.busy}
          onNext={history.next} onFirst={history.first} />
      </details>
    </div>
  </div>;
}
function Lineage({ session: s, id, onClose }: { session: CreationSession; id: string; onClose: () => void }) {
  const query = useCreationPage<CreationAncestor>(s, creationPath(`objects/${id}/lineage`));
  return <section aria-label="Полная линия происхождения"><h3>Происхождение объекта</h3><button type="button" onClick={onClose}>Закрыть историю</button>
    <p>Происхождение показано постранично, если у вас есть доступ ко всем связанным персонажам. При ограничении обратитесь к мастеру.</p>
    <QueryState loading={query.loading} error={query.error} />
    <ol className="creation-record-list">{query.data?.items.map(o => <li key={o.id}>
      <strong>{o.snapshot.name}{o.id === id ? " · выбранный объект" : ""}</strong><small>{stageLabels[o.stage]} · уровень {o.level} · {o.status === "CONSUMED" ? "Расходован" : "Активен"}</small>
      <p>Автор: {o.author?.displayName ?? "не указан"}</p><small>{new Date(o.createdAt).toLocaleString("ru-RU")}</small>
      {!!o.parentObjectIds.length && <details><summary>Создан из {o.parentObjectIds.length} объектов</summary><ul>{o.parentObjectIds.map(p => <li key={p}>
        {query.data?.items.find(n => n.id === p)?.snapshot.name ?? `Предок ${p.slice(0, 8)} на другой странице`}</li>)}</ul></details>}
      <details><summary>Сохранённая карточка</summary><p className="creation-prose">{o.snapshot.description}</p><p>{o.snapshot.appearance}</p></details>
    </li>)}</ol><PageControls more={!!query.data?.nextAfter} previous={query.hasPrevious} disabled={query.loading} onNext={query.next} onFirst={query.first} />
  </section>;
}
