import {createCipheriv, createDecipheriv, createHash, randomBytes, scrypt} from 'node:crypto';
import {mkdtemp, mkdir, open, readFile, realpath, rm, statfs} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {TextDecoder} from 'node:util';
import {assertCampaignTransferUniqueJsonKeys} from './campaign-transfer-json.js';
import {verifyCampaignTransferManifest, type CampaignTransferManifest} from './campaign-transfer-manifest.js';
import {verifyCampaignTransferStructure} from './campaign-transfer-structure.js';

// Versioned streaming envelope, not ZIP: no entry names, compression, source
// paths, permissions or executable metadata are accepted from the archive.
// Every frame authenticates its position and header. A final empty frame is
// mandatory; a valid prefix can never become a successfully imported package.
const MAGIC=Buffer.from('ARKEN-XFER-ENC1\n'), CHUNK=65536, MAX_MANIFEST=1024*1024, MAX_FRAMES=2000000;
type Expected={campaignId?:string;migrations:readonly string[]};
const ownedStages=new WeakMap<object,{root:string;manifest:CampaignTransferManifest}>();
/** One-shot capability: an HTTP caller cannot nominate filesystem roots. */
export function claimCampaignTransferArchiveStage(input:object){const stage=ownedStages.get(input);if(!stage)throw Error('CAMPAIGN_TRANSFER_STAGE_UNOWNED_OR_CONSUMED');ownedStages.delete(input);return structuredClone(stage);}

type Read=(key:string,bytes:number)=>AsyncIterable<Uint8Array>;
function entries(manifest:CampaignTransferManifest){
 return [
  ...manifest.tables.flatMap(t=>t.file?[{key:`tables/${t.name}.ndjson`,...t.file}]:[]),
  ...(manifest.projections?[{key:'projections.ndjson',...manifest.projections}]:[]),
  ...(manifest.mediaBindings?[{key:'media-bindings.ndjson',...manifest.mediaBindings}]:[]),
  ...manifest.media.map(m=>({key:`media/${m.sha256}`,...m})),
 ];
}
async function derive(password:string,salt:Buffer){
 const secret=Buffer.from(password,'utf8');
 if(secret.length<12||secret.length>1024)throw Error('CAMPAIGN_TRANSFER_PASSWORD_LENGTH');
 try{return await new Promise<Buffer>((resolve,reject)=>scrypt(secret,salt,32,{N:32768,r:8,p:1,maxmem:96*1024*1024},(error,key)=>error?reject(error):resolve(key)));}
 finally{secret.fill(0);}
}
function nonce(header:Buffer,counter:number){const iv=Buffer.alloc(12);header.copy(iv,0,MAGIC.length+16,MAGIC.length+24);iv.writeUInt32BE(counter,8);return iv;}
function frameHeader(counter:number,length:number,final:boolean){const b=Buffer.alloc(9);b.writeUInt32BE(counter);b.writeUInt32BE(length,4);b[8]=final?1:0;return b;}

/** Consume completely before publishing the output file. A failing source or
 * cancelled download cannot emit the final authenticated completion frame. */
export async function* encryptCampaignTransferArchive(input:unknown,read:Read,password:string){
 const raw=input as CampaignTransferManifest;
 const manifest=verifyCampaignTransferManifest(raw,{campaignId:raw.campaignId,migrations:raw.source.migrations});
 const metadata=Buffer.from(JSON.stringify(manifest),'utf8');if(metadata.length>MAX_MANIFEST)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_MANIFEST_LIMIT');
 const header=Buffer.concat([MAGIC,randomBytes(16),randomBytes(8)]),key=await derive(password,header.subarray(MAGIC.length,MAGIC.length+16));
 let counter=0;
 function seal(bytes:Buffer,final=false){
  if(counter>=MAX_FRAMES)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_FRAME_LIMIT');
  const frame=frameHeader(counter,bytes.length,final),cipher=createCipheriv('aes-256-gcm',key,nonce(header,counter++));cipher.setAAD(Buffer.concat([header,frame]));
  return Buffer.concat([frame,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
 }
 try{
  yield header;const size=Buffer.alloc(4);size.writeUInt32BE(metadata.length);
  for(const bytes of [size,metadata])for(let start=0;start<bytes.length;start+=CHUNK)yield seal(bytes.subarray(start,start+CHUNK));
  for(const entry of entries(manifest)){
   let bytes=0;const hash=createHash('sha256');
   for await(const incoming of read(entry.key,entry.bytes)){
    if(!(incoming instanceof Uint8Array))throw Error('CAMPAIGN_TRANSFER_ARCHIVE_SOURCE_INVALID');
    for(let start=0;start<incoming.length;start+=CHUNK){const part=Buffer.from(incoming.subarray(start,start+CHUNK));bytes+=part.length;if(bytes>entry.bytes)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_SOURCE_SIZE');hash.update(part);yield seal(part);}
   }
   if(bytes!==entry.bytes||hash.digest('hex')!==entry.sha256)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_SOURCE_INTEGRITY');
  }
  yield seal(Buffer.alloc(0),true);
 }finally{key.fill(0);}
}

// Bounded pull reader. The producer is responsible for bounded transport chunks;
// only the current transport chunk and requested bytes are retained here.
function reader(input:AsyncIterable<Uint8Array>){
 const iterator=input[Symbol.asyncIterator]();let current=Buffer.alloc(0),offset=0,ended=false;
 return {
  async exact(length:number){const result=Buffer.alloc(length);let written=0;while(written<length){
   if(offset===current.length){const next=await iterator.next();if(next.done){ended=true;throw Error('CAMPAIGN_TRANSFER_ARCHIVE_TRUNCATED');}if(!(next.value instanceof Uint8Array))throw Error('CAMPAIGN_TRANSFER_ARCHIVE_INPUT_INVALID');current=Buffer.from(next.value);offset=0;if(!current.length)continue;}
   const take=Math.min(length-written,current.length-offset);current.copy(result,written,offset,offset+take);offset+=take;written+=take;
  }return result;},
  async end(){if(offset!==current.length)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_TRAILING_DATA');while(!ended){const next=await iterator.next();if(next.done){ended=true;break;}if(next.value.byteLength)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_TRAILING_DATA');}},
  async close(){await iterator.return?.();},
 };
}

/** Decrypts into a newly owned private staging directory only. No campaign DB,
 * identity or live media writes. The directory is returned only after complete
 * authentication AND structural qualification; failures remove this stage. */
export async function stageCampaignTransferArchive(input:AsyncIterable<Uint8Array>,password:string,expected:Expected,parent:string){
 const encrypted=reader(input);let key:Buffer|undefined,root:string|undefined,canonicalParent:string|undefined;
 try{
  const header=await encrypted.exact(MAGIC.length+24);if(!header.subarray(0,MAGIC.length).equals(MAGIC))throw Error('CAMPAIGN_TRANSFER_ARCHIVE_VERSION');
  key=await derive(password,header.subarray(MAGIC.length,MAGIC.length+16));let counter=0,final=false;
  async function* plaintext(){while(!final){
   const frame=await encrypted.exact(9),length=frame.readUInt32BE(4),last=frame[8];
   if(frame.readUInt32BE(0)!==counter||counter>=MAX_FRAMES||length>CHUNK||!(last===0||last===1)||Boolean(last)!==(length===0))throw Error('CAMPAIGN_TRANSFER_ARCHIVE_FRAME_INVALID');
   const bytes=await encrypted.exact(length),tag=await encrypted.exact(16),cipher=createDecipheriv('aes-256-gcm',key!,nonce(header,counter++));cipher.setAAD(Buffer.concat([header,frame]));cipher.setAuthTag(tag);
   // Never yield decipher.update plaintext before final verifies the frame tag.
   const clear=Buffer.concat([cipher.update(bytes),cipher.final()]);
   if(last){final=true;await encrypted.end();return;}yield clear;
  }}
  const clear=reader(plaintext());
  try{
   const length=(await clear.exact(4)).readUInt32BE();if(length<1||length>MAX_MANIFEST)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_MANIFEST_LIMIT');
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(await clear.exact(length));assertCampaignTransferUniqueJsonKeys(raw);
   const decoded=JSON.parse(raw),manifest=verifyCampaignTransferManifest(decoded,{campaignId:expected.campaignId??decoded?.campaignId,migrations:expected.migrations}),files=entries(manifest);
   const canonical=await realpath(parent);canonicalParent=canonical;if(canonical!==parent)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_STAGE_PATH');
   const disk=await statfs(parent,{bigint:true}),required=files.reduce((sum,f)=>sum+BigInt(f.bytes),0n)+BigInt(metadataReserve);
   if(disk.bavail*disk.bsize<required)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_DISK_SPACE');
   root=await mkdtemp(join(parent,'transfer-decrypt-'));await mkdir(join(root,'tables'),{mode:0o700});await mkdir(join(root,'media'),{mode:0o700});
   for(const entry of files){
    const handle=await open(join(root,entry.key),'wx',0o600),hash=createHash('sha256');
    try{let remaining=entry.bytes;while(remaining){const part=await clear.exact(Math.min(CHUNK,remaining));hash.update(part);await handle.writeFile(part);remaining-=part.length;}await handle.sync();}
    finally{await handle.close();}
    if(hash.digest('hex')!==entry.sha256)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_FILE_INTEGRITY');
   }
   await clear.end();if(!final)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_COMPLETION_REQUIRED');
   await verifyCampaignTransferStructure(manifest,{campaignId:manifest.campaignId,migrations:expected.migrations},async key=>readFile(join(root!,key)));
   const handle=await open(join(root,'candidate-manifest.json'),'wx',0o600);try{await handle.writeFile(JSON.stringify(manifest)+'\n');await handle.sync();}finally{await handle.close();}
   const stage={state:'AUTHENTICATED_PRIVATE_STAGE' as const,root,manifest};ownedStages.set(stage,{root,manifest:structuredClone(manifest)});return Object.freeze(stage);
  }finally{await clear.close();}
 }catch(error){
  if(root){
   // Only our freshly created, canonical direct child can be recursively removed.
   if(dirname(root)!==canonicalParent||!/^transfer-decrypt-[A-Za-z0-9]+$/.test(basename(root))||await realpath(root)!==root)throw Error('CAMPAIGN_TRANSFER_ARCHIVE_CLEANUP_PATH');
   await rm(root,{recursive:true,force:true});
  }
  throw error;
 }
 finally{key?.fill(0);await encrypted.close();}
}
const metadataReserve=64*1024*1024;
