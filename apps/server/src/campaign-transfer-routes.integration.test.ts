import {createCampaignTransferManifest} from './campaign-transfer-manifest.js';
import {encryptCampaignTransferArchive} from './campaign-transfer-archive.js';
import {PgDialect} from 'drizzle-orm/pg-core';
import multipart from '@fastify/multipart';
import {importCampaignTransferStage,recoverCampaignTransferImport,repairCampaignTransferMedia} from './campaign-transfer-import.js';
import {initializeLocalOwner,inspectLocalHost} from './local-host-identity.js';
import {readStoredImage} from './storage.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import sharp from 'sharp';
import {it,expect} from 'vitest';
import {drizzle} from 'drizzle-orm/pglite';
import {readMigrationFiles} from 'drizzle-orm/migrator';
import {eq,sql} from 'drizzle-orm';
import {mkdir,mkdtemp,readFile,readdir,rm,realpath,writeFile,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import * as schema from '@arken/db';
import {createMigratedPglite} from '../../../tests/helpers/pglite-template.js';
import {registerAccountCampaignRoutes} from './account-campaigns.js';
import {hashPassword} from './password-security.js';
import {hashToken} from './security.js';
import {env} from './env.js';
import {seedTransferPopulatedCampaign} from './test-support/transfer-populated-campaign-fixture.js';
import {stageCampaignTransferArchive} from './campaign-transfer-archive.js';

it('exports from an authenticated owner through HTTP and rejects stolen, revoked and changed-password downloads',async()=>{
 const base=resolve('.qa-temp'),parent=await mkdtemp(join(base,'transfer-http-')),database=await createMigratedPglite(),app=Fastify();
 function adapt(value:any):any{return new Proxy(value,{get(target,key){if(key==='execute')return async(...args:any[])=>{const result=await target.execute(...args);return Array.isArray(result)?result:result.rows;};if(key==='transaction')return(callback:any,options:any)=>target.transaction((tx:any)=>callback(adapt(tx)),options);const found=Reflect.get(target,key);return typeof found==='function'?found.bind(target):found;}});}
 const db=adapt(drizzle(database,{schema})) as ReturnType<typeof schema.createDatabase>['db'];
 const previousMedia=env.MEDIA_ROOT,previousMode=env.DEPLOYMENT_MODE;env.MEDIA_ROOT=join(parent,'source');env.DEPLOYMENT_MODE='HOSTED';
 const password='synthetic-account-password-127',archivePassword='synthetic-archive-password-127',campaignId=crypto.randomUUID(),membershipId=crypto.randomUUID(),userId=crypto.randomUUID(),sessionId=crypto.randomUUID(),csrf='synthetic-csrf-127',token='synthetic-session-127',origin='http://localhost:5173';
 const migrations=readMigrationFiles({migrationsFolder:resolve('packages/db/drizzle')}).map(m=>m.hash);
 try{
  await mkdir(env.MEDIA_ROOT);await app.register(cookie);
  await database.exec('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)');
  for(const entry of readMigrationFiles({migrationsFolder:resolve('packages/db/drizzle')}))await db.execute(sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(${entry.hash},${entry.folderMillis})`);
  const passwordHash=await hashPassword(password);
  await db.insert(schema.users).values({id:userId,identityKind:'HOSTED',hostedLogin:'p127-'+userId.replaceAll('-',''),hostedApprovedAt:new Date(),passwordHash});
  await db.insert(schema.campaigns).values({id:campaignId,name:'Synthetic HTTP archive127'});
  await db.insert(schema.memberships).values({id:membershipId,campaignId,userId,role:'GM',displayName:'Synthetic GM'});
  await db.insert(schema.accountSessions).values({id:sessionId,userId,tokenHash:hashToken(token),csrfHash:hashToken(csrf),expiresAt:new Date(Date.now()+3600000)});
  const auth={campaignId,membershipId,role:'GM' as const,displayName:'Synthetic GM'},asset=crypto.randomUUID(),payload=await sharp({create:{width:2,height:2,channels:4,background:'#2468ac'}}).png().toBuffer();
  await seedTransferPopulatedCampaign(db as never,auth,{asset,storageKey:'synthetic-'+asset+'.png',payload});
  registerAccountCampaignRoutes(app,db as never,{in:()=>({disconnectSockets:()=>undefined})},{enabled:true,creationEnabled:false,creationLimit:2,sessionTtlDays:1,cookieSecure:false,accountCookieName:'account',csrfCookieName:'csrf',gameCookieName:'game',webOrigin:origin,transfer:{root:join(parent,'exports'),migrations}});
  await app.ready();
  const headers={origin,cookie:`account=${token}; csrf=${csrf}`,'x-csrf-token':csrf},url=`/api/account/campaigns/${campaignId}/transfer-exports`,body={accountPassword:password,archivePassword};
  expect((await app.inject({method:'POST',url,payload:body,headers:{origin}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url,payload:body,headers:{...headers,origin:'https://other.invalid'}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url,payload:body,headers:{...headers,'x-csrf-token':'wrong'}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url,payload:{...body,accountPassword:'wrong-synthetic-password'},headers})).statusCode).toBe(403);
  const created=await app.inject({method:'POST',url,payload:body,headers});expect(created.statusCode,created.body).toBe(202);expect(created.headers['cache-control']).toBe('no-store');
  const job=created.json();expect(job.state).toBe('PREPARING');
  let status=job;for(let i=0;i<100&&status.state==='PREPARING';i++){await new Promise(resolve=>setTimeout(resolve,25));const response=await app.inject({url:`${url}/${job.id}`,headers});expect(response.statusCode,response.body).toBe(200);status=response.json();}
  expect(status.state).toBe('READY');
  const downloaded=await app.inject({url:`${url}/${job.id}/download`,headers});expect(downloaded.statusCode).toBe(200);expect(downloaded.headers['content-disposition']).toContain('attachment;');expect(downloaded.headers['cache-control']).toBe('no-store');expect(Number(downloaded.headers['content-length'])).toBe(downloaded.rawPayload.length);
  async function* transport(){yield downloaded.rawPayload;}
  const staged=await stageCampaignTransferArchive(transport(),archivePassword,{campaignId,migrations},parent);
  expect(await readFile(join(staged.root,'media',staged.manifest.media[0]!.sha256))).toEqual(payload);
  expect((await readFile(join(staged.root,'tables/memberships.ndjson'),'utf8'))).not.toContain(userId);
  const [issued]=await db.select().from(schema.campaignTransferExports);expect(issued).toMatchObject({manifestSha256:staged.manifest.sha256,campaignId,ownerUserId:userId,ownerMembershipId:membershipId,baselineSequence:BigInt(staged.manifest.source.baselineSequence),schemaDigest:staged.manifest.source.schemaDigest});expect(issued!.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);

  const targetPg=await createMigratedPglite(),target=adapt(drizzle(targetPg,{schema})) as ReturnType<typeof schema.createDatabase>['db'],instanceId=crypto.randomUUID(),targetMedia=join(parent,'target-media'),previousInstance=env.LOCAL_INSTANCE_ID;
  await mkdir(targetMedia);env.DEPLOYMENT_MODE='LOCAL_HOST';env.LOCAL_INSTANCE_ID=instanceId;env.MEDIA_ROOT=targetMedia;
  try{
   await targetPg.exec('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)');
   for(const entry of readMigrationFiles({migrationsFolder:resolve('packages/db/drizzle')}))await target.execute(sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(${entry.hash},${entry.folderMillis})`);
   await initializeLocalOwner(target,instanceId,{login:'synthetic-local-owner',password:'synthetic-local-password'});const identity=await inspectLocalHost(target,instanceId);if(!identity.initialized)throw Error('LOCAL_SETUP');const scope={instanceId,ownerId:identity.ownerId,migrations};
   const existingCampaign=crypto.randomUUID(),existingMember=crypto.randomUUID(),collisionAction=crypto.randomUUID();
   await target.insert(schema.campaigns).values({id:existingCampaign,name:'Synthetic existing local campaign'});await target.insert(schema.memberships).values({id:existingMember,campaignId:existingCampaign,userId:identity.ownerId,role:'GM',displayName:'Existing GM'});
   await target.execute(sql`INSERT INTO game_events(sequence,campaign_id,action_id,membership_id,type,entity_type,payload) VALUES(${staged.manifest.source.baselineSequence}::bigint,${existingCampaign},${collisionAction},${existingMember},'synthetic.sequence_collision','campaign','{}'::jsonb)`);
   let lateFailure=false;try{await importCampaignTransferStage(target,staged,scope);}catch(error){lateFailure=true;expect((error as {cause?:{code?:string}}).cause?.code??(error as {code?:string}).code).toBe('23505');}expect(lateFailure).toBe(true);
   expect(await target.select().from(schema.campaigns)).toHaveLength(1);expect((await target.select().from(schema.campaigns))[0]!.id).toBe(existingCampaign);expect(await target.select().from(schema.assets)).toHaveLength(0);expect(await target.select().from(schema.localCampaignImports)).toHaveLength(0);expect(await readdir(join(targetMedia,'import-media'))).toHaveLength(0);
   await target.execute(sql`DELETE FROM game_events WHERE campaign_id=${existingCampaign} AND action_id=${collisionAction}`);
   const localApp=Fastify();await localApp.register(cookie);await localApp.register(multipart);const localToken='synthetic-local-session',localCsrf='synthetic-local-csrf',localSessionId=crypto.randomUUID();
   await target.insert(schema.accountSessions).values({id:localSessionId,userId:identity.ownerId,tokenHash:hashToken(localToken),csrfHash:hashToken(localCsrf),expiresAt:new Date(Date.now()+3600000)});
   let commitAckLost=false;const dialect=new PgDialect();
   const uncertainTarget=new Proxy(target,{get(value,key){if(key==='transaction')return async(callback:any,options:any)=>{let wroteReceipt=false;const result=await value.transaction(async tx=>callback(new Proxy(tx,{get(transaction,method){if(method==='execute')return async(query:any)=>{const result=await transaction.execute(query);if(dialect.sqlToQuery(query).sql.startsWith('INSERT INTO local_campaign_imports'))wroteReceipt=true;return result;};const found=Reflect.get(transaction,method);return typeof found==='function'?found.bind(transaction):found;}})),options);if(wroteReceipt&&!commitAckLost){commitAckLost=true;throw Error('SYNTHETIC_LOST_COMMIT_ACK');}return result;};const found=Reflect.get(value,key);return typeof found==='function'?found.bind(value):found;}}) as typeof target;
   registerAccountCampaignRoutes(localApp,uncertainTarget,{in:()=>({disconnectSockets:()=>undefined})},{enabled:true,creationEnabled:false,creationLimit:2,sessionTtlDays:1,cookieSecure:false,accountCookieName:'account',csrfCookieName:'csrf',gameCookieName:'game',webOrigin:origin,localInstanceId:instanceId,transfer:{root:join(parent,'local-exports'),migrations},transferImport:{root:join(parent,'uploads'),migrations}});await localApp.ready();
   function upload(accountPassword='synthetic-local-password',filePassword=archivePassword,extra=false,operation?:'IMPORT'|'REPAIR',archiveBytes=downloaded.rawPayload){const boundary='synthetic-boundary-129',pieces:Buffer[]=[];for(const [name,value]of Object.entries({accountPassword,archivePassword:filePassword,...(operation?{operation}:{})}))pieces.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));pieces.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="../../ignored.arken"\r\nContent-Type: application/octet-stream\r\n\r\n`),archiveBytes,Buffer.from('\r\n'));if(extra)pieces.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nforbidden\r\n`));pieces.push(Buffer.from(`--${boundary}--\r\n`));return {payload:Buffer.concat(pieces),headers:{origin,cookie:`account=${localToken}; csrf=${localCsrf}`,'x-csrf-token':localCsrf,'content-type':`multipart/form-data; boundary=${boundary}`}};}
   let imported:Awaited<ReturnType<typeof importCampaignTransferStage>>;
   const newerKey='synthetic-newer-'+asset+'.png',newerPayload=await sharp({create:{width:2,height:2,channels:4,background:'#abcdef'}}).png().toBuffer();
   try{
    const endpoint='/api/account/campaign-transfers/import';
    expect((await localApp.inject({method:'POST',url:endpoint,...upload('wrong-synthetic-password')})).statusCode).toBe(403);
    expect((await localApp.inject({method:'POST',url:endpoint,...upload('synthetic-local-password','wrong-archive-password')})).statusCode).toBe(400);
    expect((await localApp.inject({method:'POST',url:endpoint,...upload('synthetic-local-password',archivePassword,true)})).statusCode).toBe(400);
    expect(await target.select().from(schema.campaigns)).toHaveLength(1);expect(await target.select().from(schema.assets)).toHaveLength(0);
    const response=await localApp.inject({method:'POST',url:endpoint,...upload()});expect(response.statusCode,response.body).toBe(201);imported=response.json();expect(imported.state).toBe('IMPORTED');expect(commitAckLost).toBe(true);
    expect(await readdir(join(parent,'uploads'))).toHaveLength(0);
    const [importReceipt]=await target.select().from(schema.localCampaignImports);expect(importReceipt).toMatchObject({manifestSha256:staged.manifest.sha256,sourceBaselineSequence:BigInt(staged.manifest.source.baselineSequence),sourceSchemaDigest:staged.manifest.source.schemaDigest});

    const preparation=await target.execute(sql`SELECT host_id,epoch,active FROM local_session_authorities WHERE campaign_id=${campaignId}`);expect(preparation).toHaveLength(1);expect(preparation[0]).toMatchObject({epoch:1,active:false});
    expect(await target.execute(sql`SELECT 1 FROM local_event_outbox WHERE campaign_id=${campaignId}`)).toHaveLength(0); // Imported history is not replayed.
    await expect(target.transaction(async tx=>{
     await tx.execute(sql`INSERT INTO game_events(campaign_id,action_id,membership_id,type,entity_type) VALUES(${campaignId},${crypto.randomUUID()},${staged.manifest.sourceOwnerMembershipId},'SYNTHETIC_PREPARATION','campaign')`);
     const captured=await tx.execute(sql`SELECT authority_epoch,event->>'type' AS type FROM local_event_outbox WHERE campaign_id=${campaignId}`);expect(captured).toHaveLength(1);expect(captured[0]).toMatchObject({authority_epoch:1,type:'SYNTHETIC_PREPARATION'});
     throw Error('SYNTHETIC_PREPARATION_ROLLBACK');
    })).rejects.toThrow('SYNTHETIC_PREPARATION_ROLLBACK');
    const [beforeAsset]=await target.select().from(schema.assets).where(eq(schema.assets.id,asset)),assetPath=join(targetMedia,beforeAsset!.storageKey);
    const [localCharacter]=await target.select().from(schema.characters);await target.update(schema.characters).set({name:'Newest local character'}).where(eq(schema.characters.id,localCharacter!.id));
    const liveCharacters=await target.select().from(schema.characters),liveEvents=await target.execute(sql`SELECT sequence::text,type,payload FROM game_events ORDER BY sequence`);
    const localHeaders={origin,cookie:`account=${localToken}; csrf=${localCsrf}`,'x-csrf-token':localCsrf},localUrl=`/api/account/campaigns/${campaignId}/transfer-exports`;
    const localCreated=await localApp.inject({method:'POST',url:localUrl,headers:localHeaders,payload:{accountPassword:'synthetic-local-password',archivePassword}});expect(localCreated.statusCode,localCreated.body).toBe(202);
    let localJob=localCreated.json();for(let i=0;i<200&&localJob.state==='PREPARING';i++){await new Promise(resolve=>setTimeout(resolve,25));const status=await localApp.inject({url:`${localUrl}/${localJob.id}`,headers:localHeaders});expect(status.statusCode,status.body).toBe(200);localJob=status.json();}
    expect(localJob.state).toBe('READY');const localDownload=await localApp.inject({url:`${localUrl}/${localJob.id}/download`,headers:localHeaders});expect(localDownload.statusCode,localDownload.body).toBe(200);
    async function* localTransport(){yield localDownload.rawPayload;}const localStage=await stageCampaignTransferArchive(localTransport(),archivePassword,{campaignId,migrations},parent);
    expect((await readFile(join(localStage.root,'tables/characters.ndjson'),'utf8'))).toContain('Newest local character');
    expect((await readFile(join(localStage.root,'tables/memberships.ndjson'),'utf8'))).not.toContain(identity.ownerId);
    expect(await readFile(join(localStage.root,'media',localStage.manifest.media[0]!.sha256))).toEqual(payload);
    expect(localStage.manifest.source.baselineSequence).toBe(staged.manifest.source.baselineSequence);
    const nextPg=await createMigratedPglite(),nextDb=adapt(drizzle(nextPg,{schema})) as typeof target,nextInstance=crypto.randomUUID(),nextMedia=join(parent,'next-local-media');
    try{
     await mkdir(nextMedia);env.LOCAL_INSTANCE_ID=nextInstance;env.MEDIA_ROOT=nextMedia;
     await nextPg.exec('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)');for(const entry of readMigrationFiles({migrationsFolder:resolve('packages/db/drizzle')}))await nextDb.execute(sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(${entry.hash},${entry.folderMillis})`);
     await initializeLocalOwner(nextDb,nextInstance,{login:'next-local-owner',password:'next-local-password'});const nextIdentity=await inspectLocalHost(nextDb,nextInstance);if(!nextIdentity.initialized)throw Error('NEXT_LOCAL_SETUP');
     const nextImported=await importCampaignTransferStage(nextDb,localStage,{instanceId:nextInstance,ownerId:nextIdentity.ownerId,migrations});expect(nextImported.state).toBe('IMPORTED');
     expect((await nextDb.select().from(schema.characters)).some(row=>row.name==='Newest local character')).toBe(true);
     const nextMembers=await nextDb.select().from(schema.memberships);expect(nextMembers.find(row=>row.id===membershipId)?.userId).toBe(nextIdentity.ownerId);expect(nextMembers.some(row=>row.userId===identity.ownerId)).toBe(false);
     const [nextAsset]=await nextDb.select().from(schema.assets).where(eq(schema.assets.id,asset));expect(await readFile(join(nextMedia,nextAsset!.storageKey))).toEqual(payload);
     expect(await nextDb.execute(sql`SELECT sequence::text,type,payload FROM game_events WHERE campaign_id=${campaignId} ORDER BY sequence`)).toEqual(await target.execute(sql`SELECT sequence::text,type,payload FROM game_events WHERE campaign_id=${campaignId} ORDER BY sequence`));
    }finally{env.LOCAL_INSTANCE_ID=instanceId;env.MEDIA_ROOT=targetMedia;await nextPg.close();}

    await unlink(assetPath);
    const otherManifest=createCampaignTransferManifest({...staged.manifest,createdAt:'2026-11-28T00:00:00.000Z'}),wrongArchive:Buffer[]=[];for await(const part of encryptCampaignTransferArchive(otherManifest,async function*(key){yield await readFile(join(staged.root,key));},archivePassword))wrongArchive.push(part);
    async function* wrongBytes(){yield Buffer.concat(wrongArchive);}const wrongStage=await stageCampaignTransferArchive(wrongBytes(),archivePassword,{migrations},parent);await expect(repairCampaignTransferMedia(target,wrongStage,scope)).rejects.toThrow('ORIGINAL_ARCHIVE_REQUIRED');
    const wrongRepair=await localApp.inject({method:'POST',url:endpoint,...upload('synthetic-local-password',archivePassword,false,'REPAIR',Buffer.concat(wrongArchive))});expect(wrongRepair.statusCode).toBe(400);await expect(readFile(assetPath)).rejects.toMatchObject({code:'ENOENT'});
    const repaired=await localApp.inject({method:'POST',url:endpoint,...upload('synthetic-local-password',archivePassword,false,'REPAIR')});expect(repaired.statusCode,repaired.body).toBe(200);expect(repaired.json()).toMatchObject({state:'MEDIA_REPAIRED',filesRestored:1,filesChecked:2,campaignAvailable:true});expect(await readFile(assetPath)).toEqual(payload);
    expect(await target.select().from(schema.characters)).toEqual(liveCharacters);expect(await target.execute(sql`SELECT sequence::text,type,payload FROM game_events ORDER BY sequence`)).toEqual(liveEvents);
    const again=await localApp.inject({method:'POST',url:endpoint,...upload('synthetic-local-password',archivePassword,false,'REPAIR')});expect(again.statusCode,again.body).toBe(200);expect(again.json().filesRestored).toBe(0);
    const namespace=join(targetMedia,'import-media',imported.id);if(dirname(namespace)!==join(targetMedia,'import-media')||await realpath(namespace)!==namespace)throw Error('UNSAFE_REPAIR_FIXTURE_NAMESPACE');await rm(namespace,{recursive:true,force:true});
    const rebuilt=await localApp.inject({method:'POST',url:endpoint,...upload('synthetic-local-password',archivePassword,false,'REPAIR')});expect(rebuilt.statusCode,rebuilt.body).toBe(200);expect(rebuilt.json().filesRestored).toBe(2);expect(await readFile(assetPath)).toEqual(payload);
    await writeFile(join(targetMedia,newerKey),newerPayload,{flag:'wx'});await target.update(schema.assets).set({storageKey:newerKey,sizeBytes:newerPayload.length,name:'Newest local art'}).where(eq(schema.assets.id,asset));await unlink(assetPath);
    const preserveNewer=await localApp.inject({method:'POST',url:endpoint,...upload('synthetic-local-password',archivePassword,false,'REPAIR')});expect(preserveNewer.statusCode,preserveNewer.body).toBe(200);expect(preserveNewer.json()).toMatchObject({filesChecked:1,filesRestored:0});await expect(readFile(assetPath)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(targetMedia,newerKey))).toEqual(newerPayload);

    const selected=await localApp.inject({method:'POST',url:'/api/account/campaigns/select',payload:{campaignId},headers:{origin,cookie:`account=${localToken}; csrf=${localCsrf}`,'x-csrf-token':localCsrf}});expect(selected.statusCode,selected.body).toBe(200);expect(selected.json().membershipId).toBe(membershipId);
   }finally{await localApp.close();}

   const [owner]=await target.select().from(schema.memberships).where(eq(schema.memberships.id,membershipId));expect(owner!.userId).toBe(identity.ownerId);
   const participants=await target.select().from(schema.memberships);expect(participants.filter(m=>m.role==='PLAYER').every(m=>m.userId===null)).toBe(true);
   const [importedAsset]=await target.select().from(schema.assets).where(eq(schema.assets.id,asset));expect(importedAsset!.storageKey).toBe(newerKey);expect(await readStoredImage(importedAsset!.storageKey)).toEqual(newerPayload);
   const [attachment]=await target.select().from(schema.chatAttachmentUploads);expect(attachment!.status).toBe('CLAIMED');expect(attachment!.storageKey).not.toBe(importedAsset!.storageKey);expect(await readStoredImage(attachment!.storageKey)).toEqual(payload);
   expect(await target.select().from(schema.accountSessions).where(eq(schema.accountSessions.id,sessionId))).toHaveLength(0);expect(await target.select().from(schema.localCampaignImports)).toHaveLength(1);
   const sequence=await target.execute<{sequence:string}>(sql`INSERT INTO game_events(campaign_id,action_id,membership_id,type,entity_type,payload) VALUES(${campaignId},${crypto.randomUUID()},${membershipId},'synthetic.local_append','campaign','{}'::jsonb) RETURNING sequence::text`);expect(BigInt(sequence[0]!.sequence)>BigInt(staged.manifest.source.baselineSequence)).toBe(true);
   await expect(importCampaignTransferStage(target,staged,scope)).rejects.toThrow('UNOWNED_OR_CONSUMED');
   expect((await recoverCampaignTransferImport(target,imported.id,scope)).state).toBe('COMMITTED');
   const before=(await readdir(join(targetMedia,'import-media'))).sort(),duplicate=await stageCampaignTransferArchive(transport(),archivePassword,{campaignId,migrations},parent);
   await expect(importCampaignTransferStage(target,duplicate,scope)).rejects.toThrow('CAMPAIGN_EXISTS');expect((await readdir(join(targetMedia,'import-media'))).sort()).toEqual(before);expect(await target.select().from(schema.localCampaignImports)).toHaveLength(1);expect(await readStoredImage(importedAsset!.storageKey)).toEqual(newerPayload);
   const interrupted=crypto.randomUUID(),interruptedRoot=join(targetMedia,'import-media',interrupted);await mkdir(interruptedRoot);await (await import('node:fs/promises')).writeFile(join(interruptedRoot,'intent.json'),JSON.stringify({version:1,id:interrupted,instanceId,ownerId:identity.ownerId,campaignId,manifestSha256:staged.manifest.sha256,files:[]}));
   expect((await recoverCampaignTransferImport(target,interrupted,scope)).state).toBe('ROLLED_BACK');expect((await readdir(join(targetMedia,'import-media'))).sort()).toEqual(before);expect(await target.select().from(schema.campaigns)).toHaveLength(2);
  }finally{await targetPg.close();env.DEPLOYMENT_MODE='HOSTED';env.LOCAL_INSTANCE_ID=previousInstance;env.MEDIA_ROOT=join(parent,'source');}
  const jobRoot=join(parent,'exports','export-'+job.id);expect(await readdir(jobRoot)).toEqual(['campaign.arken']);
  const otherSession=crypto.randomUUID(),otherToken='synthetic-second-session';await db.insert(schema.accountSessions).values({id:otherSession,userId,tokenHash:hashToken(otherToken),csrfHash:hashToken('other-csrf'),expiresAt:new Date(Date.now()+3600000)});
  expect((await app.inject({url:`${url}/${job.id}/download`,headers:{cookie:`account=${otherToken}`}})).statusCode).toBe(404);
  await db.insert(schema.gameEvents).values({campaignId,actionId:crypto.randomUUID(),membershipId,type:'synthetic.unreviewed',entityType:'campaign',entityId:campaignId,payload:{}});
  const rejected=await app.inject({method:'POST',url,payload:body,headers});expect(rejected.statusCode).toBe(202);const failedJob=rejected.json();
  let failed=failedJob;for(let i=0;i<100&&failed.state==='PREPARING';i++){await new Promise(resolve=>setTimeout(resolve,25));failed=(await app.inject({url:`${url}/${failedJob.id}`,headers})).json();}
  expect(failed.state).toBe('FAILED');expect(failed).not.toHaveProperty('error');expect((await readdir(join(parent,'exports'))).sort()).toEqual(['export-'+job.id]);
  await db.update(schema.users).set({passwordHash:await hashPassword('changed-synthetic-password')}).where(eq(schema.users.id,userId));
  expect((await app.inject({url:`${url}/${job.id}/download`,headers})).statusCode).toBe(404);
  await db.update(schema.accountSessions).set({revokedAt:new Date()}).where(eq(schema.accountSessions.id,sessionId));
  expect((await app.inject({url:`${url}/${job.id}/download`,headers})).statusCode).toBe(401);
 }finally{
  await app.close();await database.close();env.MEDIA_ROOT=previousMedia;env.DEPLOYMENT_MODE=previousMode;
  if(dirname(parent)!==base||await realpath(parent)!==parent)throw Error('UNSAFE_HTTP_FIXTURE_CLEANUP');await rm(parent,{recursive:true,force:true});
 }
},60000);
