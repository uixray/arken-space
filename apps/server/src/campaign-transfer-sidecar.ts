import {randomUUID,createHash} from 'node:crypto';import {lstat,realpath,open,link,unlink,type FileHandle} from 'node:fs/promises';import {join,isAbsolute} from 'node:path';import {verifyCampaignTransferRowFile} from './campaign-transfer-manifest.js';
/** Fixed-key internal sidecar writer. Does not publish a package manifest. */
export async function writeCampaignTransferSidecar(root:string,name:'media-bindings.ndjson'|'projections.ndjson',lines:Iterable<string>){
 if(!['media-bindings.ndjson','projections.ndjson'].includes(name)||!isAbsolute(root)||(await lstat(root)).isSymbolicLink()||await realpath(root)!==root)throw Error('CAMPAIGN_TRANSFER_SIDECAR_PATH_INVALID');
 const temporary=join(root,'part-'+randomUUID());let handle:FileHandle|undefined,owned=false;
 try{handle=await open(temporary,'wx',0o600);owned=true;let bytes=0,rows=0;const hash=createHash('sha256');
  for(const line of lines){const chunk=Buffer.from(line+'\n');verifyCampaignTransferRowFile(chunk,1);bytes+=chunk.length;if(++rows>100000||bytes>256*1024*1024)throw Error('CAMPAIGN_TRANSFER_SIDECAR_LIMIT');await handle.writeFile(chunk);hash.update(chunk);}
  await handle.sync();await handle.close();handle=undefined;if(!rows)return null;await link(temporary,join(root,name));return {sha256:hash.digest('hex'),bytes};
 }finally{try{await handle?.close();}finally{if(owned)await unlink(temporary);}}
}
