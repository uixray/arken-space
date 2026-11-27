import {useEffect,useRef,useState} from "react";
import {z} from "zod";
import {Button} from "../design-system/Button";
import {createManualPeer,peerDescriptionSchema} from "./manual-peer";
import {bindLocalHostChannel,localPairingCodeSchema} from "./session-channel";

type Entry={peer:ReturnType<typeof createManualPeer>;rpc?:ReturnType<typeof bindLocalHostChannel>;ready:boolean};
const answerSchema=z.object({version:z.literal(1),sessionId:z.string().uuid(),deviceId:z.string().uuid(),description:peerDescriptionSchema}).strict();
export function useHostPeerBridge(code:string){
  const entries=useRef(new Map<string,Entry>()),alive=useRef(true),pending=useRef(false),generation=useRef(0);
  const [offer,setOffer]=useState(""),[answer,setAnswer]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[connected,setConnected]=useState(0);
  const hideCodes=()=>{generation.current++;setOffer("");setAnswer("");for(const[id,entry]of entries.current)if(!entry.ready){entry.peer.close();entries.current.delete(id);}};
  const closeAll=()=>{generation.current++;for(const entry of [...entries.current.values()]){entry.rpc?.close();entry.peer.close();}entries.current.clear();setOffer("");setAnswer("");setConnected(0);};
  const revoke=(id:string)=>{const entry=entries.current.get(id);entry?.rpc?.close();entry?.peer.close();entries.current.delete(id);setConnected([...entries.current.values()].filter(e=>e.ready).length);};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;for(const e of entries.current.values()){e.rpc?.close();e.peer.close();}entries.current.clear();};},[]);
  const run=async(action:()=>Promise<void>)=>{if(pending.current)return;pending.current=true;setBusy(true);setMessage("");try{await action();}catch{if(alive.current)setMessage("Не удалось подготовить соединение. Проверьте код, срок подключения и сеть.");}finally{pending.current=false;if(alive.current)setBusy(false);}};
  const ui=<section className="local-session-panel" aria-label="Прямое соединение с игроком">
    <p>Подключено устройств: {connected}. Для первого соединения обменяйтесь сетевыми кодами лично. Они содержат адреса и доступ; не публикуйте их.</p>
    <Button disabled={!code||busy} onClick={()=>void run(async()=>{
      const pairing=localPairingCodeSchema.parse(JSON.parse(code));revoke(pairing.deviceId);
      if(entries.current.size>=6)throw Error("PEER_LIMIT");
      const version=++generation.current;setOffer("");setAnswer("");
      let entry:Entry;
      const peer=createManualPeer({initiator:true,onClosed:()=>{
        if(entries.current.get(pairing.deviceId)!==entry)return;
        entry.rpc?.close();entries.current.delete(pairing.deviceId);
        if(alive.current){setConnected([...entries.current.values()].filter(e=>e.ready).length);setMessage("Прямой канал закрыт. Для повторного подключения создайте новый код.");}
      },onChannel:channel=>{
        if(!alive.current||entries.current.get(pairing.deviceId)!==entry){channel.close();return;}
        entry.rpc=bindLocalHostChannel(channel,pairing);entry.ready=true;
        setConnected([...entries.current.values()].filter(e=>e.ready).length);setMessage("Канал установлен. Игрок подтверждает своё одноразовое подключение.");
      }});
      entry={peer,ready:false};entries.current.set(pairing.deviceId,entry);
      const description=await peer.offer();
      if(!alive.current||generation.current!==version){peer.close();return;}
      setOffer(JSON.stringify({version:1,pairing,description}));
    })}>Подготовить сетевой код для игрока</Button>
    {offer&&<>
      <label>Сетевой код мастера<textarea readOnly rows={5} value={offer} onFocus={e=>e.currentTarget.select()}/></label>
      <p>Игрок открывает /local-session в своём браузере, вставляет этот код и возвращает ответ.</p>
      <label>Ответ игрока<textarea rows={5} value={answer} maxLength={524288} onChange={e=>setAnswer(e.target.value)} autoComplete="off" spellCheck={false}/></label>
      <Button disabled={busy||!answer} onClick={()=>void run(async()=>{
        const received=answerSchema.parse(JSON.parse(answer)),sent=JSON.parse(offer);
        if(received.sessionId!==sent.pairing.authority.sessionId||received.deviceId!==sent.pairing.deviceId)throw Error("PEER_SCOPE");
        const entry=entries.current.get(received.deviceId);if(!entry)throw Error("PEER_CLOSED");
        await entry.peer.acceptAnswer(received.description);setOffer("");setAnswer("");
      })}>Принять ответ игрока</Button>
    </>}
    {message&&<p role="status">{message}</p>}
  </section>;
  return {ui,hideCodes,closeAll,revoke};
}
