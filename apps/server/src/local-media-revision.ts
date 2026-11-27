import {createHash} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {sql} from 'drizzle-orm';
import {env} from './env.js';
type Database=ReturnType<typeof import('@arken/db').createDatabase>['db'];
/** Called only inside the already authenticated peer projection transaction.
 * Opaque completion generation exposes no paths or source archive metadata.
 * The complete marker is atomically replaced on repair and startup recovery.
 */
export async function readLocalMediaRevision(db:Database,campaignId:string):Promise<string>{
 const rows=await db.execute<{id:string}>(sql`SELECT id FROM local_campaign_imports WHERE campaign_id=${campaignId}`);
 const hash=createHash('sha256').update('local-media-v1');
 for(const row of rows){
  if(!/^[a-f0-9-]{36}$/.test(row.id))throw Error('LOCAL_MEDIA_RECEIPT_INVALID');
  const folder=join(env.MEDIA_ROOT,'import-media',row.id);
  hash.update(row.id);
  try{
   const directory=await lstat(folder);if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('LOCAL_MEDIA_NAMESPACE_INVALID');
   const info=await lstat(join(folder,'complete.json'));
   if(!info.isFile()||info.isSymbolicLink())throw Error('LOCAL_MEDIA_MARKER_INVALID');
   hash.update([info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':'));
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;hash.update('pending');}
 }
 return hash.digest('hex');
}
