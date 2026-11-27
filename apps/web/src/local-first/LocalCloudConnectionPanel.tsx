import "./local-cloud-history.css";
import {FormInput} from "../ui/GravityFormControls";
import {useEffect,useRef,useState} from "react";
import {localCloudConnectionStatusSchema,localCloudSendResultSchema,localCloudCheckResultSchema,localCloudHistorySchema,localOutboxCoverageSchema,type LocalOutboxCoverage,type CloudTransferProof,type LocalAuthority} from "@arken/contracts";
import {z} from "zod";
import {api} from "../api";
import {Button} from "../design-system/Button";
type Status=z.infer<typeof localCloudConnectionStatusSchema>;
/** Key by complete authority at the caller. Never persist the pasted secret in
 * browser storage, URLs, diagnostics or error messages. */
export function LocalCloudConnectionPanel({authority,membershipId,historical=false,transferProof}:{authority:LocalAuthority;membershipId:string;historical?:boolean;transferProof?:CloudTransferProof}){
 const [status,setStatus]=useState<Status|null>(null),[grant,setGrant]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[delivery,setDelivery]=useState("");
 const [coverage,setCoverage]=useState<LocalOutboxCoverage|null>(null);
 const [history,setHistory]=useState<z.infer<typeof localCloudHistorySchema>|null>(null);
 const putStatus=(value:unknown)=>{const next=localCloudConnectionStatusSchema.parse(value);setStatus(next);setHistory(next.history??null);};
 const sessionLabel=historical?"выбранной сессии":"текущей сессии";
 const alive=useRef(false),generation=useRef(0),controller=useRef<AbortController|null>(null);
 const request=async(action:"status"|"save"|"forget"|"send"|"preflight"|"check"|"history",body:unknown={})=>{
  const own=++generation.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);setError("");setCoverage(null);
  try{const call=(operation:string,payload:unknown)=>api(`/api/local-session/cloud/${operation}`,{method:"POST",headers:{"x-arken-membership-id":membershipId,"x-arken-campaign-id":authority.campaignId},body:JSON.stringify(operation==="preflight"?{}:{...payload as Record<string,unknown>,scope:authority}),signal:abort.signal});
   const response=await call(action,body);
   if(!alive.current||own!==generation.current)return;
   if(action==="history"){setHistory(localCloudHistorySchema.parse(response));}
   else if(action==="preflight"){setCoverage(localOutboxCoverageSchema.parse(response));}
   else if(action==="check"){
    const result=localCloudCheckResultSchema.parse(response);
    setDelivery(result.state==="APPLIED"?`Подтверждено применение событий: ${result.appliedEvents}.`:result.state==="WAITING"?"Пакет сохранён в облаке и ожидает применения к кампании.":"Новых подтверждений применения для этой сессии нет.");
    const refreshed=localCloudConnectionStatusSchema.parse(await call("status",{}));if(alive.current&&own===generation.current)putStatus(refreshed);
   }
   else if(action==="send"){
    const result=localCloudSendResultSchema.parse(response);
    setDelivery(result.state==="EMPTY"?`Новых событий ${sessionLabel} для отправки нет.`:`Облако сохранило событий: ${result.sentEvents}. Игровые изменения ещё не применены.`);
    const refreshed=localCloudConnectionStatusSchema.parse(await call("status",{}));
    if(alive.current&&own===generation.current)putStatus(refreshed);
   }else{putStatus(response);if(action!=="status")setDelivery("");}
  }catch{if(alive.current&&own===generation.current&&!abort.signal.aborted)setError(action==="preflight"?"Не удалось проверить очередь. Повторите проверку через несколько секунд.":action==="check"?"Не удалось получить подтверждение применения. Проверьте подключение и повторите запрос.":action==="history"?"Не удалось прочитать сохранённые подтверждения. Повторите запрос.":"Не удалось обновить подключение. Проверьте ключ и настройки установки.");}
  finally{if(alive.current&&own===generation.current)setBusy(false);}
 };
 useEffect(()=>{alive.current=true;void request("status");return()=>{alive.current=false;generation.current++;controller.current?.abort();};},[]);
 useEffect(()=>{if(status?.state!=="READY"||!status.expiresAt)return;const timer=setTimeout(()=>setStatus(current=>current?.state==="READY"?{...current,state:"RECONNECT_REQUIRED",expiresAt:null}:current),Math.max(0,Date.parse(status.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[status?.state,status?.expiresAt]);
 const save=()=>{const pasted=grant;setGrant("");try{const value:unknown=JSON.parse(pasted);void request("save",{grant:value});}catch{setError("Некорректный ключ подключения.");}};
 return <section aria-label="Подключение к облаку">
  <h3>Подключение к облаку</h3>
  <p>{status?.state==="READY"?"Ключ сохранён средствами защиты Windows.":status?.state==="RECONNECT_REQUIRED"?"Подключение требует нового ключа.":status?.state==="UNAVAILABLE"?"Облако не настроено в этой установке.":status?"Ключ подключения не сохранён.":"Получаем настройки подключения…"}</p>
  {status?.canSend===false&&<p>Ключ предназначен для чтения подтверждений закрытой сессии.</p>}
  {status?.target&&<p>Сервер: {status.target}</p>}
  {status?.expiresAt&&<p>Ключ действует до {new Date(status.expiresAt).toLocaleString("ru-RU")}.</p>}
  <label>Данные локальной сессии для облака<FormInput readOnly value={JSON.stringify({...authority,...(transferProof?{transferProof}:{})})} onFocus={event=>event.target.select()}/></label>
  <p>Скопируйте данные сессии в облачный кабинет той же кампании и получите ключ подключения.</p>
  <label>Ключ подключения облака<FormInput type="password" data-private="true" value={grant} onChange={event=>setGrant(event.target.value)} maxLength={12000} autoComplete="off" spellCheck={false} disabled={busy||status?.state==="UNAVAILABLE"}/></label>
  <div className="local-session-panel__actions"><Button disabled={busy||!grant.trim()||status?.state==="UNAVAILABLE"} onClick={save}>Сохранить ключ облака</Button><Button disabled={busy||!status} onClick={()=>{setGrant("");void request("forget");}}>Удалить ключ облака</Button><Button disabled={busy} onClick={()=>void request("status")}>Обновить подключение</Button></div>
  <Button disabled={busy||status?.state!=="READY"||status.canSend===false} onClick={()=>{setDelivery("");void request("send");}}>{`Отправить пакет ${sessionLabel}`}</Button>
  <Button disabled={busy} onClick={()=>void request("preflight")}>Проверить полноту очереди кампании</Button>
  {coverage&&<div role="status" aria-label="Результат проверки очереди">
   <p>{coverage.status==="COVERED"?`На момент проверки в очереди сохранены все события после импорта. Проверено: ${coverage.checkedEvents}.`:
    coverage.status==="BUSY"?"Кампания сейчас изменяется. Повторите проверку через несколько секунд.":
    coverage.status==="NOT_IMPORTED"?"Для этой кампании нет исходного архива переноса.":
    coverage.status==="BASELINE_UNKNOWN"?"В старой копии не сохранена исходная точка переноса. Нужен исходный архив.":
    coverage.status==="LIMIT_REACHED"?"Проверка достигла ограничения. Полнота очереди пока не подтверждена.":
    coverage.status==="MISSING_EVENTS"?`В очереди отсутствует событие ${coverage.firstProblemSequence??""}. Требуется восстановление очереди.`:
    coverage.status==="EVENT_TOO_LARGE"?`Событие ${coverage.firstProblemSequence??""} превышает размер пакета синхронизации.`:
    `Данные события ${coverage.firstProblemSequence??""} в очереди отличаются от журнала кампании.`}</p>
   {coverage.throughSequence&&<p>Проверено до события {coverage.throughSequence}. Проверка относится ко всей кампании.</p>}
   <p>Это проверка локальной очереди. Готовность передачи права записи определяется отдельно при сверке с облаком.</p>
  </div>}
  <Button disabled={busy||status?.state!=="READY"} onClick={()=>void request("check")}>Проверить применение пакета</Button>
  {status?.appliedThrough&&<p>Подтверждено применение до события {status.appliedThrough} {sessionLabel}.</p>}
  <section className="local-cloud-history" aria-label="Сохранённые подтверждения применения">
   <h4>Сохранённые подтверждения</h4>
   {history?.entries.length?<ul>{history.entries.map(entry=><li key={entry.streamId}><p>Сохранено подтверждение применения до события {entry.appliedThrough}.</p><p>Сервер: {entry.target}</p></li>)}</ul>:<p>Сохранённых подтверждений для этой сессии пока нет.</p>}
   <Button disabled={busy} onClick={()=>void request("history")}>Обновить подтверждения</Button>
   {history?.next&&<Button disabled={busy} onClick={()=>void request("history",{after:history.next!})}>Следующие подтверждения</Button>}
   <p>Это история на данном мастере. Текущее состояние облака проверяется отдельно.</p>
  </section>
  {status?.storedThrough&&<p>Подтверждено облачное хранение до события {status.storedThrough} {sessionLabel}.</p>}
  {delivery&&<p role="status">{delivery}</p>}
  <p>Одна отправка содержит до 32 событий {sessionLabel}. Для следующего пакета нажмите ещё раз. События прошлых сессий сохраняются отдельно.</p>
  <p>Сохранение ключа подключает защищённое хранилище. События остаются в локальной очереди до подтверждённого применения.</p>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
