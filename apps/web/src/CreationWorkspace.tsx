import { useCallback, useEffect, useMemo, useState } from "react";
import { ArkenDialog } from "./ui/ArkenDialog";
import { creationPath, type CreationCharacter, type RulePack } from "./creation-client";
import { useCreationQuery, useCreationSession } from "./use-creation-session";
import { CreationStudio } from "./CreationStudio";
import { CreationObjects } from "./CreationObjects";
import { CreationManager } from "./CreationManager";
import { CreationMaterialNames, QueryState } from "./CreationParts";
import "./CreationWorkspace.css";

/** Parent keys by campaign/member/role, so old scoped responses cannot paint a
 * new account. The durable pending action survives closing this workspace. */
export function CreationWorkspace({ campaignId, membershipId, gm, characters, onClose }: {
  campaignId: string; membershipId: string; gm: boolean; characters: CreationCharacter[]; onClose: () => void;
}) {
  const context = useMemo(() => ({ campaignId, membershipId }), [campaignId, membershipId]), s = useCreationSession(context);
  const [tab, setTab] = useState<"studio" | "objects" | "gm">("studio");
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? ""), [closing, setClosing] = useState(false);
  const [dirtyScopes, setDirtyScopes] = useState({ studio: false, objects: false, rules: false, recipes: false });
  const studioDirty = useCallback((value: boolean) => setDirtyScopes(previous => previous.studio === value ? previous : { ...previous, studio: value }), []);
  const rulesDirty = useCallback((value: boolean) => setDirtyScopes(previous => previous.rules === value ? previous : { ...previous, rules: value }), []);
  const recipesDirty = useCallback((value: boolean) => setDirtyScopes(previous => previous.recipes === value ? previous : { ...previous, recipes: value }), []);
  const dirty = Object.values(dirtyScopes).some(Boolean);
  const character = characters.find(c => c.id === characterId) ?? null;
  const rules = useCreationQuery<{ items: RulePack[] }>(s, creationPath("rules"));
  const close = () => { if (dirty) setClosing(true); else onClose(); };
  useEffect(() => {
    if (!dirty && !s.pending) return;
    const before = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", before); return () => window.removeEventListener("beforeunload", before);
  }, [dirty, s.pending]);
  return <ArkenDialog open title="Мастерская" variant="workspace" footer={false} onClose={close}>
    <div className="creation-workspace" onChangeCapture={event => {
      if (!(event.target instanceof HTMLElement)) return;
      const scope = event.target.closest<HTMLElement>("[data-creation-dirty-scope]")?.dataset.creationDirtyScope;
      if (scope === "objects")
        setDirtyScopes(previous => previous.objects ? previous : { ...previous, objects: true });
    }}>
      <header className="creation-workspace-header"><div><h2>Навыки и артефакты</h2><p>Чертёж → допуск мастера → игровой объект</p></div>
        <button type="button" disabled={s.busy} onClick={s.refresh}>Обновить данные</button></header>
      {closing && <section className="creation-confirm" aria-label="Закрытие форм"><h3>Закрыть мастерскую?</h3>
        <p>Несохранённые формы будут потеряны. Сохранённые версии и код ожидающего действия останутся.</p>
        <div className="creation-actions"><button type="button" onClick={() => setClosing(false)}>Продолжить редактирование</button><button type="button" onClick={onClose}>Закрыть формы</button></div></section>}
      {s.error && <p className="creation-message" role="alert">{s.error}</p>}
      {s.notice && <p className="creation-message" role="status">{s.notice}</p>}
      {s.pending && <section className="creation-confirm" aria-label="Восстановление действия"><h3>Результат ещё не подтверждён</h3>
        <p>{s.pending.label}. Новое изменение заблокировано до восстановления.</p><code>{s.pending.actionId}</code>
        {s.pending.cancellationRequested && <p>Запрошена отмена. При восстановлении повторяется только запрос отмены, не исходное действие. Уже выполненное действие не откатывается.</p>}
        <button type="button" disabled={s.busy} onClick={() => void s.recover()}>
          {s.pending.cancellationRequested ? "Восстановить результат отмены" : "Проверить / повторить то же действие"}</button>
        <button type="button" disabled={s.busy || !!s.pending.cancellationRequested} onClick={() => {
          if (window.confirm("Отменить действие, только если оно ещё не выполнено? Если оно уже сохранено, будет показан прежний результат: потраченные ресурсы не возвращаются этой кнопкой."))
            void s.cancelPending();
        }}>Отменить невыполненное действие</button></section>}
      <div className="creation-context" data-creation-character-selector><label>Персонаж для предметов и материалов<select value={characterId} disabled={s.locked} onChange={e => {
        if (e.target.value !== characterId && dirtyScopes.objects && !window.confirm("Смена персонажа закроет формы объектов. Несохранённые изменения в них будут потеряны. Продолжить?")) return;
        setCharacterId(e.target.value);
        setDirtyScopes(previous => ({ ...previous, objects: false }));
      }}>
        <option value="">Без выбранного персонажа</option>{characterId && !character && <option value={characterId} disabled>Персонаж больше недоступен</option>}
        {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <p>Авторство и личные чертежи принадлежат участнику кампании, а кошелёк и материалы — выбранному персонажу.</p></div>
      <nav className="creation-tabs" aria-label="Разделы мастерской">
        {([["studio", "Чертежи и конструктор"], ["objects", "Объекты и изготовление"]] as const).map(([id, name]) =>
          <button type="button" key={id} aria-pressed={tab === id} disabled={s.busy} onClick={() => setTab(id)}>{name}</button>)}
        {gm && <button type="button" aria-pressed={tab === "gm"} disabled={s.busy} onClick={() => setTab("gm")}>Настройки мастера</button>}
      </nav>
      <QueryState loading={rules.loading} error={rules.error} />
      <CreationMaterialNames session={s}>
        <div hidden={tab !== "studio"}><CreationStudio session={s} packs={rules.data?.items ?? []} gm={gm} characterId={characterId} active={tab === "studio"} onDirtyChange={studioDirty} /></div>
        <div hidden={tab !== "objects"} data-creation-dirty-scope="objects"><CreationObjects key={characterId} session={s} character={character} characters={characters} gm={gm} active={tab === "objects"}
          onCraftSettled={() => setDirtyScopes(previous => ({ ...previous, objects: false }))} /></div>
        {gm && <div hidden={tab !== "gm"}><CreationManager session={s} packs={rules.data?.items ?? []} active={tab === "gm"} onRulesDirtyChange={rulesDirty} onRecipesDirtyChange={recipesDirty} /></div>}
      </CreationMaterialNames>
    </div>
  </ArkenDialog>;
}
