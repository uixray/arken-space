import {useEffect,useRef,useState} from "react";
import {localCloudScopesSchema,type CloudTransferProof,type LocalAuthority} from "@arken/contracts";
import {z} from "zod";
import {api} from "../api";
import {Button} from "../design-system/Button";
import {FormSelect} from "../ui/GravityFormControls";
import {LocalCloudConnectionPanel} from "./LocalCloudConnectionPanel";
type Page=z.infer<typeof localCloudScopesSchema>;
const key=(authority:LocalAuthority)=>`${authority.hostId}:${authority.sessionId}:${authority.epoch}`;
/** Caller keys by campaign/member/current authority. Child remount clears secrets
 * when switching historical sessions; the server independently proves scope. */
export function LocalCloudSessionSelector({campaignId,membershipId,current,transferProof}:{campaignId:string;membershipId:string;current?:LocalAuthority;transferProof?:CloudTransferProof}){
 const [rows,setRows]=useState<Page["scopes"]>([]),[next,setNext]=useState<Page["next"]>(null),[selected,setSelected]=useState(current?key(current):""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const generation=useRef(0),controller=useRef<AbortController|null>(null);
 const load=async(after?:Page["next"])=>{
  const own=++generation.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);setError("");
  try{const page=localCloudScopesSchema.parse(await api("/api/local-session/cloud/scopes",{method:"POST",headers:{"x-arken-campaign-id":campaignId,"x-arken-membership-id":membershipId},body:JSON.stringify(after?{after}:{}),signal:abort.signal}));
   if(page.scopes.some(row=>row.authority.campaignId!==campaignId))throw Error("SCOPE_MISMATCH");
   if(own!==generation.current)return;
   setRows(previous=>after?[...previous,...page.scopes.filter(row=>!previous.some(old=>key(old.authority)===key(row.authority)))]:page.scopes);setNext(page.next);
   if(!after&&!current)setSelected(previous=>page.scopes.some(row=>key(row.authority)===previous)?previous:page.scopes[0]?key(page.scopes[0].authority):"");
  }catch{if(own===generation.current&&!abort.signal.aborted)setError("Не удалось загрузить накопленные сессии. Повторите загрузку.");}
  finally{if(own===generation.current)setBusy(false);}
 };
 useEffect(()=>{void load();return()=>{generation.current++;controller.current?.abort();};},[]);
 const candidates=[...(current?[{authority:current,pendingEvents:0,limited:false}]:[]),...rows.filter(row=>!current||key(row.authority)!==key(current))];
 const authority=candidates.find(row=>key(row.authority)===selected)?.authority;
 return <section aria-label="Выбор сессии для облака">
  <label>Сессия для отправки<FormSelect value={authority?selected:""} onChange={event=>setSelected(event.target.value)}><option value="">Выберите сессию</option>{candidates.map(row=><option key={key(row.authority)} value={key(row.authority)}>{current&&key(current)===key(row.authority)?`Текущая сессия · версия ${row.authority.epoch}`:`Сохранённая сессия · версия ${row.authority.epoch} · событий ${row.pendingEvents}${row.limited?"+":""}`}</option>)}</FormSelect></label>
  <Button disabled={busy} onClick={()=>void load()}>Обновить список сессий</Button>
  {next&&<Button disabled={busy} onClick={()=>void load(next)}>Показать более ранние сессии</Button>}
  {!busy&&!candidates.length&&!error&&<p>Накопленных сессий для отправки пока нет.</p>}
  {error&&<p role="alert">{error}</p>}
  {authority&&<LocalCloudConnectionPanel key={membershipId+key(authority)} transferProof={transferProof} authority={authority} membershipId={membershipId} historical={!current||key(current)!==key(authority)}/>}
 </section>;
}
