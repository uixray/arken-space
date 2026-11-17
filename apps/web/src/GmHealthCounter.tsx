import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Button } from "./design-system/Button";

type Note = { text: string; revision: number };
type Health = { current: number; maximum: number };
const marker = /<!-- arken-gm-health:(.*?) -->/;
function readHealth(text: string): Health | null {
  try { const match = marker.exec(text); if (!match?.[1]) return null;
    const h = JSON.parse(match[1]);
    return Number.isFinite(h.current) && Number.isFinite(h.maximum) ? h : null;
  } catch { return null; }
}
/** Private to the GM author: never stored in shared character resources/events. */
export function GmHealthCounter({ characterId }: { characterId: string }) {
 const [note,setNote]=useState<Note|null>(null);
 const [health,setHealth]=useState<Health|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const [draft,setDraft]=useState("");
 const dirty=useRef(false),flight=useRef(false),alive=useRef(true);
 const url=`/api/characters/${characterId}/private-notebook`;
 const load=async()=>{try {const n=await api<Note>(url);if(!alive.current||dirty.current||flight.current)return;setNote(n);const h=readHealth(n.text);setHealth(h);setDraft(h?String(h.current):"");setError("");}catch {if(alive.current)setError("Не удалось загрузить здоровье");}};
 useEffect(()=>{alive.current=true;void load();const refresh=()=>{if(!dirty.current&&!flight.current)void load();};window.addEventListener("arken-gm-health-changed",refresh);window.addEventListener("focus",refresh);return()=>{alive.current=false;window.removeEventListener("arken-gm-health-changed",refresh);window.removeEventListener("focus",refresh);};},[characterId]);
 const save=async(next:Health)=>{if(!note||flight.current||!Number.isFinite(next.current)||!Number.isFinite(next.maximum))return;
  flight.current=true;setBusy(true);setError("");
  const line=`<!-- arken-gm-health:${JSON.stringify(next)} -->`;
  const text=marker.test(note.text)?note.text.replace(marker,line):`${note.text}\n${line}`;
  try {const n=await api<Note>(url,{method:"PUT",body:JSON.stringify({actionId:crypto.randomUUID(),revision:note.revision,text})});if(alive.current){dirty.current=false;setNote(n);setHealth(next);setDraft(String(next.current));}window.dispatchEvent(new Event("arken-gm-health-changed"));}
  catch {if(alive.current)setError("Не сохранено. Перечитайте данные перед повторной правкой.");}
  finally {flight.current=false;if(alive.current)setBusy(false);}
 };
 return <div className="gm-health-counter">
  <label>Здоровье · мастер <input aria-label="Здоровье · мастер" type="number" min="0" value={draft} disabled={!note||busy} onChange={e=>{dirty.current=true;setDraft(e.target.value);}} onBlur={()=>{if(dirty.current&&draft!=="")void save({current:Math.max(0,Number(draft)),maximum:health?.maximum??Math.max(0,Number(draft))});}} /></label>
  <span>/ {health?.maximum??"—"}</span>
  <Button disabled={!health||busy||dirty.current} aria-label="Уменьшить здоровье" onClick={()=>health&&void save({...health,current:Math.max(0,health.current-1)})}>−</Button>
  <Button disabled={!health||busy||dirty.current} aria-label="Увеличить здоровье" onClick={()=>health&&void save({...health,current:health.current+1})}>+</Button>
  <details><summary aria-label="Максимум здоровья">…</summary><label>Максимум <input type="number" aria-label="Максимум здоровья" min="0" key={health?.maximum} defaultValue={health?.maximum??""} disabled={!note||busy} onBlur={e=>{if(e.target.value!=="")void save({current:health?.current??Number(e.target.value),maximum:Math.max(0,Number(e.target.value))});}} /></label></details>
  {error&&<div role="alert">{error} <Button onClick={()=>{dirty.current=false;void load();}}>Перечитать</Button></div>}
 </div>;
}

