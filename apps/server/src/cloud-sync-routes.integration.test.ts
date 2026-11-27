import Fastify from 'fastify';import cookie from '@fastify/cookie';import {beforeEach,afterEach,expect,it} from 'vitest';import {sql} from 'drizzle-orm';import {drizzle} from 'drizzle-orm/pglite';import * as schema from '@arken/db';
import {createMigratedPglite} from '../../../tests/helpers/pglite-template.js';import {registerAccountAuthRoutes} from './account-auth-routes.js';import {unconfiguredMailAdapter} from './account-mail.js';import {env} from './env.js';import {hashToken} from './security.js';import {createLocalEventEnvelope} from './local-event-envelope.js';
let pg:Awaited<ReturnType<typeof createMigratedPglite>>,db:any,app:ReturnType<typeof Fastify>,campaignId:string,userId:string,memberId:string;const origin='http://localhost:5173',token='synthetic-account-session',csrf='synthetic-csrf';let previous:boolean;
function adapt(value:any):any{return new Proxy(value,{get(object,key){if(key==='execute')return async(...args:any[])=>{const result=await object.execute(...args);return Array.isArray(result)?result:result.rows;};if(key==='transaction')return(callback:any)=>object.transaction((tx:any)=>callback(adapt(tx)));const result=Reflect.get(object,key);return typeof result==='function'?result.bind(object):result;}});}
async function build(){app=Fastify();await app.register(cookie);registerAccountAuthRoutes(app as never,db,{in:()=>({disconnectSockets(){}})} as never,{enabled:true,registrationEnabled:false,legacyDevEnabled:false,campaignLinkAccessEnabled:false,campaignCreationEnabled:false,sessionTtlDays:3,cookieSecure:false,accountCookieName:'arken_account',gameCookieName:'arken_session',csrfCookieName:'arken_account_csrf',webOrigin:origin,publicUrl:origin,mailRuntimeEnabled:false,mail:unconfiguredMailAdapter,mailKeyring:null});await app.ready();}
beforeEach(async()=>{previous=env.CLOUD_SYNC_STAGING_ENABLED;env.CLOUD_SYNC_STAGING_ENABLED=true;pg=await createMigratedPglite();db=adapt(drizzle(pg,{schema}));campaignId=crypto.randomUUID();userId=crypto.randomUUID();memberId=crypto.randomUUID();await db.insert(schema.campaigns).values({id:campaignId,name:'Synthetic cloud route'});await db.insert(schema.users).values({id:userId,emailNormalized:userId+'@example.invalid',emailDisplay:userId+'@example.invalid',passwordHash:'synthetic',verifiedAt:new Date()});await db.insert(schema.memberships).values({id:memberId,campaignId,userId,role:'GM',displayName:'Synthetic'});await db.insert(schema.accountSessions).values({userId,tokenHash:hashToken(token),csrfHash:hashToken(csrf),expiresAt:new Date(Date.now()+60000)});await build();});
afterEach(async()=>{await app?.close();await pg?.close();env.CLOUD_SYNC_STAGING_ENABLED=previous;});
const headers=()=>({origin,cookie:`arken_account=${token}; arken_account_csrf=${csrf}`,'x-csrf-token':csrf});
const source=()=>({campaignId,origin:{hostId:crypto.randomUUID(),sessionId:crypto.randomUUID(),epoch:1,baselineSequence:'0'}});
it('requires real account cookie, CSRF, origin and campaign GM access',async()=>{
 const body=source(),post=(h:any)=>app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:h,payload:body});
 expect((await post({origin})).statusCode).toBe(401);expect((await post({...headers(),'x-csrf-token':'wrong'})).statusCode).toBe(403);expect((await post({...headers(),origin:'https://foreign.invalid'})).statusCode).toBe(403);
 const foreign=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:{...body,campaignId:crypto.randomUUID()}});expect(foreign.statusCode).toBe(403);
 const valid=await post(headers());expect(valid.statusCode,valid.body).toBe(200);expect(valid.json().mode).toBe('INBOX_ONLY');expect(valid.headers['cache-control']).toBe('no-store');
 const extra=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:{...body,accountUserId:crypto.randomUUID()}});expect(extra.statusCode).toBe(400);
});
it('stores a checked batch over HTTP and returns the same STORED_ONLY receipt on retry',async()=>{
 const body=source(),registered=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:body}),originId=registered.json().originId;
 const envelope=createLocalEventEnvelope({hostId:body.origin.hostId,sessionId:body.origin.sessionId,epoch:body.origin.epoch,campaignId},{sequence:'1',campaign_id:campaignId,action_id:crypto.randomUUID(),membership_id:memberId,type:'SYNTHETIC',entity_type:'campaign',entity_id:null,entity_revision:null,payload:{private:'synthetic'},created_at:new Date(0).toISOString()});
 const batch={version:1,hostId:body.origin.hostId,campaignId,events:[envelope],after:null,lastSequence:'1',hasMore:false,delivery:'NOT_CONFIGURED'};
 const send=()=>app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/batches`,headers:headers(),payload:{campaignId,batch}});const first=await send(),again=await send();expect(first.statusCode,first.body).toBe(200);expect(first.json().status).toBe('STORED_ONLY');expect(again.json()).toEqual(first.json());expect(first.body).not.toContain('private');expect(await db.select().from(schema.cloudSyncInbox)).toHaveLength(1);
 const duplicateAction={...batch,after:'1',lastSequence:'2',events:[createLocalEventEnvelope(envelope.origin,{...envelope.event,sequence:'2'})]};
 const conflict=await app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/batches`,headers:headers(),payload:{campaignId,batch:duplicateAction}});expect(conflict.statusCode,conflict.body).toBe(409);expect(conflict.body).not.toContain('synthetic');

});
it('leaves routes unavailable while the staging feature is disabled',async()=>{
 await app.close();env.CLOUD_SYNC_STAGING_ENABLED=false;await build();const result=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:source()});expect(result.statusCode).toBe(404);
});

it('masks invalid JSON and oversized bodies without reflecting private content',async()=>{
 for(const payload of ['{"private":"SYNTHETIC_PRIVATE_MARKER"',JSON.stringify({private:'SYNTHETIC_PRIVATE_MARKER'.repeat(500)})]){
  const response=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:{...headers(),'content-type':'application/json'},payload});
  expect([400,413]).toContain(response.statusCode);expect(response.body).not.toContain('SYNTHETIC_PRIVATE_MARKER');expect(response.headers['cache-control']).toBe('no-store');
 }
});

it('uses a hash-only rotating intake grant with expiry, revocation and current GM access checks',async()=>{
 const body=source(),register=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:body}),originId=register.json().originId;
 const issue=async()=>{const response=await app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/grant`,headers:headers(),payload:{campaignId}});expect(response.statusCode,response.body).toBe(200);expect(response.headers['cache-control']).toBe('no-store');return response.json();};
 const grant=await issue();expect(grant.expiresAt).toMatch(/Z$/);expect(Number.isFinite(Date.parse(grant.expiresAt))).toBe(true);expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(grant.scope).toBe('STAGING_ONLY');
 const [stored]=await db.select().from(schema.cloudSyncGrants);expect(stored.tokenHash).toBe(hashToken(grant.token));expect(JSON.stringify(stored)).not.toContain(grant.token);
 const envelope=createLocalEventEnvelope({hostId:body.origin.hostId,sessionId:body.origin.sessionId,epoch:1,campaignId},{sequence:'1',campaign_id:campaignId,action_id:crypto.randomUUID(),membership_id:memberId,type:'SYNTHETIC',entity_type:'campaign',entity_id:null,entity_revision:null,payload:{synthetic:true},created_at:new Date(0).toISOString()});
 const batch={version:1,hostId:body.origin.hostId,campaignId,events:[envelope],after:null,lastSequence:'1',hasMore:false,delivery:'NOT_CONFIGURED'};
 const send=(token:string,id=originId)=>app.inject({method:'POST',url:`/api/cloud-sync/sources/${id}/batches`,headers:{authorization:'Bearer '+token},payload:{batch}});
 const accepted=await send(grant.token);expect(accepted.statusCode,accepted.body).toBe(200);expect(accepted.json().status).toBe('STORED_ONLY');expect(accepted.headers['cache-control']).toBe('no-store');
 expect((await send(grant.token,crypto.randomUUID())).statusCode).toBe(403);
 const rotated=await issue();expect(rotated.token).not.toBe(grant.token);expect((await send(grant.token)).statusCode).toBe(403);expect((await send(rotated.token)).json()).toEqual(accepted.json());
 await db.update(schema.cloudSyncGrants).set({expiresAt:new Date(Date.now()-1000)});expect((await send(rotated.token)).statusCode).toBe(403);
 const revoked=await issue();const revoke=await app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/grant/revoke`,headers:headers(),payload:{campaignId}});expect(revoke.statusCode).toBe(200);expect((await send(revoked.token)).statusCode).toBe(403);
 const current=await issue();await db.update(schema.memberships).set({accessRevokedAt:new Date()});expect((await send(current.token)).statusCode).toBe(403);
});
it('rejects plaintext production grant intake even if forwarded HTTPS is claimed',async()=>{
 const previous=env.NODE_ENV;env.NODE_ENV='production';try{
  const response=await app.inject({method:'POST',url:`/api/cloud-sync/sources/${crypto.randomUUID()}/batches`,headers:{'x-forwarded-proto':'https',authorization:'Bearer '+'a'.repeat(43)},payload:{batch:{}}});
  expect(response.statusCode).toBe(426);expect(response.json().error).toBe('TLS_REQUIRED');
  const proofPath=`/api/cloud-sync/sources/${crypto.randomUUID()}/receipts/${crypto.randomUUID()}/application`;
  const plainProof=await app.inject({method:'POST',url:proofPath,headers:{'x-forwarded-proto':'https',authorization:'Bearer '+'a'.repeat(43)},payload:{}});expect(plainProof.statusCode).toBe(426);

  const savedPeers=env.CLOUD_SYNC_TRUSTED_PROXY_IPS;env.CLOUD_SYNC_TRUSTED_PROXY_IPS=['127.0.0.1'];
  try{
   const acceptedProxy=await app.inject({method:'POST',url:`/api/cloud-sync/sources/${crypto.randomUUID()}/batches`,remoteAddress:'127.0.0.1',headers:{'x-forwarded-proto':'https',authorization:'Bearer '+'a'.repeat(43)},payload:{batch:{}}});expect(acceptedProxy.statusCode).toBe(403); // TLS accepted, unknown grant rejected.
   const proofProxy=await app.inject({method:'POST',url:proofPath,remoteAddress:'127.0.0.1',headers:{'x-forwarded-proto':'https',authorization:'Bearer '+'a'.repeat(43)},payload:{}});expect(proofProxy.statusCode).toBe(403);

   const foreignPeer=await app.inject({method:'POST',url:`/api/cloud-sync/sources/${crypto.randomUUID()}/batches`,remoteAddress:'203.0.113.77',headers:{'x-forwarded-proto':'https',authorization:'Bearer '+'a'.repeat(43)},payload:{batch:{}}});expect(foreignPeer.statusCode).toBe(426);
  }finally{env.CLOUD_SYNC_TRUSTED_PROXY_IPS=savedPeers;}

 }finally{env.NODE_ENV=previous;}
});

it('connects a UI source with server baseline and never rebases it on reissue',async()=>{
 const request=source(),scope={campaignId,...request.origin};delete (scope as any).baselineSequence;
 const connect=(origin=scope,extra={})=>app.inject({method:'POST',url:'/api/account/cloud-sync/connect',headers:headers(),payload:{campaignId,origin,...extra}});
 const first=await connect();expect(first.statusCode,first.body).toBe(200);expect(first.headers['cache-control']).toBe('no-store');
 expect((await connect()).json()).toEqual(first.json());
 await db.insert(schema.gameEvents).values({campaignId,actionId:crypto.randomUUID(),membershipId:memberId,type:'SYNTHETIC_CLOUD',entityType:'campaign'});
 expect((await connect()).json()).toEqual(first.json());
 const [stored]=await db.select().from(schema.cloudSyncOrigins);expect(stored.baselineSequence).toBe(0n);
 expect((await connect({...scope,campaignId:crypto.randomUUID()})).statusCode).toBe(403);
 expect((await connect(scope,{baselineSequence:'999'})).statusCode).toBe(400);
 const missingCsrf=await app.inject({method:'POST',url:'/api/account/cloud-sync/connect',headers:{cookie:`arken_account=${token}`,origin},payload:{campaignId,origin:scope}});expect(missingCsrf.statusCode).not.toBe(200);
});

it('rejects pre-baseline history, foreign/revoked actors and committed action IDs atomically',async()=>{
 const old=env.DEPLOYMENT_MODE;env.DEPLOYMENT_MODE='HOSTED';try{
  const baseline='9007199254740993',oldAction=crypto.randomUUID();await db.execute(sql`INSERT INTO game_events(sequence,campaign_id,action_id,membership_id,type,entity_type,payload) VALUES(${baseline}::bigint,${campaignId},${oldAction},${memberId},'SYNTHETIC','campaign','{}'::jsonb)`);
  const body=source();body.origin.baselineSequence=baseline;const registered=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:body});expect(registered.statusCode,registered.body).toBe(200);const originId=registered.json().originId;
  const send=async(sequence:string,actor=memberId,action=crypto.randomUUID())=>{
   const envelope=createLocalEventEnvelope({hostId:body.origin.hostId,sessionId:body.origin.sessionId,epoch:1,campaignId},{sequence,campaign_id:campaignId,action_id:action,membership_id:actor,type:'SYNTHETIC',entity_type:'campaign',entity_id:null,entity_revision:null,payload:{},created_at:new Date(0).toISOString()});
   const batch={version:1,hostId:body.origin.hostId,campaignId,events:[envelope],after:null,lastSequence:sequence,hasMore:false,delivery:'NOT_CONFIGURED'};
   return app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/batches`,headers:headers(),payload:{campaignId,batch}});
  };
  expect((await send('9007199254740992')).statusCode).toBe(409);expect((await send(baseline)).statusCode).toBe(409);
  const otherCampaign=crypto.randomUUID(),foreign=crypto.randomUUID();await db.insert(schema.campaigns).values({id:otherCampaign,name:'Private other campaign'});await db.insert(schema.memberships).values({id:foreign,campaignId:otherCampaign,role:'PLAYER',displayName:'Foreign'});
  expect((await send('9007199254740994',foreign)).statusCode).toBe(409);
  const revoked=crypto.randomUUID();await db.insert(schema.memberships).values({id:revoked,campaignId,role:'PLAYER',displayName:'Revoked',accessRevokedAt:new Date()});expect((await send('9007199254740994',revoked)).statusCode).toBe(409);
  expect((await send('9007199254740994',memberId,oldAction)).statusCode).toBe(409);
  expect(await db.select().from(schema.cloudSyncReceipts)).toHaveLength(0);expect(await db.select().from(schema.cloudSyncInbox)).toHaveLength(0);expect((await db.select().from(schema.cloudSyncOrigins))[0].receivedSequence).toBeNull();
  const accepted=await send('9007199254740995');expect(accepted.statusCode,accepted.body).toBe(200);expect(accepted.json()).toMatchObject({status:'STORED_ONLY',lastSequence:'9007199254740995'});expect(await db.select().from(schema.gameEvents)).toHaveLength(1);
 }finally{env.DEPLOYMENT_MODE=old;}
});
it('requires completed password change for registration and existing grant delivery',async()=>{
 const body=source(),registered=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:body});expect(registered.statusCode).toBe(200);const originId=registered.json().originId;
 const issued=await app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/grant`,headers:headers(),payload:{campaignId}});expect(issued.statusCode).toBe(200);
 await db.update(schema.users).set({passwordChangeRequired:true});
 expect((await app.inject({method:'POST',url:'/api/cloud-sync/sources/'+originId+'/batches',headers:{authorization:'Bearer '+issued.json().token},payload:{batch:{}}})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:source()})).statusCode).toBe(403);
});

it('binds an issued archive to the owner source and rejects altered or foreign proofs',async()=>{
 const proof={manifestSha256:'a'.repeat(64),baselineSequence:'0',schemaDigest:'b'.repeat(64)},descriptor={campaignId,hostId:crypto.randomUUID(),sessionId:crypto.randomUUID(),epoch:1,transferProof:proof};await db.insert(schema.campaignTransferExports).values({manifestSha256:proof.manifestSha256,campaignId,ownerUserId:userId,ownerMembershipId:memberId,baselineSequence:0n,schemaDigest:proof.schemaDigest,snapshotDigest:'c'.repeat(64)});
 const connect=(origin:any)=>app.inject({method:'POST',url:'/api/account/cloud-sync/connect',headers:headers(),payload:{campaignId,origin}});const accepted=await connect(descriptor);expect(accepted.statusCode,accepted.body).toBe(200);expect(accepted.json().mode).toBe('INBOX_ONLY');expect((await db.select().from(schema.cloudSyncOrigins))[0].transferManifestSha256).toBe(proof.manifestSha256);
 for(const change of [{manifestSha256:'d'.repeat(64)},{baselineSequence:'1'},{schemaDigest:'d'.repeat(64)}])expect((await connect({...descriptor,transferProof:{...proof,...change}})).statusCode).toBe(409);
 await db.update(schema.campaignTransferExports).set({ownerUserId:crypto.randomUUID()});expect((await connect(descriptor)).statusCode).toBe(409);
});
it('does not retroactively attach archive lineage after inbox delivery',async()=>{
 const proof={manifestSha256:'e'.repeat(64),baselineSequence:'0',schemaDigest:'f'.repeat(64)},origin={campaignId,hostId:crypto.randomUUID(),sessionId:crypto.randomUUID(),epoch:1};const response=await app.inject({method:'POST',url:'/api/account/cloud-sync/connect',headers:headers(),payload:{campaignId,origin}});expect(response.statusCode).toBe(200);await db.insert(schema.campaignTransferExports).values({manifestSha256:proof.manifestSha256,campaignId,ownerUserId:userId,ownerMembershipId:memberId,baselineSequence:0n,schemaDigest:proof.schemaDigest,snapshotDigest:'c'.repeat(64)});await db.update(schema.cloudSyncOrigins).set({receivedSequence:1n});expect((await app.inject({method:'POST',url:'/api/account/cloud-sync/connect',headers:headers(),payload:{campaignId,origin:{...origin,transferProof:proof}}})).statusCode).toBe(409);expect((await db.select().from(schema.cloudSyncOrigins))[0].transferManifestSha256).toBeNull();
});

it('reports stored versus applied receipts and explicit writer release through owner-only metadata',async()=>{
 const registered=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:source()}),originId=registered.json().originId;
 const [o]=await db.select().from(schema.cloudSyncOrigins),auth={campaignId,membershipId:memberId,role:'GM' as const,displayName:'Synthetic'};
 const status=(h=headers(),extra={})=>app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/status`,headers:h,payload:{campaignId,...extra}});
 expect((await status({...headers(),'x-csrf-token':'wrong'})).statusCode).toBe(403);
 const initial=await status();expect(initial.statusCode,initial.body).toBe(200);expect(initial.headers['cache-control']).toBe('no-store');expect(initial.json().writer).toEqual({mode:'HOSTED',revision:'0',isSelectedSource:false});
 const {reserveCloudCampaignWriter,releaseCloudCampaignWriter}=await import('./campaign-writer-authority.js'),{applyCloudSyncReceipt}=await import('./cloud-sync-apply.js');
 const a=await reserveCloudCampaignWriter(db,auth,userId,{originId,expectedRevision:'0',baselineSequence:'0'});
 const event=createLocalEventEnvelope({campaignId,hostId:o.hostId,sessionId:o.sessionId,epoch:o.epoch},{sequence:'9007199254740993',campaign_id:campaignId,action_id:crypto.randomUUID(),membership_id:memberId,type:'campaign.renamed',entity_type:'campaign',entity_id:campaignId,entity_revision:1,payload:{name:'Applied synthetic name'},created_at:new Date().toISOString()});
 const response=await app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/batches`,headers:headers(),payload:{campaignId,batch:{version:1,hostId:o.hostId,campaignId,events:[event],after:null,lastSequence:event.event.sequence,hasMore:false,delivery:'NOT_CONFIGURED'}}});expect(response.statusCode,response.body).toBe(200);
 const receiptId=response.json().receiptId;expect((await status()).json().receipts[0]).toMatchObject({receiptId,lastSequence:'9007199254740993',state:'STORED_ONLY'});
 const issued=await app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/grant`,headers:headers(),payload:{campaignId}});expect(issued.statusCode,issued.body).toBe(200);const grant=issued.json();
 expect((await app.inject({method:'POST',url:'/api/account/cloud-sync/receipt-read-grant',headers:headers(),payload:{campaignId,origin:{campaignId,hostId:o.hostId,sessionId:o.sessionId,epoch:o.epoch}}})).statusCode).toBe(403);
 const application=(token=grant.token,id=receiptId,extra={})=>app.inject({method:'POST',url:`/api/cloud-sync/sources/${originId}/receipts/${id}/application`,headers:{authorization:'Bearer '+token},payload:extra});
 expect((await app.inject({method:'POST',url:`/api/cloud-sync/sources/${originId}/receipts/${receiptId}/application`,payload:{}})).statusCode).toBe(401);
 expect((await application()).json().status).toBe('STORED_ONLY');expect((await application(grant.token,crypto.randomUUID())).statusCode).toBe(403);expect((await application(grant.token,receiptId,{arbitrary:true})).statusCode).toBe(400);

 await applyCloudSyncReceipt(db,auth,userId,{campaignId,originId,revision:a.revision,receiptId});
 const applied=await status();expect(applied.json().writer).toEqual({mode:'LOCAL',revision:'1',isSelectedSource:true});expect(applied.json().source.appliedThrough).toBe('9007199254740993');expect(applied.json().receipts[0].state).toBe('APPLIED');expect(applied.body).not.toContain('Applied synthetic name');
 const proof=await application();expect(proof.statusCode,proof.body).toBe(200);expect(proof.headers['cache-control']).toBe('no-store');expect(proof.json()).toMatchObject({status:'APPLIED',originId,receiptId,lastSequence:'9007199254740993',writerRevision:'1'});expect(proof.json().mappings[0]).toMatchObject({sourceSequence:'9007199254740993',actionId:event.event.action_id});expect(proof.body).not.toContain('Applied synthetic name');
 await releaseCloudCampaignWriter(db,auth,userId,{campaignId,originId,revision:a.revision});const released=(await status()).json();expect(released.writer.mode).toBe('HOSTED');expect(released.source.closed).toBe(true);expect(released.receipts[0].state).toBe('APPLIED');
 expect((await application()).json()).toEqual(proof.json());
 await db.execute(sql`UPDATE cloud_sync_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE origin_id=${originId}`);expect((await application()).statusCode).toBe(403);
 await db.execute(sql`UPDATE cloud_sync_grants SET expires_at=clock_timestamp()+interval '1 hour',revoked_at=clock_timestamp() WHERE origin_id=${originId}`);expect((await application()).statusCode).toBe(403);
 const recover=()=>app.inject({method:'POST',url:'/api/account/cloud-sync/receipt-read-grant',headers:headers(),payload:{campaignId,origin:{campaignId,hostId:o.hostId,sessionId:o.sessionId,epoch:o.epoch}}});
 const recovered=await recover();expect(recovered.statusCode,recovered.body).toBe(200);const readGrant=recovered.json();expect(readGrant.scope).toBe('READ_RECEIPTS_ONLY');expect(readGrant.originId).toBe(originId);expect(readGrant.token).not.toBe(grant.token);expect((await application(readGrant.token)).json()).toEqual(proof.json());expect((await application()).statusCode).toBe(403);
 const deniedIntake=await app.inject({method:'POST',url:`/api/cloud-sync/sources/${originId}/batches`,headers:{authorization:'Bearer '+readGrant.token},payload:{batch:{}}});expect(deniedIntake.statusCode,deniedIntake.body).toBe(403);
 expect((await app.inject({method:'POST',url:`/api/cloud-sync/sources/${originId}/batches`,headers:{authorization:'Bearer '+readGrant.token},payload:{batch:{version:1,hostId:o.hostId,campaignId,events:[event],after:null,lastSequence:event.event.sequence,hasMore:false,delivery:'NOT_CONFIGURED'}}})).statusCode).toBe(403);
 const [writer]=await db.select().from(schema.campaignWriterAuthorities);expect(writer.writer).toBe('HOSTED');expect(writer.revision).toBe(2n);const [closed]=await db.select().from(schema.cloudSyncOrigins);expect(closed.closedAt).not.toBeNull();
 expect((await app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${originId}/grant`,headers:headers(),payload:{campaignId}})).statusCode).toBe(403);


 expect((await status(headers(),{token:'FORBIDDEN'})).statusCode).toBe(400);
 await db.execute(sql`UPDATE memberships SET role='PLAYER' WHERE id=${memberId}`);expect((await status()).statusCode).toBe(403);expect((await recover()).statusCode).toBe(403);
});
it('paginates owner metadata with exact bigint cursors without exposing payloads or foreign origins',async()=>{
 const registered=await app.inject({method:'POST',url:'/api/account/cloud-sync/sources',headers:headers(),payload:source()}),originId=registered.json().originId;
 for(let n=1;n<=21;n++)await db.execute(sql`INSERT INTO cloud_sync_receipts(origin_id,batch_hash,last_sequence) VALUES(${originId},${n.toString(16).padStart(64,'0')},${(9007199254740993n+BigInt(n)).toString()}::bigint)`);
 const call=(id=originId,extra={})=>app.inject({method:'POST',url:`/api/account/cloud-sync/sources/${id}/status`,headers:headers(),payload:{campaignId,...extra}});
 const first=await call();expect(first.statusCode,first.body).toBe(200);const page=first.json();expect(page.receipts).toHaveLength(20);expect(page.next.lastSequence).toBe('9007199254741013');
 const last=(await call(originId,{after:page.next})).json();expect(last.receipts).toHaveLength(1);expect(last.receipts[0].lastSequence).toBe('9007199254741014');expect(last.next).toBeNull();
 expect((await call(crypto.randomUUID())).statusCode).toBe(403);expect(first.body).not.toContain(token);
});
