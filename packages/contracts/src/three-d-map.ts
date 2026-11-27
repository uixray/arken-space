import { z } from "zod";
import type { IsometricSceneGeometry } from "./isometric-geometry.js";

export const map3dCellSchema = z.object({
  floorId: z.string().uuid(), x: z.number().int().min(-10000).max(10000), y: z.number().int().min(-10000).max(10000),
  kind: z.enum(["FLOOR", "WALL", "DOOR", "PROP", "VOID"]),
  open: z.boolean().optional(), manual: z.boolean(), uncertain: z.boolean(),
  axis: z.enum(["X","Y"]).optional(),
  room: z.string().max(40).optional(), modelId: z.string().uuid().optional(),
}).strict();
export const map3dSpecSchema = z.object({
  version: z.literal(1), reviewed: z.boolean(), wallHeight: z.number().finite().min(.5).max(10),
  cells: z.array(map3dCellSchema).min(1).max(16384),
  models: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80),
    /** Normalized triangle soup, no URLs, shaders, scripts or textures. */
    positions: z.array(z.number().finite().min(0).max(1)).min(9).max(147456)
      .refine(v => v.length % 9 === 0),
  }).strict()).max(16),
  sources: z.array(z.object({ floorId: z.string().uuid(), assetId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192), pixelsPerCell: z.number().finite().min(8).max(512),
    method: z.literal("LUMINANCE_GRID_V1"), threshold: z.number().int().min(0).max(255),
  }).strict()).max(16).optional(),
}).strict().superRefine((spec, ctx) => {
  const keys = new Set(spec.cells.map(c => `${c.floorId}:${c.x},${c.y}`));
  if (keys.size !== spec.cells.length) ctx.addIssue({ code: "custom", message: "Duplicate cell" });
  const ids = new Set(spec.models.map(m => m.id));
  if (ids.size !== spec.models.length || spec.models.reduce((sum,m) => sum+m.positions.length,0) > 147456)
    ctx.addIssue({ code: "custom", message: "Model budget exceeded" });
  for (const cell of spec.cells) if (cell.modelId && !ids.has(cell.modelId)) ctx.addIssue({ code: "custom", message: "Unknown model" });
});
export type Map3dSpec = z.infer<typeof map3dSpecSchema>;
export type Map3dCell = z.infer<typeof map3dCellSchema>;
export const map3dBlocked = (cell: Map3dCell) => cell.kind === "WALL" || cell.kind === "VOID" || cell.kind === "PROP" || (cell.kind === "DOOR" && !cell.open);

/** Single movement authority: reuse floor IDs, bounds and transitions from 2.5D. */
export function map3dMovementGeometry(geometry: IsometricSceneGeometry, spec: Map3dSpec): IsometricSceneGeometry {
  const floors = new Map(geometry.floors.map(f => [f.id,f]));
  let expected = 0;
  for (const floor of floors.values()) expected += floor.bounds.width * floor.bounds.height;
  if (expected > 16384 || expected !== spec.cells.length || new Set(spec.cells.map(c=>`${c.floorId}:${c.x},${c.y}`)).size!==spec.cells.length) throw Error("3D_CELL_COVERAGE");
  const models=new Map(spec.models.map(m=>[m.id,m]));let vertices=0;
  for (const cell of spec.cells) {
    const f = floors.get(cell.floorId), b = f?.bounds;
    if (!b || cell.x < b.x || cell.y < b.y || cell.x >= b.x+b.width || cell.y >= b.y+b.height) throw Error("3D_CELL_BOUNDS");
    if(cell.kind!=="VOID") vertices+=36+(cell.kind==="WALL"?36:cell.kind==="DOOR"?cell.open?72:36:cell.kind==="PROP"?cell.modelId?(models.get(cell.modelId)?.positions.length??0)/3:36:0);
    if(vertices>1000000)throw Error("3D_GEOMETRY_BUDGET");
  }
  return { ...geometry, floors: geometry.floors.map(f => ({ ...f,
    blocked: spec.cells.filter(c => c.floorId === f.id && map3dBlocked(c)).map(c => ({ x:c.x,y:c.y })),
  })) };
}

/** Adapts edits in the existing graphical floor/stair editor, without a second model. */
export function map3dApplyFloorEdits(spec: Map3dSpec, geometry: IsometricSceneGeometry): Map3dSpec {
  const old = new Map(spec.cells.map(c => [`${c.floorId}:${c.x},${c.y}`,c]));
  const cells: Map3dCell[] = [];
  for (const f of geometry.floors) {
    if (cells.length + f.bounds.width * f.bounds.height > 16384) throw Error("3D_CELL_BUDGET");
    const blocks = new Set(f.blocked.map(c => `${c.x},${c.y}`));
    for (let y=f.bounds.y;y<f.bounds.y+f.bounds.height;y++) for(let x=f.bounds.x;x<f.bounds.x+f.bounds.width;x++) {
      const previous = old.get(`${f.id}:${x},${y}`), blocked = blocks.has(`${x},${y}`);
      cells.push(previous && map3dBlocked(previous) === blocked ? previous : {
        floorId:f.id,x,y,kind:blocked?"WALL":"FLOOR",manual:true,uncertain:false,
      });
    }
  }
  return { ...spec, cells, reviewed:false, sources: spec.sources?.filter(s => geometry.floors.some(f => f.id === s.floorId)) };
}

/** Deterministic conservative raster proposal. No inference of hidden geometry. */
export function convertMap3dPixels(input: {
  rgba: ArrayLike<number>; width:number; height:number; samplesPerCell:number; floorId:string;
  threshold:number; projection:"TOP_DOWN"; previous?: readonly Map3dCell[];
}): { cells:Map3dCell[]; columns:number; rows:number; warnings:string[] } {
  const { width,height,samplesPerCell:s,rgba } = input;
  if(input.previous?.some(c=>c.floorId===input.floorId&&c.manual&&(c.x<0||c.y<0||c.x>=width/s||c.y>=height/s)))throw Error("3D_MANUAL_EDITS_OUTSIDE_GRID");
  if (input.projection !== "TOP_DOWN" || !Number.isInteger(width) || !Number.isInteger(height) ||
      !Number.isInteger(s) || s<2 || s>32 || width<1 || height<1 || width%s || height%s ||
      width/s>128 || height/s>128 || rgba.length!==width*height*4 || !Number.isInteger(input.threshold) || input.threshold<0 || input.threshold>255) throw Error("3D_RASTER_LIMIT");
  const columns=width/s, rows=height/s, cells:Map3dCell[]=[];
  const previous=new Map(input.previous?.filter(c=>c.floorId===input.floorId&&c.manual).map(c=>[`${c.x},${c.y}`,c]));
  for(let y=0;y<rows;y++) for(let x=0;x<columns;x++) {
    const saved=previous.get(`${x},${y}`); if(saved){cells.push({...saved});continue;}
    let dark=0, transparent=0;
    for(let dy=0;dy<s;dy++)for(let dx=0;dx<s;dx++) {
      const i=((y*s+dy)*width+x*s+dx)*4;
      if(rgba[i+3]!<128){transparent++;continue;}
      if(.2126*rgba[i]!+.7152*rgba[i+1]!+.0722*rgba[i+2]!<input.threshold)dark++;
    }
    const fraction=dark/(s*s);
    cells.push({floorId:input.floorId,x,y,kind:transparent>s*s*.4?"VOID":fraction>.12?"WALL":"FLOOR",manual:false,uncertain: fraction>.03 || transparent>0});
  }
  const at=(x:number,y:number)=>cells[y*columns+x];
  // One-cell gaps are only door CANDIDATES; they are closed until GM correction.
  for(const c of cells) if(c.kind==="FLOOR"&&!c.manual&&c.x>0&&c.y>0&&c.x<columns-1&&c.y<rows-1) {
    const horizontal=at(c.x-1,c.y)?.kind==="WALL"&&at(c.x+1,c.y)?.kind==="WALL";
    const vertical=at(c.x,c.y-1)?.kind==="WALL"&&at(c.x,c.y+1)?.kind==="WALL";
    if(horizontal!==vertical){c.kind="DOOR";c.open=false;c.axis=horizontal?"X":"Y";c.uncertain=true;}
  }
  let room=0;const visited=new Set<number>();
  for(let i=0;i<cells.length;i++) {
    if(visited.has(i)||map3dBlocked(cells[i]!))continue;
    const queue=[i];visited.add(i);room++;
    for(let head=0;head<queue.length;head++) {
      const index=queue[head]!, c=cells[index]!; c.room=`room-${room}`;
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const x=c.x+dx!,y=c.y+dy!,n=y*columns+x;
        if(x>=0&&y>=0&&x<columns&&y<rows&&!visited.has(n)&&!map3dBlocked(cells[n]!)){visited.add(n);queue.push(n);}
      }
    }
  }
  return {cells,columns,rows,warnings:["Черновая клеточная реконструкция: стены, двери и комнаты требуют проверки мастером.","Мебель, тени, подписи и сетка могут ошибочно распознаваться как стены. Перспективные и изометрические арты не поддерживаются."]};
}
