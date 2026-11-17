import { useEffect, useRef, useState } from "react";
import type { CreationListingSource, CreationStoreQuote } from "@arken/contracts";
import { creationPath, creationRequest, type CreationCharacter, type IncomeRow, type Listing, type PolicyView,
  type PurchaseRow, type RecipePage, type Template } from "./creation-client";
import { useCreationPage, useCreationQuery, type CreationSession } from "./use-creation-session";
import { Cost, MaterialPicker, PageControls, QueryState, useQuoteExpired } from "./CreationParts";

export function CreationStore({ session: s, character, characters, gm, active, onDirtyChange }: { session: CreationSession; character: CreationCharacter | null;
  characters: CreationCharacter[]; gm: boolean; active: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [tab, setTab] = useState<"browse" | "author" | "history">("browse");
  const policy = useCreationQuery<PolicyView>(s, active ? creationPath("store/policy") : null);
  const listings = useCreationPage<Listing>(s, active && tab === "browse" ? creationPath("store/listings") : null);
  const mine = useCreationPage<Listing>(s, active && tab === "author" ? creationPath("store/mine") : null);
  const purchases = useCreationPage<PurchaseRow>(s, active && tab === "history" ? creationPath("store/purchases") : null);
  const income = useCreationPage<IncomeRow>(s, active && tab === "history" ? creationPath("store/income") : null);
  const [selected, setSelected] = useState<Listing | null>(null), [edit, setEdit] = useState<Listing | null>(null), [creating, setCreating] = useState(false);
  const [listingDirty, setListingDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(listingDirty); }, [listingDirty, onDirtyChange]);
  const mayLeaveListing = () => !listingDirty || window.confirm("Несохранённые условия лота будут потеряны. Продолжить?");
  const [picks, setPicks] = useState<Array<{ instanceId: string; quantity: number }>>([]), [reason, setReason] = useState("");
  const [quote, setQuote] = useState<{ value: CreationStoreQuote; epoch: number } | null>(null);
  const generation = useRef(0), live = quote?.epoch === s.epoch ? quote.value : null, expired = useQuoteExpired(live?.expiresAt);
  const invalidate = () => { generation.current++; setQuote(null); };
  const observedCompletion = useRef(s.completed);
  useEffect(() => {
    const completed = s.completed;
    if (!completed || completed === observedCompletion.current) return;
    observedCompletion.current = completed;
    if (completed.path === "store/commit" && quote?.value.id === completed.body.quoteId) {
      generation.current++; setQuote(null); setPicks([]); setSelected(null);
    }
    if (completed.path === "store/listings/enabled" && edit && edit.id === completed.body.listingId &&
        edit.revision === completed.body.expectedRevision && reason.trim() === completed.body.reason) {
      setReason(""); setEdit(null);
    }
  }, [s.completed, quote, edit, reason]);
  const getQuote = () => s.inspect(async () => {
    if (!selected || !character) return;
    const epoch = generation.current, result = await creationRequest<CreationStoreQuote>(s.context, creationPath("store/quote"), {
      listingVersionId: selected.listingVersionId, characterId: character.id, materialPicks: picks });
    if (!result || result.characterId !== character.id || result.listingVersionId !== selected.listingVersionId ||
        typeof result.id !== "string" || !Number.isFinite(Date.parse(result.expiresAt)))
      throw new Error("Сервер не подтвердил расчёт для выбранного персонажа и лота. Получите новую котировку.");
    if (epoch === generation.current) setQuote({ value: result, epoch: s.epoch });
  });
  const buy = async () => {
    if (!live || Date.parse(live.expiresAt) <= Date.now()) return;
    const result = await s.submit("store/commit", { quoteId: live.id }, `Покупка «${live.name}» · ${character?.name}`);
    if (result) { invalidate(); setPicks([]); setSelected(null); purchases.first(); }
  };
  const toggle = async (l: Listing) => {
    const result = await s.submit("store/listings/enabled", { listingId: l.id, expectedRevision: l.revision,
      enabled: !l.enabled, reason }, `${l.enabled ? "Выключение" : "Включение"} лота`, "PUT");
    if (result) { setReason(""); setEdit(null); }
  };
  return <div><div className="creation-tabs" aria-label="Разделы витрины">
    {([["browse", "Витрина"], ["author", gm ? "Лоты кампании" : "Мои лоты"], ["history", "Покупки и доходы"]] as const).map(([key, label]) =>
      <button type="button" key={key} aria-pressed={tab === key} disabled={s.locked} onClick={() => {
        if (tab === key || mayLeaveListing()) { if (tab !== key) { setCreating(false); setEdit(null); setListingDirty(false); } setTab(key); }
      }}>{label}</button>)}
  </div><QueryState loading={policy.loading} error={policy.error} />
    {!policy.loading && !policy.data?.policy?.enabled && <p>Витрина выключена или ещё не настроена мастером. История покупок и приобретённые версии сохраняются.</p>}
    {tab === "browse" && <div className="creation-studio"><div>
      <QueryState loading={listings.loading} error={listings.error} />
      {listings.data?.items.length === 0 && <p>Доступных лотов пока нет. Публиковать можно только одобренные версии с открытыми материалами.</p>}
      <ul className="creation-record-list">{listings.data?.items.map(l => <li key={l.id}>
        <h3>{l.card?.name ?? "Лот"}</h3><small>{l.terms.mode === "COPY" ? "Копия с изготовлением" : "Лицензия на чертёж"} · {l.author.displayName} · допуск GM</small>
        <p>{l.terms.priceCopper.toLocaleString("ru-RU")} медных{l.card?.artifact ? ` · ${l.card.artifact.rarity}` : ""}</p>
        <p className="creation-prose">{l.card?.description}</p>
        {l.terms.collection && <p>Подборка: {l.terms.collection}</p>}{l.terms.note && <p>{l.terms.note}</p>}
        {l.terms.maxPurchases !== null && <p>Покупок: {l.soldCount} из {l.terms.maxPurchases} для этого лота.</p>}
        {l.terms.availableUntil && <p>До {new Date(l.terms.availableUntil).toLocaleString("ru-RU")}</p>}
        <details><summary>Свойства и требования</summary><p>{l.card?.appearance}</p><ul>{l.card?.requirements.map(r => <li key={r.statKey}>{r.statKey}: не менее {r.minimum}</li>)}</ul>
          <ul>{l.card?.components.map((c, i) => <li key={i}>{c}</li>)}</ul><ul>{l.card?.manualEffects.map((e, i) => <li key={i}>Вручную: {e}</li>)}</ul></details>
        {l.fabrication && <Cost session={s} value={l.fabrication} title="Дополнительно на изготовление" />}
        <button type="button" disabled={s.locked || !character} onClick={() => { invalidate(); setSelected(l); setPicks([]); }}>Выбрать предложение</button>
        <ListingHistory session={s} id={l.id} />
      </li>)}</ul><PageControls more={!!listings.data?.nextAfter} previous={listings.hasPrevious} disabled={listings.loading || s.busy}
        onNext={listings.next} onFirst={listings.first} />
    </div><div>
      {!character && <p>Выберите персонажа, с кошелька которого будет оплачена покупка.</p>}
      {selected && character && <fieldset disabled={s.locked}><legend>{selected.card?.name} для {character.name}</legend>
        <p>{selected.terms.mode === "TEMPLATE" ? "Лицензию получит владелец персонажа, не контролёр. Она не включает будущие версии и бесплатное изготовление."
          : "Один новый объект. Цена автора и расход на изготовление оплачиваются вместе. Право новых копий не приобретается."}</p>
        {selected.fabrication && <Cost session={s} value={selected.fabrication} title="Изготовление" />}
        {!!selected.fabrication?.materials.length && <MaterialPicker session={s} characterId={character.id} picks={picks}
          onChange={v => { invalidate(); setPicks(v); }} disabled={s.locked} />}
        <button type="button" onClick={() => void getQuote()}>Рассчитать покупку на сервере</button>
        <button type="button" onClick={() => { invalidate(); setSelected(null); setPicks([]); }}>Отменить выбор</button>
      </fieldset>}
      {live && <section className="creation-confirm" aria-label="Подтверждение покупки"><h3>{live.name} · {character?.name}</h3>
        <p>{live.mode === "TEMPLATE" ? "Лицензия владельцу персонажа" : "Одна изготовленная копия"}</p>
        <Cost session={s} value={live.total} title="Полный расход" />
        <dl><dt>Цена автора</dt><dd>{live.priceCopper} медных</dd><dt>Получит автор</dt><dd>{live.authorIncomeCopper} медных</dd><dt>Комиссия / системный sink</dt><dd>{live.sinkCopper} медных</dd></dl>
        <p>{expired ? "Котировка истекла." : `Подтвердите до ${new Date(live.expiresAt).toLocaleTimeString("ru-RU")}.`}</p>
        {!live.affordable && <p>Недостаточно средств. После изменения кошелька получите новую котировку.</p>}
        <button type="button" className="creation-primary" disabled={s.locked || expired || !live.affordable} onClick={() => void buy()}>Оплатить и получить</button>
      </section>}
    </div></div>}
    {tab === "author" && <div>
      <button type="button" disabled={s.locked} onClick={() => { if (mayLeaveListing()) { setListingDirty(false); setCreating(true); setEdit(null); } }}>Выставить свою одобренную версию</button>
      <QueryState loading={mine.loading} error={mine.error} />
      <ul className="creation-record-list">{mine.data?.items.map(l => <li key={l.id}><strong>{l.card?.name ?? "Лот недоступной версии"}</strong>
        <small>{l.enabled ? "Включён" : "Выключен"} · продано {l.soldCount}{l.blockedByGm ? " · скрыт мастером" : ""}</small>
        {l.blocked && <p>Требуется обновить доступ или условия: {l.blocked}</p>}
        <button type="button" disabled={s.locked} onClick={() => { if (mayLeaveListing()) { setListingDirty(false); setCreating(false); setEdit(l); setReason(""); } }}>Управлять лотом</button></li>)}</ul>
      <PageControls more={!!mine.data?.nextAfter} previous={mine.hasPrevious} disabled={mine.loading || s.busy} onNext={mine.next} onFirst={mine.first} />
      {(creating || edit) && <ListingEditor key={edit?.listingVersionId ?? "new"} session={s} listing={edit} characters={characters} gm={gm}
        onDirtyChange={setListingDirty} onSaved={() => { setListingDirty(false); setCreating(false); setEdit(null); mine.first(); }} />}
      {edit && <fieldset disabled={s.locked}><legend>{gm ? "Доступ / модерация" : "Доступ к лоту"}</legend>
        <label>Причина<textarea maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button type="button" disabled={!reason.trim() || (!gm && !!edit.blockedByGm && !edit.enabled)} onClick={() => void toggle(edit)}>{edit.enabled ? "Выключить лот" : "Включить лот"}</button>
      </fieldset>}
    </div>}
    {tab === "history" && <div className="creation-studio"><section><h3>Покупки {gm ? "кампании" : "моих действий и лицензий"}</h3>
      <QueryState loading={purchases.loading} error={purchases.error} />
      <ul className="creation-record-list">{purchases.data?.items.map(p => <li key={p.id}><strong>{p.receipt.name}</strong>
        <small>{p.receipt.mode === "COPY" ? "Копия" : "Лицензия"} · {new Date(p.createdAt).toLocaleString("ru-RU")}</small>
        <Cost session={s} value={p.receipt.total} title="Оплачено" /><small>Код: {p.receipt.actionId}</small></li>)}</ul>
      <PageControls more={!!purchases.data?.nextAfter} previous={purchases.hasPrevious} disabled={purchases.loading} onNext={purchases.next} onFirst={purchases.first} />
    </section><section><h3>Доходы {gm ? "кампании" : "автора"}</h3><QueryState loading={income.loading} error={income.error} />
      <ul className="creation-record-list">{income.data?.items.map(i => <li key={i.id}><strong>Автору {i.authorIncomeCopper} медных</strong>
        <p>Цена {i.priceCopper} · комиссия / sink {i.sinkCopper}</p><small>{new Date(i.createdAt).toLocaleString("ru-RU")}</small></li>)}</ul>
      <PageControls more={!!income.data?.nextAfter} previous={income.hasPrevious} disabled={income.loading} onNext={income.next} onFirst={income.first} />
    </section></div>}
  </div>;
}
function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function ListingEditor({ session: s, listing, characters, gm, onSaved, onDirtyChange }: { session: CreationSession; listing: Listing | null;
  characters: CreationCharacter[]; gm: boolean; onSaved: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const templates = useCreationPage<Template>(s, creationPath("templates")), recipes = useCreationQuery<RecipePage>(s, creationPath("recipes"));
  const [versionId, setVersionId] = useState(listing?.source?.versionId ?? ""), [mode, setMode] = useState<"COPY" | "TEMPLATE">(listing?.source?.mode ?? "TEMPLATE");
  const [recipeId, setRecipeId] = useState(listing?.source?.recipeVersionId ?? ""), [price, setPrice] = useState(listing ? String(listing.terms.priceCopper) : "");
  const [payee, setPayee] = useState(listing?.source?.payoutCharacterId ?? ""), [sink, setSink] = useState(listing?.source?.payout === "SINK");
  const [collection, setCollection] = useState(listing?.terms.collection ?? ""), [note, setNote] = useState(listing?.terms.note ?? "");
  const [limit, setLimit] = useState(listing?.terms.maxPurchases == null ? "" : String(listing.terms.maxPurchases));
  const [until, setUntil] = useState(() => localDateTime(listing?.terms.availableUntil));
  const signature = JSON.stringify([versionId, mode, recipeId, price, payee, sink, collection, note, limit, until]);
  const baseline = useRef(signature);
  useEffect(() => { onDirtyChange(signature !== baseline.current); }, [signature, onDirtyChange]);
  const untilDate = until ? new Date(until) : null;
  const validUntil = !untilDate || Number.isFinite(untilDate.getTime()) && localDateTime(untilDate.toISOString()) === until;
  const canEdit = !listing || listing.author.membershipId === s.context.membershipId;
  const pendingListing = useRef<string | null>(null);
  const observedCompletion = useRef(s.completed);
  useEffect(() => {
    const completed = s.completed;
    if (!completed || completed === observedCompletion.current) return;
    observedCompletion.current = completed;
    if (completed.path === "store/listings" && pendingListing.current && completed.body.listingId === pendingListing.current) {
      pendingListing.current = null; onSaved();
    }
  }, [s.completed, onSaved]);
  const own = templates.data?.items.filter(t => t.authorMembershipId === s.context.membershipId && t.review?.decision === "APPROVED") ?? [];
  const save = async () => {
    if (!validUntil) return;
    const source: CreationListingSource = { format: 1, versionId, mode, recipeVersionId: mode === "COPY" ? recipeId : null,
      priceCopper: Number(price), payout: sink ? "SINK" : "AUTHOR", payoutCharacterId: sink ? null : payee,
      collection, note, maxPurchases: limit === "" ? null : Number(limit), availableUntil: untilDate?.toISOString() ?? null };
    const listingId = listing?.id ?? crypto.randomUUID();
    pendingListing.current = listingId;
    if (await s.submit("store/listings", { listingId, expectedRevision: listing?.revision ?? null, source }, "Публикация условий лота")) {
      pendingListing.current = null; onSaved();
    }
  };
  return <fieldset disabled={s.locked || !canEdit || !!listing?.blockedByGm && !gm}><legend>{listing ? "Новая версия условий лота" : "Авторский лот"}</legend>
    {!canEdit && <p>GM может скрыть чужой лот, но не менять цену или получателя от имени автора.</p>}
    <QueryState loading={templates.loading || recipes.loading} error={templates.error || recipes.error} />
    <label>Одобренная версия<select value={versionId} disabled={!!listing} onChange={e => { setVersionId(e.target.value); setRecipeId(""); }}>
      <option value="">Выберите свой шаблон</option>{listing && <option value={listing.terms.versionId}>{listing.card?.name ?? "Исходная версия лота"}</option>}
      {!listing && own.map(t => <option key={t.id} value={t.latestVersion.id}>{t.latestVersion.design.name} · версия {t.latestVersion.number}</option>)}</select></label>
    {!listing && <PageControls more={!!templates.data?.nextAfter} previous={templates.hasPrevious} disabled={templates.loading} onNext={templates.next} onFirst={templates.first} />}
    <label>Что продаётся<select value={mode} disabled={!!listing} onChange={e => setMode(e.target.value as typeof mode)}>
      <option value="TEMPLATE">Лицензия на точную версию</option><option value="COPY">Одна копия с изготовлением</option></select></label>
    {mode === "COPY" && <label>Рецепт изготовления<select value={recipeId} onChange={e => setRecipeId(e.target.value)}><option value="">Выберите рецепт</option>
      {recipes.data?.recipes.filter(r => r.source.operation === "CRAFT" && r.source.output?.versionId === versionId).map(r => <option key={r.version.id} value={r.version.id}>{r.source.name}</option>)}</select></label>}
    <label>Цена продажи, медные<input type="number" min={0} max={1e12} step={1} value={price} onChange={e => setPrice(e.target.value)} /></label>
    {gm && <label className="creation-check"><input type="checkbox" checked={sink} onChange={e => setSink(e.target.checked)} />Системный лот: вся цена в sink</label>}
    {!sink && <label>Персонаж автора для дохода<select value={payee} onChange={e => setPayee(e.target.value)}><option value="">Выберите своего персонажа</option>
      {characters.filter(c => c.ownerMembershipId === s.context.membershipId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <div className="creation-fields"><label>Подборка<input value={collection} maxLength={100} onChange={e => setCollection(e.target.value)} /></label>
      <label>Предел покупок этого лота (пусто — без заданного лимита)<input type="number" min={1} max={1e6} value={limit} onChange={e => setLimit(e.target.value)} /></label>
      <label>Доступен до (пусто — без срока)<input type="datetime-local" step={1} value={until} onChange={e => {
        const raw = e.target.value; setUntil(raw.length === 16 ? `${raw}:00` : raw);
      }} /><small>Часовой пояс этого устройства: {Intl.DateTimeFormat().resolvedOptions().timeZone}.
        {validUntil && untilDate ? ` Время отправки: ${untilDate.toISOString()}` : ""}</small></label>
      {!validUntil && <p role="alert">Укажите существующие дату и время в часовом поясе устройства.</p>}</div>
    <label>Публичное примечание<textarea value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /></label>
    <button type="button" className="creation-primary" disabled={!validUntil || !versionId || price === "" || (!sink && !payee) || (mode === "COPY" && !recipeId)} onClick={() => void save()}>Сохранить и выставить</button>
    <p>Прошлые покупки и счётчик продаж не переписываются. Новой версии самого произведения нужен отдельный лот.</p>
  </fieldset>;
}
function ListingHistory({ session: s, id }: { session: CreationSession; id: string }) {
  const [open, setOpen] = useState(false), [before, setBefore] = useState<string>();
  const query = useCreationQuery<{ items: Array<{ id: string; number: number; createdAt: string; terms: Listing["terms"] }>; nextBefore: number | null }>(s,
    open ? creationPath(`store/listings/${id}/versions`, { before }) : null);
  return <details onToggle={e => setOpen(e.currentTarget.open)}><summary>История условий лота</summary><QueryState loading={query.loading} error={query.error} />
    <ol>{query.data?.items.map(v => <li key={v.id}>Условия {v.number}: {v.terms.priceCopper} медных · {new Date(v.createdAt).toLocaleString("ru-RU")}</li>)}</ol>
    {before && <button type="button" onClick={() => setBefore(undefined)}>Последние условия</button>}
    {query.data?.nextBefore != null && <button type="button" onClick={() => setBefore(String(query.data!.nextBefore))}>Ранее</button>}
  </details>;
}
