export type OfflineShellStatus={phase:"CHECKING"|"PREPARING"|"READY"|"UPDATE_WAITING"|"UPDATE_FAILED"|"UNAVAILABLE"|"UNSUPPORTED"|"DEVELOPMENT";available:boolean};
let current:OfflineShellStatus={phase:"CHECKING",available:false};
const listeners=new Set<()=>void>();
export const getOfflineShellStatus=()=>current;
export const subscribeOfflineShell=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
export function publishOfflineShellStatus(next:OfflineShellStatus){
 if(next.phase===current.phase&&next.available===current.available)return;
 current=next;for(const listener of listeners)listener();
}
export function offlineShellStatusText(status:OfflineShellStatus){
 switch(status.phase){
  case "READY":return "Автономный интерфейс готов на этом устройстве.";
  case "PREPARING":return status.available?"Готовится обновление. Текущий автономный интерфейс доступен.":"Готовим автономный интерфейс. Дождитесь завершения перед отключением сети.";
  case "UPDATE_WAITING":return "Новая версия готова. Обновление применится после закрытия всех вкладок приложения.";
  case "UPDATE_FAILED":return "Обновление не подготовлено. Предыдущий автономный интерфейс сохранён.";
  case "UNAVAILABLE":return "Автономный запуск пока недоступен. Откройте приложение с сетью и дождитесь подготовки.";
  case "UNSUPPORTED":return "Этот браузер или адрес не поддерживает автономный запуск.";
  case "DEVELOPMENT":return "Автономный запуск проверяется в собранной версии приложения.";
  default:return "Проверяем готовность автономного интерфейса…";
 }
}
export function queryOfflineShell(worker:ServiceWorker):Promise<boolean>{
 return new Promise(resolve=>{
  const channel=new MessageChannel();let finished=false;
  const done=(ready:boolean)=>{if(finished)return;finished=true;clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(ready);};
  const timer=setTimeout(()=>done(false),5000);
  channel.port1.onmessage=event=>{const data=event.data;done(data?.type==="SHELL_STATUS"&&data.ready===true&&typeof data.version==="string"&&/^[a-f0-9]{64}$/.test(data.version));};
  try{worker.postMessage("SHELL_STATUS",[channel.port2]);}catch{done(false);}
 });
}
/** Worker state alone is insufficient: browser cache eviction can leave an active
 * worker without its public assets. Ask that worker before reporting readiness. */
export function monitorOfflineShell(registration:ServiceWorkerRegistration,publish:typeof publishOfflineShellStatus=publishOfflineShellStatus,query=queryOfflineShell){
 let stopped=false,revision=0,failed=false;
 const watched=new Set<ServiceWorker>();
 const refresh=async()=>{
  const intent=++revision,active=registration.active;
  const available=active?await query(active).catch(()=>false):false;
  if(stopped||intent!==revision)return;
  const installing=registration.installing&&!['redundant','activated'].includes(registration.installing.state);
  const phase=registration.waiting?"UPDATE_WAITING":installing?"PREPARING":failed&&available?"UPDATE_FAILED":available?"READY":"UNAVAILABLE";
  publish({phase,available});
 };
 const changed=()=>{
  for(const worker of [registration.installing,registration.waiting])if(worker&&!watched.has(worker)){
   watched.add(worker);worker.addEventListener("statechange",workerChanged);
  }
  void refresh();
 };
 const workerChanged=(event:Event)=>{if((event.target as ServiceWorker).state==="redundant")failed=true;changed();};
 const update=()=>{failed=false;changed();};
 const resume=()=>{void refresh();};
 if(typeof window!=="undefined")window.addEventListener("focus",resume);
 if(typeof document!=="undefined")document.addEventListener("visibilitychange",resume);
 registration.addEventListener("updatefound",update);changed();
 return ()=>{stopped=true;revision++;if(typeof window!=="undefined")window.removeEventListener("focus",resume);if(typeof document!=="undefined")document.removeEventListener("visibilitychange",resume);registration.removeEventListener("updatefound",update);for(const worker of watched)worker.removeEventListener("statechange",workerChanged);};
}
