import { useEffect,useMemo,useRef,useState } from "react";
import type { IsometricSceneGeometry,Map3dSpec,SceneDto,TokenDto } from "@arken/contracts";
import { buildMap3dMesh,pick3dGround,transform4,type Mat4 } from "./map3d-geometry";
import { createMap3dCanvas } from "./map3d-webgl";

const EMPTY:TokenDto[]=[];
export function Map3dViewport({spec,geometry,floorId,grid,actors=EMPTY,selectedId,move=false,onPoint,onUnavailable}: {
  spec:Map3dSpec;geometry:IsometricSceneGeometry;floorId:string;grid:SceneDto["grid"];actors?:TokenDto[];selectedId?:string|null;move?:boolean;
  onPoint?:(point:{x:number;y:number},phase:"start"|"move"|"end")=>void;onUnavailable:()=>void;
}) {
  const canvas=useRef<HTMLCanvasElement>(null),engine=useRef<ReturnType<typeof createMap3dCanvas>|null>(null),latest=useRef(onUnavailable);
  latest.current=onUnavailable;
  const [matrix,setMatrix]=useState<Mat4|null>(null),drag=useRef<{x:number;y:number;pan:boolean;move:boolean;id:number}|null>(null);
  const floor=geometry.floors.find(f=>f.id===floorId)??geometry.floors[0]!;
  const mesh=useMemo(()=>{try{return buildMap3dMesh(spec,geometry,floorId);}catch{return null;}},[spec,geometry,floorId]);
  const actorMesh=useMemo(()=>{
    const vertices:number[]=[],m=geometry.metersPerCell;
    for(const token of actors.slice(0,512)) {
      const x=(token.x+token.width/2-grid.offsetX)/grid.size*m,z=(token.y+token.height-grid.offsetY)/grid.size*m,y=floor.elevationMeters;
      const color=selectedId===token.id?[.2,.85,1]:/^#[0-9a-f]{6}$/i.test(token.baseColor)?[1,3,5].map(i=>parseInt(token.baseColor.slice(i,i+2),16)/255):[.8,.55,.25];
      const w=m*.55,h=m*.9,d=m*.55;
      const p=[[x-w/2,y,z-d/2],[x+w/2,y,z-d/2],[x+w/2,y,z+d/2],[x-w/2,y,z+d/2],[x-w/2,y+h,z-d/2],[x+w/2,y+h,z-d/2],[x+w/2,y+h,z+d/2],[x-w/2,y+h,z+d/2]];
      for(const face of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]])for(const i of [face[0]!,face[1]!,face[2]!,face[0]!,face[2]!,face[3]!])vertices.push(...p[i]!,...color);
    }
    return new Float32Array(vertices);
  },[actors,selectedId,grid.size,grid.offsetX,grid.offsetY,geometry.metersPerCell,floor.elevationMeters]);
  useEffect(()=>{
    if(!canvas.current)return;
    try{engine.current=createMap3dCanvas(canvas.current,setMatrix,()=>latest.current());}catch{latest.current();}
    return()=>{engine.current?.stop();engine.current=null;};
  },[]);
  useEffect(()=>{if(mesh)engine.current?.setMesh(mesh);else latest.current();},[mesh]);
  useEffect(()=>{engine.current?.setActors(actorMesh);},[actorMesh]);
  const fit=()=>{const b=floor.bounds,m=geometry.metersPerCell;engine.current?.fit([(b.x+b.width/2)*m,floor.elevationMeters,(b.y+b.height/2)*m],Math.max(b.width,b.height)*m);};
  useEffect(()=>{fit();},[floor.id,floor.bounds.x,floor.bounds.y,floor.bounds.width,floor.bounds.height,floor.elevationMeters,geometry.metersPerCell]);
  const point=(event:{clientX:number;clientY:number})=>{
    const rect=canvas.current?.getBoundingClientRect();if(!matrix||!rect||!rect.width||!rect.height)return null;
    try {const p=pick3dGround(matrix,2*(event.clientX-rect.left)/rect.width-1,1-2*(event.clientY-rect.top)/rect.height,floor.elevationMeters);
      return p?{x:p[0]/geometry.metersPerCell,y:p[2]/geometry.metersPerCell}:null;}catch{return null;}
  };
  const selected=actors.find(t=>t.id===selectedId);
  const marker=selected&&matrix?transform4(matrix,[(selected.x+selected.width/2-grid.offsetX)/grid.size*geometry.metersPerCell,floor.elevationMeters+geometry.metersPerCell,(selected.y+selected.height-grid.offsetY)/grid.size*geometry.metersPerCell,1]):null;
  return <div style={{position:"relative",width:"100%",height:"100%",minHeight:240}}>
    <canvas ref={canvas} style={{width:"100%",height:"100%",display:"block",touchAction:"none"}} aria-label="Трёхмерная игровая карта"
      onContextMenu={e=>e.preventDefault()} onWheel={e=>engine.current?.zoom(e.deltaY)}
      onPointerDown={e=>{if(e.button!==0&&e.button!==1&&e.button!==2)return;e.currentTarget.setPointerCapture(e.pointerId);const moving=move&&e.button===0;drag.current={x:e.clientX,y:e.clientY,pan:e.button!==0||e.shiftKey,move:moving,id:e.pointerId};if(moving){const p=point(e);if(p)onPoint?.(p,"start");}}}
      onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;if(d.move){const p=point(e);if(p)onPoint?.(p,"move");}else if(d.pan)engine.current?.pan(e.clientX-d.x,e.clientY-d.y);else engine.current?.orbit(e.clientX-d.x,e.clientY-d.y);d.x=e.clientX;d.y=e.clientY;}}
      onPointerUp={e=>{const d=drag.current;drag.current=null;if(d?.id===e.pointerId&&d.move){const p=point(e);if(p)onPoint?.(p,"end");}}} onPointerCancel={()=>{drag.current=null;}} />
    <button type="button" style={{position:"absolute",right:12,bottom:12,minHeight:44}} onClick={fit}>Вписать 3D</button>
    {marker&&marker[3]!>0&&Math.abs(marker[0]!/marker[3]!)<1.2&&Math.abs(marker[1]!/marker[3]!)<1.2&&<span style={{position:"absolute",left:`${(marker[0]!/marker[3]!+1)*50}%`,top:`${(1-marker[1]!/marker[3]!)*50}%`,transform:"translate(-50%,-100%)",pointerEvents:"none",background:"#191919dd",color:"white",padding:4}}>{selected?.name}</span>}
  </div>;
}
