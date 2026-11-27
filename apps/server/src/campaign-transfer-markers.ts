import {randomUUID} from 'node:crypto';
import {open,link,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
/** Atomic owned metadata publication. A killed writer leaves either a complete
 * marker or an uncommitted .part file, never a partially published JSON marker.
 * Files are fsynced; this is not a universal hardware power-loss guarantee. */
export async function writeCampaignTransferMarker(path:string,value:unknown,replace=false){
 const parent=dirname(path);if(await realpath(parent)!==parent||(await lstat(parent)).isSymbolicLink())throw Error('TRANSFER_MARKER_PARENT');
 if(replace)try{const current=await lstat(path);if(!current.isFile()||current.isSymbolicLink())throw Error('TRANSFER_MARKER_TARGET');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const temporary=join(parent,'.part-'+randomUUID());let owned=false;
 try{const file=await open(temporary,'wx',0o600);owned=true;try{await file.writeFile(JSON.stringify(value)+'\n');await file.sync();}finally{await file.close();}
  if(replace)await rename(temporary,path);else await link(temporary,path);
 }finally{if(owned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
