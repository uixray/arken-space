import { fogGeometryBounds, simplifyFogBrush, validateFogPolygon, type FogBounds, type FogGeometry } from "@arken/contracts";
export class FogGeometryError extends Error { constructor(public code:string){super(code)} }
export function canonicalizeFogGeometry(input: FogGeometry, scene:{width:number;height:number}, legacy=false):{geometry:FogGeometry;bbox:FogBounds}{
 let geometry=input;
 if(input.type==="BRUSH") geometry={...input,points:simplifyFogBrush(input.points,input.radius)};
 if(geometry.type==="POLYGON"&&!validateFogPolygon(geometry.points)) throw new FogGeometryError("FOG_POLYGON_INVALID");
 let bbox=fogGeometryBounds(geometry);
 if(legacy&&geometry.type==="RECT"){const l=Math.max(0,bbox.x),t=Math.max(0,bbox.y),r=Math.min(scene.width,bbox.x+bbox.width),b=Math.min(scene.height,bbox.y+bbox.height);if(r<=l||b<=t)throw new FogGeometryError("FOG_OUTSIDE_SCENE");geometry={type:"RECT",x:l,y:t,width:r-l,height:b-t};bbox=fogGeometryBounds(geometry)}
 else if(bbox.x<0||bbox.y<0||bbox.x+bbox.width>scene.width||bbox.y+bbox.height>scene.height)throw new FogGeometryError("FOG_OUTSIDE_SCENE");
 return {geometry,bbox};
}
