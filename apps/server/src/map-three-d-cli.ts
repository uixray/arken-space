/** Local proposal only. Publishing always requires GM review through the editor. */
import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import sharp from "sharp";
import { convertMap3dPixels, map3dSpecSchema, map3dMovementGeometry, isometricSceneGeometrySchema } from "@arken/contracts";

async function main() {
  const [input,output,pixelsText="64",metersText="1.5",previousPath] = process.argv.slice(2);
  if (!input || !output || process.argv.length>7) throw Error("Usage: map-three-d-cli INPUT.png OUTPUT.json [pixelsPerCell] [metersPerCell] [previous.json]");
  if (resolve(input)===resolve(output) || previousPath&&resolve(previousPath)===resolve(output)) throw Error("Output must be a new file");
  const pixelsPerCell=Number(pixelsText), metersPerCell=Number(metersText);
  if (!Number.isFinite(pixelsPerCell)||pixelsPerCell<8||pixelsPerCell>512||!Number.isFinite(metersPerCell)||metersPerCell<.1||metersPerCell>100) throw Error("Invalid scale");
  if ((await stat(input)).size>20*1024*1024) throw Error("Map exceeds 20 MiB");
  const bytes=await readFile(input);
  if(bytes.length>20*1024*1024) throw Error("Map exceeds 20 MiB");
  const image=sharp(bytes,{limitInputPixels:16*1024*1024,animated:false}),metadata=await image.metadata();
  const {width,height}=metadata;
  if (!width||!height||width>8192||height>8192||!["png","jpeg"].includes(metadata.format??"")||(metadata.pages??1)>1) throw Error("Single PNG/JPEG up to 8192px and 16MP required");
  const columns=Math.ceil(width/pixelsPerCell),rows=Math.ceil(height/pixelsPerCell),samples=8;
  if(columns>128||rows>128) throw Error("Increase pixelsPerCell: limit is 128 cells per side");
  let previous: ReturnType<typeof map3dSpecSchema.parse>|undefined;
  let oldGeometry: ReturnType<typeof isometricSceneGeometrySchema.parse>|undefined;
  let previousPixels:number|undefined;
  if(previousPath) {
    if((await stat(previousPath)).size>8*1024*1024)throw Error("Previous JSON exceeds 8 MiB");
    const raw=JSON.parse(await readFile(previousPath,"utf8"));
    previous=map3dSpecSchema.parse(raw.threeD);oldGeometry=isometricSceneGeometrySchema.parse(raw.geometry);
    previousPixels=raw.provenance?.pixelsPerCell;
    map3dMovementGeometry(oldGeometry,previous);
    if(oldGeometry.floors.length!==1)throw Error("CLI regeneration supports one floor; use the editor for multiple floors");
  }
  const floorId=oldGeometry?.floors[0]!.id??randomUUID();
  if(previous?.cells.some(c=>c.manual&&(c.x<0||c.y<0||c.x>=columns||c.y>=rows)))throw Error("New grid would crop manual edits");
  if(previous?.cells.some(c=>c.manual)&&((previousPixels!==undefined&&previousPixels!==pixelsPerCell)||previous.sources?.some(s=>s.pixelsPerCell!==pixelsPerCell)))throw Error("Keep previous scale to preserve manual edits");
  const scaledWidth=Math.max(1,Math.min(columns*samples,Math.round(width/pixelsPerCell*samples)));
  const scaledHeight=Math.max(1,Math.min(rows*samples,Math.round(height/pixelsPerCell*samples)));
  const rgba=await image.resize(scaledWidth,scaledHeight,{fit:"fill",kernel:"nearest"}).ensureAlpha().extend({top:0,left:0,right:columns*samples-scaledWidth,bottom:rows*samples-scaledHeight,background:{r:0,g:0,b:0,alpha:0}}).raw().toBuffer();
  const proposal=convertMap3dPixels({rgba,width:columns*samples,height:rows*samples,samplesPerCell:samples,floorId,threshold:160,projection:"TOP_DOWN",previous:previous?.cells});
  const geometry=isometricSceneGeometrySchema.parse({...oldGeometry,version:1,metersPerCell,transform:oldGeometry?.transform??{origin:{x:0,y:0},axisX:{x:64,y:0},axisY:{x:0,y:64}},floors:[{...oldGeometry?.floors[0],id:floorId,name:oldGeometry?.floors[0]!.name??"Основной ярус",elevationMeters:oldGeometry?.floors[0]!.elevationMeters??0,screenOffsetY:0,bounds:{x:0,y:0,width:columns,height:rows},blocked:[]}],transitions:[],occluders:[]});
  const threeD=map3dSpecSchema.parse({version:1,reviewed:false,wallHeight:previous?.wallHeight??2.5,models:previous?.models??[],cells:proposal.cells});
  await writeFile(output,JSON.stringify({geometry:map3dMovementGeometry(geometry,threeD),threeD,provenance:{sha256:createHash("sha256").update(bytes).digest("hex"),width,height,pixelsPerCell,method:"LUMINANCE_GRID_V1",threshold:160},warnings:proposal.warnings},null,2),{flag:"wx"});
  process.stdout.write(`Created private draft: ${resolve(output)}\n`);
}
main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:"Conversion failed"}\n`);process.exitCode=1;});
