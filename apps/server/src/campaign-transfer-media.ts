import {createHash,randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {open,lstat,realpath,mkdir,link,unlink,type FileHandle} from "node:fs/promises";
import {isAbsolute,join,relative,resolve,sep} from "node:path";
import {z} from "zod";
const referenceSchema=z.object({storageKey:z.string().min(1).max(384),mimeType:z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/).max(127),sizeBytes:z.number().int().min(1).max(256*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export type TransferMediaReference=z.infer<typeof referenceSchema>;
export type TransferMediaFile={sha256:string;bytes:number;mimeType:string};
export interface TransferMediaPin{readonly reference:Readonly<TransferMediaReference>;close():Promise<void>}
const pins=new WeakMap<TransferMediaPin,{root:string;handle:FileHandle;size:bigint;mtimeNs:bigint;closed:boolean}>();
const inside=(root:string,path:string)=>{const part=relative(root,path);return part!==""&&!part.startsWith(".."+sep)&&part!==".."&&!isAbsolute(part);};
async function directory(path:string){if(!isAbsolute(path)||(await lstat(path)).isSymbolicLink())throw Error("TRANSFER_MEDIA_ROOT_INVALID");const canonical=await realpath(path);if(!(await lstat(canonical)).isDirectory())throw Error("TRANSFER_MEDIA_ROOT_INVALID");return canonical;}

/** Only server-authorized DB references belong here. No arbitrary client paths.
 * The handle pins the file identity across a later unlink; it is not a guarantee
 * against a hostile same-user process modifying the file in place. */
export async function pinCampaignTransferMedia(rootInput:string,input:TransferMediaReference):Promise<TransferMediaPin>{
 const reference=Object.freeze(referenceSchema.parse(input)),root=await directory(rootInput),parts=reference.storageKey.split("/");
 if(parts.length>4||parts.some(part=>! /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(part)||part.endsWith(".")||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))throw Error("TRANSFER_MEDIA_KEY_INVALID");
 let path=root;
 for(let index=0;index<parts.length;index++){path=join(path,parts[index]!);const info=await lstat(path);if(info.isSymbolicLink()||(index<parts.length-1?!info.isDirectory():!info.isFile()))throw Error("TRANSFER_MEDIA_PATH_INVALID");}
 const canonical=await realpath(path);if(!inside(root,canonical)||canonical!==resolve(root,...parts))throw Error("TRANSFER_MEDIA_PATH_INVALID");
 const before=await lstat(path,{bigint:true}),handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const opened=await handle.stat({bigint:true});
  if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==BigInt(reference.sizeBytes))throw Error("TRANSFER_MEDIA_SIZE_OR_IDENTITY_INVALID");
  if(await realpath(path)!==canonical)throw Error("TRANSFER_MEDIA_PATH_INVALID");
  const state={root,handle,size:opened.size,mtimeNs:opened.mtimeNs,closed:false};
  const pin:TransferMediaPin=Object.freeze({reference,close:async()=>{if(!state.closed){state.closed=true;await handle.close();}}});pins.set(pin,state);return pin;
 }catch(error){await handle.close();throw error;}
}

async function verifyExisting(path:string,entry:TransferMediaFile){
 const before=await lstat(path,{bigint:true});if(before.isSymbolicLink()||!before.isFile())throw Error("TRANSFER_MEDIA_STAGED_INTEGRITY_INVALID");const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{const info=await handle.stat({bigint:true});if(info.ino!==before.ino||info.dev!==before.dev||info.size!==BigInt(entry.bytes))throw Error("TRANSFER_MEDIA_STAGED_INTEGRITY_INVALID");const hash=createHash("sha256"),buffer=Buffer.alloc(64*1024);let bytes=0;while(true){const chunk=await handle.read(buffer,0,Math.min(buffer.length,entry.bytes-bytes+1),bytes);if(!chunk.bytesRead)break;bytes+=chunk.bytesRead;if(bytes>entry.bytes)throw Error("TRANSFER_MEDIA_STAGED_INTEGRITY_INVALID");hash.update(buffer.subarray(0,chunk.bytesRead));}if(bytes!==entry.bytes||hash.digest("hex")!==entry.sha256)throw Error("TRANSFER_MEDIA_STAGED_INTEGRITY_INVALID");}finally{await handle.close();}
}

/** Creates a fresh private staging root. Final media names appear only after a
 * complete fsynced copy, via no-replace hard link. No source file is changed.
 * The complete campaign assembler must still publish its manifest atomically. */
export async function createCampaignTransferMediaStage(parentInput:string,limits:{maxBytes?:number;maxFiles?:number}={}){
 const maxBytes=z.number().int().min(1).max(32*1024*1024*1024).parse(limits.maxBytes??32*1024*1024*1024),maxFiles=z.number().int().min(1).max(100000).parse(limits.maxFiles??100000),parent=await directory(parentInput),root=join(parent,"transfer-"+randomUUID()),folder=join(root,"media");
 await mkdir(root,{mode:0o700});await mkdir(folder,{mode:0o700});
 let tail=Promise.resolve(),total=0;
 const files=new Map<string,TransferMediaFile>();
 const queue=<T>(action:()=>Promise<T>)=>{const result=tail.then(action);tail=result.then(()=>undefined,()=>undefined);return result;};
 return {root,
  entries:()=>[...files.values()].map(file=>({...file})).sort((a,b)=>a.sha256<b.sha256?-1:a.sha256>b.sha256?1:0),
  copy:(pin:TransferMediaPin)=>queue(async()=>{
   const state=pins.get(pin);if(!state||state.closed)throw Error("TRANSFER_MEDIA_PIN_INVALID");
   const temporary=join(folder,"part-"+randomUUID()),hash=createHash("sha256");let destination:FileHandle|undefined,temporaryOwned=false;
   try{
    // Keep source and staging disjoint, including when the source was configured
    // through a canonical alias. Staging never becomes a writable media source.
    if(root===state.root||inside(state.root,root)||inside(root,state.root)||!inside(parent,root)||(await realpath(folder))!==folder||(await lstat(folder)).isSymbolicLink())throw Error("TRANSFER_MEDIA_STAGE_INVALID");
    destination=await open(temporary,"wx",0o600);temporaryOwned=true;const buffer=Buffer.alloc(64*1024);let bytes=0;
    while(true){const result=await state.handle.read(buffer,0,Math.min(buffer.length,pin.reference.sizeBytes-bytes+1),bytes);if(!result.bytesRead)break;bytes+=result.bytesRead;if(bytes>pin.reference.sizeBytes)throw Error("TRANSFER_MEDIA_CHANGED");const chunk=buffer.subarray(0,result.bytesRead);hash.update(chunk);await destination.writeFile(chunk);}
    const after=await state.handle.stat({bigint:true});
    if(bytes!==pin.reference.sizeBytes||after.size!==state.size||after.mtimeNs!==state.mtimeNs)throw Error("TRANSFER_MEDIA_CHANGED");
    const sha256=hash.digest("hex");if(pin.reference.sha256&&sha256!==pin.reference.sha256)throw Error("TRANSFER_MEDIA_HASH_MISMATCH");
    const entry={sha256,bytes,mimeType:pin.reference.mimeType},existing=files.get(sha256);
    if(existing){if(existing.bytes!==bytes||existing.mimeType!==entry.mimeType)throw Error("TRANSFER_MEDIA_METADATA_CONFLICT");await verifyExisting(join(folder,sha256),existing);return {...existing};}
    if(total+bytes>maxBytes||files.size>=maxFiles)throw Error("TRANSFER_MEDIA_QUOTA_EXCEEDED");
    await destination.sync();await destination.close();destination=undefined;
    // No overwrite and no partial final hash-named file. Unsupported hard-link
    // filesystems fail closed; there is deliberately no unsafe copy fallback.
    await link(temporary,join(folder,sha256));files.set(sha256,entry);total+=bytes;return {...entry};
   }finally{try{await destination?.close();}finally{try{if(temporaryOwned)await unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw error;});}finally{await pin.close();}}}
  }),
 };
}
export type CampaignTransferMediaStage=Awaited<ReturnType<typeof createCampaignTransferMediaStage>>;
