import './campaign-transfer.css';
import {useEffect,useId,useRef,useState} from 'react';
import {z} from 'zod';
import {api} from '../api';
import {Button} from '../design-system/Button';
import {FormInput} from '../ui/GravityFormControls';
const importedSchema=z.object({state:z.literal('IMPORTED'),id:z.string().uuid(),campaignId:z.string().uuid(),ownerMembershipId:z.string().uuid(),cleanupPending:z.boolean().optional()}).strict();
const repairedSchema=z.object({state:z.literal('MEDIA_REPAIRED'),id:z.string().uuid(),campaignId:z.string().uuid(),campaignAvailable:z.boolean(),filesChecked:z.number().int().nonnegative(),filesRestored:z.number().int().nonnegative(),cleanupPending:z.boolean().optional()}).strict();
type Props={csrfToken:string;onRefresh:()=>Promise<unknown>;onOpen:(campaignId:string)=>void};
function ImportForm({csrfToken,onRefresh,onOpen}:Props){
 const [operation,setOperation]=useState<'IMPORT'|'REPAIR'>('IMPORT');
 const [accountPassword,setAccountPassword]=useState(''),[archivePassword,setArchivePassword]=useState(''),[file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[campaignId,setCampaignId]=useState<string|null>(null),[uncertain,setUncertain]=useState(false);
 const controller=useRef<AbortController|null>(null),fileInput=useRef<HTMLInputElement|null>(null),fileDescription=useId();
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function submit(){
  if(!file||!accountPassword||!archivePassword||busy||uncertain)return;
  if(file.size<1||file.size>33*1024*1024*1024){setMessage('Выберите непустой файл кампании размером до 33 ГБ.');return;}
  const abort=new AbortController();controller.current=abort;setBusy(true);setCampaignId(null);setMessage(operation==='REPAIR'?'Проверяем исходный архив и восстанавливаем файлы…':'Читаем файл, проверяем пароль и переносим кампанию…');
  const body=new FormData();body.append('accountPassword',accountPassword);body.append('archivePassword',archivePassword);body.append('operation',operation);body.append('archive',file);
  setAccountPassword('');setArchivePassword('');setFile(null);if(fileInput.current)fileInput.current.value='';
  try{
   const response=await api('/api/account/campaign-transfers/import',{method:'POST',headers:{'x-csrf-token':csrfToken},body,signal:abort.signal});
   const result=operation==='REPAIR'?repairedSchema.parse(response):importedSchema.parse(response);
   if(abort.signal.aborted)return;
   const success=result.state==='MEDIA_REPAIRED'?`Файлы проверены: ${result.filesChecked}. Восстановлены: ${result.filesRestored}. Откройте кампанию заново, чтобы обновить изображения.`:'Кампания перенесена. Можно открыть её за местного мастера.';
   setCampaignId(result.state==='MEDIA_REPAIRED'&&!result.campaignAvailable?null:result.campaignId);setMessage(success);
   await onRefresh().catch(()=>{if(!abort.signal.aborted)setMessage(success+' Обновите список кампаний.');});
  }catch(error){if(!abort.signal.aborted){if(operation==='REPAIR'&&error&&typeof error==='object'&&'code' in error&&error.code==='TRANSFER_REPAIR_FILE_BUSY'){setMessage('Файл занят открытой кампанией. Закройте её вкладки и повторите восстановление с тем же исходным архивом. Уже восстановленные файлы сохраняются.');return;}setUncertain(true);setMessage(operation==='REPAIR'?'Результат восстановления не подтверждён. Обновите список перед повтором и выберите тот же исходный файл кампании.':'Результат переноса не подтверждён. Обновите список кампаний перед повтором; проверьте пароль учётной записи и пароль файла.');}}
  finally{if(!abort.signal.aborted)setBusy(false);}
 }
 async function refresh(){setBusy(true);try{await onRefresh();setUncertain(false);setMessage('Список обновлён. Проверьте наличие кампании перед повторным действием.');}catch{setMessage('Не удалось обновить список. Повторите обновление перед переносом.');}finally{setBusy(false);}}
 return <section className="campaign-transfer" aria-label="Импорт кампании">
  <p>{operation==='REPAIR'?'Выберите тот же исходный архив. Иллюстрации и вложения будут восстановлены; текущие персонажи, права и события сохранятся.':'Выберите зашифрованный файл кампании. Перенесённая кампания будет принадлежать местному мастеру.'}</p>
  <form onSubmit={event=>{event.preventDefault();void submit();}}>
   <div className="campaign-transfer__actions" role="group" aria-label="Действие с файлом">
    <Button type="button" view={operation==='IMPORT'?'action':'normal'} aria-pressed={operation==='IMPORT'} disabled={busy||uncertain} onClick={()=>{setOperation('IMPORT');setCampaignId(null);setMessage('');}}>Перенос кампании</Button>
    <Button type="button" view={operation==='REPAIR'?'action':'normal'} aria-pressed={operation==='REPAIR'} disabled={busy||uncertain} onClick={()=>{setOperation('REPAIR');setCampaignId(null);setMessage('');}}>Восстановление файлов</Button>
   </div>
   <div className="campaign-transfer__file">
    <label>Файл кампании<FormInput className="campaign-transfer__file-input" type="file" accept=".arken" tabIndex={-1} disabled={busy||uncertain} controlRef={fileInput} onChange={event=>setFile(event.target.files?.[0]??null)}/></label>
    <Button type="button" disabled={busy||uncertain} aria-describedby={fileDescription} onClick={()=>fileInput.current?.click()}>Выбрать файл кампании</Button>
    <span id={fileDescription} data-private="true" aria-live="polite">{file?.name??'Файл не выбран'}</span>
   </div>
   <label>Пароль местной учётной записи<FormInput type="password" autoComplete="current-password" data-private="true" maxLength={512} disabled={busy||uncertain} value={accountPassword} onChange={event=>setAccountPassword(event.target.value)}/></label>
   <label>Пароль переносимого файла<FormInput type="password" autoComplete="off" data-private="true" maxLength={1024} disabled={busy||uncertain} value={archivePassword} onChange={event=>setArchivePassword(event.target.value)}/></label>
   <Button type="submit" disabled={busy||uncertain||!file||!accountPassword||!archivePassword}>{operation==='REPAIR'?'Восстановить файлы кампании':'Импортировать кампанию'}</Button>
  </form>
  {message&&<p role="status">{message}</p>}
  {campaignId&&<Button view="action" onClick={()=>onOpen(campaignId)}>{operation==='REPAIR'?'Открыть восстановленную кампанию':'Открыть перенесённую кампанию'}</Button>}
  {uncertain&&<Button disabled={busy} onClick={()=>void refresh()}>Обновить список кампаний</Button>}
 </section>;
}
export function CampaignImportPanel(props:Props){const [open,setOpen]=useState(false);return <details className="account-campaign-invite" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Перенести кампанию из файла</summary>{open&&<ImportForm key={props.csrfToken} {...props}/>}</details>;}
