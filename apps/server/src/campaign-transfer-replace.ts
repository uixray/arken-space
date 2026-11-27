import {rename} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
export class CampaignTransferFileBusy extends Error {
 constructor(){super('TRANSFER_REPAIR_FILE_BUSY');this.name='CampaignTransferFileBusy';}
}
/** Windows cannot replace an entry held by a reader. One shared repair deadline
 * bounds all retries; never unlink the current file to force a replacement. */
export async function replaceCampaignTransferFile(source:string,target:string,deadline:number,
 dependencies={rename,wait:(ms:number)=>setTimeout(ms),now:()=>performance.now(),windows:process.platform==='win32'}){
 let delay=25;
 for(;;){
  try{await dependencies.rename(source,target);return;}
  catch(error){
   const code=(error as NodeJS.ErrnoException).code;
   if(!dependencies.windows||!['EPERM','EACCES','EBUSY'].includes(code??''))throw error;
   const remaining=deadline-dependencies.now();
   if(remaining<=0)throw new CampaignTransferFileBusy();
   await dependencies.wait(Math.min(delay,remaining));delay=Math.min(delay*2,200);
  }
 }
}
