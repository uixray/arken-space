import {randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,lstat,realpath,readdir,rm,statfs,stat,open} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {encryptCampaignTransferArchive} from './campaign-transfer-archive.js';
import type {CampaignTransferManifest} from './campaign-transfer-manifest.js';

export type TransferExportActor={userId:string;sessionId:string;passwordHash:string;campaignId:string;membershipId:string};
type Job={id:string;actor:TransferExportActor;expiresAt:number;state:'PREPARING'|'READY'|'FAILED';bytes?:number;root:string;work:Promise<void>;readers:number};
const TTL=15*60*1000,RESERVE=128n*1024n*1024n;
const ownedName=/^export-[a-f0-9-]{36}$/;
/** One bounded export worker per process. Only encrypted READY files survive
 * capture; job credentials are memory-only and bound to the originating account
 * session/password generation. Restart invalidates URLs. Expired orphan stages
 * from a crashed worker are swept from this dedicated private root. */
export async function createCampaignTransferExporter(parent:string){
 await mkdir(parent,{recursive:true,mode:0o700});if((await lstat(parent)).isSymbolicLink()||await realpath(parent)!==parent)throw Error('TRANSFER_EXPORT_ROOT_INVALID');
 const jobs=new Map<string,Job>();let active=false,closed=false;
 async function remove(root:string){
  if(dirname(root)!==parent||!ownedName.test(basename(root)))throw Error('TRANSFER_EXPORT_CLEANUP_PATH');
  try{if((await lstat(root)).isSymbolicLink()||await realpath(root)!==root)throw Error('TRANSFER_EXPORT_CLEANUP_PATH');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  await rm(root,{recursive:true,force:true});
 }
 async function sweep(){
  const now=Date.now();
  for(const job of jobs.values())if(job.expiresAt<=now&&job.state!=='PREPARING'&&!job.readers){await remove(job.root);jobs.delete(job.id);}
  for(const entry of await readdir(parent,{withFileTypes:true}))if(entry.isDirectory()&&ownedName.test(entry.name)&&!jobs.has(entry.name.slice(7))){const path=join(parent,entry.name);if(now-(await lstat(path)).mtimeMs>TTL+3600000)await remove(path);}
 }
 await sweep();const timer=setInterval(()=>{void sweep().catch(()=>undefined);},60000);timer.unref();
 const matches=(a:TransferExportActor,b:TransferExportActor)=>a.userId===b.userId&&a.sessionId===b.sessionId&&a.passwordHash===b.passwordHash&&a.campaignId===b.campaignId&&a.membershipId===b.membershipId;
 function lookup(id:string,actor:TransferExportActor){const job=jobs.get(id);return job&&job.expiresAt>Date.now()&&matches(job.actor,actor)?job:null;}
 return {
  start(actor:TransferExportActor,password:string,capture:(root:string)=>Promise<{root:string;manifest:CampaignTransferManifest}>,onReady?:(manifest:CampaignTransferManifest)=>Promise<void>){
   if(closed||active||jobs.size>=8)throw Error('TRANSFER_EXPORT_BUSY');active=true;
   const id=randomUUID(),root=join(parent,'export-'+id),job:Job={id,actor:{...actor},root,state:'PREPARING',expiresAt:Date.now()+TTL,work:Promise.resolve(),readers:0};jobs.set(id,job);
   job.work=(async()=>{let owned=false;try{
    const disk=await statfs(parent,{bigint:true});if(disk.bavail*disk.bsize<RESERVE)throw Error('TRANSFER_EXPORT_DISK_SPACE');
    await mkdir(root,{mode:0o700});owned=true;const scratch=join(root,'capture');await mkdir(scratch,{mode:0o700});
    const candidate=await capture(scratch),m=candidate.manifest;
    const bytes=m.tables.reduce((s,t)=>s+BigInt(t.file?.bytes??0),0n)+m.media.reduce((s,t)=>s+BigInt(t.bytes),0n)+BigInt((m.projections?.bytes??0)+(m.mediaBindings?.bytes??0));
    const available=await statfs(parent,{bigint:true});if(available.bavail*available.bsize<bytes+RESERVE)throw Error('TRANSFER_EXPORT_DISK_SPACE');
    await pipeline(Readable.from(encryptCampaignTransferArchive(m,key=>createReadStream(join(candidate.root,key)),password)),createWriteStream(join(root,'campaign.arken'),{flags:'wx',mode:0o600}));
    const archiveHandle=await open(join(root,'campaign.arken'),'r+');try{await archiveHandle.sync();}finally{await archiveHandle.close();}
    // scratch is our own fixed child; never a caller-selected capture path.
    if(await realpath(scratch)!==scratch||dirname(scratch)!==root)throw Error('TRANSFER_EXPORT_CLEANUP_PATH');
    await rm(scratch,{recursive:true,force:true});
    await onReady?.(m);
    job.bytes=(await stat(join(root,'campaign.arken'))).size;job.state='READY';job.expiresAt=Date.now()+TTL;
   }catch{if(owned)await remove(root);job.state='FAILED';}finally{password='';active=false;}})();
   // Keep cleanup failures observable without an unhandled rejection.
   void job.work.catch(()=>{job.state='FAILED';});
   return {id,state:job.state,expiresAt:new Date(job.expiresAt).toISOString()};
  },
  status(id:string,actor:TransferExportActor){const job=lookup(id,actor);return job?{id,state:job.state,bytes:job.bytes,expiresAt:new Date(job.expiresAt).toISOString()}:null;},
  download(id:string,actor:TransferExportActor){
   const job=lookup(id,actor);if(!job||job.state!=='READY')return null;
   const stream=createReadStream(join(job.root,'campaign.arken'));job.readers++;let released=false;
   stream.once('close',()=>{if(!released){released=true;job.readers--;}});
   return {stream,bytes:job.bytes!};
  },
  async close(){closed=true;clearInterval(timer);await Promise.allSettled([...jobs.values()].map(j=>j.work));for(const job of jobs.values())if(!job.readers)await remove(job.root);jobs.clear();},
 };
}
