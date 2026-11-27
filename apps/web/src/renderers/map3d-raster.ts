import { convertMap3dPixels,type Map3dCell,type AssetDto } from "@arken/contracts";
import { campaignHeaders } from "../campaign-route";

const MAX_BYTES=20*1024*1024,MAX_PIXELS=16*1024*1024;
export async function preflightMap3dImage(file:File):Promise<string> {
  if(file.size<24||file.size>MAX_BYTES)throw Error("Карта должна быть PNG/JPEG размером до 20 МБ");
  const bytes=await file.arrayBuffer(),v=new DataView(bytes);let width=0,height=0;
  if(v.getUint32(0)===0x89504e47&&v.getUint32(4)===0x0d0a1a0a){width=v.getUint32(16);height=v.getUint32(20);}
  else if(v.getUint16(0)===0xffd8){
    let p=2;
    while(p+9<Math.min(bytes.byteLength,1024*1024)) {
      if(v.getUint8(p++)!==255)throw Error("Некорректный JPEG");while(p<bytes.byteLength&&v.getUint8(p)===255)p++;
      const marker=v.getUint8(p++);if(marker===0xda||marker===0xd9)break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      const length=v.getUint16(p);if(length<2||p+length>bytes.byteLength)throw Error("Некорректный JPEG");
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=length;
    }
  }
  if(!width||!height||width>8192||height>8192||width*height>MAX_PIXELS)throw Error("Нужна PNG/JPEG карта до 8192 пикселей по стороне и 16 мегапикселей");
  const hash=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("");
}

export async function proposeMap3d(asset:AssetDto,pixelsPerCell:number,threshold:number,floorId:string,previous:Map3dCell[],signal:AbortSignal) {
  if(!/^[a-f0-9-]{36}$/i.test(asset.id)||asset.kind!=="MAP"||!asset.width||!asset.height||asset.width>8192||asset.height>8192||asset.width*asset.height>MAX_PIXELS)throw Error("Выберите ограниченную по размеру карту из медиатеки");
  if(!Number.isFinite(pixelsPerCell)||pixelsPerCell<8||pixelsPerCell>512)throw Error("Задайте размер клетки от 8 до 512 пикселей");
  const response=await fetch(`/api/assets/${encodeURIComponent(asset.id)}/content`,{headers:campaignHeaders(),credentials:"include",signal});
  if(!response.ok||!response.body)throw Error("Не удалось прочитать изображение карты");
  const mime=(response.headers.get("content-type")??"").split(";")[0]!;
  if(!["image/png","image/jpeg","image/webp"].includes(mime))throw Error("Неподдерживаемый формат карты");
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>MAX_BYTES){await reader.cancel();throw Error("Карта превышает 20 МБ");}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes.buffer)),v=>v.toString(16).padStart(2,"0")).join("");
  const bitmap=await createImageBitmap(new Blob([bytes.buffer],{type:mime}));
  try {
    if(signal.aborted)throw Error("Импорт отменён");
    if(bitmap.width>8192||bitmap.height>8192||bitmap.width*bitmap.height>MAX_PIXELS)throw Error("Размер карты превышает лимит");
    const columns=Math.ceil(bitmap.width/pixelsPerCell),rows=Math.ceil(bitmap.height/pixelsPerCell),samples=8;
    if(columns>128||rows>128)throw Error("Увеличьте размер клетки: максимум 128 клеток по стороне");
    if(previous.some(c=>c.floorId===floorId&&c.manual&&(c.x<0||c.y<0||c.x>=columns||c.y>=rows)))throw Error("Новая сетка обрезает ручные правки. Сохраните прежний размер сетки или исправьте их в редакторе");
    const canvas=document.createElement("canvas");canvas.width=columns*samples;canvas.height=rows*samples;
    const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)throw Error("Декодирование карты недоступно");
    context.imageSmoothingEnabled=false;context.drawImage(bitmap,0,0,bitmap.width/pixelsPerCell*samples,bitmap.height/pixelsPerCell*samples);
    const proposal=convertMap3dPixels({rgba:context.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height,samplesPerCell:samples,floorId,threshold,projection:"TOP_DOWN",previous});
    return {...proposal,source:{floorId,assetId:asset.id,sha256:sha,width:bitmap.width,height:bitmap.height,pixelsPerCell,threshold,method:"LUMINANCE_GRID_V1" as const}};
  } finally {bitmap.close();}
}
