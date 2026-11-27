import {replaceCampaignTransferFile} from './campaign-transfer-replace.js';
import {constants} from 'node:fs';
import {writeCampaignTransferMarker as writeOwned} from './campaign-transfer-markers.js';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,realpath,lstat,readFile,open,link,rm,readdir,unlink} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {chatAttachmentUploads} from '@arken/db';
import {env} from './env.js';
import {claimCampaignTransferArchiveStage} from './campaign-transfer-archive.js';
import {verifyCampaignTransferStructure} from './campaign-transfer-structure.js';
import {verifyCampaignTransferRowFile} from './campaign-transfer-manifest.js';
import {campaignTransferCatalog,type CampaignTransferTable} from './campaign-transfer-policy.js';
import {assertCampaignTransferTargetSchema} from './campaign-transfer-target-schema.js';
import {campaignTransferMediaBindingSchema} from './campaign-transfer-binding-schema.js';
import {campaignTransferProjectionSchema} from './campaign-transfer-projections.js';
import {materializeCampaignTransferAttachment} from './campaign-transfer-attachment-materialization.js';
import {createCampaignTransferMediaStage,pinCampaignTransferMedia,type CampaignTransferMediaStage} from './campaign-transfer-media.js';
type Database=ReturnType<typeof import('@arken/db').createDatabase>['db'];
type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const intentSchema=z.object({version:z.literal(1),id:uuid,instanceId:uuid,ownerId:uuid,campaignId:uuid,manifestSha256:hash,files:z.array(z.object({name:z.string().regex(/^[a-f0-9-]{36}\.bin$/),sha256:hash,bytes:z.number().int().positive().max(256*1024*1024)}).strict()).max(100000)}).strict();
type Scope={instanceId:string;ownerId:string;migrations:readonly string[];accountProof?:{sessionId:string;passwordHash:string}};
type RepairOutcome={state:'MEDIA_REPAIRED';id:string;campaignId:string;campaignAvailable:boolean;filesChecked:number;filesRestored:number;cleanupPending?:boolean};
const LOCK=683128;
async function privateDirectory(path:string){if((await lstat(path)).isSymbolicLink()||await realpath(path)!==path||!(await lstat(path)).isDirectory())throw Error('TRANSFER_IMPORT_PATH');}
async function localOwner(tx:Pick<Database,'execute'>,scope:Scope){
 if(env.DEPLOYMENT_MODE!=='LOCAL_HOST'||env.LOCAL_INSTANCE_ID!==scope.instanceId)throw Error('TRANSFER_IMPORT_LOCAL_HOST_REQUIRED');
 const found=await tx.execute(sql`SELECT i.id FROM local_host_instances i JOIN users u ON u.id=i.owner_user_id WHERE i.id=${scope.instanceId} AND i.owner_user_id=${scope.ownerId} AND u.identity_kind='LOCAL' AND u.local_instance_id=i.id AND u.local_approved_at IS NOT NULL AND u.disabled_at IS NULL AND u.password_change_required=false FOR SHARE OF i,u`);
 if(found.length!==1)throw Error('TRANSFER_IMPORT_OWNER_REQUIRED');
 if(scope.accountProof){
  uuid.parse(scope.accountProof.sessionId);
  const proof=await tx.execute(sql`SELECT s.id FROM account_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=${scope.accountProof.sessionId} AND s.user_id=${scope.ownerId} AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.password_hash=${scope.accountProof.passwordHash} FOR SHARE OF s`);
  if(proof.length!==1)throw Error('TRANSFER_IMPORT_ACCOUNT_PROOF_REQUIRED');
 }

}
/** Only the mutable membership dice-frame FK forms an inter-table cycle.
 * It is restored before commit. Self-FKs are inserted in one table statement,
 * retaining immutable version/history rows without UPDATE or disabled checks. */
function insertionOrder(){
 const tables=campaignTransferCatalog().filter(t=>t.policy!=='EXCLUDED_AUTH_RUNTIME'||t.name==='chat_attachment_uploads'),known=new Set(tables.map(t=>t.name)),done=new Set<string>(),ordered:CampaignTransferTable[]=[];
 while(done.size<tables.length){let moved=false;for(const table of tables)if(!done.has(table.name)&&table.foreignKeys.every(f=>f.table===table.name||!known.has(f.table)||done.has(f.table)||(table.name==='memberships'&&f.columns.length===1&&f.columns[0]==='dice_frame_asset_id'))){done.add(table.name);ordered.push(table.name as CampaignTransferTable);moved=true;}if(!moved)throw Error('TRANSFER_IMPORT_UNREVIEWED_FK_CYCLE');}
 if(tables.some(t=>t.name!=='game_events'&&t.foreignKeys.some(f=>f.table==='game_events')))throw Error('TRANSFER_IMPORT_EVENT_ORDER_UNREVIEWED');
 return [...ordered.filter(t=>t!=='game_events'),'game_events'] as CampaignTransferTable[];
}

async function importFence(tx:Transaction,scope:Scope){
 await tx.execute(sql`SET LOCAL lock_timeout='5s'`);await tx.execute(sql`SET LOCAL statement_timeout='30s'`);await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK})`);await localOwner(tx,scope);
}
async function readMarker(path:string,maxBytes=32*1024*1024){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>maxBytes||await realpath(path)!==path)throw Error('TRANSFER_IMPORT_MARKER_INVALID');return JSON.parse(await readFile(path,'utf8')) as unknown;
}
async function validMedia(path:string,expected:{bytes:number;sha256:string}){
 let handle:Awaited<ReturnType<typeof open>>|undefined;
 try{
  const before=await lstat(path,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size!==BigInt(expected.bytes)||await realpath(path)!==path)return false;
  handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=await handle.stat({bigint:true});if(opened.ino!==before.ino||opened.dev!==before.dev)return false;
  const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let size=0;
  while(size<=expected.bytes){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,expected.bytes-size+1),size);if(!bytesRead)break;digest.update(buffer.subarray(0,bytesRead));size+=bytesRead;}
  const after=await handle.stat({bigint:true});return size===expected.bytes&&after.size===opened.size&&after.mtimeNs===opened.mtimeNs&&digest.digest('hex')===expected.sha256;
 }catch{return false;}finally{await handle?.close();}
}
async function neededMediaKeys(tx:Transaction,prefix:string){return tx.execute<{key:string}>(sql`
   SELECT storage_key AS key FROM assets WHERE storage_key LIKE ${prefix+'%'}
   UNION SELECT poster_storage_key AS key FROM assets WHERE poster_storage_key LIKE ${prefix+'%'}
   UNION SELECT storage_key AS key FROM world_content_images WHERE storage_key LIKE ${prefix+'%'}
   UNION SELECT storage_key AS key FROM sticker_media WHERE storage_key LIKE ${prefix+'%'}
   UNION SELECT storage_key AS key FROM global_sticker_media WHERE storage_key LIKE ${prefix+'%'}
   UNION SELECT storage_key AS key FROM chat_attachment_uploads u WHERE storage_key LIKE ${prefix+'%'} AND EXISTS(SELECT 1 FROM chat_attachments a WHERE a.content_id=u.content_id)
   LIMIT 100001`);}
async function recoverUnderLock(tx:Transaction,id:string,scope:Scope,mediaRoot:string){
 const folder=join(mediaRoot,'import-media',id);await privateDirectory(folder);
 const receipts=await tx.execute<{manifest_sha256:string;campaign_id:string;instance_id:string;owner_user_id:string}>(sql`SELECT manifest_sha256,campaign_id,instance_id,owner_user_id FROM local_campaign_imports WHERE id=${id}`),receipt=receipts[0];
 if(receipt&&(receipt.instance_id!==scope.instanceId||receipt.owner_user_id!==scope.ownerId))return {state:'NEEDS_REVIEW' as const};
 let intent:z.infer<typeof intentSchema>|undefined;
 try{intent=intentSchema.parse(await readMarker(join(folder,'intent.json')));}catch{
  // Without a valid receipt/intent never delete unknown user files. A killed
  // atomic marker writer can only leave an empty directory or .part metadata.
  if(!receipt){const entries=await readdir(folder,{withFileTypes:true});if(entries.every(e=>e.isFile()&&/^\.part-[a-f0-9-]{36}$/.test(e.name))){await rm(folder,{recursive:true,force:true});return {state:'ROLLED_BACK' as const};}}
  return {state:'NEEDS_REVIEW' as const};
 }
 if(intent.id!==id||intent.instanceId!==scope.instanceId||intent.ownerId!==scope.ownerId)return {state:'NEEDS_REVIEW' as const};
 if(receipt){
  if(receipt.manifest_sha256!==intent.manifestSha256||receipt.campaign_id!==intent.campaignId)return {state:'NEEDS_REVIEW' as const};
  let complete=false;try{const marker=z.object({id:uuid,manifestSha256:hash}).strict().parse(await readMarker(join(folder,'complete.json'),1024));complete=marker.id===id&&marker.manifestSha256===intent.manifestSha256;}catch{/* finish an interrupted post-COMMIT marker below */}
  const prefix=`import-media/${id}/`,needed=await neededMediaKeys(tx,prefix);
  const planned=new Map(intent.files.map(f=>[prefix+f.name,f]));if(needed.length>100000)return {state:'COMMITTED' as const,campaignId:intent.campaignId,mediaState:'NEEDS_REPAIR' as const};
  for(const item of needed){
   const file=planned.get(item.key);let valid=false;
   if(file){const path=join(folder,file.name);if(complete)try{const info=await lstat(path);valid=info.isFile()&&!info.isSymbolicLink()&&info.size===file.bytes&&await realpath(path)===path;}catch{/* missing media is not a successful recovery */}else valid=await validMedia(path,file);}
   if(!valid)return {state:'COMMITTED' as const,campaignId:intent.campaignId,mediaState:'NEEDS_REPAIR' as const};
  }
  if(!complete)await writeOwned(join(folder,'complete.json'),{id,manifestSha256:intent.manifestSha256},true);
  for(const entry of await readdir(folder,{withFileTypes:true}))if(entry.isFile()&&!entry.isSymbolicLink()&&/^\.repair-[a-f0-9-]{36}$/.test(entry.name))await unlink(join(folder,entry.name));
  return {state:'COMMITTED' as const,campaignId:intent.campaignId,mediaState:'READY' as const};
 }
 if(dirname(folder)!==join(mediaRoot,'import-media')||await realpath(folder)!==folder)throw Error('TRANSFER_IMPORT_CLEANUP_PATH');
 await rm(folder,{recursive:true,force:true});return {state:'ROLLED_BACK' as const,campaignId:intent.campaignId};
}
/** The DB lock spans file creation/copy as well as SQL publication. Recovery
 * waits for a live importer; an unavailable DB never permits deletion. */
export async function recoverCampaignTransferImport(db:Database,id:string,scope:Scope){
 uuid.parse(id);const mediaRoot=await realpath(env.MEDIA_ROOT);return db.transaction(async tx=>{await importFence(tx,scope);return recoverUnderLock(tx,id,scope,mediaRoot);});
}
/** Startup gate for managed namespaces only. Unknown/corrupt folders are kept
 * and reported, not silently treated as successful or recursively erased. */
export async function recoverPendingCampaignTransfers(db:Database,scope:Scope){
 const mediaRoot=await realpath(env.MEDIA_ROOT),parent=join(mediaRoot,'import-media'),report={committed:0,rolledBack:0,needsRepair:0,preserved:0,scratchRemoved:0};
 let parentExists=true;try{await privateDirectory(parent);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')parentExists=false;else throw error;}
 return db.transaction(async tx=>{
  await importFence(tx,scope);await assertCampaignTransferTargetSchema(tx,scope.migrations);
  const entries=parentExists?await readdir(parent,{withFileTypes:true}):[];if(entries.length>10000)throw Error('TRANSFER_IMPORT_RECOVERY_LIMIT');
  const receiptIds=await tx.execute<{id:string}>(sql`SELECT id FROM local_campaign_imports WHERE instance_id=${scope.instanceId} AND owner_user_id=${scope.ownerId} LIMIT 10001`);if(receiptIds.length>10000)throw Error('TRANSFER_IMPORT_RECOVERY_LIMIT');
  const present=new Set(entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>e.name));for(const receipt of receiptIds)if(!present.has(receipt.id))report.needsRepair++;
  for(const entry of entries){
   if(entry.isSymbolicLink()||!entry.isDirectory()){report.preserved++;continue;}
   const path=join(parent,entry.name);
   if(/^transfer-[a-f0-9-]{36}$/.test(entry.name)){await privateDirectory(path);await rm(path,{recursive:true,force:true});report.scratchRemoved++;continue;}
   if(!uuid.safeParse(entry.name).success){report.preserved++;continue;}
   const state=await recoverUnderLock(tx,entry.name,scope,mediaRoot);if(state.state==='ROLLED_BACK')report.rolledBack++;else if(state.state==='COMMITTED'){if(state.mediaState==='READY')report.committed++;else report.needsRepair++;}else report.preserved++;
  }
  return report;
 });
}

function stageReader(stage:{root:string;manifest:import('./campaign-transfer-manifest.js').CampaignTransferManifest}){
 const descriptors=new Map<string,{bytes:number;sha256:string}>();
 for(const table of stage.manifest.tables)if(table.file)descriptors.set(`tables/${table.name}.ndjson`,table.file);
 if(stage.manifest.projections)descriptors.set('projections.ndjson',stage.manifest.projections);
 if(stage.manifest.mediaBindings)descriptors.set('media-bindings.ndjson',stage.manifest.mediaBindings);
 for(const media of stage.manifest.media)descriptors.set('media/'+media.sha256,media);
 return async(key:string,size?:number)=>{const entry=descriptors.get(key);if(!entry)throw Error('TRANSFER_IMPORT_INPUT_KEY');const path=join(stage.root,key),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||await realpath(path)!==path||info.size!==entry.bytes||(size!==undefined&&info.size!==size))throw Error('TRANSFER_IMPORT_INPUT_PATH');const bytes=await readFile(path);if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('TRANSFER_IMPORT_INPUT_INTEGRITY');return bytes;};
}

/** Internal atomic importer. Only a capability issued after complete archive
 * authentication can reach it. Public upload/auth/session handling is separate.
 * No trigger/constraint disabling, no replacement of an existing campaign. */
export async function importCampaignTransferStage(db:Database,input:object,scope:Scope){
 uuid.parse(scope.instanceId);uuid.parse(scope.ownerId);
 const stage=claimCampaignTransferArchiveStage(input),expected={campaignId:stage.manifest.campaignId,migrations:scope.migrations};
 const read=stageReader(stage);
 await privateDirectory(stage.root);const manifest=await verifyCampaignTransferStructure(stage.manifest,expected,read);
 if(BigInt(manifest.source.baselineSequence)>=9223372036854775807n)throw Error('TRANSFER_IMPORT_EVENT_SEQUENCE_EXHAUSTED');
 await db.transaction(tx=>localOwner(tx,scope));
 const bindings:z.infer<typeof campaignTransferMediaBindingSchema>[]=[],metadata=new Map<string,unknown>();
 if(manifest.mediaBindings)verifyCampaignTransferRowFile(await read('media-bindings.ndjson',manifest.mediaBindings.bytes),undefined,row=>bindings.push(campaignTransferMediaBindingSchema.parse(row)));
 if(manifest.projections)verifyCampaignTransferRowFile(await read('projections.ndjson',manifest.projections.bytes),undefined,row=>{const p=campaignTransferProjectionSchema.parse(row);if(p.kind==='MATERIALIZED_ATTACHMENT_METADATA')metadata.set(p.contentId.toLowerCase(),p);});
 const id=randomUUID(),mediaRoot=await realpath(env.MEDIA_ROOT),parent=join(mediaRoot,'import-media');await mkdir(parent,{recursive:true,mode:0o700});await privateDirectory(parent);
 const folder=join(parent,id);
 const files=bindings.map(binding=>({binding,name:randomUUID()+'.bin'})),keys=new Map(files.map(f=>[f.binding.kind+':'+f.binding.id.toLowerCase(),`import-media/${id}/${f.name}`]));
 const intent=intentSchema.parse({version:1,id,instanceId:scope.instanceId,ownerId:scope.ownerId,campaignId:manifest.campaignId,manifestSha256:manifest.sha256,files:files.map(f=>({name:f.name,sha256:f.binding.sha256,bytes:f.binding.bytes}))});
 let mediaStage:CampaignTransferMediaStage|undefined,committed=false,ownedNamespace=false;
 const result:{state:'IMPORTED';id:string;campaignId:string;ownerMembershipId:string;cleanupPending?:boolean}={state:'IMPORTED',id,campaignId:manifest.campaignId,ownerMembershipId:manifest.sourceOwnerMembershipId};
 try{
  await db.transaction(async tx=>{
   await tx.execute(sql`SET LOCAL lock_timeout='5s'`);await tx.execute(sql`SET LOCAL statement_timeout='30s'`);await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK})`);await localOwner(tx,scope);await assertCampaignTransferTargetSchema(tx,scope.migrations);
   const existing=await tx.execute(sql`SELECT id FROM campaigns WHERE id=${manifest.campaignId}`);if(existing.length)throw Error('TRANSFER_IMPORT_CAMPAIGN_EXISTS');
   // Namespace creation/copy and publication share the recovery lock. Another
   // process cannot mistake an active file-copy phase for an abandoned import.
   await mkdir(folder,{mode:0o700});ownedNamespace=true;await writeOwned(join(folder,'intent.json'),intent);
   mediaStage=await createCampaignTransferMediaStage(parent);
   for(const file of files){const pin=await pinCampaignTransferMedia(stage.root,{storageKey:'media/'+file.binding.sha256,mimeType:file.binding.mimeType,sizeBytes:file.binding.bytes,sha256:file.binding.sha256});await mediaStage.copy(pin);await link(join(mediaStage.root,'media',file.binding.sha256),join(folder,file.name));}
   await localOwner(tx,scope); // clock/session proof after a potentially long copy

   // Prevent application INSERT/default-nextval races while preserving the
   // original exact event sequences and advancing the local writer sequence.
   const diceFrames:{id:string;asset:string}[]=[];
   for(const name of insertionOrder()){
    if(name==='chat_attachment_uploads'){
     for(const binding of bindings)if(binding.kind==='CHAT_ATTACHMENT'){const record=materializeCampaignTransferAttachment(metadata.get(binding.id.toLowerCase()),binding);await tx.insert(chatAttachmentUploads).values({...record,storageKey:keys.get(binding.kind+':'+binding.id.toLowerCase())!});}
     continue;
    }
    const table=manifest.tables.find(t=>t.name===name);if(!table?.file)continue;
    const bytes=await read(`tables/${name}.ndjson`,table.file.bytes);if(createHash('sha256').update(bytes).digest('hex')!==table.file.sha256)throw Error('TRANSFER_IMPORT_TABLE_INTEGRITY');
    const rows:string[]=[];verifyCampaignTransferRowFile(bytes,table.rows,(row,raw)=>{
     if(name==='memberships'&&typeof row.dice_frame_asset_id==='string')diceFrames.push({id:row.id as string,asset:row.dice_frame_asset_id});rows.push(raw);
    });
    // Keep bigint-bearing JSON text intact; only explicitly mapped fields are
    // patched by PostgreSQL JSONB operators, never JSON.stringify(parsed rows).
    let patch=sql`'{}'::jsonb`;
    if(name==='memberships')patch=sql`jsonb_build_object('user_id',CASE WHEN lower(source.row->>'id')=lower(${manifest.sourceOwnerMembershipId}) THEN ${scope.ownerId}::uuid ELSE NULL END,'dice_frame_asset_id',NULL)`;
    const kinds:Record<string,string>={assets:'ASSET_ORIGINAL',world_content_images:'WORLD_IMAGE',sticker_media:'STICKER_MEDIA',global_sticker_media:'GLOBAL_STICKER_MEDIA'};
    if(kinds[name]){
     const kind=kinds[name]!,mapping=Object.fromEntries(bindings.filter(b=>b.kind===kind).map(b=>[b.id.toLowerCase(),keys.get(kind+':'+b.id.toLowerCase())!]));
     patch=sql`jsonb_build_object('storage_key',${JSON.stringify(mapping)}::jsonb->lower(source.row->>'id'))`;
     if(name==='assets'){const posters=Object.fromEntries(bindings.filter(b=>b.kind==='ASSET_POSTER').map(b=>[b.id.toLowerCase(),keys.get(b.kind+':'+b.id.toLowerCase())!]));patch=sql`${patch}||jsonb_build_object('poster_storage_key',${JSON.stringify(posters)}::jsonb->lower(source.row->>'id'))`;}
    }
    if(name==='game_events')await tx.execute(sql`LOCK TABLE game_events IN ACCESS EXCLUSIVE MODE`);
    await tx.execute(sql`INSERT INTO public.${sql.identifier(name)} SELECT record.* FROM jsonb_array_elements(${`[${rows.join(',')}]`}::jsonb) AS source(row) CROSS JOIN LATERAL jsonb_populate_record(NULL::public.${sql.identifier(name)},source.row||${patch}) AS record`);
    if(name==='campaigns')await tx.execute(sql`DELETE FROM chat_threads WHERE campaign_id=${manifest.campaignId}`); // only fresh trigger-created empty streams
   }
   for(const frame of diceFrames)await tx.execute(sql`UPDATE memberships SET dice_frame_asset_id=${frame.asset} WHERE id=${frame.id}`);
   await tx.execute(sql`INSERT INTO local_campaign_imports(id,instance_id,owner_user_id,campaign_id,manifest_sha256,source_baseline_sequence,source_schema_digest) VALUES(${id},${scope.instanceId},${scope.ownerId},${manifest.campaignId},${manifest.sha256},${manifest.source.baselineSequence}::bigint,${manifest.source.schemaDigest})`);
   // Historical imported events are already inserted. Establish durable local
   // ownership now, before preparation writes can commit; peer access stays off.
   await tx.execute(sql`INSERT INTO local_session_authorities(campaign_id,host_id,session_id,epoch,active) VALUES(${manifest.campaignId},${scope.instanceId},${randomUUID()},1,false)`);
   await tx.execute(sql`LOCK TABLE game_events IN ACCESS EXCLUSIVE MODE`);
   await tx.execute(sql`SELECT setval(pg_get_serial_sequence('game_events','sequence'),GREATEST((SELECT coalesce(max(sequence),1) FROM game_events),(SELECT last_value FROM game_events_sequence_seq)),true)`);
  });
  committed=true;await writeOwned(join(folder,'complete.json'),{id,manifestSha256:manifest.sha256},true);
  return result;
 }catch(error){
  // COMMIT transport errors are ambiguous. Reacquire the DB lock and consult
  // the receipt; never delete media merely because the client saw an error.
  if(ownedNamespace){
   try{const recovered=await recoverCampaignTransferImport(db,id,scope);if(recovered.state==='COMMITTED'&&recovered.mediaState==='READY'){committed=true;return result;}}catch{/* unknown outcome: retain the namespace for startup recovery */}
  }
  throw error;
 }finally{
  if(mediaStage)try{const root=mediaStage.root,part=relative(parent,root);if(isAbsolute(part)||!/^transfer-[a-f0-9-]{36}$/.test(part))throw Error('TRANSFER_IMPORT_STAGE_CLEANUP_PATH');try{await privateDirectory(root);await rm(root,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  catch(error){if(committed)result.cleanupPending=true;else throw error;}
 }
}

/** Explicit media-only recovery. The original authenticated manifest must match
 * the committed receipt. Current rows are locked/read, never restored from old
 * table snapshots. Replaced/deleted live media is therefore not resurrected. */
export async function repairCampaignTransferMedia(db:Database,input:object,scope:Scope){
 const stage=claimCampaignTransferArchiveStage(input),read=stageReader(stage),manifest=await verifyCampaignTransferStructure(stage.manifest,{campaignId:stage.manifest.campaignId,migrations:scope.migrations},read);
 const bindings:z.infer<typeof campaignTransferMediaBindingSchema>[]=[];
 if(manifest.mediaBindings)verifyCampaignTransferRowFile(await read('media-bindings.ndjson',manifest.mediaBindings.bytes),undefined,row=>bindings.push(campaignTransferMediaBindingSchema.parse(row)));
 const mediaRoot=await realpath(env.MEDIA_ROOT),parent=join(mediaRoot,'import-media');await mkdir(parent,{recursive:true,mode:0o700});await privateDirectory(parent);
 let scratch:CampaignTransferMediaStage|undefined,outcome:RepairOutcome|undefined;
 try{outcome=await db.transaction(async tx=>{
  await importFence(tx,scope);await assertCampaignTransferTargetSchema(tx,scope.migrations);
  const [receipt]=await tx.execute<{id:string;instance_id:string;owner_user_id:string;manifest_sha256:string}>(sql`SELECT id,instance_id,owner_user_id,manifest_sha256 FROM local_campaign_imports WHERE campaign_id=${manifest.campaignId} FOR UPDATE`);
  if(!receipt||receipt.instance_id!==scope.instanceId||receipt.owner_user_id!==scope.ownerId||receipt.manifest_sha256!==manifest.sha256)throw Error('TRANSFER_REPAIR_ORIGINAL_ARCHIVE_REQUIRED');
  await tx.execute(sql`UPDATE local_campaign_imports SET source_baseline_sequence=coalesce(source_baseline_sequence,${manifest.source.baselineSequence}::bigint),source_schema_digest=coalesce(source_schema_digest,${manifest.source.schemaDigest}) WHERE id=${receipt.id}`);
  uuid.parse(receipt.id);const prefix=`import-media/${receipt.id}/`,folder=join(parent,receipt.id);
  const definitions={
   ASSET_ORIGINAL:{table:'assets',identity:'id',key:'storage_key',bytes:'size_bytes',mime:'mime_type'},
   ASSET_POSTER:{table:'assets',identity:'id',key:'poster_storage_key',bytes:'poster_size_bytes',mime:null},
   WORLD_IMAGE:{table:'world_content_images',identity:'id',key:'storage_key',bytes:'size_bytes',mime:'mime_type'},
   STICKER_MEDIA:{table:'sticker_media',identity:'id',key:'storage_key',bytes:'size_bytes',mime:'mime_type'},
   GLOBAL_STICKER_MEDIA:{table:'global_sticker_media',identity:'id',key:'storage_key',bytes:'size_bytes',mime:'mime_type'},
   CHAT_ATTACHMENT:{table:'chat_attachment_uploads',identity:'content_id',key:'storage_key',bytes:'size_bytes',mime:'mime_type'},
  } as const;
  const plans=new Map<string,{name:string;sha256:string;bytes:number;mimeType:string}>();
  for(const binding of [...bindings].sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id))){
   const def=definitions[binding.kind],active=binding.kind==='CHAT_ATTACHMENT'?sql`t.status='CLAIMED' AND EXISTS(SELECT 1 FROM chat_attachments a WHERE a.content_id=t.content_id)`:sql`true`;
   const campaignBound=['ASSET_ORIGINAL','ASSET_POSTER','STICKER_MEDIA','CHAT_ATTACHMENT'].includes(binding.kind)?sql`t.campaign_id=${manifest.campaignId}`:sql`true`;
   const [row]=await tx.execute<{key:string;bytes:number;mime:string}>(sql`SELECT t.${sql.identifier(def.key)} AS key,t.${sql.identifier(def.bytes)} AS bytes,${def.mime?sql`t.${sql.identifier(def.mime)}`:sql`'image/webp'::text`} AS mime FROM public.${sql.identifier(def.table)} t WHERE t.${sql.identifier(def.identity)}=${binding.id} AND t.${sql.identifier(def.key)} LIKE ${prefix+'%'} AND ${active} AND ${campaignBound} FOR UPDATE OF t`);
   if(!row)continue;
   const name=row.key.slice(prefix.length);if(!/^[a-f0-9-]{36}\.bin$/.test(name)||row.bytes!==binding.bytes||row.mime!==binding.mimeType)throw Error('TRANSFER_REPAIR_CURRENT_MEDIA_CHANGED');
   const previous=plans.get(row.key);if(previous&&(previous.sha256!==binding.sha256||previous.bytes!==binding.bytes))throw Error('TRANSFER_REPAIR_BINDING_CONFLICT');
   plans.set(row.key,{name,sha256:binding.sha256,bytes:binding.bytes,mimeType:binding.mimeType});
  }
  const needed=await neededMediaKeys(tx,prefix);if(needed.length>100000||needed.some(row=>!plans.has(row.key)))throw Error('TRANSFER_REPAIR_UNKNOWN_LIVE_REFERENCE');
  try{await mkdir(folder,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}await privateDirectory(folder);
  try{const old=intentSchema.parse(await readMarker(join(folder,'intent.json')));if(old.id!==receipt.id||old.instanceId!==scope.instanceId||old.ownerId!==scope.ownerId||old.manifestSha256!==manifest.sha256)throw Error('TRANSFER_REPAIR_FOREIGN_INTENT');}
  catch(error){if(error instanceof Error&&error.message==='TRANSFER_REPAIR_FOREIGN_INTENT')throw error;/* reconstruct damaged/missing metadata from receipt + current refs */}
  // Mark the repair pending before copy/hash so a killed repair is checked deeply.
  await unlink(join(folder,'complete.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await writeOwned(join(folder,'intent.json'),{version:1,id:receipt.id,instanceId:scope.instanceId,ownerId:scope.ownerId,campaignId:manifest.campaignId,manifestSha256:manifest.sha256,files:[...plans.values()].map(({mimeType:_,...plan})=>plan)},true);
  const repairs:Array<{name:string;sha256:string;bytes:number;mimeType:string}>=[];
  for(const plan of plans.values())if(!await validMedia(join(folder,plan.name),plan))repairs.push(plan);
  if(repairs.length){scratch=await createCampaignTransferMediaStage(parent);for(const plan of repairs){const pin=await pinCampaignTransferMedia(stage.root,{storageKey:'media/'+plan.sha256,mimeType:plan.mimeType,sizeBytes:plan.bytes,sha256:plan.sha256});await scratch.copy(pin);}}
  await localOwner(tx,scope);
  let restored=0;const replacementDeadline=performance.now()+3000;
  for(const plan of repairs){
   const target=join(folder,plan.name);try{const info=await lstat(target);if(!info.isFile()||info.isSymbolicLink())throw Error('TRANSFER_REPAIR_TARGET_INVALID');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const temporary=join(folder,'.repair-'+randomUUID());let owned=false;
   try{await link(join(scratch!.root,'media',plan.sha256),temporary);owned=true;await replaceCampaignTransferFile(temporary,target,replacementDeadline);restored++;}finally{if(owned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  for(const plan of plans.values())if(!await validMedia(join(folder,plan.name),plan))throw Error('TRANSFER_REPAIR_VERIFICATION_FAILED');
  await writeOwned(join(folder,'complete.json'),{id:receipt.id,manifestSha256:manifest.sha256},true);
  const available=await tx.execute(sql`SELECT m.id FROM memberships m JOIN campaigns c ON c.id=m.campaign_id WHERE m.id=${manifest.sourceOwnerMembershipId} AND m.campaign_id=${manifest.campaignId} AND m.user_id=${scope.ownerId} AND m.role='GM' AND m.access_revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM campaign_archive_state a WHERE a.campaign_id=c.id AND a.archived_at IS NOT NULL)`);
  return {state:'MEDIA_REPAIRED' as const,id:receipt.id,campaignId:manifest.campaignId,campaignAvailable:available.length===1,filesChecked:plans.size,filesRestored:restored};
 });return outcome;}finally{
  if(scratch)try{const root=scratch.root,part=relative(parent,root);if(isAbsolute(part)||!/^transfer-[a-f0-9-]{36}$/.test(part))throw Error('TRANSFER_REPAIR_CLEANUP_PATH');try{await privateDirectory(root);await rm(root,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  catch(error){if(outcome)outcome.cleanupPending=true;else throw error;}
 }
}
