import {LocalCloudSessionSelector} from "./LocalCloudSessionSelector";
import { useEffect,useRef,useState } from "react";
import { localOutboxStatusSchema,cloudTransferProofSchema,localAuthoritySchema,type LocalAuthority,type GameSnapshot } from "@arken/contracts";
import { z } from "zod";
import { api,formatApiError } from "../api";
import { Button } from "../design-system/Button";
import { FormInput } from "../ui/GravityFormControls";
import { ArkenDialog } from "../ui/ArkenDialog";
import "./local-session.css";
import {useHostPeerBridge} from "./use-host-peer-bridge";

const statusSchema=z.object({lastEpoch:z.number().int().nonnegative(),active:z.boolean(),authority:localAuthoritySchema.optional(),outbox:localOutboxStatusSchema.optional(),transferProof:cloudTransferProofSchema.optional()});
type Status=z.infer<typeof statusSchema>;
type Pairing={authority:LocalAuthority;pairingId:string;token:string;expiresInSeconds:number};

/** Mount with campaign + membership key: secrets are memory-only and scope-bound. */
export function LocalSessionPanel({campaignId,membershipId,members}:{campaignId:string;membershipId:string;members:GameSnapshot["members"]}){
  const [open,setOpen]=useState(false),[status,setStatus]=useState<Status|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const players=members.filter(m=>m.role==="PLAYER");
  const [player,setPlayer]=useState(players[0]?.id??""),[device,setDevice]=useState<string>(()=>crypto.randomUUID()),[code,setCode]=useState("");
  const [confirmStop,setConfirmStop]=useState(false);
  const bridge=useHostPeerBridge(code);
  const pending=useRef(false),scope=useRef(0),alive=useRef(true),abort=useRef<AbortController|null>(null),expiry=useRef<ReturnType<typeof setTimeout>|null>(null);
  const clearCode=()=>{setCode("");bridge.hideCodes();if(expiry.current)clearTimeout(expiry.current);expiry.current=null;};
  const close=()=>{scope.current++;abort.current?.abort();bridge.hideCodes();setOpen(false);clearCode();setError("");setConfirmStop(false);};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;scope.current++;abort.current?.abort();if(expiry.current)clearTimeout(expiry.current);};},[]);
  const call=async<T,>(path:string,body:unknown,signal:AbortSignal)=>{
    const headers=new Headers({"x-arken-membership-id":membershipId,"x-arken-campaign-id":campaignId});
    return api<T>(`/api/local-session/${path}`,{method:"POST",headers,body:JSON.stringify(body),signal});
  };
  const refresh=async(signal:AbortSignal,version:number)=>{
    const result=statusSchema.parse(await call("status",{},signal));
    if(result.authority&&result.authority.campaignId!==campaignId)throw Error("Сессия относится к другой кампании");
    if(alive.current&&scope.current===version)setStatus(result);
    return result;
  };
  const run=async(action:(signal:AbortSignal,version:number)=>Promise<void>)=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError("");
    const version=scope.current,controller=new AbortController();abort.current=controller;
    try{await action(controller.signal,version);}catch(e){if(alive.current&&scope.current===version&&!controller.signal.aborted)setError(formatApiError(e));}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  };
  const eligible=Boolean(player&&players.some(p=>p.id===player));
  return <>
    <Button type="button" onClick={()=>{setOpen(true);clearCode();void run(async(signal,v)=>{await refresh(signal,v);});}}>Автономная сессия</Button>
    <ArkenDialog open={open} title="Автономная сессия мастера" onClose={close} footer={false}>
      <div className="local-session-panel">
        <p>Управление локальным мастером. Подключение устройства выдаёт доступ только выбранному игроку этой кампании.</p>
        <p role="status">{status?status.active?`Локальная сессия запущена · версия ${status.lastEpoch}`:"Локальная сессия остановлена":"Получаем состояние…"}</p>
        <div className="local-session-panel__actions">
          <Button disabled={busy} onClick={()=>void run(async(signal,v)=>{clearCode();await refresh(signal,v);})}>Обновить состояние</Button>
          <Button disabled={busy||!status||status.active} onClick={()=>void run(async(signal,v)=>{clearCode();await call("start",{expectedEpoch:status!.lastEpoch},signal);await refresh(signal,v);})}>Запустить локальную сессию</Button>
          <Button disabled={busy||!status?.active} onClick={()=>setConfirmStop(true)}>Остановить и отозвать подключения</Button>
        </div>
        {confirmStop&&<section aria-label="Подтверждение остановки"><p>Все устройства этой сессии потеряют доступ. Для нового подключения понадобится новый код.</p><Button disabled={busy} onClick={()=>setConfirmStop(false)}>Оставить сессию</Button><Button disabled={busy} onClick={()=>void run(async(signal,v)=>{clearCode();await call("stop",{expectedEpoch:status!.lastEpoch},signal);bridge.closeAll();setConfirmStop(false);await refresh(signal,v);})}>Подтвердить остановку</Button></section>}
        {status?.outbox&&<section aria-label="Синхронизация локальной сессии">
          <p>События, сохранённые на этом мастере: {status.outbox.pendingEvents}{status.outbox.limited?"+":""}.</p>
          <p>Автоматическая передача в облако ещё не настроена. Ручная отправка доступна в подключении к облаку. События сохранены на этом мастере.</p>
          <Button disabled={busy} onClick={()=>void run(async(signal,v)=>{await refresh(signal,v);})}>Обновить очередь</Button>
        </section>}
        {open&&status&&<LocalCloudSessionSelector key={membershipId+":"+campaignId+":"+JSON.stringify(status.authority)} transferProof={status.transferProof} current={status.active?status.authority:undefined} campaignId={campaignId} membershipId={membershipId}/>}
        <fieldset disabled={busy||!status?.active}>
          <legend>Устройство игрока</legend>
          <label>Игрок<select value={eligible?player:""} onChange={e=>{setPlayer(e.target.value);clearCode();}}><option value="">Выберите игрока</option>{players.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
          {!players.length&&<p>Сначала добавьте игрока в эту локальную кампанию.</p>}
          <label>Идентификатор устройства<FormInput value={device} onChange={e=>{setDevice(e.target.value);clearCode();}} autoComplete="off" spellCheck={false}/></label>
          <Button onClick={()=>{setDevice(crypto.randomUUID());clearCode();}}>Новое устройство</Button>
          <div className="local-session-panel__actions">
            <Button disabled={!eligible} onClick={()=>void run(async(signal,v)=>{
              z.string().uuid().parse(device);clearCode();
              const result=await call<Pairing>("pairings",{membershipId:player,deviceId:device},signal);
              if(!alive.current||scope.current!==v)return;
              const a=localAuthoritySchema.parse(result.authority);if(a.campaignId!==campaignId)throw Error("Сессия относится к другой кампании");
              z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(result.token);
              setCode(JSON.stringify({version:1,authority:a,deviceId:device,token:result.token}));
              expiry.current=setTimeout(()=>{if(alive.current)clearCode();},300000);
            })}>Создать одноразовое подключение</Button>
            <Button disabled={!eligible} onClick={()=>void run(async(signal,v)=>{z.string().uuid().parse(device);clearCode();await call("revoke",{membershipId:player,deviceId:device},signal);bridge.revoke(device);await refresh(signal,v);})}>Отозвать это устройство</Button>
          </div>
        </fieldset>
        {code&&<section><label>Код подключения<textarea readOnly value={code} rows={5} spellCheck={false} onFocus={e=>e.currentTarget.select()}/></label><p>Передайте лично. Код действует 5 минут, подходит одному устройству и скрывается при закрытии окна.</p></section>}
        {bridge.ui}
        {error&&<p role="alert">{error}</p>}
      </div>
    </ArkenDialog>
  </>;
}
