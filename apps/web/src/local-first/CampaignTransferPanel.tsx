import './campaign-transfer.css';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {api} from '../api';
import {Button} from '../design-system/Button';
import {FormInput} from '../ui/GravityFormControls';

const jobSchema=z.object({id:z.string().uuid(),state:z.enum(['PREPARING','READY','FAILED']),bytes:z.number().int().positive().optional(),expiresAt:z.string().datetime()}).strict();
function TransferForm({campaignId,csrfToken}:{campaignId:string;csrfToken:string}){
 const [accountPassword,setAccountPassword]=useState(''),[archivePassword,setArchivePassword]=useState(''),[confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[download,setDownload]=useState<string|null>(null);
 const controller=useRef<AbortController|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{controller.current?.abort();if(timer.current)clearTimeout(timer.current);},[]);
 async function prepare(){
  if(archivePassword!==confirmation||Array.from(archivePassword).length<12||new TextEncoder().encode(archivePassword).length>1024){setMessage('Задайте пароль файла от 12 символов и повторите его без изменений.');return;}
  controller.current?.abort();if(timer.current)clearTimeout(timer.current);
  const current=new AbortController();controller.current=current;setBusy(true);setMessage('Подготавливаем данные и иллюстрации кампании…');setDownload(null);
  const base=`/api/account/campaigns/${campaignId}/transfer-exports`;
  try{
   const body=JSON.stringify({accountPassword,archivePassword});setAccountPassword('');setArchivePassword('');setConfirmation('');
   let job=jobSchema.parse(await api(base,{method:'POST',headers:{'x-csrf-token':csrfToken},body,signal:current.signal}));
   while(!current.signal.aborted){
    if(Date.parse(job.expiresAt)<=Date.now())throw Error('EXPIRED');
    if(job.state==='FAILED')throw Error('FAILED');
    if(job.state==='READY'){
     if(!job.bytes)throw Error('MISSING_SIZE');
     setDownload(`${base}/${job.id}/download`);setMessage(`Файл готов (${(job.bytes/1024/1024).toFixed(1)} МБ). Ссылка действует 15 минут.`);
     timer.current=setTimeout(()=>{setDownload(null);setMessage('Срок ссылки истёк. Подготовьте новый файл.');},Math.min(Date.parse(job.expiresAt)-Date.now(),15*60*1000));
     return;
    }
    await new Promise<void>(resolve=>{timer.current=setTimeout(resolve,1500);});
    if(current.signal.aborted)return;
    job=jobSchema.parse(await api(`${base}/${job.id}`,{signal:current.signal}));
   }
  }catch{if(!current.signal.aborted)setMessage('Не удалось подготовить файл. Проверьте пароль учётной записи и повторите попытку.');}
  finally{if(!current.signal.aborted)setBusy(false);}
 }
 return <section className="campaign-transfer" aria-label="Файл переноса кампании">
  <p>Сохраните данные и доступные вам иллюстрации кампании в зашифрованный файл. Для его открытия понадобится отдельный пароль файла — сохраните его у себя.</p>
  <form onSubmit={event=>{event.preventDefault();void prepare();}}>
   <label>Пароль учётной записи<FormInput type="password" autoComplete="current-password" data-private="true" maxLength={512} disabled={busy} value={accountPassword} onChange={event=>setAccountPassword(event.target.value)}/></label>
   <label>Пароль файла<FormInput type="password" autoComplete="new-password" data-private="true" maxLength={1024} disabled={busy} value={archivePassword} onChange={event=>setArchivePassword(event.target.value)}/></label>
   <label>Повтор пароля файла<FormInput type="password" autoComplete="new-password" data-private="true" maxLength={1024} disabled={busy} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>
   <Button type="submit" disabled={busy||!accountPassword||!archivePassword||!confirmation}>Подготовить файл кампании</Button>
  </form>
  {message&&<p role="status">{message}</p>}
  {download&&<Button href={download} download view="action">Скачать файл кампании</Button>}
 </section>;
}
export function CampaignTransferPanel(props:{campaignId:string;csrfToken:string}){
 const [open,setOpen]=useState(false);
 return <details className="account-campaign-invite" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Сохранить файл кампании</summary>{open&&<TransferForm key={props.campaignId+props.csrfToken} {...props}/>}</details>;
}
