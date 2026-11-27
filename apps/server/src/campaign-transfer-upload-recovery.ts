import {readdir,lstat,realpath,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {z} from 'zod';
/** Signal zero checks OS liveness, never terminates a process. PID reuse or an
 * inaccessible process is conservatively treated as live, preserving its work. */
function isLive(pid:number){try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}}
export async function recoverCampaignTransferUploads(root:string,instanceId:string){
 if(await realpath(root)!==root||(await lstat(root)).isSymbolicLink())throw Error('TRANSFER_UPLOAD_RECOVERY_ROOT');
 const report={removed:0,live:0,preserved:0},entries=await readdir(root,{withFileTypes:true});if(entries.length>10000)throw Error('TRANSFER_UPLOAD_RECOVERY_LIMIT');
 const ownerSchema=z.object({version:z.literal(1),instanceId:z.string().uuid(),pid:z.number().int().positive().max(2147483647)}).strict();
 for(const entry of entries){
  if(!entry.isDirectory()||entry.isSymbolicLink()||!/^upload-[A-Za-z0-9]+$/.test(entry.name)){report.preserved++;continue;}
  const path=join(root,entry.name);if(dirname(path)!==root||await realpath(path)!==path)throw Error('TRANSFER_UPLOAD_RECOVERY_PATH');
  try{
   const marker=join(path,'owner.json'),info=await lstat(marker);if(!info.isFile()||info.isSymbolicLink()||info.size>1024)throw Error('INVALID_OWNER');
   const owner=ownerSchema.parse(JSON.parse(await readFile(marker,'utf8')));if(owner.instanceId!==instanceId)throw Error('FOREIGN_OWNER');
   if(isLive(owner.pid)){report.live++;continue;}
  }catch{report.preserved++;continue;}
  await rm(path,{recursive:true,force:true});report.removed++;
 }
 return report;
}
