const CHANNEL="arken-player-cache-invalidation-v1";
/** Messages are hints, not authorization: always reread IndexedDB before acting. */
export function notifyPlayerCacheChanged(){
  try{const channel=new BroadcastChannel(CHANNEL);channel.postMessage("CHECK");channel.close();}catch{}
}
export function watchCacheValidity(check:()=>Promise<boolean>,onInvalidated:()=>void){
  let stopped=false,inFlight=false,channel:BroadcastChannel|undefined;
  const tick=async()=>{
    if(stopped||inFlight)return;inFlight=true;
    try{if(!await check()&&!stopped){stop();onInvalidated();}}
    catch{if(!stopped){stop();onInvalidated();}}
    finally{inFlight=false;}
  };
  const timer=setInterval(()=>void tick(),1000);
  const resume=()=>{void tick();};
  function stop(){if(stopped)return;stopped=true;clearInterval(timer);channel?.close();
    if(typeof window!=="undefined")window.removeEventListener("focus",resume);
    if(typeof document!=="undefined")document.removeEventListener("visibilitychange",resume);
  }
  try{channel=new BroadcastChannel(CHANNEL);channel.onmessage=resume;}catch{}
  if(typeof window!=="undefined")window.addEventListener("focus",resume);
  if(typeof document!=="undefined")document.addEventListener("visibilitychange",resume);
  void tick();return stop;
}
