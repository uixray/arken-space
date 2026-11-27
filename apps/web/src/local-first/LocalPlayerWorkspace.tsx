import {WorkspacePortalContext} from "../workspace-portal";
import {getOfflineShellStatus,subscribeOfflineShell,offlineShellStatusText} from "./offline-shell-status";
import {installPlayerCopyRuntime} from "./player-copy-runtime";
import {openPlayerSnapshotCache,listPlayerCopySummaries,type PlayerCopySummary,type PlayerCacheScope} from "./player-snapshot-cache";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {z} from "zod";
import {App} from "../App";
import {Button} from "../design-system/Button";
import {createManualPeer,peerDescriptionSchema} from "./manual-peer";
import {bindLocalPlayerChannel,localPairingCodeSchema} from "./session-channel";
import {installLocalPlayerRuntime} from "./player-runtime";
import "./local-session.css";
const offerSchema=z.object({version:z.literal(1),pairing:localPairingCodeSchema,description:peerDescriptionSchema}).strict();

/** Separate entry before cloud authentication; the game itself remains the shared App. */
export function LocalPlayerWorkspace(){
  const [tableElement,setTableElement]=useState<HTMLDivElement|null>(null);
  const shellStatus=useSyncExternalStore(subscribeOfflineShell,getOfflineShellStatus,getOfflineShellStatus);
  const [offer,setOffer]=useState(""),[answer,setAnswer]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[playing,setPlaying]=useState(false);
  const [saveLocally,setSaveLocally]=useState(false),[cacheStatus,setCacheStatus]=useState("");
  const [copies,setCopies]=useState<PlayerCopySummary[]>([]),[viewingCopy,setViewingCopy]=useState(false);
  const captureAllowed=useRef(false);
  const cache=useRef<Awaited<ReturnType<typeof openPlayerSnapshotCache>>|null>(null);
  const alive=useRef(true),pending=useRef(false),version=useRef(0),peer=useRef<ReturnType<typeof createManualPeer>|null>(null),runtime=useRef<ReturnType<typeof installLocalPlayerRuntime>|null>(null);
  const disconnect=()=>{version.current++;setViewingCopy(false);captureAllowed.current=false;cache.current?.close();cache.current=null;setCacheStatus("");peer.current?.close();peer.current=null;runtime.current?.dispose();runtime.current=null;setPlaying(false);setAnswer("");setOffer("");setBusy(false);pending.current=false;};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;version.current++;peer.current?.close();runtime.current?.dispose();cache.current?.close();cache.current=null;};},[]);
  const forgetCache=async()=>{
    const saved=cache.current;if(!saved)return;const generation=version.current;cache.current=null;captureAllowed.current=false;setSaveLocally(false);
    try{await saved.forget();if(alive.current&&version.current===generation)setCacheStatus("Локальная копия удалена.");}
    catch{if(alive.current&&version.current===generation){setCacheStatus("Не удалось удалить локальную копию. Повторите удаление.");cache.current=saved;}else saved.close();return;}
    saved.close();if(viewingCopy){runtime.current?.dispose();runtime.current=null;setPlaying(false);setViewingCopy(false);setCopies([]);}
  };
  const clearOnLogout=async()=>{
    const target=cache.current;if(!target){disconnect();return;}
    const generation=version.current;captureAllowed.current=false;cache.current=null;setSaveLocally(false);
    try{await target.forget();target.close();if(alive.current&&version.current===generation){disconnect();setCopies([]);setCacheStatus("Локальная копия удалена.");}}
    catch{if(alive.current&&version.current===generation){cache.current=target;runtime.current?.dispose();runtime.current=null;peer.current?.close();peer.current=null;setPlaying(false);setViewingCopy(false);setError("Соединение закрыто, но удалить локальную копию не удалось. Повторите удаление.");}else target.close();throw Error("Не удалось удалить локальную копию при выходе.");}
  };
  const showCopies=async()=>{
    setError("");try{const found=await listPlayerCopySummaries();if(alive.current){setCopies(found);if(!found.length)setError("Сохранённых копий на этом устройстве нет.");}}
    catch{if(alive.current)setError("Не удалось прочитать список локальных копий.");}
  };
  const openCopy=async(scope:PlayerCacheScope)=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError("");const current=++version.current;
    let saved:Awaited<ReturnType<typeof openPlayerSnapshotCache>>|null=null;
    try{
      saved=await openPlayerSnapshotCache(scope,true);const bundle=await saved?.loadBundle();
      if(!bundle)throw Error("COPY_EXPIRED");
      if(!alive.current||version.current!==current){saved?.close();return;}
      runtime.current=installPlayerCopyRuntime(scope,bundle,{onLogout:clearOnLogout});cache.current=saved;captureAllowed.current=false;
      saved?.watch?.(()=>{
        if(!alive.current||version.current!==current||cache.current!==saved)return;
        disconnect();setCopies([]);setError("Локальная копия недоступна: срок доступа истёк, копия удалена или хранилище недоступно.");
      },bundle.expiresAt);
      setViewingCopy(true);setPlaying(true);setCacheStatus(`Сохранено: ${bundle.savedAt?new Date(bundle.savedAt).toLocaleString("ru-RU"):"время неизвестно"}. Данные могли измениться; часть файлов может отсутствовать. Сюжетный архив содержит только сохранённые страницы. Прочтение отмечается только в открытой копии.`);
    }catch{saved?.close();if(alive.current&&version.current===current)setError("Копия недоступна, повреждена или срок хранения истёк. Подключитесь к мастеру.");}
    finally{if(alive.current&&version.current===current){pending.current=false;setBusy(false);}}
  };
  const connect=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError("");const current=++version.current;
    try{
      const code=offerSchema.parse(JSON.parse(offer));if(code.description.type!=="offer")throw Error("OFFER_REQUIRED");
      peer.current?.close();
      const connection=createManualPeer({initiator:false,onClosed:()=>{if(alive.current&&version.current===current){disconnect();setError("Прямой канал закрыт. Для возвращения за стол получите новый код мастера. Сохранённую копию можно открыть отдельно.");}},onChannel:channel=>{
        void(async()=>{
          const client=await bindLocalPlayerChannel(channel,code.pairing);
          const initial=await client.request({kind:"SNAPSHOT"});
          if(!alive.current||version.current!==current){client.close();return;}
          let saved:Awaited<ReturnType<typeof openPlayerSnapshotCache>>|null=null;
          if(saveLocally){
            try{saved=await openPlayerSnapshotCache({authority:client.authority,membershipId:client.membershipId,deviceId:code.pairing.deviceId});await saved.save(initial.snapshot);}
            catch{let failed=false;try{await saved?.forget();}catch{failed=true;}saved?.close();saved=null;if(alive.current&&version.current===current)setCacheStatus(failed?"Локальное сохранение недоступно; прежнюю копию удалить не удалось.":"Локальное сохранение недоступно.");}
          }
          if(!alive.current||version.current!==current){saved?.close();client.close();return;}
          cache.current=saved;captureAllowed.current=Boolean(saved);if(saved)setCacheStatus("Состояние сохранено на этом устройстве.");
          saved?.watch?.(()=>{
            if(!alive.current||version.current!==current||cache.current!==saved)return;
            captureAllowed.current=false;cache.current=null;saved?.close();setSaveLocally(false);setCacheStatus("Локальное сохранение отключено: копия удалена, истекла или хранилище недоступно.");
          });
          runtime.current=installLocalPlayerRuntime(client,initial.snapshot,{onLogout:clearOnLogout,onSnapshot:async (snapshot,media,story,reads)=>{
            const target=cache.current;if(!target||!captureAllowed.current)return;
            try{await target.save(snapshot,media,story,reads);if(alive.current&&version.current===current&&cache.current===target)setCacheStatus("Состояние сохранено на этом устройстве.");}
            catch{
              if(!alive.current||version.current!==current||cache.current!==target)return;
              captureAllowed.current=false;cache.current=null;setSaveLocally(false);
              try{await target.forget();target.close();if(alive.current&&version.current===current)setCacheStatus("Сохранение остановлено. Прежняя копия удалена после ошибки обновления.");}
              catch{if(alive.current&&version.current===current){cache.current=target;setCacheStatus("Сохранение остановлено. Прежнюю копию удалить не удалось; повторите удаление.");}else target.close();}
            }
          }});setOffer("");setAnswer("");setPlaying(true);setError("");
        })().catch(()=>{connection.close();if(alive.current&&version.current===current)setError("Не удалось подтвердить подключение. Попросите мастера создать новый код.");});
      }});
      peer.current=connection;const description=await connection.answer(code.description);
      if(!alive.current||version.current!==current){connection.close();return;}
      setAnswer(JSON.stringify({version:1,sessionId:code.pairing.authority.sessionId,deviceId:code.pairing.deviceId,description}));
    }catch{if(alive.current&&version.current===current)setError("Не удалось подготовить соединение. Проверьте код мастера и сеть.");}
    finally{if(alive.current&&version.current===current){setBusy(false);pending.current=false;}}
  };
  if(playing)return <div className="local-player-workspace"><aside className="local-player-workspace__status"><span role="status">{viewingCopy?"Локальная копия — только просмотр":"Прямой канал мастера"}</span><Button onClick={disconnect}>Отсоединиться</Button><span role="status" data-offline-shell-state={shellStatus.phase}>{offlineShellStatusText(shellStatus)}</span>{cacheStatus&&<span role="status">{cacheStatus}</span>}{cache.current&&<Button onClick={()=>void forgetCache()}>Удалить локальную копию</Button>}{error&&<span role="alert">{error}</span>}</aside><div ref={setTableElement} className="local-player-workspace__table"><WorkspacePortalContext.Provider value={tableElement}><App localCopyMode={viewingCopy}/></WorkspacePortalContext.Provider></div></div>;
  return <main className="account-auth-shell"><section className="account-auth-card local-session-panel">
    <h1>Подключиться к локальному мастеру</h1>
    <p role="status" data-offline-shell-state={shellStatus.phase}>{offlineShellStatusText(shellStatus)}</p>
    <p>Попросите мастера передать сетевой код лично. Подготовьте канал до игры. Если сеть не допускает прямую связь, нужен настроенный relay; сейчас используется ручной обмен параметрами соединения.</p>
    <label><input type="checkbox" checked={saveLocally} disabled={busy||Boolean(answer)} onChange={event=>setSaveLocally(event.target.checked)}/>Сохранять состояние игрока на этом устройстве</label>
    <p>Локальная копия включает доступную вам личную переписку и доступна в приложении до 12 часов после обновления. Используйте только личное устройство. При отсутствии связи отзыв доступа к уже полученной копии проверить невозможно.</p>
    <label>Сетевой код мастера<textarea value={offer} maxLength={524288} rows={7} spellCheck={false} autoComplete="off" onChange={e=>setOffer(e.target.value)}/></label>
    <Button disabled={busy||!offer||Boolean(answer)} onClick={()=>void connect()}>Подготовить ответ мастеру</Button>
    {answer&&<section><label>Ответ для мастера<textarea value={answer} readOnly rows={7} onFocus={e=>e.currentTarget.select()}/></label><p>Передайте ответ мастеру и дождитесь подтверждения соединения.</p></section>}
    {error&&<p role="alert">{error}</p>}
    <Button disabled={busy} onClick={()=>void showCopies()}>Открыть сохранённую копию</Button>
    {copies.map((copy,index)=><Button className="local-copy-choice" key={JSON.stringify(copy.scope)} disabled={busy} onClick={()=>void openCopy(copy.scope)}>{copy.name}{copy.legacy?` ${index+1}`:""}{copy.player?` · ${copy.player}`:""}{copy.savedAt?` · ${new Date(copy.savedAt).toLocaleString("ru-RU")}`:""}</Button>)}
    {cache.current&&<Button onClick={()=>void forgetCache()}>Удалить локальную копию</Button>}
    <Button onClick={disconnect}>Очистить подключение</Button><a href="/account">Вернуться к аккаунту</a>
  </section></main>;
}
