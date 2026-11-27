import { and, eq } from "drizzle-orm";
import { scenes } from "@arken/db";
import { isometricFloorId, isometricPublishedFloor, isRectFullyRevealed, type FogOperation, type IsometricSceneGeometry, type Map3dSpec } from "@arken/contracts";
import type { CampaignCanvasDb } from "./campaign-pause-guard.js";

type LayerScene = { projection: string; grid: { isometric?: IsometricSceneGeometry; threeD?:Map3dSpec; size: number; offsetX?:number; offsetY?:number } };
export function isometricRowIsPublished(scene: LayerScene | undefined, levelId: string | null | undefined): boolean {
  const geometry = scene && ["ISOMETRIC","THREE_D"].includes(scene.projection) ? scene.grid.isometric : undefined;
  return !geometry || isometricFloorId(geometry, levelId) === isometricPublishedFloor(geometry);
}

/** Fog covers the cell under upright feet, not the billboard's screen height. */
export function isometricFogFootprint<T extends { x: number; y: number; width: number; height: number }>(scene: LayerScene | undefined, token: T): T {
  if (!scene?.grid.isometric || !["ISOMETRIC","THREE_D"].includes(scene.projection)) return token;
  const size = scene.grid.size;
  return { ...token, x: token.x + token.width / 2 - size / 2, y: token.y + token.height - size / 2, width: size, height: size };
}

export function isometricDrawingIsVisible(scene: LayerScene | undefined,
  drawing: { levelId?: string | null; x: number; y: number; points: number[]; kind: string; strokeWidth: number; stampSize: number | null; stampRotation: number | null },
  fog: readonly FogOperation[],
): boolean {
  if (!scene?.grid.isometric || !["ISOMETRIC","THREE_D"].includes(scene.projection)) return true;
  if (!isometricRowIsPublished(scene, drawing.levelId)) return false;
  let bounds;
  if (drawing.kind === "STAMP") {
    const angle = (drawing.stampRotation ?? 0) * Math.PI / 180;
    const size = (drawing.stampSize ?? 0) * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
    bounds = { x: drawing.x - size / 2, y: drawing.y - size / 2, width: size, height: size };
  } else {
    const xs = drawing.points.filter((_, i) => i % 2 === 0), ys = drawing.points.filter((_, i) => i % 2 !== 0);
    if (!xs.length || !ys.length) return false;
    const pad = drawing.strokeWidth / 2;
    bounds = { x: Math.min(...xs) + drawing.x - pad, y: Math.min(...ys) + drawing.y - pad,
      width: Math.max(...xs) - Math.min(...xs) + pad * 2, height: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  return isRectFullyRevealed(bounds, fog.filter(row => isometricRowIsPublished(scene, row.levelId)));
}
export async function canvasLayerLevel(
  db: CampaignCanvasDb, campaignId: string, sceneId: string,
  requested: string | null | undefined, role: "GM" | "PLAYER",
): Promise<string | null> {
  const [scene] = await db.select().from(scenes)
    .where(and(eq(scenes.id, sceneId), eq(scenes.campaignId, campaignId))).limit(1).for("share");
  const geometry = scene && ["ISOMETRIC","THREE_D"].includes(scene.projection) ? scene.grid.isometric : undefined;
  const deny = () => { throw Object.assign(new Error("LAYER_FORBIDDEN"), { statusCode: 403 }); };
  if (!scene) return deny();
  if (!geometry) return requested ?? null;
  const id = requested === undefined && role === "PLAYER" ? isometricPublishedFloor(geometry) : requested ?? geometry.floors[0]!.id;
  if (!geometry.floors.some(floor => floor.id === id) || (role !== "GM" && id !== isometricPublishedFloor(geometry))) return deny();
  return id === geometry.floors[0]!.id ? null : id;
}

export function playerMap3dSpec(scene:LayerScene, fog:readonly FogOperation[]):Map3dSpec|undefined {
  const spec=scene.grid.threeD,geometry=scene.grid.isometric;if(!spec||!geometry)return undefined;
  const id=isometricPublishedFloor(geometry),size=scene.grid.size;
  const revealed=fog.filter(row=>isometricRowIsPublished(scene,row.levelId));
  const cells=spec.cells.filter(c=>c.floorId===id&&isRectFullyRevealed({x:(scene.grid.offsetX??0)+c.x*size,y:(scene.grid.offsetY??0)+c.y*size,width:size,height:size},revealed))
    .map(({room,...cell})=>cell);
  const models=new Set(cells.map(c=>c.modelId));
  return {version:1,reviewed:true,wallHeight:spec.wallHeight,cells,models:spec.models.filter(m=>models.has(m.id)).map(m=>({...m,name:"Декорация"}))};
}

/** Legacy batch/history packets have no floor context; require GM in iso scenes. */
export async function assertLegacyCanvasLayerAccess(db: CampaignCanvasDb, campaignId: string, sceneId: string, role: "GM" | "PLAYER") {
  if (role === "GM") return;
  const [scene] = await db.select().from(scenes).where(and(eq(scenes.id, sceneId), eq(scenes.campaignId, campaignId))).limit(1);
  if (scene?.grid.isometric) throw Object.assign(new Error("LAYER_CONTEXT_REQUIRED"), { statusCode: 403 });
}
