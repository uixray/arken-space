import { useEffect,useMemo,useRef,useState,type ReactNode } from "react";
import { isometricFloorId,isometricPublishedFloor,type TokenDto } from "@arken/contracts";
import type { SceneRendererProps } from "./SceneRenderer";
import { Map3dViewport } from "./Map3dViewport";
import { api,formatApiError } from "../api";
import { shouldIgnoreGlobalShortcut } from "../input-diagnostics";

export function ThreeDSceneRenderer(props:SceneRendererProps & {fallback:(view:{id:string;onChange:(id:string)=>void})=>ReactNode}) {
  const geometry=props.scene.grid.isometric!,spec=props.scene.grid.threeD!,grid=props.scene.grid;
  const [floorId,setFloorId]=useState(isometricPublishedFloor(geometry)),[selected,setSelected]=useState<string|null>(null),[twoD,setTwoD]=useState(false),[gpuFailed,setGpuFailed]=useState(false),[moving,setMoving]=useState(false),[error,setError]=useState("");
  const floor=geometry.floors.find(f=>f.id===(props.role==="GM"?floorId:isometricPublishedFloor(geometry)))??geometry.floors[0]!;
  const actors=useMemo(()=>props.tokens.filter(t=>t.levelId?t.levelId===floor.id:props.role==="GM"?floor.id===geometry.floors[0]!.id:floor.legacyNullLevel===true),[props.tokens,floor,geometry,props.role]);
  const token=actors.find(t=>t.id===selected),alive=useRef(true),timer=useRef<ReturnType<typeof setTimeout>|null>(null),lastPreview=useRef(0);
  const pending=useRef<{id:string;tokenId:string;revision:number;floorId:string}|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current);};},[]);
  useEffect(()=>{setSelected(null);setMoving(false);props.onSelectionChange?.([]);},[floor.id]);
  useEffect(()=>{
    const p=pending.current;if(!p)return;const current=props.tokens.find(t=>t.id===p.tokenId);
    if(!current||current.revision!==p.revision){if(current&&props.role==="GM"&&isometricFloorId(geometry,current.levelId)===p.floorId)setFloorId(p.floorId);pending.current=null;setBusy(false);if(timer.current)clearTimeout(timer.current);}
  },[props.tokens]);
  const canMove=(t:TokenDto)=>!props.readOnly&&!props.paused&&!t.locked&&(props.role==="GM"||t.controllerMembershipIds.includes(props.membershipId)||t.ownerMembershipId===props.membershipId);
  const send=(t:TokenDto,x:number,y:number,levelId=t.levelId)=>{
    if(pending.current||!props.socket?.connected||!canMove(t))return;
    const id=crypto.randomUUID();pending.current={id,tokenId:t.id,revision:t.revision,floorId:isometricFloorId(geometry,levelId)};setBusy(true);setError("");
    timer.current=setTimeout(()=>{if(alive.current&&pending.current?.id===id)setError("Подтверждение хода задерживается. Дождитесь обновления или обновите страницу.");},15000);
    props.socket.emit("token:moved",{actionId:id,tokenId:t.id,revision:t.revision,x,y,z:t.z,levelId},ack=>{
      if(!alive.current||pending.current?.id!==id)return;
      if(timer.current)clearTimeout(timer.current);pending.current=null;setBusy(false);
      if(!ack.ok)setError("Сервер отклонил ход. Проверьте проход и актуальное положение токена.");else if(props.role==="GM")setFloorId(isometricFloorId(geometry,levelId));
    });
  };
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(twoD||gpuFailed||props.tool!=="PAN"||!token||e.repeat||shouldIgnoreGlobalShortcut(e))return;
      const d:Record<string,[number,number]>={w:[0,-1],a:[-1,0],s:[0,1],d:[1,0]};const move=d[e.key.toLowerCase()];if(move){e.preventDefault();send(token,token.x+move[0]*grid.size,token.y+move[1]*grid.size);}};
    window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
  });
  const fallback=twoD||gpuFailed||props.tool!=="PAN"||actors.length>512;
  return <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <div style={{display:"flex",flexWrap:"wrap",gap:8,padding:8,background:"var(--surface)"}}>
      <button type="button" onClick={()=>{if(gpuFailed){setGpuFailed(false);setTwoD(false);}else setTwoD(v=>!v);}}>{gpuFailed?"Повторить 3D":twoD?"Открыть 3D":"Вернуться к 2D"}</button>
      {actors.length>512&&<span role="status">Для большого числа токенов включён полный 2D-вид.</span>}
      {gpuFailed&&<span role="status">Включено 2D-отображение: 3D недоступно на этом устройстве.</span>}
      {props.tool!=="PAN"&&<button onClick={()=>props.onToolSelect("PAN")}>Вернуться к 3D после редактирования</button>}
      {props.role==="GM"&&<><label>Ярус <select value={floor.id} onChange={e=>setFloorId(e.target.value)}>{geometry.floors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <button disabled={props.paused||busy} onClick={async()=>{try{await api(`/api/scenes/${props.scene.id}/isometric`,{method:"PUT",body:JSON.stringify({actionId:crypto.randomUUID(),revision:props.scene.revision??0,projection:"THREE_D",geometry:{...geometry,publishedFloorId:floor.id},threeD:spec})});}catch(e){setError(formatApiError(e));}}}>Показать ярус игрокам</button></>}
      {!fallback&&<><label>Токен <select value={selected??""} onChange={e=>{setSelected(e.target.value||null);props.onSelectionChange?.(e.target.value?[e.target.value]:[]);}}><option value="">Выбрать</option>{actors.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <button disabled={!token||!canMove(token)||busy} onClick={()=>setMoving(v=>!v)} aria-pressed={moving}>{moving?"Перемещение токена":"Управлять токеном"}</button>
      <span>Drag: обзор; Shift/правая кнопка: сдвиг; колесо: масштаб. WASD: выбранный токен.</span>
      {token&&props.role==="GM"&&geometry.transitions.flatMap(t=>{
        const from=t.from.floorId===floor.id?t.from:t.bidirectional&&t.to.floorId===floor.id?t.to:null,to=from===t.from?t.to:t.from;
        if(!from||Math.floor((token.x+token.width/2-grid.offsetX)/grid.size)!==from.x||Math.floor((token.y+token.height-grid.offsetY)/grid.size)!==from.y)return [];
        return [<button key={t.id} disabled={busy||props.paused||props.readOnly} onClick={()=>send(token,(to.x+.5)*grid.size+grid.offsetX-token.width/2,(to.y+.5)*grid.size+grid.offsetY-token.height,to.floorId===geometry.floors[0]!.id?null:to.floorId)}>По лестнице: {geometry.floors.find(f=>f.id===to.floorId)?.name}</button>];
      })}</>}
      {busy&&<span role="status">Сохраняю ход…</span>}{error&&<span role="alert">{error}</span>}
    </div>
    <div style={{flex:1,minHeight:0}}>{fallback?props.fallback({id:floor.id,onChange:setFloorId}):<Map3dViewport spec={spec} geometry={geometry} floorId={floor.id} grid={grid} actors={actors} selectedId={selected} move={moving&&!props.paused}
      onUnavailable={()=>setGpuFailed(true)} onPoint={(p,phase)=>{
        if(!token||!canMove(token)||pending.current)return;
        const x=(Math.floor(p.x)+.5)*grid.size+grid.offsetX-token.width/2,y=(Math.floor(p.y)+.5)*grid.size+grid.offsetY-token.height;
        if(phase==="end")send(token,x,y);
        else if(phase==="move"&&props.socket?.connected&&props.socket.previewEpoch&&performance.now()-lastPreview.current>50){lastPreview.current=performance.now();props.socket.emit("token:moving",{actionId:crypto.randomUUID(),tokenId:token.id,sceneId:props.scene.id,revision:token.revision,x:p.x*grid.size+grid.offsetX-token.width/2,y:p.y*grid.size+grid.offsetY-token.height,z:token.z,levelId:token.levelId,previewEpoch:props.socket.previewEpoch,snapshotVersion:props.socket.previewSnapshotVersion});}
      }} />}</div>
  </div>;
}
