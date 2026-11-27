import { useEffect, useRef, useState } from "react";
import { isometricSceneGeometrySchema, projectIsometricPoint, unprojectIsometricPoint,
  type IsometricSceneGeometry, type IsometricPoint, type AssetDto, type SceneDto } from "@arken/contracts";
import { api, formatApiError } from "../api";

function initial(scene: SceneDto): IsometricSceneGeometry {
  return structuredClone(scene.grid.isometric ?? {
    version: 1, transform: { origin: { x: scene.width / 2, y: 40 }, axisX: { x: 32, y: 16 }, axisY: { x: -32, y: 16 } },
    metersPerCell: scene.grid.metersPerCell ?? 1.5,
    floors: [{ id: crypto.randomUUID(), name: "Основной ярус", elevationMeters: 0, screenOffsetY: 0,
      bounds: { x: 0, y: 0, width: Math.ceil(scene.width / scene.grid.size), height: Math.ceil(scene.height / scene.grid.size) }, blocked: [] }],
    transitions: [], occluders: [],
  });
}
type Mode = "origin" | "axisX" | "axisY" | "block" | "stairs" | "occluder" | "baseline";
export function IsometricSettings({ scene, assets = [], onSaveGeometry }: { scene: SceneDto; assets?: AssetDto[]; onSaveGeometry?:(geometry:IsometricSceneGeometry,revision:number)=>Promise<void> }) {
  const [draft, setDraft] = useState(() => initial(scene));
  const [selected, setSelected] = useState(draft.floors[0]!.id);
  const [mode, setMode] = useState<Mode>("block");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [baseRevision, setBaseRevision] = useState(scene.revision ?? 0);
  const dirtyRef = useRef(false), alive = useRef(true);
  const [stairStart, setStairStart] = useState<{ x: number; y: number; floorId: string } | null>(null);
  const [polygon, setPolygon] = useState<IsometricPoint[]>([]);
  const [occluderId, setOccluderId] = useState<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if ((scene.revision ?? 0) === baseRevision) return;
    if (dirtyRef.current) { setError("Сцена изменена. Сохранение проверит конфликт; обновите черновик перед повторной правкой."); return; }
    const next = initial(scene); setDraft(next); setSelected(id => next.floors.some(f => f.id === id) ? id : next.floors[0]!.id); setBaseRevision(scene.revision ?? 0);
  }, [scene.revision]);
  const floor = draft.floors.find(f => f.id === selected) ?? draft.floors[0]!;
  const change = (next: IsometricSceneGeometry) => { dirtyRef.current = true; setDraft(next); setError(""); };
  const updateFloor = (patch: Partial<typeof floor>) => change({ ...draft, floors: draft.floors.map(f => f.id === floor.id ? { ...f, ...patch } : f) });
  const project = (x: number, y: number) => projectIsometricPoint(draft.transform, { x, y }, floor.screenOffsetY);
  const polygonPoints = (x: number, y: number, w: number, h: number) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([a,b]) => { const p = project(a!, b!); return `${p.x},${p.y}`; }).join(" ");
  const numberField = (label: string, value: number, onChange: (n: number) => void, min: number, max: number, step = 1) => <label style={{ display: "inline-block", margin: 4 }}>{label} <input type="number" value={value} min={min} max={max} step={step} style={{ width: 80 }} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n))); }} /></label>;
  const background = assets.find(asset => asset.id === scene.mapAssetId)?.url;
  return <details className="grid-settings"><summary>{onSaveGeometry?"Геометрия ярусов и лестницы 3D":"Изометрия и ярусы"}</summary><div style={{ width: "min(88vw, 820px)", maxHeight: "80vh", overflow: "auto", padding: 12, background: "var(--surface, #25221e)" }}>
    <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
      <p>Выберите инструмент и укажите точки прямо на карте. Новая проекция включается на пустой сцене. Размер клетки в метрах задаётся вручную.</p>
      <label>Редактируемый ярус <select value={floor.id} onChange={e => { setSelected(e.target.value); setPolygon([]); setOccluderId(null); }}>{draft.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <button disabled={draft.floors.length >= 16} onClick={() => {
        const next = { ...structuredClone(floor), id: crypto.randomUUID(), name: `Ярус ${draft.floors.length + 1}`, elevationMeters: Math.min(10000, floor.elevationMeters + 3), screenOffsetY: Math.max(-100000, floor.screenOffsetY - 80), blocked: [] };
        change({ ...draft, floors: [...draft.floors, next] }); setSelected(next.id); setPolygon([]); setOccluderId(null);
      }}>Добавить ярус</button>
      <button disabled={floor.id === draft.floors[0]!.id} onClick={() => {
        change({ ...draft, floors: draft.floors.filter(f => f.id !== floor.id),
          publishedFloorId: draft.publishedFloorId === floor.id ? draft.floors[0]!.id : draft.publishedFloorId,
          transitions: draft.transitions.filter(t => t.from.floorId !== floor.id && t.to.floorId !== floor.id), occluders: draft.occluders.filter(o => o.floorId !== floor.id) });
        setSelected(draft.floors[0]!.id); setStairStart(null); setPolygon([]); setOccluderId(null);
      }}>Удалить пустой ярус</button>
      <div><label>Название <input value={floor.name} maxLength={80} onChange={e => updateFloor({ name: e.target.value })} /></label>
        {numberField("Высота, м", floor.elevationMeters, n => updateFloor({ elevationMeters: n }), -10000, 10000, .1)}
        {numberField("Смещение по экрану", floor.screenOffsetY, n => updateFloor({ screenOffsetY: n }), -100000, 100000)}
        {numberField("Метров в клетке", draft.metersPerCell, n => change({ ...draft, metersPerCell: n }), .01, 1000000, .1)}
      </div>
      <div>{numberField("Начало X", floor.bounds.x, n => updateFloor({ bounds: { ...floor.bounds, x: Math.round(n) } }), -10000, 10000)}
        {numberField("Начало Y", floor.bounds.y, n => updateFloor({ bounds: { ...floor.bounds, y: Math.round(n) } }), -10000, 10000)}
        {numberField("Ширина, клеток", floor.bounds.width, n => updateFloor({ bounds: { ...floor.bounds, width: Math.round(n) } }), 1, 1024)}
        {numberField("Глубина, клеток", floor.bounds.height, n => updateFloor({ bounds: { ...floor.bounds, height: Math.round(n) } }), 1, 1024)}</div>
      <label>Опубликованный ярус <select value={draft.publishedFloorId ?? draft.floors[0]!.id} onChange={e => change({ ...draft, publishedFloorId: e.target.value })}>{draft.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <button onClick={() => updateFloor({ blocked: [] })}>Очистить проходимость яруса</button>
      <div>{([['origin','Начало сетки'],['axisX','Шаг по X'],['axisY','Шаг по Y'],['block','Проходимость'],['stairs','Лестница'],['occluder','Передний полигон'],['baseline','Линия основания']] as const).map(([id,label]) => <button key={id} aria-pressed={mode === id} onClick={() => { setMode(id); setPolygon([]); if (id !== "stairs") setStairStart(null); }}>{label}</button>)}</div>
      <p>{mode === "stairs" ? stairStart ? "Начало выбрано. Переключите ярус и нажмите конечную клетку лестницы." : "Нажмите начальную клетку лестницы." : mode === "origin" ? "Нажмите начало логической сетки (0,0)." : mode === "axisX" || mode === "axisY" ? "Нажмите соседний узел сетки на расстоянии одной клетки от начала по выбранной оси." : mode === "block" ? "Нажмите клетку, чтобы закрыть или открыть проход." : mode === "baseline" ? "Выберите полигон ниже и нажмите высоту его основания на изображении." : "Обведите кликами переднюю часть здания и завершите полигон."}</p>
      <svg width="100%" height={330} viewBox={`0 0 ${scene.width} ${scene.height}`} style={{ background: "#211f1b", touchAction: "none" }} aria-label="Графический редактор изометрии" onPointerDown={event => {
        const matrix = event.currentTarget.getScreenCTM(); if (!matrix) return;
        const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        if (mode === "origin") { change({ ...draft, transform: { ...draft.transform, origin: { x: p.x, y: p.y - floor.screenOffsetY } } }); return; }
        if (mode === "axisX" || mode === "axisY") { change({ ...draft, transform: { ...draft.transform, [mode]: { x: p.x - draft.transform.origin.x, y: p.y - floor.screenOffsetY - draft.transform.origin.y } } }); return; }
        if (mode === "occluder") { if (polygon.length < 64) setPolygon([...polygon, { x: p.x, y: p.y }]); return; }
        if (mode === "baseline") { if (occluderId) change({ ...draft, occluders: draft.occluders.map(o => o.id === occluderId ? { ...o, baselineY: p.y } : o) }); return; }
        let point: IsometricPoint;
        try { point = unprojectIsometricPoint(draft.transform, p, floor.screenOffsetY); } catch { setError("Сначала задайте две независимые оси сетки"); return; }
        const cell = { x: Math.floor(point.x), y: Math.floor(point.y) };
        if (cell.x < floor.bounds.x || cell.y < floor.bounds.y || cell.x >= floor.bounds.x + floor.bounds.width || cell.y >= floor.bounds.y + floor.bounds.height) { setError("Выберите клетку внутри границ яруса"); return; }
        const blocked = floor.blocked.some(c => c.x === cell.x && c.y === cell.y);
        if (mode === "block") { if (blocked) updateFloor({ blocked: floor.blocked.filter(c => c.x !== cell.x || c.y !== cell.y) }); else if (floor.blocked.length < 16384) updateFloor({ blocked: [...floor.blocked, cell] }); return; }
        if (blocked) { setError("Лестница должна находиться в проходимой клетке"); return; }
        if (!stairStart) setStairStart({ ...cell, floorId: floor.id });
        else if (stairStart.floorId === floor.id) setError("Выберите другой ярус для конца лестницы");
        else if (draft.transitions.length < 512) { change({ ...draft, transitions: [...draft.transitions, { id: crypto.randomUUID(), from: stairStart, to: { ...cell, floorId: floor.id }, bidirectional: true }] }); setStairStart(null); }
        else setError("Достигнут предел лестниц сцены");
      }}>
        {background && <image href={background} x={scene.backgroundFrame.x} y={scene.backgroundFrame.y} width={scene.backgroundFrame.width} height={scene.backgroundFrame.height} />}
        <polygon points={polygonPoints(floor.bounds.x, floor.bounds.y, floor.bounds.width, floor.bounds.height)} fill="#dfc99822" stroke="#dfc998" />
        {Array.from({ length: floor.bounds.width + 1 }, (_, i) => { const a = project(floor.bounds.x+i,floor.bounds.y), b = project(floor.bounds.x+i,floor.bounds.y+floor.bounds.height); return <line key={`x${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#dfc99888" />; })}
        {Array.from({ length: floor.bounds.height + 1 }, (_, i) => { const a = project(floor.bounds.x,floor.bounds.y+i), b = project(floor.bounds.x+floor.bounds.width,floor.bounds.y+i); return <line key={`y${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#dfc99888" />; })}
        {floor.blocked.map(c => <polygon key={`${c.x},${c.y}`} points={polygonPoints(c.x,c.y,1,1)} fill="#e35e5e99" stroke="#d33" />)}
        {draft.occluders.filter(o => o.floorId === floor.id).map(o => <g key={o.id}><polygon points={o.polygon.map(p => `${p.x},${p.y}`).join(" ")} fill="#6498c955" stroke="#92ceef" /><line x1={0} x2={scene.width} y1={o.baselineY} y2={o.baselineY} stroke="#92ceef" strokeDasharray="8 8" /></g>)}
        {polygon.length > 0 && <polyline points={polygon.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#ffc578" strokeWidth={3} />}
        {draft.transitions.flatMap(t => [t.from,t.to].filter(p => p.floorId === floor.id).map((p,i) => { const a = project(p.x+.5,p.y+.5); return <g key={`${t.id}-${i}`}><rect x={a.x-8} y={a.y-8} width={16} height={16} fill="#8cdec6" /><text x={a.x+12} y={a.y} fill="white" fontSize={18}>Лестница</text></g>; }))}
      </svg>
      {mode === "occluder" && <button disabled={polygon.length < 3 || draft.occluders.length >= 512} onClick={() => { const id = crypto.randomUUID(); change({ ...draft, occluders: [...draft.occluders, { id, floorId: floor.id, polygon, baselineY: Math.max(...polygon.map(p => p.y)) }] }); setOccluderId(id); setPolygon([]); }}>Завершить полигон</button>}
      {draft.occluders.filter(o => o.floorId === floor.id).map((o,i) => <div key={o.id}><button aria-pressed={occluderId === o.id} onClick={() => { setOccluderId(o.id); setMode("baseline"); }}>Основание полигона {i+1}</button><button onClick={() => change({ ...draft, occluders: draft.occluders.filter(p => p.id !== o.id) })}>Удалить полигон {i+1}</button></div>)}
      {draft.transitions.map((t,i) => <div key={t.id}>Лестница {i+1}: из «{draft.floors.find(f => f.id === t.from.floorId)?.name}» в «{draft.floors.find(f => f.id === t.to.floorId)?.name}» <button onClick={() => change({ ...draft, transitions: draft.transitions.filter(p => p.id !== t.id) })}>Удалить лестницу</button></div>)}
      {error && <p role="alert">{error}</p>}
      <button onClick={async () => {
        const parsed = isometricSceneGeometrySchema.safeParse(draft);
        if (!parsed.success) { setError("Проверьте калибровку, границы, проходимость и концы лестниц"); return; }
        setSaving(true); setError("");
        try { if(onSaveGeometry)await onSaveGeometry(parsed.data,baseRevision);else await api(`/api/scenes/${scene.id}/isometric`, { method: "PUT", body: JSON.stringify({ actionId: crypto.randomUUID(), revision: baseRevision, geometry: parsed.data }) }); if (alive.current) { dirtyRef.current = false; setBaseRevision(baseRevision + 1); setError(""); } }
        catch (e) { if (alive.current) setError(formatApiError(e)); }
        finally { if (alive.current) setSaving(false); }
      }}>{onSaveGeometry?"Сохранить ярусы 3D":"Сохранить изометрию"}</button>
      <button onClick={() => { const next = initial(scene); setDraft(next); setSelected(next.floors[0]!.id); setBaseRevision(scene.revision ?? 0); dirtyRef.current = false; setStairStart(null); setPolygon([]); setOccluderId(null); setError(""); }}>Обновить черновик</button>
    </fieldset>
  </div></details>;
}
