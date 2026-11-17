import { useEffect, useState } from "react";
import type { CreationKind } from "@arken/contracts";
import { creationPath, type PolicyView } from "./creation-client";
import { useCreationQuery, type CreationSession } from "./use-creation-session";
import { QueryState } from "./CreationParts";
export function CreationPolicy({ session: s, active, onDirtyChange }: { session: CreationSession; active: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const query = useCreationQuery<PolicyView>(s, active ? creationPath("store/policy") : null);
  const [editing, setEditing] = useState(false), [revision, setRevision] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false), [players, setPlayers] = useState(false);
  const [kinds, setKinds] = useState<CreationKind[]>(["SKILL", "ARTIFACT"]);
  const [min, setMin] = useState(""), [max, setMax] = useState(""), [fee, setFee] = useState(""), [reason, setReason] = useState("");
  useEffect(() => { onDirtyChange?.(editing); }, [editing, onDirtyChange]);
  const open = () => { const p = query.data?.policy; setRevision(query.data?.revision ?? null); setEnabled(p?.enabled ?? false);
    setPlayers(p?.allowPlayerListings ?? false); setKinds(p?.allowedKinds ?? ["SKILL", "ARTIFACT"]);
    setMin(p ? String(p.minimumPriceCopper) : ""); setMax(p ? String(p.maximumPriceCopper) : ""); setFee(p ? String(p.commissionBasisPoints) : ""); setReason(""); setEditing(true); };
  const save = async () => {
    if (min === "" || max === "" || fee === "") return;
    const result = await s.submit("store/policy", { expectedRevision: revision, reason, policy: { format: 1, enabled,
      allowPlayerListings: players, allowedKinds: kinds, minimumPriceCopper: Number(min), maximumPriceCopper: Number(max),
      commissionBasisPoints: Number(fee) } }, "Настройки витрины", "PUT");
    if (result) setEditing(false);
  };
  return <section><h3>Витрина одной кампании</h3><QueryState loading={query.loading} error={query.error} />
    <p>{query.data?.policy?.enabled ? "Витрина включена." : "Витрина выключена."} Цифры задаются явно; предложенный стартовый баланс сюда не подставляется.</p>
    <button type="button" disabled={s.locked || query.loading || !!query.error} onClick={open}>Редактировать правила витрины</button>
    {editing && <fieldset disabled={s.locked}><legend>Новые условия</legend>
      <label className="creation-check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Включить витрину</label>
      <label className="creation-check"><input type="checkbox" checked={players} onChange={e => setPlayers(e.target.checked)} />Разрешить авторские лоты игроков</label>
      {(["SKILL", "ARTIFACT"] as const).map(kind => <label key={kind} className="creation-check"><input type="checkbox" checked={kinds.includes(kind)}
        onChange={e => setKinds(e.target.checked ? [...kinds, kind] : kinds.filter(k => k !== kind))} />{kind === "SKILL" ? "Навыки" : "Артефакты"}</label>)}
      <div className="creation-fields"><label>Минимальная цена, медные<input type="number" min={0} max={1e12} value={min} onChange={e => setMin(e.target.value)} /></label>
        <label>Максимальная цена, медные<input type="number" min={0} max={1e12} value={max} onChange={e => setMax(e.target.value)} /></label>
        <label>Комиссия, базисные пункты (100 = 1%)<input type="number" min={0} max={10000} step={1} value={fee} onChange={e => setFee(e.target.value)} /></label></div>
      <p>Комиссия округляется вверх до целой медной монеты. Ручное изменение обычных монет игроком сохраняется.</p>
      <label>Причина<textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
      <div className="creation-actions"><button type="button" disabled={min === "" || max === "" || fee === "" || !reason.trim()} onClick={() => void save()}>Сохранить условия</button>
        <button type="button" onClick={() => setEditing(false)}>Отмена</button></div></fieldset>}
  </section>;
}
