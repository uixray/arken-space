import {randomUUID,createHash} from 'node:crypto';import {open,mkdir,lstat,realpath,link,unlink,type FileHandle} from 'node:fs/promises';import {join,isAbsolute} from 'node:path';
import {campaignTransferPolicies,type CampaignTransferTable} from './campaign-transfer-policy.js';import {verifyCampaignTransferRowFile} from './campaign-transfer-manifest.js';
/** Private data stage only. A later assembler must bind media/projections,
 * validate the complete package and publish its manifest as the commit marker. */
export async function createCampaignTransferDataStage(parent:string){
 if(!isAbsolute(parent)||(await lstat(parent)).isSymbolicLink()||!(await lstat(parent)).isDirectory())throw Error('CAMPAIGN_TRANSFER_STAGE_PARENT_INVALID');
 const canonical=await realpath(parent),root=join(canonical,'transfer-data-'+randomUUID()),folder=join(root,'tables');await mkdir(root,{mode:0o700});await mkdir(folder,{mode:0o700});
 let failed=false,total=0;const active=new Set<string>(),entries=new Map<string,{name:CampaignTransferTable;policy:string;rows:number;file:{sha256:string;bytes:number}|null}>();
 return {root,
  entries(){if(failed||active.size)throw Error('CAMPAIGN_TRANSFER_STAGE_INCOMPLETE');return [...entries.values()].map(e=>({...e,file:e.file?{...e.file}:null})).sort((a,b)=>a.name.localeCompare(b.name));},
  async write(table:CampaignTransferTable,lines:AsyncIterable<string>){
   if(failed)throw Error('CAMPAIGN_TRANSFER_STAGE_FAILED');if(!Object.hasOwn(campaignTransferPolicies,table)||campaignTransferPolicies[table]==='EXCLUDED_AUTH_RUNTIME')throw Error('CAMPAIGN_TRANSFER_STAGE_TABLE_FORBIDDEN');
   if(active.has(table)||entries.has(table))throw Error('CAMPAIGN_TRANSFER_STAGE_TABLE_DUPLICATE');active.add(table);
   const temporary=join(folder,'part-'+randomUUID());let handle:FileHandle|undefined,owned=false;
   try{
    if(await realpath(folder)!==folder||(await lstat(folder)).isSymbolicLink())throw Error('CAMPAIGN_TRANSFER_STAGE_PATH_INVALID');
    handle=await open(temporary,'wx',0o600);owned=true;const hash=createHash('sha256');let bytes=0,rows=0;
    for await(const raw of lines){const chunk=Buffer.from(raw+'\n');verifyCampaignTransferRowFile(chunk,1);bytes+=chunk.length;if(++rows>1000000||bytes>256*1024*1024||total+chunk.length>32*1024*1024*1024)throw Error('CAMPAIGN_TRANSFER_STAGE_LIMIT');total+=chunk.length;await handle.writeFile(chunk);hash.update(chunk);}
    await handle.sync();await handle.close();handle=undefined;
    const file=rows?{sha256:hash.digest('hex'),bytes}:null;
    if(rows)await link(temporary,join(folder,table+'.ndjson'));
    const entry={name:table,policy:campaignTransferPolicies[table],rows,file};entries.set(table,entry);return {...entry,file:file?{...file}:null};
   }catch(error){failed=true;throw error;}finally{try{await handle?.close();}finally{active.delete(table);if(owned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT'){failed=true;throw error;}});}}
  },
 };
}
