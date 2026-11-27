import { useEffect,useMemo,useRef,useState } from "react";
import { map3dSpecSchema,map3dMovementGeometry,map3dApplyFloorEdits,isometricSceneGeometrySchema,type AssetDto,type SceneDto,type IsometricSceneGeometry,type Map3dSpec,type Map3dCell } from "@arken/contracts";
import { api,formatApiError } from "../api";
import { preflightMap3dImage,proposeMap3d } from "./map3d-raster";
import { importMap3dGlb } from "./map3d-glb";
import { buildMap3dMesh,exportMap3dGlb } from "./map3d-geometry";
import { Map3dViewport } from "./Map3dViewport";
import { IsometricSettings } from "./IsometricSettings";

const fresh=(scene:SceneDto):IsometricSceneGeometry=>structuredClone(scene.grid.isometric??{version:1,transform:{origin:{x:0,y:0},axisX:{x:scene.grid.size,y:0},axisY:{x:0,y:scene.grid.size}},metersPerCell:scene.grid.metersPerCell??1.5,floors:[{id:crypto.randomUUID(),name:"Основной ярус",elevationMeters:0,screenOffsetY:0,bounds:{x:0,y:0,width:1,height:1},blocked:[]}],transitions:[],occluders:[]});
export function ThreeDSettings({scene,assets}:{scene:SceneDto;assets:AssetDto[]}) {
  const [geometry,setGeometry]=useState(()=>fresh(scene)),[spec,setSpec]=useState<Map3dSpec|null>(()=>scene.grid.threeD?structuredClone(scene.grid.threeD):null);
  const [floorId,setFloorId]=useState(geometry.floors[0]!.id),[asset,setAsset]=useState<AssetDto|undefined>(()=>assets.find(a=>a.id===scene.mapAssetId));
  const [pixels,setPixels]=useState(64),[threshold,setThreshold]=useState(160),[mode,setMode]=useState<Map3dCell["kind"]>("WALL"),[modelId,setModelId]=useState("");
  const [doorAxis,setDoorAxis]=useState<"X"|"Y">("X");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[warnings,setWarnings]=useState<string[]>([]),[preview,setPreview]=useState(false),[gpuError,setGpuError]=useState(false),[dirty,setDirty]=useState(false),[revision,setRevision]=useState(scene.revision??0);
  const alive=useRef(true),pending=useRef(false),controller=useRef<AbortController|null>(null),uploadKeys=useRef(new Map<string,string>()),downloads=useRef(new Set<string>());
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();for(const url of downloads.current)URL.revokeObjectURL(url);};},[]);
  const floor=geometry.floors.find(f=>f.id===floorId)??geometry.floors[0]!;
  const gridAsset=assets.find(a=>a.id===asset?.id)??asset;
  const floorSource=spec?.sources?.find(s=>s.floorId===floor.id);
  const renderedGeometry=useMemo(()=>{if(!spec)return geometry;try{return map3dMovementGeometry(geometry,spec);}catch{return geometry;}},[geometry,spec]);
  const cells=spec?.cells.filter(c=>c.floorId===floor.id)??[];
  const update=(next:Map3dSpec)=>{setSpec({...next,reviewed:false});setDirty(true);setError("");};
  const analyze=async(selected=gridAsset)=>{
    if(!selected)throw Error("Выберите карту");
    const oldSource=spec?.sources?.find(s=>s.floorId===floor.id);
    if(oldSource&&oldSource.pixelsPerCell!==pixels&&spec?.cells.some(c=>c.floorId===floor.id&&c.manual))throw Error("Размер сетки изменит ручные правки. Сохраните прежний шаг или используйте новую сцену");
    controller.current?.abort();const abort=new AbortController();controller.current=abort;
    const proposal=await proposeMap3d(selected,pixels,threshold,floor.id,spec?.cells??[],abort.signal);
    if(!alive.current||abort.signal.aborted)return;
    const next:Map3dSpec={version:1,reviewed:false,wallHeight:spec?.wallHeight??2.5,models:spec?.models??[],cells:[...(spec?.cells.filter(c=>c.floorId!==floor.id)??[]),...proposal.cells],sources:[...(spec?.sources?.filter(s=>s.floorId!==floor.id)??[]),proposal.source]};
    map3dSpecSchema.parse(next);
    setGeometry(g=>({...g,transform:{origin:{x:0,y:0},axisX:{x:scene.grid.size,y:0},axisY:{x:0,y:scene.grid.size}},floors:g.floors.map(f=>f.id===floor.id?{...f,bounds:{x:0,y:0,width:proposal.columns,height:proposal.rows}}:f)}));
    setAsset(selected);update(next);setWarnings(proposal.warnings);setPreview(false);
  };
  const perform=async(action:()=>Promise<void>)=>{if(pending.current)return;pending.current=true;setBusy(true);setError("");try{await action();}catch(e){if(alive.current)setError(e instanceof Error&&e.message.startsWith("GLB_")?"Поддерживается ограниченная GLB 2 геометрия: треугольники, без внешних файлов, текстур, анимации и расширений.":e instanceof Error&&e.name==="ZodError"?"Превышены лимиты модели или карты. Уменьшите детализацию.":formatApiError(e));}finally{pending.current=false;if(alive.current)setBusy(false);}};
  const save=async(plan:Map3dSpec,geo:IsometricSceneGeometry,base=revision)=>{
    if(!plan.reviewed)throw Error("Подтвердите просмотр планировки перед сохранением");
    const parsed=map3dSpecSchema.parse(plan),canonical=map3dMovementGeometry(geo,parsed);
    await api(`/api/scenes/${scene.id}/isometric`,{method:"PUT",body:JSON.stringify({actionId:crypto.randomUUID(),revision:base,projection:"THREE_D",geometry:canonical,threeD:parsed,...(asset?{mapAssetId:asset.id}:{})})});
    if(alive.current){setRevision(base+1);setDirty(false);setGeometry(canonical);setSpec(parsed);}
  };
  const download=(blob:Blob,name:string)=>{const url=URL.createObjectURL(blob);downloads.current.add(url);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>{URL.revokeObjectURL(url);downloads.current.delete(url);},30000);};
  return <details className="grid-settings"><summary>3D-карта из изображения</summary><div style={{width:"min(92vw,900px)",maxHeight:"85vh",overflow:"auto",padding:12,background:"var(--surface)"}}>
    <p>Клеточный черновик для карты строго сверху. Проверьте стены и двери по исходному изображению; тени и мебель могут распознаться неверно. Изометрические арты этим способом не восстанавливаются.</p>
    <fieldset disabled={busy} style={{border:0,padding:0}}>
      <label>Импорт черновика JSON <input type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value="";if(!file)return;void perform(async()=>{if(file.size>8*1024*1024)throw Error("Черновик должен быть до 8 МБ");const raw=JSON.parse(await file.text()),plan=map3dSpecSchema.parse(raw.threeD),geo=isometricSceneGeometrySchema.parse(raw.geometry);const canonical=isometricSceneGeometrySchema.parse(map3dMovementGeometry(geo,plan));if(!alive.current)return;setGeometry(canonical);setFloorId(canonical.floors[0]!.id);setAsset(undefined);update(plan);setWarnings(["Импортирован частный черновик. Проверьте масштаб и двери перед включением 3D; исходное изображение автоматически не публикуется."]);});}}/></label>
      <label>Карта <select value={asset?.id??""} onChange={e=>setAsset(assets.find(a=>a.id===e.target.value))}><option value="">Выбрать MAP</option>{assets.filter(a=>a.kind==="MAP").map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Загрузить PNG/JPEG <input type="file" accept="image/png,image/jpeg" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value="";if(!file)return;void perform(async()=>{const hash=await preflightMap3dImage(file);if(!alive.current)return;const id=uploadKeys.current.get(hash)??crypto.randomUUID();uploadKeys.current.set(hash,id);const form=new FormData();form.append("file",file);const uploaded=await api<AssetDto>("/api/assets?kind=MAP",{method:"POST",headers:{"x-action-id":id},body:form});if(!alive.current)return;setAsset(uploaded);await analyze(uploaded);});}} /></label>
      <label>Ярус <select value={floor.id} onChange={e=>setFloorId(e.target.value)}>{geometry.floors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <label>Пикселей в клетке <input type="number" value={pixels} min={8} max={512} onChange={e=>setPixels(Math.max(8,Math.min(512,Number(e.target.value)||8)))}/></label>
      <label>Порог тёмных стен <input type="range" value={threshold} min={0} max={255} onChange={e=>setThreshold(Number(e.target.value))}/></label>
      <label>Метров в клетке <input type="number" value={geometry.metersPerCell} min={.1} max={100} step={.1} onChange={e=>{setGeometry(g=>({...g,metersPerCell:Math.max(.1,Math.min(100,Number(e.target.value)||.1))}));if(spec)update(spec);}}/></label>
      <button onClick={()=>void perform(()=>analyze())}>Распознать / обновить черновик</button>
      {spec&&<>
        <label>Высота стен, м <input type="number" value={spec.wallHeight} min={.5} max={10} step={.1} onChange={e=>update({...spec,wallHeight:Math.max(.5,Math.min(10,Number(e.target.value)||.5))})}/></label>
        <label>Исправление клетки <select value={mode} onChange={e=>setMode(e.target.value as Map3dCell["kind"])}><option value="FLOOR">Пол</option><option value="WALL">Стена</option><option value="DOOR">Дверь (закрыта)</option><option value="PROP">Декорация</option><option value="VOID">Вне карты</option></select></label>
        <label>Модель декорации <select value={modelId} onChange={e=>setModelId(e.target.value)}><option value="">Базовый ящик</option>{spec.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Ось двери <select value={doorAxis} onChange={e=>setDoorAxis(e.target.value as "X"|"Y")}><option value="X">Вдоль X</option><option value="Y">Вдоль Y</option></select></label>
        <label>GLB геометрия <input type="file" accept=".glb" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value="";if(!file)return;void perform(async()=>{if(file.size>8*1024*1024)throw Error("GLB должен быть до 8 МБ");const positions=importMap3dGlb(await file.arrayBuffer());if(!alive.current)return;const model={id:crypto.randomUUID(),name:file.name.slice(0,80)||"Модель",positions};const next={...spec,models:[...spec.models,model]};map3dSpecSchema.parse(next);update(next);setModelId(model.id);});}}/></label>
        <p>Нажмите клетку для исправления. Shift + клик по двери переключает открыто/закрыто. Ручные клетки сохраняются при повторном распознавании на той же сетке.</p>
        <svg width="100%" height={360} viewBox={`${floor.bounds.x} ${floor.bounds.y} ${floor.bounds.width} ${floor.bounds.height}`} style={{background:"#171717",touchAction:"none"}} aria-label="Редактор распознанной планировки" onPointerDown={e=>{const m=e.currentTarget.getScreenCTM();if(!m)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse()),x=Math.floor(p.x),y=Math.floor(p.y);update({...spec,cells:spec.cells.map(c=>c.floorId===floor.id&&c.x===x&&c.y===y?{floorId:c.floorId,x,y,kind:e.shiftKey&&c.kind==="DOOR"?"DOOR":mode,open:e.shiftKey&&c.kind==="DOOR"?!c.open:false,axis:e.shiftKey&&c.kind==="DOOR"?c.axis:doorAxis,manual:true,uncertain:false,...(mode==="PROP"&&modelId?{modelId}:{})}:c)});}}>
          {floorSource&&<image href={`/api/assets/${encodeURIComponent(floorSource.assetId)}/content`} x={0} y={0} width={floorSource.width/floorSource.pixelsPerCell} height={floorSource.height/floorSource.pixelsPerCell}/>}
          {cells.map(c=><rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={1} height={1} fill={c.kind==="WALL"?"#e9c27eaa":c.kind==="DOOR"?c.open?"#77ddaa99":"#ed777799":c.kind==="PROP"?"#b28ff099":c.kind==="VOID"?"#000e":"#ffffff11"} stroke={c.uncertain?"#ffb547":"#fff4"} strokeWidth={.03}/>)}
        </svg>
        {warnings.map(w=><p key={w}>{w}</p>)}
        <label><input type="checkbox" checked={spec.reviewed} onChange={e=>{setSpec({...spec,reviewed:e.target.checked});setDirty(true);}}/>Планировка, двери и масштаб просмотрены; понимаю ограничения распознавания</label>
        <button onClick={()=>{setGpuError(false);setPreview(v=>!v);}}>Предпросмотр 3D</button>
        <button disabled={!spec.reviewed} onClick={()=>void perform(()=>save(spec,renderedGeometry))}>Сохранить и включить 3D</button>
        <button onClick={()=>download(new Blob([JSON.stringify({geometry:renderedGeometry,threeD:spec},null,2)],{type:"application/json"}),"arken-map-private.json")}>Экспорт JSON (для мастера)</button>
        <button onClick={()=>{try{download(exportMap3dGlb(buildMap3dMesh(spec,renderedGeometry)),"arken-map-private.glb");}catch(e){setError(formatApiError(e));}}}>Экспорт GLB</button>
        {preview&&<div style={{height:360}}>{gpuError?<p role="status">3D недоступно. Планировку можно исправить в 2D.</p>:<Map3dViewport spec={spec} geometry={renderedGeometry} floorId={floor.id} grid={scene.grid} onUnavailable={()=>setGpuError(true)}/>}</div>}
      </>}
      {dirty&&(scene.revision??0)!==revision&&<p role="alert">Сцена изменена другим действием. Сохранение отклонит конфликт; обновите черновик.</p>}
      <button onClick={()=>{setGeometry(fresh(scene));setSpec(scene.grid.threeD?structuredClone(scene.grid.threeD):null);setRevision(scene.revision??0);setDirty(false);setError("");}}>Обновить черновик из сцены</button>
      {error&&<p role="alert">{error}</p>}
    </fieldset>
    {scene.grid.threeD&&<IsometricSettings key={`${scene.id}:${scene.revision}`} scene={scene} assets={assets} onSaveGeometry={async(g,r)=>{const updated=map3dApplyFloorEdits(scene.grid.threeD!,g);await save({...updated,reviewed:true},g,r);}}/>}
  </div></details>;
}
