import "./cloud-source-connection.css";
import {useEffect,useRef,useState} from "react";
import {z} from "zod";
import {cloudSourceDescriptorSchema,localCloudGrantSchema,cloudSyncSourceStatusSchema,cloudSyncStatusCursorSchema} from "@arken/contracts";
import {api} from "../api";
import {Button} from "../design-system/Button";
import {FormTextArea} from "../ui/GravityFormControls";

const registered=z.object({originId:z.string().uuid(),mode:z.literal("INBOX_ONLY")}).strict();
/** Mounted only while the disclosure is open; private results never leave memory. */
function Connection({campaignId,csrfToken}:{campaignId:string;csrfToken:string}){
 const [descriptor,setDescriptor]=useState(""),[secret,setSecret]=useState(""),[originId,setOriginId]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [sourceStatus,setSourceStatus]=useState<z.infer<typeof cloudSyncSourceStatusSchema>|null>(null);
 const generation=useRef(0),abort=useRef<AbortController|null>(null),expiry=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{generation.current++;abort.current?.abort();if(expiry.current)clearTimeout(expiry.current);},[]);
 const run=async(action:"issue"|"revoke"|"status"|"recover",after?:z.infer<typeof cloudSyncStatusCursorSchema>)=>{
  const own=++generation.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setSecret("");setMessage("");setSourceStatus(null);if(expiry.current)clearTimeout(expiry.current);
  const post=(path:string,body:unknown)=>api(path,{method:"POST",headers:{"x-csrf-token":csrfToken},body:JSON.stringify(body),signal:controller.signal});
  try{
   if(action==="revoke"){
    if(!originId)throw Error("SOURCE_REQUIRED");
    await post(`/api/account/cloud-sync/sources/${originId}/grant/revoke`,{campaignId});
    if(own===generation.current)setMessage("Ключ этой локальной сессии отозван.");
   }else if(action==="status"){
    if(!originId)throw Error("SOURCE_REQUIRED");
    const result=cloudSyncSourceStatusSchema.parse(await post(`/api/account/cloud-sync/sources/${originId}/status`,{campaignId,...(after?{after}:{})}));
    if(result.originId!==originId)throw Error("SOURCE_MISMATCH");
    if(own===generation.current)setSourceStatus(result);
   }else{
    const connectionDescriptor=cloudSourceDescriptorSchema.parse(JSON.parse(descriptor)),{transferProof,...origin}=connectionDescriptor;if(origin.campaignId!==campaignId)throw Error("CAMPAIGN_MISMATCH");
    const source=action==="recover"?null:registered.parse(await post("/api/account/cloud-sync/connect",{campaignId,origin:connectionDescriptor}));if(own!==generation.current)return;if(source)setOriginId(source.originId);
    const grant=localCloudGrantSchema.parse(await post(action==="recover"?"/api/account/cloud-sync/receipt-read-grant":`/api/account/cloud-sync/sources/${source!.originId}/grant`,action==="recover"?{campaignId,origin:connectionDescriptor}:{campaignId}));
    if(grant.scope!==(action==="recover"?"READ_RECEIPTS_ONLY":"STAGING_ONLY"))throw Error("GRANT_CAPABILITY_MISMATCH");
    if(own!==generation.current)return;
    if(Object.keys(origin).some(key=>origin[key as keyof typeof origin]!==grant.origin[key as keyof typeof origin]))throw Error("SOURCE_MISMATCH");
    const remaining=Date.parse(grant.expiresAt)-Date.now();if(remaining<=0||remaining>13*3600000)throw Error("INVALID_EXPIRY");
    setOriginId(grant.originId);setSecret(JSON.stringify(grant));setMessage(action==="recover"?"Ключ читает подтверждения закрытой сессии. Скопируйте его в локальную установку.":(transferProof?"Архив переноса распознан. ":"")+"Скопируйте ключ в локальную установку. Предыдущий ключ этой сессии заменён.");
    expiry.current=setTimeout(()=>{if(own===generation.current){setSecret("");setMessage("Срок действия ключа истёк. Получите новый ключ.");}},remaining);
   }
  }catch{if(own===generation.current&&!controller.signal.aborted)setMessage("Не удалось выполнить действие. Проверьте данные сессии и права мастера.");}
  finally{if(own===generation.current)setBusy(false);}
 };
 return <section className="cloud-source-connection" aria-label="Ключ автономной сессии">
  <p>Вставьте данные локальной сессии из окна автономного режима той же кампании. Для открытой сессии получите ключ отправки, для закрытой — ключ чтения подтверждений.</p>
  <label>Данные локальной сессии<FormTextArea aria-label="Данные локальной сессии" value={descriptor} maxLength={2048} disabled={busy} onChange={event=>{setDescriptor(event.target.value);setSecret("");setOriginId(null);setSourceStatus(null);setMessage("");}}/></label>
  <Button disabled={busy||!descriptor.trim()} onClick={()=>void run("issue")}>Получить новый ключ сессии</Button>
  <Button disabled={busy||!descriptor.trim()} onClick={()=>void run("recover")}>Получить ключ подтверждений закрытой сессии</Button>
  <Button disabled={busy||!originId} onClick={()=>void run("revoke")}>Отозвать ключ сессии</Button>
  <Button disabled={busy||!originId} onClick={()=>void run("status")}>Показать состояние синхронизации</Button>
  {sourceStatus&&<section aria-label="Состояние синхронизации локальной сессии">
   <p>Право записи: {sourceStatus.writer.mode==="HOSTED"?"облако":sourceStatus.writer.isSelectedSource?"эта локальная сессия":"другая локальная сессия"}.</p>
   <p>{sourceStatus.source.closed?"Сессия завершена.":"Сессия открыта."} {sourceStatus.source.archiveRecognized?"Исходный архив распознан.":"Исходный архив не привязан."}</p>
   <p>{sourceStatus.source.receivedThrough?`Облако сохранило события до ${sourceStatus.source.receivedThrough}.`:"Облако пока не получало событий этой сессии."}</p>
   <p>{sourceStatus.source.appliedThrough?`В кампании применены события до ${sourceStatus.source.appliedThrough}.`:"События этой сессии пока не применялись к кампании."}</p>
   {sourceStatus.receipts.length?<ol>{sourceStatus.receipts.map(receipt=><li key={receipt.receiptId}>Пакет до события {receipt.lastSequence}: {receipt.state==="APPLIED"?"применён к кампании":"сохранён, ожидает применения"}.</li>)}</ol>:<p>На этой странице пакетов нет.</p>}
   {sourceStatus.next&&<Button disabled={busy} onClick={()=>void run("status",sourceStatus.next!)}>Следующие пакеты</Button>}
  </section>}
  {secret&&<label>Секретный ключ для локальной установки<FormTextArea aria-label="Секретный ключ для локальной установки" data-private="true" readOnly value={secret} onFocus={event=>event.target.select()}/></label>}
  <p>Передавайте ключ только в свою локальную установку. При закрытии раздела ключ исчезнет с экрана; срок действия — до 12 часов.</p>
  {message&&<p role="status">{message}</p>}
 </section>;
}
export function CloudSourceConnectionPanel(props:{campaignId:string;csrfToken:string}){
 const [open,setOpen]=useState(false);
 return <details className="account-campaign-invite" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Подключить автономную сессию</summary>{open&&<Connection key={props.campaignId+props.csrfToken} {...props}/>}</details>;
}
