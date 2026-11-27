import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { projectIsometricPoint, unprojectIsometricPoint, resolveTokenSpriteFrame, validateIsometricMove, isometricFloorId, isometricPublishedFloor, type TokenDto, type FogGeometry } from "@arken/contracts";
import { api, formatApiError } from "../api";
import type { SceneRendererProps } from "./SceneRenderer";
import { Orthographic2DRenderer } from "./Orthographic2DRenderer";
import { isometricDirectionalStep } from "./isometric-camera";
import { shouldIgnoreGlobalShortcut } from "../input-diagnostics";
import { stampImageUrl } from "./stamp-image-url";
import { ThreeDSceneRenderer } from "./ThreeDSceneRenderer";

/** Explicit renderer branch: orthographic stages never receive a matrix. */
export function SceneMapRenderer(props: SceneRendererProps) {
  if(props.readOnly)props={...props,socket:null,tool:"PAN"};
  if(props.scene.projection==="THREE_D"&&props.scene.grid.threeD&&props.scene.grid.isometric)
    return <ThreeDSceneRenderer key={props.scene.id} {...props} fallback={levelView=><IsometricSceneRenderer {...props} levelView={levelView}/>} />;
  return props.scene.projection === "ISOMETRIC" && props.scene.grid.isometric
    ? <IsometricSceneRenderer key={props.scene.id} {...props} /> : <Orthographic2DRenderer {...props} />;
}

function FogShape({ geometry, color }: { geometry: FogGeometry; color: string }) {
  if (geometry.type === "RECT") return <rect x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} fill={color} />;
  if (geometry.type === "CIRCLE") return <circle cx={geometry.center.x} cy={geometry.center.y} r={geometry.radius} fill={color} />;
  if (geometry.type === "POLYGON") return <polygon points={geometry.points.map(p => `${p.x},${p.y}`).join(" ")} fill={color} />;
  return <g><polyline points={geometry.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={color} strokeWidth={geometry.radius * 2} strokeLinecap="round" strokeLinejoin="round" />
    {geometry.points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={geometry.radius} fill={color} />)}</g>;
}

function IsometricSceneRenderer(props: SceneRendererProps) {
  const policy = props.scene.grid.isometric!;
  const [viewedFloorId, setViewedFloorId] = useState(isometricPublishedFloor(policy));
  const changeFloor = props.levelView?.onChange ?? setViewedFloorId;
  const floor = policy.floors.find(f => f.id === (props.role === "GM" ? props.levelView?.id ?? viewedFloorId : isometricPublishedFloor(policy))) ?? policy.floors[0]!;
  const onFloor = (levelId: string | null | undefined) => levelId ? levelId === floor.id
    : props.role === "PLAYER" ? floor.legacyNullLevel === true : floor.id === policy.floors[0]!.id;
  const tokens = props.tokens.filter(token => onFloor(token.levelId));
  const drawings = props.drawings.filter(d => onFloor(d.levelId));
  const floorFog = props.fogReveals.filter(f => onFloor(f.levelId));
  const grid = props.scene.grid;
  const transform = policy.transform;
  const svgRef = useRef<SVGSVGElement>(null);
  const prefix = useId().replace(/:/g, "");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const lastPreviewRef = useRef(0);
  const pendingRef = useRef<{ actionId: string; tokenId: string; revision: number; targetFloorId: string } | null>(null);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; if (timerRef.current !== null) clearTimeout(timerRef.current); }; }, []);
  const [camera, setCamera] = useState({ x: 0, y: 0, width: props.scene.width, height: props.scene.height });
  const gesture = useRef<{ id: number; kind: "token" | "draw" | "fog" | "fog-brush" | "texture" | "pan"; token?: TokenDto; points: number[]; start: { x: number; y: number }; camera: typeof camera } | null>(null);
  const [draft, setDraft] = useState<number[]>([]);
  const [tokenGhost, setTokenGhost] = useState<{ x: number; y: number } | null>(null);
  const [ruler, setRuler] = useState<{ x: number; y: number }[]>([]);
  const [localPing, setLocalPing] = useState<{ x: number; y: number } | null>(null);
  const [fogPolygon, setFogPolygon] = useState<{ x: number; y: number }[]>([]);
  useEffect(() => { setFogPolygon([]); gesture.current = null; setDraft([]); setTokenGhost(null); }, [floor.id, props.tool, props.paused]);
  useEffect(() => { setSelected(null); props.onSelectionChange?.([]); setRuler([]); setLocalPing(null); setDraft([]); gesture.current = null; }, [floor.id]);
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const current = props.tokens.find(token => token.id === pending.tokenId);
    if (!current || current.revision !== pending.revision) {
      if (props.role === "GM" && current && current.revision > pending.revision && isometricFloorId(policy, current.levelId) === pending.targetFloorId)
        changeFloor(pending.targetFloorId);
      pendingRef.current = null; busyRef.current = false; setBusy(false);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [props.tokens]);
  const foot = (token: TokenDto) => ({ x: (token.x + token.width / 2 - grid.offsetX) / grid.size, y: (token.y + token.height - grid.offsetY) / grid.size });
  const project = (x: number, y: number) => projectIsometricPoint(transform, { x: (x - grid.offsetX) / grid.size, y: (y - grid.offsetY) / grid.size }, floor.screenOffsetY);
  const screenFoot = (token: TokenDto) => project(token.x + token.width / 2, token.y + token.height);
  const points = (values: number[]) => {
    const output: string[] = [];
    for (let i = 0; i + 1 < values.length; i += 2) { const p = project(values[i]!, values[i + 1]!); output.push(`${p.x},${p.y}`); }
    return output.join(" ");
  };
  const canMove = (token: TokenDto) => !props.readOnly && !props.paused && !token.locked && (props.role === "GM" || token.controllerMembershipIds.includes(props.membershipId) || token.ownerMembershipId === props.membershipId);
  const pointer = (event: { clientX: number; clientY: number }) => {
    const matrix = svgRef.current?.getScreenCTM(); if (!matrix) return null;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  };
  const logical = (point: { x: number; y: number }) => {
    const p = unprojectIsometricPoint(transform, point, floor.screenOffsetY);
    return { x: p.x * grid.size + grid.offsetX, y: p.y * grid.size + grid.offsetY };
  };
  const publishSelection = (id: string | null) => { setSelected(id); props.onSelectionChange?.(id ? [id] : []); };
  const sendMove = (token: TokenDto, x: number, y: number, levelId = token.levelId) => {
    if (!canMove(token) || busyRef.current || !props.socket?.connected) return;
    const from = { ...foot(token), floorId: isometricFloorId(policy, token.levelId) };
    const to = { x: (x + token.width / 2 - grid.offsetX) / grid.size, y: (y + token.height - grid.offsetY) / grid.size, floorId: isometricFloorId(policy, levelId) };
    // The server is authoritative. Local geometry is only an early hint.
    if (props.role === "GM" && !validateIsometricMove(policy, from, to).allowed) { setError("Проход закрыт"); return; }
    busyRef.current = true; setBusy(true); setError("");
    const socket = props.socket;
    const actionId = crypto.randomUUID();
    pendingRef.current = { actionId, tokenId: token.id, revision: token.revision, targetFloorId: to.floorId };
    const timeout = window.setTimeout(() => { if (!aliveRef.current || pendingRef.current?.actionId !== actionId) return; setError("Подтверждение хода задерживается. Дождитесь обновления сцены."); }, 15000);
    timerRef.current = timeout;
    socket.emit("token:moved", { actionId, tokenId: token.id, revision: token.revision,
      x, y, z: token.z, levelId }, ack => {
      clearTimeout(timeout);
      if (!aliveRef.current || pendingRef.current?.actionId !== actionId) return;
      pendingRef.current = null; busyRef.current = false;
      timerRef.current = null;
      setBusy(false);
      if (!ack.ok) setError("Ход отклонён. Выберите токен после обновления сцены.");
      else if (to.floorId !== from.floorId) changeFloor(to.floorId);
    });
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcut(event) || event.repeat || props.tool !== "PAN") return;
      const direction = ({ w: "up", a: "left", s: "down", d: "right" } as const)[event.key.toLowerCase() as "w"];
      const token = tokens.find(t => t.id === selected);
      if (!direction || !token || !canMove(token)) return;
      event.preventDefault(); const step = isometricDirectionalStep(transform, direction);
      sendMove(token, token.x + step.x * grid.size, token.y + step.y * grid.size);
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  });
  const asset = (id: string | null | undefined) => props.assets.find(item => item.id === id)?.url;
  const background = asset(props.scene.mapAssetId);
  const fitCurrentFloor = () => {
    const b = floor.bounds;
    const corners = [[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]]
      .map(([x,y]) => projectIsometricPoint(transform, { x: x!, y: y! }, floor.screenOffsetY));
    const left = Math.min(0,...corners.map(p => p.x))-24, top = Math.min(0,...corners.map(p => p.y))-24;
    setCamera({ x: left, y: top, width: Math.max(props.scene.width,...corners.map(p => p.x))-left+24,
      height: Math.max(props.scene.height,...corners.map(p => p.y))-top+24 });
  };
  useEffect(() => { fitCurrentFloor(); }, [floor.id]);
  const { axisX: a, axisY: b, origin } = transform;
  const matrix = `matrix(${a.x / grid.size} ${a.y / grid.size} ${b.x / grid.size} ${b.y / grid.size} ${origin.x - a.x * grid.offsetX / grid.size - b.x * grid.offsetY / grid.size} ${origin.y + floor.screenOffsetY - a.y * grid.offsetX / grid.size - b.y * grid.offsetY / grid.size})`;
  const fog = [...floorFog].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const layers = [
    ...tokens.map(token => ({ kind: "token" as const, id: token.id, depth: screenFoot(token).y, token })),
    ...policy.occluders.filter(o => o.floorId === floor.id).map(occluder => ({ kind: "occluder" as const, id: occluder.id, depth: occluder.baselineY, occluder })),
  ].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  const finish = async (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = gesture.current; gesture.current = null; setDraft([]); setTokenGhost(null);
    if (!current) return;
    const p = pointer(event); if (!p || props.paused) return;
    const end = logical(p);
    if (current.kind === "token" && current.token) {
      const cell = { x: Math.floor((end.x - grid.offsetX) / grid.size) + .5, y: Math.floor((end.y - grid.offsetY) / grid.size) + .5 };
      sendMove(current.token, cell.x * grid.size + grid.offsetX - current.token.width / 2, cell.y * grid.size + grid.offsetY - current.token.height);
    } else if (current.kind === "draw" && current.points.length >= 4) {
      try { await props.onDrawingCreate({ levelId: floor.id, points: current.points, color: "#e8c979", strokeWidth: 3 }); } catch { setError("Рисунок отклонён"); }
    } else if (current.kind === "texture" && props.stampTool?.texture && props.onStampCreate) {
      const stamp = props.stampTool;
      try { await props.onStampCreate({ kind: "TEXTURE", levelId: floor.id, packId: stamp.texture!.packId,
        assetKey: stamp.texture!.assetKey, size: stamp.tileSize, brushWidth: stamp.brushWidth,
        points: current.points, x: 0, y: 0, layer: stamp.layer }); } catch { setError("Текстура отклонена"); }
    } else if (current.kind === "fog-brush") {
      const vertices = []; for (let i = 0; i + 1 < current.points.length; i += 2) vertices.push({ x: current.points[i]!, y: current.points[i+1]! });
      try { await props.onFogCreate({ levelId: floor.id, geometry: { type: "BRUSH", points: vertices, radius: Math.max(1, Math.min(512, props.fogBrushRadius ?? 64)) } }); } catch { setError("Изменение тумана отклонено"); }
    } else if (current.kind === "fog") {
      const start = logical(current.start);
      const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
      if (Math.abs(start.x - end.x) < 1 || Math.abs(start.y - end.y) < 1) return;
      try { await props.onFogCreate({ levelId: floor.id, x, y, width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) }); } catch { setError("Изменение тумана отклонено"); }
    }
  };
  return <div className="isometric-map" style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", zIndex: 2, background: "var(--surface, #25221e)", padding: 8 }}>
      <span>Изометрия · {floor.name} · {policy.metersPerCell} м/клетку</span>
      {props.role === "GM" && <>
        <label>Ярус <select value={floor.id} disabled={busy} onChange={e => changeFloor(e.target.value)}>{policy.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <button disabled={busy || props.paused} onClick={async () => { try { await api(`/api/scenes/${props.scene.id}/isometric`, { method: "PUT", body: JSON.stringify({ actionId: crypto.randomUUID(), revision: props.scene.revision ?? 0, geometry: { ...policy, publishedFloorId: floor.id }, ...(props.scene.projection==="THREE_D"?{projection:"THREE_D",threeD:props.scene.grid.threeD}:{}) }) }); } catch (e) { setError(formatApiError(e)); } }}>Показать этот ярус игрокам</button>
        {policy.transitions.flatMap(t => {
          const token = tokens.find(item => item.id === selected); if (!token) return [];
          const pos = foot(token), from = t.from.floorId === floor.id ? t.from : t.bidirectional && t.to.floorId === floor.id ? t.to : null;
          const to = from === t.from ? t.to : t.from;
          if (!from || Math.floor(pos.x) !== from.x || Math.floor(pos.y) !== from.y) return [];
          return [<button key={t.id} disabled={busy || props.paused || props.readOnly} onClick={() => sendMove(token, (to.x + .5) * grid.size + grid.offsetX - token.width / 2, (to.y + .5) * grid.size + grid.offsetY - token.height, to.floorId === policy.floors[0]!.id ? null : to.floorId)}>По лестнице: {policy.floors.find(f => f.id === to.floorId)?.name}</button>];
        })}
      </>}
      <button onClick={fitCurrentFloor}>Вписать карту</button>
      <button onClick={() => { setRuler([]); }}>Очистить линейку</button>
      {fogPolygon.length > 0 && <button disabled={props.paused || fogPolygon.length < 3} onClick={async () => { try { await props.onFogCreate({ levelId: floor.id, geometry: { type: "POLYGON", points: fogPolygon } }); setFogPolygon([]); } catch { setError("Изменение тумана отклонено"); } }}>Завершить область тумана</button>}
      {busy && <span role="status">Сохраняю ход…</span>}{error && <span role="alert">{error}</span>}
      {busy && error && <button onClick={() => location.reload()}>Обновить сцену</button>}
      {ruler.length === 2 && <span> {Math.hypot(ruler[1]!.x - ruler[0]!.x, ruler[1]!.y - ruler[0]!.y) / grid.size * policy.metersPerCell} м</span>}
    </div>
    <svg ref={svgRef} width="100%" height="100%" viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`} style={{ touchAction: "none", background: "#211f1b" }} aria-label="Изометрическая сцена"
      onDragOver={event => { if (!props.paused && props.tool === "PAN" && event.dataTransfer.types.includes("application/x-arken-token-definition")) event.preventDefault(); }}
      onDrop={event => {
        if (props.paused || props.tool !== "PAN" || !props.onPlaceTokenDefinition) return;
        const id = event.dataTransfer.getData("application/x-arken-token-definition"), p = pointer(event);
        if (!id || !p) return; event.preventDefault();
        void props.onPlaceTokenDefinition(id, { ...logical(p), levelId: floor.id }).catch(() => setError("Размещение отклонено"));
      }}
      onWheel={event => { const factor = event.deltaY > 0 ? 1.1 : 1 / 1.1; setCamera(c => { const width = Math.max(100, Math.min(65536, c.width * factor)), height = width * c.height / c.width; return { x: c.x + (c.width - width) / 2, y: c.y + (c.height - height) / 2, width, height }; }); }}
      onPointerDown={event => {
        if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
        const p = pointer(event); if (!p) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (props.paused || event.button !== 0) { gesture.current = { id: event.pointerId, kind: "pan", points: [], start: p, camera }; return; }
        const end = logical(p);
        if (props.role === "GM" && props.tool === "STAMP" && props.stampTool && props.onStampCreate) {
          const stamp = props.stampTool;
          if (stamp.mode === "BRUSH") { if (!stamp.texture) { setError("Выберите текстуру"); return; } gesture.current = { id: event.pointerId, kind: "texture", points: [end.x,end.y], start: p, camera }; }
          else void props.onStampCreate({ kind: "STAMP", levelId: floor.id, packId: stamp.packId, assetKey: stamp.assetKey, size: stamp.size, rotation: stamp.rotation, layer: stamp.layer, x: end.x, y: end.y }).catch(() => setError("Штамп отклонён"));
          return;
        }
        if (props.role === "GM" && (props.tool === "FOG_POLYGON" || props.tool === "COVER_POLYGON")) { if (fogPolygon.length < 128) setFogPolygon([...fogPolygon, end]); return; }
        if (props.role === "GM" && (props.tool === "FOG_BRUSH" || props.tool === "COVER_BRUSH")) { gesture.current = { id: event.pointerId, kind: "fog-brush", points: [end.x, end.y], start: p, camera }; return; }
        if (props.tool === "RULER") { setRuler(current => current.length === 1 ? [...current, end] : [end]); return; }
        if (props.tool === "PING") { setLocalPing(end); return; }
        const id = (event.target as Element).closest("[data-token]")?.getAttribute("data-token");
        const token = tokens.find(t => t.id === id);
        if (token && props.tool === "PAN") { publishSelection(token.id); if (canMove(token)) gesture.current = { id: event.pointerId, kind: "token", token, points: [], start: p, camera }; return; }
        if (props.tool === "DRAW") { gesture.current = { id: event.pointerId, kind: "draw", points: [end.x, end.y], start: p, camera }; return; }
        if ((props.tool === "FOG" || props.tool === "COVER") && props.role === "GM") { gesture.current = { id: event.pointerId, kind: "fog", points: [], start: p, camera }; return; }
        if (props.tool !== "PAN") { setError("В изометрии выберите прямоугольный туман, свободный рисунок, линейку или перемещение"); return; }
        publishSelection(null); gesture.current = { id: event.pointerId, kind: "pan", points: [], start: p, camera };
      }}
      onPointerMove={event => {
        const current = gesture.current; const p = pointer(event); if (!current || !p || current.id !== event.pointerId) return;
        if (current.kind === "pan") { setCamera(c => ({ ...c, x: c.x + current.start.x - p.x, y: c.y + current.start.y - p.y })); return; }
        const end = logical(p);
        if (current.kind === "token" && current.token) {
          setTokenGhost(p);
          const now = performance.now(), token = current.token;
          if (props.socket?.connected && props.socket.previewEpoch && now - lastPreviewRef.current >= 50) {
            lastPreviewRef.current = now;
            props.socket.emit("token:moving", { actionId: crypto.randomUUID(), tokenId: token.id,
              sceneId: token.sceneId, revision: token.revision, x: end.x - token.width / 2, y: end.y - token.height,
              z: token.z, levelId: token.levelId, previewEpoch: props.socket.previewEpoch,
              snapshotVersion: props.socket.previewSnapshotVersion });
          }
        }
        if ((current.kind === "draw" || current.kind === "fog-brush" || current.kind === "texture") && current.points.length < 4096) { current.points.push(end.x, end.y); setDraft([...current.points]); }
      }} onPointerUp={event => { void finish(event); }} onPointerCancel={() => { gesture.current = null; setDraft([]); setTokenGhost(null); }} onContextMenu={event => event.preventDefault()}>
      <defs>
        {drawings.filter(d => d.kind === "TEXTURE" && d.assetKey).map(d => <pattern key={d.id} id={`${prefix}-texture-${d.id}`} width={d.size ?? 96} height={d.size ?? 96} patternUnits="userSpaceOnUse"><image href={stampImageUrl(d.packId ?? "builtin-texture-v1", d.assetKey!)} width={d.size ?? 96} height={d.size ?? 96} /></pattern>)}
        <mask id={`${prefix}-fog`} maskUnits="userSpaceOnUse" x={-100000} y={-100000} width={200000} height={200000}>
          <rect x={-100000} y={-100000} width={200000} height={200000} fill="black" />
          <g transform={matrix}>{fog.map(item => <FogShape key={item.id} geometry={item.geometry ?? { type: "RECT", x: item.x, y: item.y, width: item.width, height: item.height }} color={item.operation === "COVER" ? "black" : "white"} />)}</g>
        </mask>
        <mask id={`${prefix}-covered`} maskUnits="userSpaceOnUse" x={-100000} y={-100000} width={200000} height={200000}>
          <rect x={-100000} y={-100000} width={200000} height={200000} fill="white" />
          <g transform={matrix}>{fog.map(item => <FogShape key={item.id} geometry={item.geometry ?? { type: "RECT", x: item.x, y: item.y, width: item.width, height: item.height }} color={item.operation === "COVER" ? "white" : "black"} />)}</g>
        </mask>
        {policy.occluders.filter(o => o.floorId === floor.id).map(o => <clipPath key={o.id} id={`${prefix}-${o.id}`}><polygon points={o.polygon.map(p => `${p.x},${p.y}`).join(" ")} /></clipPath>)}
      </defs>
      <g mask={props.role === "PLAYER" ? `url(#${prefix}-fog)` : undefined}>
        {background && <image href={background} {...{ x: props.scene.backgroundFrame.x, y: props.scene.backgroundFrame.y, width: props.scene.backgroundFrame.width, height: props.scene.backgroundFrame.height }} />}
        {props.role === "GM" && props.gmFogVisible !== false && <rect x={0} y={0} width={props.scene.width} height={props.scene.height} fill="#090909" opacity={props.gmFogOpacity ?? .35} mask={`url(#${prefix}-covered)`} pointerEvents="none" />}
        <g transform={matrix} pointerEvents="none">
          {grid.enabled && (props.role !== "GM" || props.gmGridVisible !== false) && <g stroke={grid.color} opacity={grid.opacity} strokeWidth={1}>
            {Array.from({ length: floor.bounds.width + 1 }, (_, i) => <line key={`x${i}`} x1={(floor.bounds.x + i) * grid.size + grid.offsetX} x2={(floor.bounds.x + i) * grid.size + grid.offsetX} y1={floor.bounds.y * grid.size + grid.offsetY} y2={(floor.bounds.y + floor.bounds.height) * grid.size + grid.offsetY} />)}
            {Array.from({ length: floor.bounds.height + 1 }, (_, i) => <line key={`y${i}`} y1={(floor.bounds.y + i) * grid.size + grid.offsetY} y2={(floor.bounds.y + i) * grid.size + grid.offsetY} x1={floor.bounds.x * grid.size + grid.offsetX} x2={(floor.bounds.x + floor.bounds.width) * grid.size + grid.offsetX} />)}
          </g>}
          {props.role === "GM" && floor.blocked.map(cell => <rect key={`${cell.x},${cell.y}`} x={cell.x * grid.size + grid.offsetX} y={cell.y * grid.size + grid.offsetY} width={grid.size} height={grid.size} fill="#d5555544" stroke="#d55555" />)}
        </g>
        {drawings.filter(d => d.kind !== "STAMP" && d.kind !== "TEXTURE").map(d => <polyline key={d.id} points={points(d.points.map((v, i) => v + (i % 2 ? d.y : d.x)))} fill="none" stroke={d.color} strokeWidth={d.strokeWidth ?? 3} strokeLinecap="round" />)}
        <g transform={matrix}>{drawings.filter(d => d.kind === "STAMP" || d.kind === "TEXTURE").map(d => d.kind === "STAMP"
          ? <image key={d.id} href={stampImageUrl(d.packId ?? "builtin-terrain-v1", d.assetKey ?? "")} x={-(d.size ?? 96)/2} y={-(d.size ?? 96)/2} width={d.size ?? 96} height={d.size ?? 96} transform={`translate(${d.x} ${d.y}) rotate(${d.rotation ?? 0})`} />
          : <polyline key={d.id} points={d.points.reduce<string[]>((out,v,i,values) => { if (i % 2 === 0) out.push(`${v},${values[i+1]}`); return out; }, []).join(" ")} transform={`translate(${d.x} ${d.y})`} fill="none" stroke={`url(#${prefix}-texture-${d.id})`} strokeWidth={d.strokeWidth ?? 32} strokeLinecap="round" strokeLinejoin="round" />)}</g>
      </g><g>
        {layers.map(item => item.kind === "token" ? (() => {
          const token = item.token; const p = screenFoot(token);
          const frame = resolveTokenSpriteFrame(token.spriteSet, token.conditions, token.facing, id => Boolean(asset(id)));
          const url = asset(frame?.assetId ?? token.assetId);
          return <g key={item.id} data-token={token.id} transform={`translate(${p.x} ${p.y})`} style={{ cursor: canMove(token) ? "grab" : "pointer" }}>
            {url ? <image href={url} x={-token.width / 2} y={-token.height} width={token.width} height={token.height} preserveAspectRatio="xMidYMax meet" /> : <rect x={-token.width / 2} y={-token.height} width={token.width} height={token.height} fill={token.baseColor} />}
            {selected === token.id && <rect x={-token.width / 2} y={-token.height} width={token.width} height={token.height} fill="none" stroke="#8bd8e2" strokeWidth={3} />}
            <text y={16} textAnchor="middle" fill="#fff" stroke="#111" strokeWidth={.5} fontSize={14}>{token.name}</text>
          </g>;
        })() : background && <image key={item.id} href={background} x={props.scene.backgroundFrame.x} y={props.scene.backgroundFrame.y} width={props.scene.backgroundFrame.width} height={props.scene.backgroundFrame.height} clipPath={`url(#${prefix}-${item.occluder.id})`} mask={props.role === "PLAYER" ? `url(#${prefix}-fog)` : undefined} pointerEvents="none" />)}
      </g>
      {props.role === "PLAYER" && tokens.filter(token => token.controllerMembershipIds.includes(props.membershipId)).map(token => { const p = screenFoot(token); return <g key={`own-${token.id}`} data-token={token.id}><rect x={p.x-token.width/2} y={p.y-token.height} width={token.width} height={token.height} fill="#8bd8e211" stroke="#8bd8e2" strokeWidth={1} strokeDasharray="4 3" /><title>{token.name}</title></g>; })}
      {tokens.filter(token => selected === token.id).map(token => { const p = screenFoot(token); return <rect key={`outline-${token.id}`} x={p.x - token.width / 2} y={p.y - token.height} width={token.width} height={token.height} fill="none" stroke="#8bd8e2" strokeWidth={2} strokeDasharray="5 3" pointerEvents="none" />; })}
      {tokenGhost && <circle cx={tokenGhost.x} cy={tokenGhost.y} r={10} fill="#8bd8e255" stroke="#8bd8e2" pointerEvents="none" />}
      {draft.length > 2 && <polyline points={points(draft)} fill="none" stroke="#e8c979" strokeWidth={3} pointerEvents="none" />}
      {fogPolygon.length > 0 && <polyline points={points(fogPolygon.flatMap(p => [p.x,p.y]))} fill="none" stroke="#e8c979" strokeWidth={3} pointerEvents="none" />}
      {ruler.length > 0 && <polyline points={points(ruler.flatMap(p => [p.x, p.y]))} fill="none" stroke="#75dbe2" strokeWidth={3} pointerEvents="none" />}
      {localPing && (() => { const p = project(localPing.x, localPing.y); return <circle cx={p.x} cy={p.y} r={12} fill="none" stroke="#f5d276" strokeWidth={3} pointerEvents="none" />; })()}
    </svg>
  </div>;
}
