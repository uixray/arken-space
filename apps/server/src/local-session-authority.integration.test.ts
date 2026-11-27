import {prepareLocalApplicationCheck,confirmLocalAppliedBatch} from "./local-cloud-applied-batch.js";
import {inspectLocalOutboxCoverage} from "./local-outbox-coverage.js";
import {freezeLocalCloudBatch,confirmLocalCloudStoredBatch} from "./local-cloud-frozen-batch.js";
import {createLocalCloudConnection} from "./local-cloud-connection.js";
import {registerCloudSyncSource,storeCloudSyncBatch} from "./cloud-sync-staging.js";
import {verifyLocalEventBatch,localEventBatchHash,createLocalEventEnvelope} from "./local-event-envelope.js";
import {prepareLocalEventBatch} from "./local-event-outbox.js";
import {ensureStreamThread} from "./chat.js";
import {readPlayerStoryFingerprint,resolveReadableStoryMedia} from "./story-media-content.js";
import { ChatUploadRecovery } from "./chat-upload-recovery.js";
import { createChatUploadLease, chatLeaseStorageKey, writeChatUploadLease } from "./chat-upload-lease.js";
import {reconcileChatUploadFile} from "./chat-upload-reconcile.js";
import * as snapshotModule from "./snapshot.js";
import {updateCharacterCounters} from "./character-counters-command.js";
import * as diceModule from "./dice.js";
import {rechargeCharacterEntry} from "./entry-recharge-command.js";
import {stageChatAttachment} from "./chat-attachment-upload.js";
import sharp from "sharp";
import {readLocalChatAttachmentChunk} from "./local-session-media.js";
import {registerLocalSessionRoutes} from "./local-session-routes.js";
import {openDirectChat,submitDirectChat} from "./direct-chat-command.js";
import {readChatHistory,markChatRead} from "./chat-read-command.js";
import {submitLocalTokenPreview} from "./local-token-preview-submit.js";
import {sendAcceptedLocalTokenPreview} from "./realtime.js";
import {pollLocalTokenPreviews} from "./local-token-preview-poll.js";
import {localTokenPreviews} from "./local-token-preview-buffer.js";
import {tokenPreviewEpochs} from "./token-preview-epochs.js";
import {prepareTokenPreview} from "./realtime.js";
import Fastify from "fastify";
import * as authModule from "./auth.js";
import {registerChatRoutes} from "./chat-routes.js";
import {mkdtemp,writeFile,rm,readdir,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {env} from "./env.js";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";
import { eq,sql } from "drizzle-orm";
import { hashToken } from "./security.js";
import { withLocalOwnerOutboxAuthority,getLocalAuthorityStatus,startLocalAuthority,issueLocalPairing,redeemLocalPairing,revokeLocalPeer,stopLocalAuthority,withLocalPeer } from "./local-session-authority.js";
import {submitDiceRoll} from "./dice-command.js";
import {registerCharacterPlayRoutes} from "./character-play-routes.js";
import {submitStreamChat} from "./stream-chat-command.js";
import {buildSnapshot} from "./snapshot.js";
import { executeLocalPeerRequest } from "./local-session-gateway.js";
const config=vi.hoisted(()=>({DEPLOYMENT_MODE:"LOCAL_HOST",LOCAL_INSTANCE_ID:"60000000-0000-4000-8000-000000000001"}));
vi.mock("./env.js",async()=>{const original=await vi.importActual<typeof import("./env.js")>("./env.js");return {env:{...original.env,...config}};});
type Database=ReturnType<typeof schema.createDatabase>["db"];
let pg:Awaited<ReturnType<typeof createMigratedPglite>>,db:Database;
let campaignId:string,gm:{campaignId:string;membershipId:string;role:"GM";displayName:string},player:string,device:string;

/** Production uses postgres-js RowList; adapt only PGlite execute's result shape. */
function adapt(value:any):Database{
  return new Proxy(value,{get(target,key){
    if(key==="execute")return async(...args:any[])=>{const result=await target.execute(...args);return Array.isArray(result)?result:result.rows;};
    if(key==="transaction")return (callback:any,options?:any)=>target.transaction((tx:any)=>callback(adapt(tx)),options);
    const result=Reflect.get(target,key);return typeof result==="function"?result.bind(target):result;
  }}) as Database;
}
beforeAll(async()=>{
  pg=await createMigratedPglite();db=adapt(drizzle(pg,{schema}));
  const ownerId=crypto.randomUUID();
  await db.insert(schema.users).values({id:ownerId,identityKind:"LOCAL",localInstanceId:config.LOCAL_INSTANCE_ID,localLogin:"owner",localApprovedAt:new Date(),passwordHash:"synthetic-not-a-login"});
  await db.insert(schema.localHostInstances).values({id:config.LOCAL_INSTANCE_ID,ownerUserId:ownerId});
},60000);
afterAll(async()=>{await pg?.close();});
beforeEach(async()=>{
  campaignId=crypto.randomUUID();player=crypto.randomUUID();device=crypto.randomUUID();
  const owner=await db.select().from(schema.localHostInstances);
  gm={campaignId,membershipId:crypto.randomUUID(),role:"GM",displayName:"Synthetic GM"};
  await db.insert(schema.campaigns).values({id:campaignId,name:"Synthetic local session"});
  await db.insert(schema.memberships).values([{id:gm.membershipId,campaignId,role:"GM",displayName:gm.displayName,userId:owner[0]!.ownerUserId},{id:player,campaignId,role:"PLAYER",displayName:"Synthetic player"}]);
});
async function pair(){
  const authority=await startLocalAuthority(db,gm,0);
  const code=await issueLocalPairing(db,gm,{membershipId:player,deviceId:device});
  const result=await redeemLocalPairing(db,{campaignId,deviceId:device,token:code.token});
  return {authority,code,result,binding:{campaignId,deviceId:device,sessionId:authority.sessionId,epoch:authority.epoch,credential:result.credential}};
}
describe("durable local pairing and authority fencing",()=>{
  it("creates the authority by owner CAS and rejects other GMs/players",async()=>{
    expect(await getLocalAuthorityStatus(db,gm)).toEqual({active:false,lastEpoch:0,outbox:{pendingEvents:0,limited:false,delivery:"NOT_CONFIGURED"}});
    const a=await startLocalAuthority(db,gm,0);expect(a.epoch).toBe(1);
    await expect(startLocalAuthority(db,gm,0)).rejects.toThrow("CONFLICT");
    await expect(startLocalAuthority(db,{...gm,membershipId:player},1)).rejects.toThrow("FORBIDDEN");
    expect(await getLocalAuthorityStatus(db,gm)).toMatchObject({active:true,lastEpoch:1,authority:a});
  });
  it("stores only hashes, binds device/member, and consumes a token once",async()=>{
    const {code,result,binding}=await pair();
    const rows=await db.execute<{token_hash:string}>(sql`SELECT token_hash FROM local_session_pairings WHERE campaign_id=${campaignId}`);
    expect(rows[0]!.token_hash).toBe(hashToken(code.token));expect(rows[0]!.token_hash).not.toBe(code.token);
    expect(await withLocalPeer(db,binding,async(_tx,auth)=>auth.membershipId)).toBe(player);
    await expect(redeemLocalPairing(db,{campaignId,deviceId:device,token:code.token})).rejects.toThrow("FORBIDDEN");
    await expect(withLocalPeer(db,{...binding,deviceId:crypto.randomUUID()},async()=>true)).rejects.toThrow("FORBIDDEN");
    expect(result.membershipId).toBe(player);
  });
  it("rejects expiry, device revocation and stale epochs",async()=>{
    const {binding}=await pair();
    await revokeLocalPeer(db,gm,{membershipId:player,deviceId:device});
    await expect(withLocalPeer(db,binding,async()=>true)).rejects.toThrow("FORBIDDEN");
    const code=await issueLocalPairing(db,gm,{membershipId:player,deviceId:device});
    await db.execute(sql`UPDATE local_session_pairings SET expires_at=now()-interval '1 second' WHERE id=${code.pairingId}`);
    await expect(redeemLocalPairing(db,{campaignId,deviceId:device,token:code.token})).rejects.toThrow("FORBIDDEN");
    const rotated=await startLocalAuthority(db,gm,1);expect(rotated.epoch).toBe(2);
    await expect(withLocalPeer(db,binding,async()=>true)).rejects.toThrow("FORBIDDEN");
  });
  it("stops the session and rolls back a failed command in the same transaction",async()=>{
    const {binding,authority}=await pair();
    await expect(withLocalPeer(db,binding,async tx=>{await tx.execute(sql`UPDATE campaigns SET name='must rollback' WHERE id=${campaignId}`);throw Error("synthetic failure");})).rejects.toThrow("synthetic failure");
    const rows=await db.execute<{name:string}>(sql`SELECT name FROM campaigns WHERE id=${campaignId}`);expect(rows[0]!.name).toBe("Synthetic local session");
    await stopLocalAuthority(db,gm,authority.epoch);
    expect(await getLocalAuthorityStatus(db,gm)).toEqual({active:false,lastEpoch:1,outbox:{pendingEvents:0,limited:false,delivery:"NOT_CONFIGURED"}});
    await expect(withLocalPeer(db,binding,async()=>true)).rejects.toThrow("FORBIDDEN");
  });
  it("commits a controlled token once, rejects payload reuse, and never returns a GM object",async()=>{
    const {binding}=await pair(),sceneId=crypto.randomUUID(),definitionId=crypto.randomUUID(),hiddenDefinition=crypto.randomUUID(),tokenId=crypto.randomUUID();
    await db.insert(schema.scenes).values({id:sceneId,campaignId,name:"Synthetic map",grid:{enabled:true,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2}});
    await db.execute(sql`UPDATE campaigns SET active_scene_id=${sceneId} WHERE id=${campaignId}`);
    await db.insert(schema.tokenDefinitions).values([{id:definitionId,campaignId,name:"Own token"},{id:hiddenDefinition,campaignId,name:"SECRET-OBJECT"}]);
    await db.insert(schema.tokenControllers).values({tokenDefinitionId:definitionId,membershipId:player});
    await db.insert(schema.tokens).values([{id:tokenId,definitionId,sceneId,name:"Own token",x:64,y:64},{definitionId:hiddenDefinition,sceneId,name:"SECRET-OBJECT",layer:"GM",x:300,y:300}]);
    const command={kind:"TOKEN_MOVE" as const,payload:{actionId:crypto.randomUUID(),tokenId,revision:0,x:128,y:128,z:0,levelId:null}};
    const first=await executeLocalPeerRequest(db,{peer:binding,command});
    expect(first.ack).toMatchObject({ok:true,status:"APPLIED"});expect(first.snapshot.me.id).toBe(player);
    expect(JSON.stringify(first)).not.toContain("SECRET-OBJECT");
    const second=await executeLocalPeerRequest(db,{peer:binding,command});
    expect(second.ack).toMatchObject({ok:true,status:"DUPLICATE"});
    const conflict=await executeLocalPeerRequest(db,{peer:binding,command:{...command,payload:{...command.payload,x:192}}});
    expect(conflict.ack).toEqual({ok:false,reason:"ACTION_CONFLICT"});
    const rows=await db.execute<{revision:number;x:number}>(sql`SELECT revision,x FROM tokens WHERE id=${tokenId}`);
    expect(rows[0]).toEqual({revision:1,x:128});
  });
  it("delivers actual bounded media, hides GM media, and fences revoke between chunks",async()=>{
    const {binding}=await pair(),sceneId=crypto.randomUUID(),definitionId=crypto.randomUUID(),visible=crypto.randomUUID(),hidden=crypto.randomUUID();
    const previous=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-peer-media-"));env.MEDIA_ROOT=root;
    try{
      const bytes=Buffer.alloc(150000,83);await writeFile(join(root,"synthetic.webp"),bytes);
      await db.insert(schema.assets).values([{id:visible,campaignId,uploadedByMembershipId:gm.membershipId,kind:"IMAGE",name:"Visible",storageKey:"synthetic.webp",mimeType:"image/webp",sizeBytes:bytes.length},{id:hidden,campaignId,uploadedByMembershipId:gm.membershipId,kind:"IMAGE",name:"GM secret",storageKey:"absent-secret.webp",mimeType:"image/webp",sizeBytes:10}]);
      await db.insert(schema.scenes).values({id:sceneId,campaignId,name:"Media scene",grid:{enabled:false,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2}});
      await db.execute(sql`UPDATE campaigns SET active_scene_id=${sceneId} WHERE id=${campaignId}`);
      await db.insert(schema.tokenDefinitions).values({id:definitionId,campaignId,name:"Visible token",defaultAssetId:visible});
      await db.insert(schema.tokenControllers).values({tokenDefinitionId:definitionId,membershipId:player});
      await db.insert(schema.tokens).values({definitionId,sceneId,name:"Visible token",assetId:visible,x:64,y:64});
      await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"ASSET_CHUNK",assetId:hidden,offset:0}})).rejects.toThrow("ASSET_NOT_FOUND");
      const first=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"ASSET_CHUNK",assetId:visible,offset:0}});
      expect(Buffer.from(first.assetChunk!.base64,"base64")).toEqual(bytes.subarray(0,131072));
      expect(first.assetChunk).toMatchObject({offset:0,total:150000});
      const command={kind:"ASSET_CHUNK",assetId:visible,offset:131072,version:first.assetChunk!.version};
      const last=await executeLocalPeerRequest(db,{peer:binding,command});expect(Buffer.from(last.assetChunk!.base64,"base64")).toEqual(bytes.subarray(131072));
      await revokeLocalPeer(db,gm,{membershipId:player,deviceId:device});
      await expect(executeLocalPeerRequest(db,{peer:binding,command})).rejects.toThrow("FORBIDDEN");
    }finally{env.MEDIA_ROOT=previous;await rm(root,{recursive:true,force:true});}
  });

  it("uses canonical chat creation once across peer and HTTP service with payload and actor fencing",async()=>{
    const {binding}=await pair(),payload={actionId:crypto.randomUUID(),body:"Synthetic peer message",stream:"TABLE" as const,visibility:"PUBLIC" as const};
    const first=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"CHAT_SEND",payload}});
    expect(first.chatResult).toMatchObject({body:payload.body,membershipId:player});
    const retry=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"CHAT_SEND",payload}});expect(retry.chatResult).toEqual({duplicate:true});
    expect(await submitStreamChat(db,{...gm,membershipId:player,role:"PLAYER"},payload)).toEqual({duplicate:true});
    await expect(submitStreamChat(db,gm,payload)).rejects.toThrow("ACTION_ID_CONFLICT");
    await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"CHAT_SEND",payload:{...payload,body:"changed"}}})).rejects.toThrow("ACTION_ID_CONFLICT");
    const rows=await db.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM chat_messages WHERE campaign_id=${campaignId}`);expect(rows[0]!.count).toBe(1);
  });
  it("keeps private chat out of other players and rejects forbidden story/character writes",async()=>{
    const {binding}=await pair(),other=crypto.randomUUID();
    await db.insert(schema.memberships).values({id:other,campaignId,role:"PLAYER",displayName:"Other player"});
    const payload={actionId:crypto.randomUUID(),body:"PRIVATE-SYNTHETIC-MESSAGE",stream:"TABLE" as const,visibility:"GM_ONLY" as const};
    const sent=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"CHAT_SEND",payload}});expect(JSON.stringify(sent.snapshot)).toContain(payload.body);
    const others=await buildSnapshot(db,{campaignId,membershipId:other,role:"PLAYER",displayName:"Other player"});expect(JSON.stringify(others)).not.toContain(payload.body);
    await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"CHAT_SEND",payload:{...payload,actionId:crypto.randomUUID(),stream:"STORY"}}})).rejects.toThrow("CHAT_THREAD_FORBIDDEN");
    await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"CHAT_SEND",payload:{...payload,actionId:crypto.randomUUID(),characterId:crypto.randomUUID()}}})).rejects.toThrow("CHARACTER_FORBIDDEN");
  });

  it("preserves HTTP chat status/broadcasts and uses the same action fencing",async()=>{
    const app=Fastify(),emit=vi.fn(),to=vi.fn(()=>({emit}));
    const resolvedAuth={...gm,membershipId:player,role:"PLAYER" as const,displayName:"Synthetic HTTP player"};
    const authSpy=vi.spyOn(authModule,"requireAuth").mockResolvedValue(resolvedAuth as any);
    registerChatRoutes(app,db,{to} as any);
    try{
      const payload={actionId:crypto.randomUUID(),body:"HTTP shared command",stream:"TABLE",visibility:"PUBLIC"};
      const first=await app.inject({method:"POST",url:"/api/chat",payload});expect(first.statusCode,first.body).toBe(201);expect(first.json()).toMatchObject({body:payload.body,membershipId:player});expect(emit).toHaveBeenCalledOnce();
      const retry=await app.inject({method:"POST",url:"/api/chat",payload});expect(retry.statusCode).toBe(200);expect(retry.json()).toEqual({duplicate:true});expect(emit).toHaveBeenCalledOnce();
      const conflict=await app.inject({method:"POST",url:"/api/chat",payload:{...payload,body:"changed"}});expect(conflict.statusCode).toBe(409);
      const forbidden=await app.inject({method:"POST",url:"/api/chat",payload:{...payload,actionId:crypto.randomUUID(),stream:"STORY"}});expect(forbidden.statusCode).toBe(403);
    }finally{authSpy.mockRestore();await app.close();}
  });

  it("rolls on the server once and rejects reused dice action IDs with changed intent or actor",async()=>{
    const {binding}=await pair(),payload={actionId:crypto.randomUUID(),formula:"2d6",rollMode:"ADVANTAGE" as const,visibility:"PUBLIC" as const};
    const first=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"DICE_ROLL",payload}});
    expect(first.chatResult).toMatchObject({kind:"DICE",membershipId:player,stream:"ROLLS",dice:{formula:"2d6",rollMode:"ADVANTAGE"}});
    const again=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"DICE_ROLL",payload}});expect(again.chatResult).toEqual({duplicate:true});
    expect(await submitDiceRoll(db,{...gm,membershipId:player,role:"PLAYER"},payload)).toEqual({duplicate:true});
    await expect(submitDiceRoll(db,gm,payload)).rejects.toThrow("ACTION_ID_CONFLICT");
    await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"DICE_ROLL",payload:{...payload,formula:"1d20"}}})).rejects.toThrow("ACTION_ID_CONFLICT");
    const rows=await db.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM chat_messages WHERE campaign_id=${campaignId}`);expect(rows[0]!.count).toBe(1);
  });
  it("checks character access, private roll projection and rollback of invalid formula",async()=>{
    const {binding}=await pair(),other=crypto.randomUUID();await db.insert(schema.memberships).values({id:other,campaignId,role:"PLAYER",displayName:"Other"});
    const payload={actionId:crypto.randomUUID(),formula:"1d20",visibility:"GM_ONLY" as const};
    const result=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"DICE_ROLL",payload}});expect(result.chatResult).toMatchObject({visibility:"GM_ONLY",kind:"DICE"});
    const otherSnapshot=await buildSnapshot(db,{campaignId,membershipId:other,role:"PLAYER",displayName:"Other"});expect(otherSnapshot.messages).toHaveLength(0);
    await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"DICE_ROLL",payload:{...payload,actionId:crypto.randomUUID(),characterId:crypto.randomUUID()}}})).rejects.toThrow("CHARACTER_FORBIDDEN");
    await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"DICE_ROLL",payload:{...payload,actionId:crypto.randomUUID(),formula:"1d1"}}})).rejects.toThrow();
    const rows=await db.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM chat_messages WHERE campaign_id=${campaignId}`);expect(rows[0]!.count).toBe(1);
  });
  it("preserves HTTP dice statuses, invalid-formula errors and one broadcast on replay",async()=>{
    const app=Fastify(),emit=vi.fn(),to=vi.fn(()=>({emit}));
    const authSpy=vi.spyOn(authModule,"requireAuth").mockResolvedValue({...gm,membershipId:player,role:"PLAYER",displayName:"Synthetic HTTP player"} as any);
    registerCharacterPlayRoutes(app,db,{to} as any,{broadcast:async()=>undefined,publishCharacter:async()=>undefined});
    try{
      const payload={actionId:crypto.randomUUID(),formula:"1d6",visibility:"PUBLIC"};
      const first=await app.inject({method:"POST",url:"/api/dice",payload});expect(first.statusCode,first.body).toBe(201);expect(first.json()).toMatchObject({kind:"DICE",membershipId:player});expect(emit).toHaveBeenCalledOnce();
      const retry=await app.inject({method:"POST",url:"/api/dice",payload});expect(retry.statusCode).toBe(200);expect(retry.json()).toEqual({duplicate:true});expect(emit).toHaveBeenCalledOnce();
      expect((await app.inject({method:"POST",url:"/api/dice",payload:{...payload,formula:"2d6"}})).statusCode).toBe(409);
      const invalid=await app.inject({method:"POST",url:"/api/dice",payload:{...payload,actionId:crypto.randomUUID(),formula:"1d1"}});expect(invalid.statusCode).toBe(400);expect(invalid.json().error).toBe("INVALID_DICE_FORMULA");
    }finally{authSpy.mockRestore();await app.close();}
  });

  it("filters current preview coordinates and redacts a public token crossing into fog",async()=>{
    const {binding}=await pair(),sceneId=crypto.randomUUID(),definitionId=crypto.randomUUID(),tokenId=crypto.randomUUID(),secret=crypto.randomUUID();
    await db.insert(schema.scenes).values({id:sceneId,campaignId,name:"Preview scene",grid:{enabled:false,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2}});
    await db.execute(sql`UPDATE campaigns SET active_scene_id=${sceneId} WHERE id=${campaignId}`);
    await db.insert(schema.tokenDefinitions).values({id:definitionId,campaignId,name:"Preview token"});
    await db.insert(schema.tokens).values([{id:tokenId,definitionId,sceneId,name:"Public",x:64,y:64},{id:secret,definitionId,sceneId,name:"SECRET-PREVIEW",layer:"GM",x:64,y:64}]);
    const rectangle={x:0,y:0,width:256,height:256};
    await db.insert(schema.fogReveals).values({sceneId,...rectangle,geometry:{type:"RECT",...rectangle},bbox:rectangle});
    const movement={actionId:crypto.randomUUID(),tokenId,sceneId,revision:0,x:128,y:64,z:0,levelId:null,previewEpoch:tokenPreviewEpochs.current(campaignId),snapshotVersion:0};
    expect(await prepareTokenPreview(db,gm,movement)).not.toBeNull();
    expect(await prepareTokenPreview(db,{...gm,membershipId:player,role:"PLAYER"},movement)).toBeNull();
    localTokenPreviews.publish(campaignId,movement);localTokenPreviews.publish(campaignId,{...movement,x:512});localTokenPreviews.publish(campaignId,{...movement,tokenId:secret});
    const result=await pollLocalTokenPreviews(db,{kind:"PREVIEW_POLL",peer:binding,cursor:0});
    expect(result.events.map(e=>e.kind)).toEqual(["MOVING","HIDDEN"]);expect(result.membershipId).toBe(player);expect(result.authority.sessionId).toBe(binding.sessionId);
    expect(JSON.stringify(result)).not.toContain(secret);expect(JSON.stringify(result)).not.toContain('"x":512');expect(JSON.stringify(result)).not.toContain("SECRET-PREVIEW");
    const cover={x:0,y:0,width:1024,height:1024};await db.insert(schema.fogReveals).values({sceneId,...cover,operation:"COVER",geometry:{type:"RECT",...cover},bbox:cover});
    expect((await pollLocalTokenPreviews(db,{kind:"PREVIEW_POLL",peer:binding,cursor:0})).events).toEqual([]);
    await db.insert(schema.tokenControllers).values({tokenDefinitionId:definitionId,membershipId:player});
    const controlled=await pollLocalTokenPreviews(db,{kind:"PREVIEW_POLL",peer:binding,cursor:0});expect(controlled.events.map(e=>e.kind)).toEqual(["MOVING","MOVING"]);
    await revokeLocalPeer(db,gm,{membershipId:player,deviceId:device});await expect(pollLocalTokenPreviews(db,{kind:"PREVIEW_POLL",peer:binding,cursor:result.cursor})).rejects.toThrow("FORBIDDEN");
  });

  it("accepts only controlled peer drag hints and redacts them for a second player before commit",async()=>{
    const {binding}=await pair(),other=crypto.randomUUID(),otherDevice=crypto.randomUUID();
    await db.insert(schema.memberships).values({id:other,campaignId,role:"PLAYER",displayName:"Second player"});
    const code=await issueLocalPairing(db,gm,{membershipId:other,deviceId:otherDevice}),redeemed=await redeemLocalPairing(db,{campaignId,deviceId:otherDevice,token:code.token});
    const otherBinding={...binding,deviceId:otherDevice,credential:redeemed.credential};
    const sceneId=crypto.randomUUID(),definitionId=crypto.randomUUID(),tokenId=crypto.randomUUID();
    await db.insert(schema.scenes).values({id:sceneId,campaignId,name:"Outbound scene",grid:{enabled:false,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2}});
    await db.execute(sql`UPDATE campaigns SET active_scene_id=${sceneId} WHERE id=${campaignId}`);
    await db.insert(schema.tokenDefinitions).values({id:definitionId,campaignId,name:"Controlled"});await db.insert(schema.tokenControllers).values({tokenDefinitionId:definitionId,membershipId:player});
    await db.insert(schema.tokens).values({id:tokenId,definitionId,sceneId,name:"Controlled",x:64,y:64});
    const rect={x:0,y:0,width:512,height:512};await db.insert(schema.fogReveals).values({sceneId,...rect,geometry:{type:"RECT",...rect},bbox:rect});
    const movement={actionId:crypto.randomUUID(),tokenId,sceneId,revision:0,x:128,y:64,z:0,levelId:null,previewEpoch:tokenPreviewEpochs.current(campaignId),snapshotVersion:0};
    const notices:any[]=[],io={to:(rooms:any)=>({emit:(event:any,data:any)=>notices.push({rooms,event,data}),except:(excluded:any)=>({emit:(event:any,data:any)=>notices.push({rooms,excluded,event,data})})})};
    const deliver=vi.fn((id:string,prepared:any,value:any)=>sendAcceptedLocalTokenPreview(io as any,id,prepared,value));
    expect(await submitLocalTokenPreview(db,{kind:"PREVIEW_SEND",peer:otherBinding,movement},deliver)).toMatchObject({accepted:false});expect(deliver).not.toHaveBeenCalled();
    expect(await submitLocalTokenPreview(db,{kind:"PREVIEW_SEND",peer:binding,movement},deliver)).toMatchObject({accepted:true,membershipId:player});
    const visible=await pollLocalTokenPreviews(db,{kind:"PREVIEW_POLL",peer:otherBinding,cursor:0});expect(visible.events).toEqual([{kind:"MOVING",movement}]);
    expect(await submitLocalTokenPreview(db,{kind:"PREVIEW_SEND",peer:binding,movement:{...movement,x:900}},deliver)).toMatchObject({accepted:true});
    const hidden=await pollLocalTokenPreviews(db,{kind:"PREVIEW_POLL",peer:otherBinding,cursor:visible.cursor});expect(hidden.events.map(e=>e.kind)).toEqual(["HIDDEN"]);expect(JSON.stringify(hidden)).not.toContain('"x":900');expect(notices.some(n=>n.event==="token:preview-hidden")).toBe(true);
    const before=await db.execute<{revision:number;x:number}>(sql`SELECT revision,x FROM tokens WHERE id=${tokenId}`);expect(before[0]).toEqual({revision:0,x:64});
    const count=await db.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM game_events WHERE campaign_id=${campaignId}`);expect(count[0]!.count).toBe(0);
    const commit=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"TOKEN_MOVE",payload:{actionId:crypto.randomUUID(),tokenId,revision:0,x:192,y:64,z:0,levelId:null}}});expect(commit.ack).toMatchObject({ok:true,status:"APPLIED"});
    expect((await pollLocalTokenPreviews(db,{kind:"PREVIEW_POLL",peer:otherBinding,cursor:0})).events).toEqual([]);
    await revokeLocalPeer(db,gm,{membershipId:player,deviceId:device});await expect(submitLocalTokenPreview(db,{kind:"PREVIEW_SEND",peer:binding,movement},deliver)).rejects.toThrow("FORBIDDEN");
  });

  it("keeps peer direct messages/history participant-only with no GM bypass and stable read cursors",async()=>{
    const {binding}=await pair(),other=crypto.randomUUID(),otherDevice=crypto.randomUUID();await db.insert(schema.memberships).values({id:other,campaignId,role:"PLAYER",displayName:"DM recipient"});
    const code=await issueLocalPairing(db,gm,{membershipId:other,deviceId:otherDevice}),redeemed=await redeemLocalPairing(db,{campaignId,deviceId:otherDevice,token:code.token});const b={...binding,deviceId:otherDevice,credential:redeemed.credential};
    const opened=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"DIRECT_OPEN",payload:{participantMembershipId:other}}}),threadId=opened.directThread!.id;
    expect(opened.directThread!.participants.map(p=>p.membershipId).sort()).toEqual([player,other].sort());
    const payload={actionId:crypto.randomUUID(),threadId,body:"ONLY-TWO-PARTICIPANTS",attachmentContentIds:[]};
    const sent=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"DIRECT_SEND",payload}});expect(sent.chatResult).toMatchObject({body:payload.body,threadId});
    const received=await executeLocalPeerRequest(db,{peer:b,command:{kind:"CHAT_HISTORY",payload:{threadId,limit:50}}});expect(received.chatHistory!.messages.map(m=>m.body)).toEqual([payload.body]);
    expect(received.snapshot.chatThreadStates.find(s=>s.threadId===threadId)!.unreadCount).toBe(1);
    expect(sent.snapshot.chatThreadStates.find(s=>s.threadId===threadId)!.unreadCount).toBe(0);
    expect((await readChatHistory(db,gm,{threadId,limit:50})).messages).toEqual([]);
    expect(JSON.stringify(await buildSnapshot(db,gm))).not.toContain(payload.body);
    await expect(submitDirectChat(db,gm,payload)).rejects.toThrow("CHAT_THREAD_NOT_FOUND");await expect(markChatRead(db,gm,{threadId,sequence:999999})).rejects.toThrow("CHAT_THREAD_NOT_FOUND");
    const retry=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"DIRECT_SEND",payload}});expect(retry.chatResult).toMatchObject({body:payload.body,threadId});
    await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"DIRECT_SEND",payload:{...payload,body:"changed"}}})).rejects.toThrow("ACTION_ID_CONFLICT");
    await expect(executeLocalPeerRequest(db,{peer:b,command:{kind:"DIRECT_SEND",payload}})).rejects.toThrow("ACTION_ID_CONFLICT");
    const read=await executeLocalPeerRequest(db,{peer:b,command:{kind:"CHAT_READ",payload:{threadId,sequence:999999}}});expect(read.chatReadCursor!.lastReadSequence).toBe(received.chatHistory!.messages[0]!.sequence);expect(read.snapshot.chatThreadStates.find(s=>s.threadId===threadId)!.unreadCount).toBe(0);
    const lower=await executeLocalPeerRequest(db,{peer:b,command:{kind:"CHAT_READ",payload:{threadId,sequence:0}}});expect(lower.chatReadCursor!.lastReadSequence).toBe(read.chatReadCursor!.lastReadSequence);
    await expect(openDirectChat(db,gm,{participantMembershipId:gm.membershipId})).rejects.toThrow("NOT_FOUND");
  });

  it("claims private attachments atomically, serves bounded chunks only to participants, and isolates the media lane",async()=>{
    const {binding}=await pair(),other=crypto.randomUUID(),otherDevice=crypto.randomUUID();await db.insert(schema.memberships).values({id:other,campaignId,role:"PLAYER",displayName:"File recipient"});
    const code=await issueLocalPairing(db,gm,{membershipId:other,deviceId:otherDevice}),redeemed=await redeemLocalPairing(db,{campaignId,deviceId:otherDevice,token:code.token}),b={...binding,deviceId:otherDevice,credential:redeemed.credential};
    const opened=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"DIRECT_OPEN",payload:{participantMembershipId:other}}}),threadId=opened.directThread!.id;
    const root=await mkdtemp(join(tmpdir(),"arken-private-chunk-")),previousRoot=env.MEDIA_ROOT,previousBridge=env.LOCAL_SESSION_BRIDGE_ENABLED;env.MEDIA_ROOT=root;
    const contentId=crypto.randomUUID(),foreign=crypto.randomUUID(),bytes=Buffer.from("private synthetic bytes");
    try{
      await writeFile(join(root,"private.png"),bytes);
      await db.insert(schema.chatAttachmentUploads).values([{contentId,campaignId,uploadedByMembershipId:player,fileName:"private.png",storageKey:"private.png",mimeType:"image/png",sizeBytes:bytes.length,width:1,height:1,expiresAt:new Date(Date.now()+60000)},{contentId:foreign,campaignId,uploadedByMembershipId:other,fileName:"foreign.png",storageKey:"foreign.png",mimeType:"image/png",sizeBytes:1,width:1,height:1,expiresAt:new Date(Date.now()+60000)}]);
      const payload={actionId:crypto.randomUUID(),threadId,body:"Private file",attachmentContentIds:[contentId]};
      await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"DIRECT_SEND",payload:{...payload,attachmentContentIds:[foreign]}}})).rejects.toThrow("CHAT_ATTACHMENT_NOT_FOUND");
      const sent=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"DIRECT_SEND",payload}});expect(sent.chatResult).toMatchObject({attachments:[{contentId,fileName:"private.png"}]});
      expect(JSON.stringify(sent.chatResult)).not.toContain("storageKey");
      await expect(readLocalChatAttachmentChunk(db,gm,{contentId,offset:0})).rejects.toThrow("NOT_FOUND");
      const chunk=await executeLocalPeerRequest(db,{peer:b,command:{kind:"CHAT_ATTACHMENT_CHUNK",contentId,offset:0}});expect(Buffer.from(chunk.assetChunk!.base64,"base64")).toEqual(bytes);
      env.LOCAL_SESSION_BRIDGE_ENABLED=true;const app=Fastify();registerLocalSessionRoutes(app,db,async()=>undefined);
      try{
        const headers={origin:env.WEB_ORIGIN};const delivered=await app.inject({method:"POST",url:"/api/local-session/media",headers,payload:{peer:b,command:{kind:"CHAT_ATTACHMENT_CHUNK",contentId,offset:0}}});expect(delivered.statusCode,delivered.body).toBe(200);
        const rejected=await app.inject({method:"POST",url:"/api/local-session/media",headers,payload:{peer:b,command:{kind:"CHAT_READ",payload:{threadId,sequence:999999}}}});expect(rejected.statusCode).toBe(400);
      }finally{await app.close();}
      await revokeLocalPeer(db,gm,{membershipId:other,deviceId:otherDevice});await expect(executeLocalPeerRequest(db,{peer:b,command:{kind:"CHAT_ATTACHMENT_CHUNK",contentId,offset:0}})).rejects.toThrow("FORBIDDEN");
    }finally{env.MEDIA_ROOT=previousRoot;env.LOCAL_SESSION_BRIDGE_ENABLED=previousBridge;await rm(root,{recursive:true,force:true});}
  });

 it("stages validated images with shared ownership and rejects oversized/invalid input",async()=>{
  const previousRoot=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-shared-chat-stage-"));env.MEDIA_ROOT=root;
  try{
   const auth={campaignId,membershipId:player,role:"PLAYER" as const,displayName:"Player"};
   const bytes=await sharp({create:{width:48,height:32,channels:4,background:"#9933aa"}}).png().toBuffer();
   const metadata=await stageChatAttachment(db,auth,bytes,"synthetic.png");
   expect(metadata).toMatchObject({mimeType:"image/webp",width:48,height:32,fileName:"synthetic.png"});
   expect(JSON.stringify(metadata)).not.toContain("storageKey");
   const rows=await db.select().from(schema.chatAttachmentUploads).where(sql`content_id=${metadata.contentId}`);
   expect(rows[0]).toMatchObject({campaignId,uploadedByMembershipId:player,status:"STAGED"});
   await expect(stageChatAttachment(db,auth,Buffer.alloc(0),"empty.png")).rejects.toThrow("UPLOAD_REQUIRED");
   await expect(stageChatAttachment(db,auth,Buffer.alloc(env.MAX_IMAGE_BYTES+1),"large.png")).rejects.toThrow("IMAGE_TOO_LARGE");
   await expect(stageChatAttachment(db,auth,Buffer.from("not an image"),"spoof.png")).rejects.toThrow();
  }finally{env.MEDIA_ROOT=previousRoot;await rm(root,{recursive:true,force:true});}
 });

 it("uploads through the fenced gateway, replays only the final receipt, and revokes mid-transfer",async()=>{
  const previousRoot=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-peer-upload-"));env.MEDIA_ROOT=root;
  try{
   const {binding}=await pair();const bytes=await sharp({create:{width:64,height:48,channels:4,background:"#31aa99"}}).png().toBuffer();
   const {createHash}=await import("node:crypto");
   const command={kind:"CHAT_UPLOAD_CHUNK" as const,uploadId:crypto.randomUUID(),fileName:"peer.png",total:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),offset:0,base64:bytes.toString("base64")};
   const first=await executeLocalPeerRequest(db,{peer:binding,command});expect(first.upload?.attachment).toMatchObject({fileName:"peer.png",mimeType:"image/webp",width:64,height:48});
   const duplicate=await executeLocalPeerRequest(db,{peer:binding,command});expect(duplicate.upload).toEqual(first.upload);
   const conflict=await executeLocalPeerRequest(db,{peer:binding,command:{...command,fileName:"changed.png"}});expect(conflict.commandError).toEqual({status:409,code:"UPLOAD_CONFLICT"});expect(conflict.upload).toBeUndefined();
   const rows=await db.execute(sql`SELECT content_id FROM local_chat_upload_receipts WHERE campaign_id=${campaignId}`);expect(rows).toHaveLength(1);
   expect(JSON.stringify(first.upload)).not.toContain("storageKey");
   const pending={...command,uploadId:crypto.randomUUID(),total:bytes.length+1,base64:bytes.subarray(0,1).toString("base64")};
   expect((await executeLocalPeerRequest(db,{peer:binding,command:pending})).upload).toMatchObject({nextOffset:1});
   await revokeLocalPeer(db,gm,{membershipId:player,deviceId:device});
   await expect(executeLocalPeerRequest(db,{peer:binding,command:{...pending,offset:1}})).rejects.toThrow("FORBIDDEN");
  }finally{env.MEDIA_ROOT=previousRoot;await rm(root,{recursive:true,force:true});}
 });

 it("recharges through the peer with exact replay, revision fencing and clock anchors",async()=>{
  const {binding}=await pair(),characterId=crypto.randomUUID(),entryId=crypto.randomUUID();
  await db.insert(schema.characters).values({id:characterId,campaignId,name:"Peer hero",ownerMembershipId:player});
  await db.insert(schema.characterCatalogEntries).values({id:entryId,characterId,kind:"ABILITY",name:"Peer charge",data:{uses:{current:0,max:3,recharge:"DAY"}}});
  await db.execute(sql`UPDATE campaigns SET day=9,battle_counter=4 WHERE id=${campaignId}`);
  const command={kind:"ENTRY_RECHARGE" as const,characterId,entryId,payload:{actionId:crypto.randomUUID(),revision:0}};
  const first=await executeLocalPeerRequest(db,{peer:binding,command});
  expect(first.entryRecharge).toMatchObject({id:entryId,revision:1,data:{uses:{current:3,max:3,lastRechargeDay:9}}});
  const replay=await executeLocalPeerRequest(db,{peer:binding,command});expect(replay.entryRecharge).toEqual({duplicate:true});
  const events=await db.execute(sql`SELECT sequence FROM game_events WHERE campaign_id=${campaignId} AND type='entry.recharged'`);expect(events).toHaveLength(1);
  const messages=await db.execute(sql`SELECT body FROM chat_messages WHERE campaign_id=${campaignId} AND kind='SYSTEM'`);expect(messages).toHaveLength(1);
  await expect(executeLocalPeerRequest(db,{peer:binding,command:{...command,payload:{...command.payload,revision:1}}})).resolves.toMatchObject({commandError:{code:"ACTION_ID_CONFLICT"}});
  await expect(rechargeCharacterEntry(db,gm,characterId,entryId,command.payload)).rejects.toThrow("ACTION_ID_CONFLICT");
  await expect(executeLocalPeerRequest(db,{peer:binding,command:{...command,payload:{actionId:crypto.randomUUID(),revision:0}}})).resolves.toMatchObject({commandError:{code:"ENTRY_CONFLICT"}});
  await db.execute(sql`UPDATE characters SET owner_membership_id=NULL WHERE id=${characterId}`);
  await expect(executeLocalPeerRequest(db,{peer:binding,command})).resolves.toMatchObject({commandError:{code:"CHARACTER_ENTRY_FORBIDDEN"}});
 });
 it("uses the same recharge command over HTTP and refuses foreign entries",async()=>{
  const {binding}=await pair(),characterId=crypto.randomUUID(),entryId=crypto.randomUUID();
  await db.insert(schema.characters).values({id:characterId,campaignId,name:"HTTP hero",ownerMembershipId:player});
  await db.insert(schema.characterCatalogEntries).values({id:entryId,characterId,kind:"ABILITY",name:"Battle charge",data:{uses:{current:0,max:2,recharge:"BATTLE"}}});
  await db.execute(sql`UPDATE campaigns SET battle_counter=7 WHERE id=${campaignId}`);
  const authSpy=vi.spyOn(authModule,"requireAuth").mockResolvedValue({...gm,membershipId:player,role:"PLAYER"} as any),app=Fastify(),broadcast=vi.fn(async()=>{});
  registerCharacterPlayRoutes(app,db,{to:()=>({emit:()=>{}})} as any,{broadcast,publishCharacter:async()=>{}});
  const body={actionId:crypto.randomUUID(),revision:0},url=`/api/characters/${characterId}/catalog/${entryId}/recharge`;
  try{
   const first=await app.inject({method:"POST",url,payload:body});expect(first.statusCode,first.body).toBe(200);expect(first.json()).toMatchObject({revision:1,data:{uses:{current:2,lastBattleCounter:7}}});
   const replay=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"ENTRY_RECHARGE",characterId,entryId,payload:body}});expect(replay.entryRecharge).toEqual({duplicate:true});expect(broadcast).toHaveBeenCalledOnce();
   broadcast.mockRejectedValueOnce(Error("synthetic projection unavailable"));
   const committed=await app.inject({method:"POST",url,payload:{actionId:crypto.randomUUID(),revision:1}});expect(committed.statusCode,committed.body).toBe(200);expect(committed.json()).toMatchObject({revision:2});
   const denied=await app.inject({method:"POST",url:url.replace(characterId,crypto.randomUUID()),payload:{actionId:crypto.randomUUID(),revision:1}});expect(denied.statusCode).toBe(403);
  }finally{authSpy.mockRestore();await app.close();}
 });

 it("executes all ability rolls once and atomically spends one use and one shared cost",async()=>{
  const {binding}=await pair(),characterId=crypto.randomUUID(),entryId=crypto.randomUUID();
  await db.insert(schema.characters).values({id:characterId,campaignId,name:"Ability hero",ownerMembershipId:player,resources:{physicalPower:{current:5,maximum:5}}});
  await db.insert(schema.characterCatalogEntries).values({id:entryId,characterId,kind:"ABILITY",name:"Double effect",data:{uses:{current:2,max:2,recharge:"DAY"},usageCost:{type:"physical",amount:2},rollActions:[{id:"first",kind:"CUSTOM",label:"First",dice:"1d6",modifiers:[],order:0,advantage:false,consumeUse:true},{id:"second",kind:"CUSTOM",label:"Second",dice:"1d4",modifiers:[],order:1,advantage:false,consumeUse:true}]}});
  const command={kind:"ENTRY_ROLL" as const,characterId,entryId,payload:{actionId:crypto.randomUUID(),entryRevision:0,executeAll:true,visibility:"PUBLIC"}};
  const rng=vi.spyOn(diceModule,"rollFormulaWithMode");
  try{
   const first=await executeLocalPeerRequest(db,{peer:binding,command});expect(first.entryRoll).toMatchObject({skillCard:{execution:"EXECUTED",uses:{before:2,after:1},activationCost:{before:5,after:3}}});expect((first.entryRoll as any).skillCard.rolls).toHaveLength(2);expect(rng).toHaveBeenCalledTimes(2);
   expect((await executeLocalPeerRequest(db,{peer:binding,command})).entryRoll).toEqual({duplicate:true});expect(rng).toHaveBeenCalledTimes(2);
   await expect(executeLocalPeerRequest(db,{peer:binding,command:{...command,payload:{...command.payload,rollMode:"ADVANTAGE"}}})).resolves.toMatchObject({commandError:{code:"ACTION_ID_CONFLICT"}});expect(rng).toHaveBeenCalledTimes(2);
   const events=await db.execute(sql`SELECT sequence FROM game_events WHERE campaign_id=${campaignId} AND type='entry.roll'`);expect(events).toHaveLength(1);
   const [character]=await db.select().from(schema.characters).where(sql`id=${characterId}`);expect(character).toMatchObject({revision:1,resources:{physicalPower:{current:3}}});
   const [entry]=await db.select().from(schema.characterCatalogEntries).where(sql`id=${entryId}`);expect(entry).toMatchObject({revision:1,data:{uses:{current:1}}});
   const app=Fastify(),authSpy=vi.spyOn(authModule,"requireAuth").mockResolvedValue({...gm,membershipId:player,role:"PLAYER"} as any);registerCharacterPlayRoutes(app,db,{to:()=>({emit:()=>{}})} as any,{broadcast:async()=>{},publishCharacter:async()=>{}});
   try{const replay=await app.inject({method:"POST",url:`/api/characters/${characterId}/catalog/${entryId}/roll`,payload:command.payload});expect(replay.statusCode,replay.body).toBe(200);expect(replay.json()).toEqual({duplicate:true});expect(rng).toHaveBeenCalledTimes(2);}finally{authSpy.mockRestore();await app.close();}
   await db.execute(sql`UPDATE characters SET owner_membership_id=NULL WHERE id=${characterId}`);
   await expect(executeLocalPeerRequest(db,{peer:binding,command})).resolves.toMatchObject({commandError:{code:"CHARACTER_ENTRY_FORBIDDEN"}});expect(rng).toHaveBeenCalledTimes(2);
  }finally{rng.mockRestore();}
 });
 it("shares skill cards without RNG and executes numeric skills using the canonical dice path",async()=>{
  const {binding}=await pair(),characterId=crypto.randomUUID(),entryId=crypto.randomUUID();
  await db.insert(schema.characters).values({id:characterId,campaignId,name:"Skill hero",ownerMembershipId:player});
  await db.insert(schema.characterCatalogEntries).values({id:entryId,characterId,kind:"SKILL",name:"Stealth",data:{skillValue:4}});
  const rng=vi.spyOn(diceModule,"rollFormulaWithMode");
  try{
   const shared=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"ENTRY_ROLL",characterId,entryId,payload:{actionId:crypto.randomUUID(),mode:"SHARE",visibility:"PUBLIC"}}});expect(shared.entryRoll).toMatchObject({skillCard:{execution:"SHARED"}});expect(rng).not.toHaveBeenCalled();
   const command={kind:"ENTRY_ROLL" as const,characterId,entryId,payload:{actionId:crypto.randomUUID(),entryRevision:0,visibility:"PUBLIC"}};
   const rolled=await executeLocalPeerRequest(db,{peer:binding,command});expect(rolled.entryRoll).toMatchObject({skillCard:{formula:"1d20 + 4",execution:"EXECUTED"}});expect(rng).toHaveBeenCalledOnce();
   await expect(executeLocalPeerRequest(db,{peer:binding,command:{...command,payload:{...command.payload,actionId:crypto.randomUUID(),visibility:"GM_ONLY"}}})).resolves.toMatchObject({commandError:{code:"GM_ONLY_VISIBILITY_FORBIDDEN"}});expect(rng).toHaveBeenCalledOnce();
  }finally{rng.mockRestore();}
 });

 it("recovers resources and only the resting character's abilities once through peer",async()=>{
  const {binding}=await pair(),characterId=crypto.randomUUID(),otherCharacter=crypto.randomUUID(),entryId=crypto.randomUUID(),otherEntry=crypto.randomUUID();
  await db.insert(schema.characters).values([{id:characterId,campaignId,name:"Resting hero",ownerMembershipId:player,resources:{physicalPower:{current:2,maximum:10,restAmount:4},inspiration:{current:1,maximum:1}}},{id:otherCharacter,campaignId,name:"Other hero",ownerMembershipId:player}]);
  await db.insert(schema.characterCatalogEntries).values([{id:entryId,characterId,kind:"ABILITY",name:"Rest charge",data:{uses:{current:0,max:2,recharge:"SHORT_REST"}}},{id:otherEntry,characterId:otherCharacter,kind:"ABILITY",name:"Other charge",data:{uses:{current:0,max:2,recharge:"SHORT_REST"}}}]);
  const command={kind:"CHARACTER_COUNTERS" as const,characterId,payload:{actionId:crypto.randomUUID(),revision:0,rest:"SHORT"}};
  const first=await executeLocalPeerRequest(db,{peer:binding,command});expect(first.ack).toMatchObject({ok:true,status:"APPLIED"});expect(first.characterCounters).toMatchObject({revision:1,resources:{physicalPower:{current:4},inspiration:{current:1}},entries:[{id:entryId,data:{uses:{current:2}}}]});
  const replay=await executeLocalPeerRequest(db,{peer:binding,command});expect(replay.ack).toMatchObject({ok:true,status:"DUPLICATE",sequence:(first.ack as any).sequence});expect(replay.characterCounters).toMatchObject({revision:1,resources:{physicalPower:{current:4}}});
  const [other]=await db.select().from(schema.characterCatalogEntries).where(sql`id=${otherEntry}`);expect(other).toBeDefined();expect(other!.data).toMatchObject({uses:{current:0}});
  const events=await db.execute(sql`SELECT sequence FROM game_events WHERE campaign_id=${campaignId} AND type='character.counters'`);expect(events).toHaveLength(1);
  await expect(executeLocalPeerRequest(db,{peer:binding,command:{...command,payload:{...command.payload,rest:"LONG"}}})).resolves.toMatchObject({commandError:{code:"ACTION_ID_CONFLICT"}});
 });
 it("preserves wallet aggregation and returns the current canonical character on exact replay",async()=>{
  const {binding}=await pair(),characterId=crypto.randomUUID();await db.insert(schema.characters).values({id:characterId,campaignId,name:"Wallet hero",ownerMembershipId:player});
  const commands=[1,2,3].map((gold,revision)=>({kind:"CHARACTER_COUNTERS" as const,characterId,payload:{actionId:crypto.randomUUID(),revision,wallet:{gold,silver:0,copper:0,sp:0}}}));
  for(const command of commands){const response=await executeLocalPeerRequest(db,{peer:binding,command});expect(response.characterCounters).toMatchObject({revision:command.payload.revision+1,wallet:command.payload.wallet});}
  const replay=await executeLocalPeerRequest(db,{peer:binding,command:commands[0]});expect(replay.ack).toMatchObject({ok:true,status:"DUPLICATE"});expect(replay.characterCounters).toMatchObject({revision:3,wallet:{gold:3}});
  const rows=await db.execute<{system_data:any}>(sql`SELECT system_data FROM chat_messages WHERE campaign_id=${campaignId} AND kind='SYSTEM'`);expect(rows).toHaveLength(1);expect(rows[0]?.system_data).toMatchObject({operationCount:3,before:{gold:0},after:{gold:3}});
  await expect(executeLocalPeerRequest(db,{peer:binding,command:{...commands[2],payload:{...commands[2]!.payload,wallet:{gold:99,silver:0,copper:0,sp:0}}}})).resolves.toMatchObject({commandError:{code:"ACTION_ID_CONFLICT"}});
  await expect(updateCharacterCounters(db,gm,characterId,commands[0]!.payload)).rejects.toThrow("ACTION_ID_CONFLICT");
  const events=await db.execute(sql`SELECT sequence FROM game_events WHERE campaign_id=${campaignId} AND type='character.counters'`);expect(events).toHaveLength(3);
 });
 it("keeps progression and inspiration ledgers separate and rolls back rejected/no-op counters",async()=>{
  const {binding}=await pair(),characterId=crypto.randomUUID();await db.insert(schema.characters).values({id:characterId,campaignId,name:"Ledger hero",ownerMembershipId:player,resources:{inspiration:{current:1,maximum:1}}});
  const request=(payload:unknown)=>executeLocalPeerRequest(db,{peer:binding,command:{kind:"CHARACTER_COUNTERS",characterId,payload}});
  await expect(request({actionId:crypto.randomUUID(),revision:0,wallet:{gold:0,silver:0,copper:0,sp:1}})).resolves.toMatchObject({commandError:{code:"USE_PROGRESSION_SP_LEDGER"}});
  await expect(request({actionId:crypto.randomUUID(),revision:0,resources:{inspiration:{current:2,maximum:2}}})).resolves.toMatchObject({commandError:{code:"USE_INSPIRATION_ADJUSTMENT"}});
  await expect(request({actionId:crypto.randomUUID(),revision:0,rest:"SHORT"})).resolves.toMatchObject({commandError:{code:"NO_COUNTER_CHANGES"}});
  const [row]=await db.select().from(schema.characters).where(sql`id=${characterId}`);expect(row).toMatchObject({revision:0,resources:{inspiration:{current:1}}});
  const events=await db.execute(sql`SELECT sequence FROM game_events WHERE campaign_id=${campaignId}`);expect(events).toHaveLength(0);
 });

 it("reads only published campaign world-map backgrounds and rechecks lifecycle on every chunk",async()=>{
  const {binding}=await pair(),previousRoot=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-world-peer-"));env.MEDIA_ROOT=root;
  try{
   const bytes=await sharp({create:{width:32,height:24,channels:4,background:"#426b77"}}).png().toBuffer();
   const visible=crypto.randomUUID(),secret=crypto.randomUUID(),draft=crypto.randomUUID(),mapId=crypto.randomUUID();
   await writeFile(join(root,"visible.png"),bytes);await writeFile(join(root,"secret.png"),bytes);await writeFile(join(root,"draft.png"),bytes);
   await db.insert(schema.assets).values([{id:visible,campaignId,uploadedByMembershipId:gm.membershipId,kind:"MAP",name:"World background",storageKey:"visible.png",mimeType:"image/png",sizeBytes:bytes.length,width:32,height:24},{id:secret,campaignId,uploadedByMembershipId:gm.membershipId,kind:"MAP",name:"GM world background",storageKey:"secret.png",mimeType:"image/png",sizeBytes:bytes.length,width:32,height:24},{id:draft,campaignId,uploadedByMembershipId:gm.membershipId,kind:"MAP",name:"Draft background",storageKey:"draft.png",mimeType:"image/png",sizeBytes:bytes.length,width:32,height:24}]);
   await db.insert(schema.worldMaps).values([{id:mapId,campaignId,name:"World",scope:"WORLD",visibility:"CAMPAIGN",lifecycle:"PUBLISHED",backgroundAssetId:visible,backgroundAssetApprovedByMembershipId:gm.membershipId,backgroundAssetApprovedAt:new Date(),publishedAt:new Date()},{campaignId,name:"Secret world",visibility:"GM_ONLY",lifecycle:"PUBLISHED",backgroundAssetId:secret,backgroundAssetApprovedByMembershipId:gm.membershipId,backgroundAssetApprovedAt:new Date(),publishedAt:new Date()},{campaignId,name:"Draft world",visibility:"CAMPAIGN",lifecycle:"DRAFT",backgroundAssetId:draft}]);
   const projected=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"SNAPSHOT"}});expect(projected.snapshot.worldMaps!.maps.map(m=>m.id)).toEqual([mapId]);expect(projected.snapshot.assets.map(a=>a.id)).toContain(visible);expect(projected.snapshot.assets.map(a=>a.id)).not.toContain(secret);expect(projected.snapshot.assets.map(a=>a.id)).not.toContain(draft);
   const first=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"ASSET_CHUNK",assetId:visible,offset:0}});expect(Buffer.from(first.assetChunk!.base64,"base64")).toEqual(bytes);
   for(const assetId of [secret,draft])await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"ASSET_CHUNK",assetId,offset:0}})).rejects.toThrow("ASSET_NOT_FOUND");
   await db.execute(sql`UPDATE world_maps SET lifecycle='ARCHIVED',archived_at=now() WHERE id=${mapId}`);
   await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"ASSET_CHUNK",assetId:visible,offset:0,version:first.assetChunk!.version}})).rejects.toThrow("ASSET_NOT_FOUND");
  }finally{env.MEDIA_ROOT=previousRoot;await rm(root,{recursive:true,force:true});}
 });

 it("applies and undoes a server-selected area once, and cancels a delayed intent",async()=>{
  const {binding}=await pair(),caster=crypto.randomUUID(),ally=crypto.randomUUID(),other=crypto.randomUUID(),sceneId=crypto.randomUUID(),entryId=crypto.randomUUID(),definition=crypto.randomUUID(),allyDef=crypto.randomUUID(),tokenId=crypto.randomUUID();
  await db.insert(schema.memberships).values({id:other,campaignId,role:"PLAYER",displayName:"Other"});
  const otherDevice=crypto.randomUUID(),code=await issueLocalPairing(db,gm,{membershipId:other,deviceId:otherDevice}),otherRedeem=await redeemLocalPairing(db,{campaignId,deviceId:otherDevice,token:code.token});const b={...binding,deviceId:otherDevice,credential:otherRedeem.credential};
  await db.insert(schema.scenes).values({id:sceneId,campaignId,name:"Area scene",grid:{enabled:true,size:20,offsetX:0,offsetY:0,color:"#ffffff",opacity:.2,metersPerCell:1}});
  await db.execute(sql`UPDATE campaigns SET active_scene_id=${sceneId},paused=true WHERE id=${campaignId}`);
  await db.insert(schema.characters).values([{id:caster,campaignId,name:"Caster",ownerMembershipId:player,resources:{magicPower:{current:0,maximum:20}}},{id:ally,campaignId,name:"PRIVATE-ALLY",ownerMembershipId:other,resources:{magicPower:{current:0,maximum:20}}}]);
  await db.insert(schema.characterCatalogEntries).values({id:entryId,characterId:caster,kind:"ABILITY",name:"Peer area",data:{areaEffect:{kind:"RESTORE_MANA",radiusMeters:15,origin:"CASTER",targets:"PLAYER_CHARACTERS",dice:"1d6",includeCaster:true},uses:{current:1,max:1,recharge:"DAY"}}});
  await db.insert(schema.tokenDefinitions).values([{id:definition,campaignId,characterId:caster},{id:allyDef,campaignId,characterId:ally}]);await db.insert(schema.tokenControllers).values({tokenDefinitionId:definition,membershipId:player});
  await db.insert(schema.tokens).values([{id:tokenId,definitionId:definition,sceneId,name:"Caster",x:100,y:100,width:10,height:10},{definitionId:allyDef,sceneId,name:"PRIVATE-ALLY",x:150,y:100,width:10,height:10,visible:false,layer:"GM"}]);
  const rect={x:0,y:0,width:512,height:512};await db.insert(schema.fogReveals).values({sceneId,...rect,geometry:{type:"RECT",...rect},bbox:rect});
  const payload={actionId:crypto.randomUUID(),characterId:caster,entryId,entryRevision:0,sceneId,sceneRevision:0,casterTokenId:tokenId,casterTokenRevision:0},command={kind:"AREA_APPLY" as const,payload};
  const paused=await executeLocalPeerRequest(db,{peer:binding,command});expect(paused.commandError).toEqual({status:409,code:"CAMPAIGN_PAUSED",notApplied:true});
  await db.execute(sql`UPDATE campaigns SET paused=false WHERE id=${campaignId}`);
  const rng=vi.spyOn(diceModule,"rollFormula");
  try{
   const applied=await executeLocalPeerRequest(db,{peer:binding,command});expect(applied.areaResult).toMatchObject({duplicate:false,actionId:payload.actionId});expect(rng).toHaveBeenCalledOnce();expect(JSON.stringify(applied.areaResult)).not.toContain(ally);
   expect((await executeLocalPeerRequest(db,{peer:binding,command})).areaResult).toMatchObject({duplicate:true,messageId:(applied.areaResult as any).messageId});expect(rng).toHaveBeenCalledOnce();
   const conflict=await executeLocalPeerRequest(db,{peer:binding,command:{...command,payload:{...payload,entryRevision:1}}});expect(conflict.commandError).toEqual({status:409,code:"ACTION_CONFLICT"});expect(rng).toHaveBeenCalledOnce();
   const cancelledPayload={...payload,actionId:crypto.randomUUID()};expect((await executeLocalPeerRequest(db,{peer:binding,command:{kind:"AREA_CANCEL",payload:cancelledPayload}})).areaResult).toEqual({actionId:cancelledPayload.actionId,cancelled:true,notApplied:true});expect((await executeLocalPeerRequest(db,{peer:binding,command:{kind:"AREA_APPLY",payload:cancelledPayload}})).areaResult).toMatchObject({cancelled:true});expect(rng).toHaveBeenCalledOnce();
   const messageId=(applied.areaResult as any).messageId,undo={kind:"APPLICATION_UNDO" as const,payload:{actionId:crypto.randomUUID(),messageId}};
   const denied=await executeLocalPeerRequest(db,{peer:b,command:undo});expect(denied.commandError).toEqual({status:403,code:"UNDO_FORBIDDEN"});
   const undone=await executeLocalPeerRequest(db,{peer:binding,command:undo});expect(undone.applicationUndo).toEqual({ok:true});expect(undone.snapshot.messages.find(m=>m.id===messageId)?.applicationUndo).toEqual({cancelled:true});
   expect((await executeLocalPeerRequest(db,{peer:binding,command:undo})).applicationUndo).toEqual({duplicate:true});
   const people=await db.select().from(schema.characters).where(sql`campaign_id=${campaignId}`);for(const row of people)expect(row.resources).toMatchObject({magicPower:{current:0}});
   const [entry]=await db.select().from(schema.characterCatalogEntries).where(sql`id=${entryId}`);expect(entry?.data).toMatchObject({uses:{current:1}});
  }finally{rng.mockRestore();}
 });
 it("starts area execution serializably and reauthenticates error projections after rollback",async()=>{
  const {binding}=await pair();await db.execute(sql`UPDATE campaigns SET paused=true WHERE id=${campaignId}`);
  const options:unknown[]=[];let rootCalls=0;
  const observed=new Proxy(db,{get(target,key){if(key==="transaction")return async(callback:any,config:any)=>{options.push(config);rootCalls++;if(rootCalls===2)await revokeLocalPeer(db,gm,{membershipId:player,deviceId:device});return target.transaction(callback,config);};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
  const payload={actionId:crypto.randomUUID(),characterId:crypto.randomUUID(),entryId:crypto.randomUUID(),entryRevision:0,sceneId:crypto.randomUUID(),sceneRevision:0,casterTokenId:crypto.randomUUID(),casterTokenRevision:0};
  await expect(executeLocalPeerRequest(observed,{peer:binding,command:{kind:"AREA_APPLY",payload}})).rejects.toThrow("FORBIDDEN");expect(options[0]).toEqual({isolationLevel:"serializable"});expect(rootCalls).toBe(2);
 });

 it("classifies outer transaction aborts without declaring an old intent not applied",async()=>{
  const {binding}=await pair();let count=0;
  const aborting=new Proxy(db,{get(target,key){if(key==="transaction")return (callback:any,options:any)=>{if(count++===0)return Promise.reject(Object.assign(Error("PRIVATE SQL"),{code:"40001"}));return target.transaction(callback,options);};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
  const payload={actionId:crypto.randomUUID(),characterId:crypto.randomUUID(),entryId:crypto.randomUUID(),entryRevision:0,sceneId:crypto.randomUUID(),sceneRevision:0,casterTokenId:crypto.randomUUID(),casterTokenRevision:0};
  const result=await executeLocalPeerRequest(aborting,{peer:binding,command:{kind:"AREA_APPLY",payload}});expect(result.commandError).toEqual({status:409,code:"AREA_RETRY"});expect(JSON.stringify(result)).not.toContain("PRIVATE SQL");expect(count).toBe(2);
 });

 it("returns safe upload validation errors and leaves no staged row or blob",async()=>{
  const {binding}=await pair(),bytes=Buffer.from("not an image"),{createHash}=await import("node:crypto");
  const previousRoot=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-upload-invalid-"));env.MEDIA_ROOT=root;
  try{
   const command={kind:"CHAT_UPLOAD_CHUNK",uploadId:crypto.randomUUID(),fileName:"spoof.png",total:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),offset:0,base64:bytes.toString("base64")};
   const result=await executeLocalPeerRequest(db,{peer:binding,command});expect(result.commandError).toEqual({status:400,code:"UNSUPPORTED_FILE_TYPE"});expect(result.upload).toBeUndefined();
   const conflict=await executeLocalPeerRequest(db,{peer:binding,command:{...command,total:env.MAX_IMAGE_BYTES+1}});expect(conflict.commandError).toEqual({status:400,code:"IMAGE_TOO_LARGE"});
   expect(await readdir(root)).toEqual([]);expect(await db.select().from(schema.chatAttachmentUploads).where(sql`campaign_id=${campaignId}`)).toHaveLength(0);
  }finally{env.MEDIA_ROOT=previousRoot;await rm(root,{recursive:true,force:true});}
 });
 it.each(["INSERT","SNAPSHOT"] as const)("removes a new unreferenced blob after a real %s transaction rollback",async phase=>{
  const {binding}=await pair(),previousRoot=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-upload-rollback-"));env.MEDIA_ROOT=root;
  const bytes=await sharp({create:{width:32,height:24,channels:4,background:"#884455"}}).png().toBuffer(),{createHash}=await import("node:crypto");
  const command={kind:"CHAT_UPLOAD_CHUNK",uploadId:crypto.randomUUID(),fileName:"rollback.png",total:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),offset:0,base64:bytes.toString("base64")};
  let spy:ReturnType<typeof vi.spyOn>|undefined;
  try{
   if(phase==="INSERT"){
    await db.execute(sql`CREATE FUNCTION qa_reject_chat_stage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic stage insert rejected'; END $$`);
    await db.execute(sql`CREATE TRIGGER qa_reject_chat_stage BEFORE INSERT ON chat_attachment_uploads FOR EACH ROW EXECUTE FUNCTION qa_reject_chat_stage()`);
   }else spy=vi.spyOn(snapshotModule,"buildSnapshot").mockRejectedValueOnce(Error("synthetic snapshot rejected"));
   await expect(executeLocalPeerRequest(db,{peer:binding,command})).rejects.toThrow();
   expect(await readdir(join(root,"chat-files"))).toEqual([]);expect(await readdir(join(root,"chat-upload-leases"))).toEqual([]);
   expect(await db.select().from(schema.chatAttachmentUploads).where(sql`campaign_id=${campaignId}`)).toHaveLength(0);
   const receipts=await db.execute(sql`SELECT content_id FROM local_chat_upload_receipts WHERE campaign_id=${campaignId}`);expect(receipts).toHaveLength(0);
  }finally{spy?.mockRestore();if(phase==="INSERT"){await db.execute(sql`DROP TRIGGER IF EXISTS qa_reject_chat_stage ON chat_attachment_uploads`);await db.execute(sql`DROP FUNCTION IF EXISTS qa_reject_chat_stage()`);}env.MEDIA_ROOT=previousRoot;await rm(root,{recursive:true,force:true});}
 });
 it.each(["PEER","HTTP"] as const)("retains a committed %s blob when the COMMIT acknowledgement is lost",async transport=>{
  const {binding}=await pair(),previousRoot=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-upload-uncertain-"));env.MEDIA_ROOT=root;
  const bytes=await sharp({create:{width:32,height:24,channels:4,background:"#335588"}}).png().toBuffer(),{createHash}=await import("node:crypto");
  const command={kind:"CHAT_UPLOAD_CHUNK",uploadId:crypto.randomUUID(),fileName:"committed.png",total:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),offset:0,base64:bytes.toString("base64")};let rootCalls=0;
  const uncertain=new Proxy(db,{get(target,key){if(key==="transaction")return async(callback:any,options:any)=>{const call=++rootCalls,result=await target.transaction(callback,options);if(call===1)throw Object.assign(Error("synthetic lost commit acknowledgement"),{code:"EPIPE"});return result;};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
  try{
   const request=transport==="PEER"?executeLocalPeerRequest(uncertain,{peer:binding,command}):stageChatAttachment(uncertain,{...gm,membershipId:player,role:"PLAYER"},bytes,"committed.png");
   await expect(request).rejects.toThrow("synthetic lost commit acknowledgement");
   const [upload]=await db.select().from(schema.chatAttachmentUploads).where(sql`campaign_id=${campaignId}`);expect(upload).toBeDefined();expect(await readdir(join(root,"chat-files"))).toHaveLength(1);expect(await readdir(join(root,"chat-upload-leases"))).toEqual([]);expect((await readFile(join(root,upload!.storageKey))).length).toBeGreaterThan(0);
   if(transport==="PEER"){const repeated=await executeLocalPeerRequest(db,{peer:binding,command});expect(repeated.upload?.attachment?.contentId).toBe(upload!.contentId);expect(await readdir(join(root,"chat-files"))).toHaveLength(1);expect(await readdir(join(root,"chat-upload-leases"))).toEqual([]);}
  }finally{env.MEDIA_ROOT=previousRoot;await rm(root,{recursive:true,force:true});}
 });
 it("preserves a file when database reconciliation is unavailable",async()=>{
  const previousRoot=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-upload-pending-"));env.MEDIA_ROOT=root;const warning=vi.spyOn(process,"emitWarning").mockImplementation(()=>{});
  const unavailable=new Proxy(db,{get(target,key){if(key==="transaction")return ()=>Promise.reject(Error("PRIVATE database unavailable"));const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
  try{await writeFile(join(root,"pending.webp"),"retain me");expect(await reconcileChatUploadFile(unavailable,campaignId,"pending.webp")).toBe("PENDING");expect(await readFile(join(root,"pending.webp"),"utf8")).toBe("retain me");for(const call of warning.mock.calls)expect(JSON.stringify(call)).not.toContain("PRIVATE");}
  finally{warning.mockRestore();env.MEDIA_ROOT=previousRoot;await rm(root,{recursive:true,force:true});}
 });

 it("recovers an orphan journal after restart and retries when the database returns",async()=>{
  const previousRoot=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-recovery-orphan-"));env.MEDIA_ROOT=root;
  const warning=vi.spyOn(process,"emitWarning").mockImplementation(()=>{});
  const unavailable=new Proxy(db,{get(target,key){if(key==="transaction")return ()=>Promise.reject(Error("PRIVATE offline database"));const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
  let recovery:ChatUploadRecovery|undefined;
  try{
   const lease=await createChatUploadLease(root,campaignId),key=chatLeaseStorageKey(lease.id);
   await writeChatUploadLease(root,lease,Buffer.from("partial image bytes before crash"));
   recovery=new ChatUploadRecovery({root,graceMs:0,reconcile:(campaign,key)=>reconcileChatUploadFile(unavailable,campaign,key)});
   expect((await recovery.runOnce()).pending).toBe(1);expect((await readFile(join(root,key))).length).toBeGreaterThan(0);expect(await readdir(join(root,"chat-upload-leases"))).toHaveLength(1);
   await recovery.stop();
   recovery=new ChatUploadRecovery({root,graceMs:0,reconcile:(campaign,key)=>reconcileChatUploadFile(db,campaign,key)});
   expect((await recovery.runOnce()).removed).toBe(1);expect(await readdir(join(root,"chat-files"))).toEqual([]);expect(await readdir(join(root,"chat-upload-leases"))).toEqual([]);
   for(const call of warning.mock.calls)expect(JSON.stringify(call)).not.toContain("PRIVATE");
  }finally{await recovery?.stop();warning.mockRestore();env.MEDIA_ROOT=previousRoot;await rm(root,{recursive:true,force:true});}
 });
 it("keeps committed bytes and retires a leftover journal after restart",async()=>{
  const previousRoot=env.MEDIA_ROOT,root=await mkdtemp(join(tmpdir(),"arken-recovery-committed-"));env.MEDIA_ROOT=root;let recovery:ChatUploadRecovery|undefined;
  try{
   const lease=await createChatUploadLease(root,campaignId),key=chatLeaseStorageKey(lease.id),bytes=Buffer.from("committed bytes");
   await writeChatUploadLease(root,lease,bytes);
   await db.insert(schema.chatAttachmentUploads).values({campaignId,uploadedByMembershipId:player,fileName:"kept.webp",storageKey:key,mimeType:"image/webp",sizeBytes:bytes.length,width:1,height:1,expiresAt:new Date(Date.now()+3600000)});
   recovery=new ChatUploadRecovery({root,graceMs:0,reconcile:(campaign,key)=>reconcileChatUploadFile(db,campaign,key)});
   expect((await recovery.runOnce()).referenced).toBe(1);expect(await readFile(join(root,key))).toEqual(bytes);expect(await readdir(join(root,"chat-upload-leases"))).toEqual([]);
   expect(await db.select().from(schema.chatAttachmentUploads).where(sql`storage_key=${key}`)).toHaveLength(1);
  }finally{await recovery?.stop();env.MEDIA_ROOT=previousRoot;await rm(root,{recursive:true,force:true});}
 });

 it("reauthenticates character rejection projections after device revocation",async()=>{
  const {binding}=await pair();let calls=0;
  const observed=new Proxy(db,{get(target,key){if(key==="transaction")return async(callback:any,config:any)=>{calls++;if(calls===2)await revokeLocalPeer(db,gm,{membershipId:player,deviceId:device});return target.transaction(callback,config);};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
  await expect(executeLocalPeerRequest(observed,{peer:binding,command:{kind:"CHARACTER_COUNTERS",characterId:crypto.randomUUID(),payload:{actionId:crypto.randomUUID(),revision:0,rest:"SHORT"}}})).rejects.toThrow("FORBIDDEN");expect(calls).toBe(2);
 });

});

it("story media gateway enforces current revision, archive, campaign and peer revocation",async()=>{
 const {binding}=await pair(),thread=await ensureStreamThread(db,campaignId,"STORY"),postId=crypto.randomUUID(),contentId=crypto.randomUUID();
 const root=await mkdtemp(join(tmpdir(),"arken-story-chunk-")),previousRoot=env.MEDIA_ROOT,previousBridge=env.LOCAL_SESSION_BRIDGE_ENABLED;env.MEDIA_ROOT=root;
 try{
  const bytes=Buffer.from("synthetic story image");await writeFile(join(root,"story.png"),bytes);
  await db.insert(schema.chatAttachmentUploads).values({contentId,campaignId,uploadedByMembershipId:gm.membershipId,fileName:"story.png",storageKey:"story.png",mimeType:"image/png",sizeBytes:bytes.length,width:1,height:1,expiresAt:new Date(Date.now()+60000)});
  await db.insert(schema.storyPosts).values({id:postId,campaignId,threadId:thread.id,authorMembershipId:gm.membershipId,title:"Synthetic",body:"Public",gmNotes:"private editorial note",lifecycle:"PUBLISHED",visibility:"PUBLIC",revision:1,publishedAt:new Date()});
  for(const revision of [1,2])await db.insert(schema.storyPostRevisions).values({campaignId,postId,revision,lifecycle:"PUBLISHED",title:"Synthetic",body:"Public",gmNotes:"private",changedByMembershipId:gm.membershipId});
  await db.insert(schema.storyPostMedia).values({campaignId,postId,revision:1,contentId,sortOrder:0,altText:"Synthetic image"});
  const auth={...gm,membershipId:player,role:"PLAYER" as const};
  expect(await resolveReadableStoryMedia(db,{...auth,campaignId:crypto.randomUUID()},contentId)).toBeNull();
  const chunk=await executeLocalPeerRequest(db,{peer:binding,command:{kind:"STORY_MEDIA_CHUNK",contentId,offset:0}});
  expect(Buffer.from(chunk.assetChunk!.base64,"base64")).toEqual(bytes);expect(JSON.stringify(chunk)).not.toContain("private editorial note");
  expect(chunk.mediaRevision).toMatch(/^[a-f0-9]{64}$/);
  const firstFingerprint=chunk.storyFingerprint;expect(firstFingerprint).toMatch(/^[a-f0-9]{64}$/);expect(await readPlayerStoryFingerprint(db,auth)).toBe(firstFingerprint);
  env.LOCAL_SESSION_BRIDGE_ENABLED=true;const app=Fastify();registerLocalSessionRoutes(app,db,async()=>undefined);
  try{const response=await app.inject({method:"POST",url:"/api/local-session/media",headers:{origin:env.WEB_ORIGIN},payload:{peer:binding,command:{kind:"STORY_MEDIA_CHUNK",contentId,offset:0}}});expect(response.statusCode,response.body).toBe(200);}finally{await app.close();}
  await db.execute(sql`UPDATE story_posts SET revision=2,lifecycle='CORRECTED' WHERE id=${postId}`);
  expect(await resolveReadableStoryMedia(db,auth,contentId)).toBeNull();expect(await resolveReadableStoryMedia(db,gm,contentId)).not.toBeNull();
  const correctedFingerprint=await readPlayerStoryFingerprint(db,auth);expect(correctedFingerprint).not.toBe(firstFingerprint);
  await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"STORY_MEDIA_CHUNK",contentId,offset:0}})).rejects.toThrow("STORY_MEDIA_NOT_FOUND");
  await db.insert(schema.storyPostMedia).values({campaignId,postId,revision:2,contentId,sortOrder:0,altText:"Corrected image"});
  expect(await resolveReadableStoryMedia(db,auth,contentId)).not.toBeNull();
  await db.execute(sql`UPDATE story_posts SET lifecycle='ARCHIVED',visibility='GM_ONLY',archived_at=now() WHERE id=${postId}`);
  expect(await resolveReadableStoryMedia(db,auth,contentId)).toBeNull();
  expect(await readPlayerStoryFingerprint(db,auth)).not.toBe(correctedFingerprint);
  await db.execute(sql`UPDATE story_posts SET lifecycle='CORRECTED',visibility='PUBLIC',archived_at=NULL WHERE id=${postId}`);
  await revokeLocalPeer(db,gm,{membershipId:player,deviceId:device});
  await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:"STORY_MEDIA_CHUNK",contentId,offset:0}})).rejects.toThrow("FORBIDDEN");
 }finally{env.MEDIA_ROOT=previousRoot;env.LOCAL_SESSION_BRIDGE_ENABLED=previousBridge;await rm(root,{recursive:true,force:true});}
},60000);

it("story fingerprint follows independently renamed linked targets",async()=>{
 const thread=await ensureStreamThread(db,campaignId,"STORY"),characterId=crypto.randomUUID(),postId=crypto.randomUUID();
 await db.insert(schema.scenes).values({id:characterId,campaignId,name:"Before",grid:{enabled:false,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2}});
 await db.execute(sql`UPDATE campaigns SET active_scene_id=${characterId} WHERE id=${campaignId}`);
 await db.insert(schema.storyPosts).values({id:postId,campaignId,threadId:thread.id,authorMembershipId:gm.membershipId,title:"Story",body:"Public",entityLinks:[{kind:"SCENE",entityId:characterId}],lifecycle:"PUBLISHED",visibility:"PUBLIC",revision:1,publishedAt:new Date()});
 const auth={...gm,membershipId:player,role:"PLAYER" as const},before=await readPlayerStoryFingerprint(db,auth);
 await db.execute(sql`UPDATE scenes SET name='After' WHERE id=${characterId}`);
 const after=await readPlayerStoryFingerprint(db,auth);expect(after).not.toBe(before);expect(await readPlayerStoryFingerprint(db,auth)).toBe(after);
 await db.execute(sql`UPDATE campaigns SET active_scene_id=NULL WHERE id=${campaignId}`);
 expect(await readPlayerStoryFingerprint(db,auth)).not.toBe(after);
});

it("stages local authority events atomically, fences epochs and preserves pending envelopes",async()=>{
 const insert=async(target:Database,actionId=crypto.randomUUID())=>target.insert(schema.gameEvents).values({campaignId,actionId,membershipId:gm.membershipId,type:"SYNTHETIC_OUTBOX",entityType:"campaign",entityId:campaignId,payload:{serverOnly:"synthetic-private"}});
 const pending=async()=>db.select().from(schema.localEventOutbox).where(eq(schema.localEventOutbox.campaignId,campaignId));
 await insert(db);expect(await pending()).toHaveLength(0); // No durable local authority yet.
 const {authority}=await pair();const actionId=crypto.randomUUID();await insert(db,actionId);
 expect((await getLocalAuthorityStatus(db,gm)).outbox).toEqual({pendingEvents:1,limited:false,delivery:"NOT_CONFIGURED"});
 await expect(getLocalAuthorityStatus(db,{...gm,membershipId:player,role:"PLAYER"})).rejects.toThrow("FORBIDDEN");
 let rows=await pending();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({campaignId,actionId,originHostId:authority.hostId,authoritySessionId:authority.sessionId,authorityEpoch:authority.epoch,event:{action_id:actionId,payload:{serverOnly:"synthetic-private"}}});
 await expect(db.transaction(async tx=>{await insert(tx as unknown as Database);throw Error("SYNTHETIC_ROLLBACK");})).rejects.toThrow("SYNTHETIC_ROLLBACK");expect(await pending()).toHaveLength(1);
 await expect(insert(db,actionId)).rejects.toThrow();expect(await pending()).toHaveLength(1);
 await stopLocalAuthority(db,gm,authority.epoch);await insert(db);expect(await pending()).toHaveLength(2);
 const next=await startLocalAuthority(db,gm,authority.epoch);await insert(db);rows=await pending();expect(rows).toHaveLength(3);expect(rows.map(row=>row.authorityEpoch).sort()).toEqual([authority.epoch,authority.epoch,next.epoch]);
 expect(await withLocalOwnerOutboxAuthority(db,gm,authority,async scope=>scope)).toEqual(authority);
 expect(await withLocalOwnerOutboxAuthority(db,gm,next,async scope=>scope)).toEqual(next);
 await expect(withLocalOwnerOutboxAuthority(db,gm,{...authority,sessionId:crypto.randomUUID()},async()=>true)).rejects.toThrow("FORBIDDEN");
 await expect(withLocalOwnerOutboxAuthority(db,gm,{...authority,hostId:crypto.randomUUID()},async()=>true)).rejects.toThrow("FORBIDDEN");
 await expect(withLocalOwnerOutboxAuthority(db,{...gm,membershipId:player,role:"PLAYER"},authority,async()=>true)).rejects.toThrow("FORBIDDEN");
 const batch=await prepareLocalEventBatch(db,gm,{limit:64});expect(batch.events).toHaveLength(2);expect(batch.hasMore).toBe(true);expect(batch.delivery).toBe("NOT_CONFIGURED");
 const nextBatch=await prepareLocalEventBatch(db,gm,{after:batch.lastSequence,limit:64});expect(nextBatch.events).toHaveLength(1);expect(nextBatch.hasMore).toBe(false);expect(nextBatch.events[0]!.origin.epoch).toBe(next.epoch);
 const repeated=await prepareLocalEventBatch(db,gm,{limit:64});expect(repeated).toEqual(batch);expect(await pending()).toHaveLength(3);
 await db.execute(sql`UPDATE local_event_outbox SET event=event||jsonb_build_object('action_id',${crypto.randomUUID()}::text) WHERE campaign_id=${campaignId}`);
 await expect(prepareLocalEventBatch(db,gm,{limit:64})).rejects.toThrow("INTEGRITY_INVALID");
 await db.execute(sql`UPDATE local_event_outbox o SET event=to_jsonb(e) FROM game_events e WHERE o.event_sequence=e.sequence AND o.campaign_id=${campaignId}`);

 await expect(prepareLocalEventBatch(db,{...gm,membershipId:player,role:"PLAYER"},{limit:64})).rejects.toThrow("FORBIDDEN");
 await db.execute(sql`DELETE FROM campaigns WHERE id=${campaignId}`);expect(await pending()).toHaveLength(3);
});

it("stores cloud inbox, checkpoint and stable retry receipt atomically without applying game state",async()=>{
 const oldMode=env.DEPLOYMENT_MODE;env.DEPLOYMENT_MODE="HOSTED";
 try{
  const accountUserId=crypto.randomUUID();await db.insert(schema.users).values({id:accountUserId,identityKind:"HOSTED",hostedLogin:"sync-"+accountUserId.replaceAll("-",""),hostedApprovedAt:new Date(),passwordHash:"synthetic-not-login"});
  await db.execute(sql`UPDATE memberships SET user_id=${accountUserId} WHERE id=${gm.membershipId}`);
  const origin={hostId:crypto.randomUUID(),campaignId,sessionId:crypto.randomUUID(),epoch:1};
  const registration=await registerCloudSyncSource(db,gm,accountUserId,{hostId:origin.hostId,sessionId:origin.sessionId,epoch:1,baselineSequence:"0"});
  expect(registration.mode).toBe("INBOX_ONLY");
  await expect(registerCloudSyncSource(db,gm,crypto.randomUUID(),{hostId:origin.hostId,sessionId:origin.sessionId,epoch:1,baselineSequence:"0"})).rejects.toThrow("FORBIDDEN");
  await expect(registerCloudSyncSource(db,gm,accountUserId,{hostId:origin.hostId,sessionId:origin.sessionId,epoch:1,baselineSequence:"1"})).rejects.toThrow("BASELINE_CONFLICT");
  const action=crypto.randomUUID();
  const make=(sequence:string,after:string|null,actionId=crypto.randomUUID())=>({version:1,hostId:origin.hostId,campaignId,events:[createLocalEventEnvelope(origin,{sequence,campaign_id:campaignId,action_id:actionId,membership_id:gm.membershipId,type:"SYNTHETIC",entity_type:"campaign",entity_id:null,entity_revision:null,payload:{private:"synthetic"},created_at:new Date(0).toISOString()})],after,lastSequence:sequence,hasMore:false,delivery:"NOT_CONFIGURED"});
  const first=make("1",null,action),receipt=await storeCloudSyncBatch(db,gm,accountUserId,registration.originId,first);
  expect(receipt.status).toBe("STORED_ONLY");expect(await storeCloudSyncBatch(db,gm,accountUserId,registration.originId,first)).toEqual(receipt);
  await expect(storeCloudSyncBatch(db,gm,accountUserId,registration.originId,make("2","1",action))).rejects.toThrow();
  let rows=await db.select().from(schema.cloudSyncReceipts).where(eq(schema.cloudSyncReceipts.originId,registration.originId));expect(rows).toHaveLength(1);
  const [checkpoint]=await db.select().from(schema.cloudSyncOrigins).where(eq(schema.cloudSyncOrigins.id,registration.originId));expect(checkpoint!.receivedSequence).toBe(1n);
  expect(await storeCloudSyncBatch(db,gm,accountUserId,registration.originId,make("2","1"))).toMatchObject({status:"STORED_ONLY",lastSequence:"2"});
  expect(await storeCloudSyncBatch(db,gm,accountUserId,registration.originId,first)).toEqual(receipt); // Lost ACK, even after a later accepted batch.
  const game=await db.execute(sql`SELECT 1 FROM game_events WHERE campaign_id=${campaignId}`);expect(game).toHaveLength(0);
  expect(await db.select().from(schema.cloudSyncInbox).where(eq(schema.cloudSyncInbox.originId,registration.originId))).toHaveLength(2);
  await expect(storeCloudSyncBatch(db,{...gm,membershipId:player,role:"PLAYER"},accountUserId,registration.originId,first)).rejects.toThrow("FORBIDDEN");
  await db.insert(schema.gameEvents).values({campaignId,actionId:crypto.randomUUID(),membershipId:gm.membershipId,type:"SYNTHETIC_CLOUD_WRITE",entityType:"campaign"});
  await expect(storeCloudSyncBatch(db,gm,accountUserId,registration.originId,make("3","2"))).rejects.toThrow("BASELINE_CONFLICT");
  rows=await db.select().from(schema.cloudSyncReceipts).where(eq(schema.cloudSyncReceipts.originId,registration.originId));expect(rows).toHaveLength(2);
  await db.execute(sql`UPDATE memberships SET access_revoked_at=now() WHERE id=${gm.membershipId}`);
  await expect(storeCloudSyncBatch(db,gm,accountUserId,registration.originId,first)).rejects.toThrow("FORBIDDEN");
 }finally{env.DEPLOYMENT_MODE=oldMode;}
});

it("exposes owner connection summaries without secrets and fences player access before the store",async()=>{
 const {authority}=await pair(),oldTarget=env.LOCAL_CLOUD_SYNC_ORIGIN,oldBridge=env.LOCAL_SESSION_BRIDGE_ENABLED;env.LOCAL_CLOUD_SYNC_ORIGIN="https://cloud.example.invalid";env.LOCAL_SESSION_BRIDGE_ENABLED=true;
 const expiresAt=new Date(Date.now()+3600000).toISOString(),secret="t".repeat(43),saved={grantId:crypto.randomUUID(),originId:crypto.randomUUID(),origin:authority,token:secret,expiresAt,scope:"STAGING_ONLY" as const};
 const store={load:vi.fn(async()=>saved),save:vi.fn(async()=>({configured:true,expiresAt})),forget:vi.fn(async()=>({configured:false}))};
 const app=Fastify(),authSpy=vi.spyOn(authModule,"requireAuth").mockResolvedValue(gm as any);registerLocalSessionRoutes(app,db,async()=>{},()=>{},createLocalCloudConnection(store,()=>true));
 try{
  const call=(action:string,payload:Record<string,unknown>={})=>app.inject({method:"POST",url:"/api/local-session/cloud/"+action,headers:{origin:env.WEB_ORIGIN},payload});
  const status=await call("status");expect(status.statusCode,status.body).toBe(200);expect(status.json()).toEqual({state:"READY",target:"https://cloud.example.invalid",expiresAt,storedThrough:null});expect(status.body).not.toContain(secret);
  expect((await call("send",{receipt:{},url:"https://other.invalid"})).statusCode).toBe(400);
  const save=await call("save",{grant:saved});expect(save.statusCode).toBe(200);expect(store.save).toHaveBeenCalledWith(authority,saved);expect(save.body).not.toContain(secret);
  authSpy.mockResolvedValue({...gm,membershipId:player,role:"PLAYER"} as any);const reads=store.load.mock.calls.length;expect((await call("status")).statusCode).toBe(403);expect(store.load.mock.calls.length).toBe(reads);
  authSpy.mockResolvedValue(gm as any);store.save.mockRejectedValueOnce(Error("PRIVATE-KEY-IN-ERROR"));const failed=await call("save",{grant:saved});expect(failed.statusCode).toBe(500);expect(failed.body).not.toContain("PRIVATE");
  expect((await call("forget")).json().state).toBe("DISCONNECTED");
 }finally{authSpy.mockRestore();env.LOCAL_CLOUD_SYNC_ORIGIN=oldTarget;env.LOCAL_SESSION_BRIDGE_ENABLED=oldBridge;await app.close();}
});

it("freezes exact outbound bytes across appended events, lost ACK, rollback and historical epochs",async()=>{
 const oldTarget=env.LOCAL_CLOUD_SYNC_ORIGIN;env.LOCAL_CLOUD_SYNC_ORIGIN="https://cloud.example.invalid";
 try{
  const {authority}=await pair(),remote=crypto.randomUUID();
  const insert=async()=>{const actionId=crypto.randomUUID();await db.insert(schema.gameEvents).values({campaignId,actionId,membershipId:gm.membershipId,type:"SYNTHETIC_FROZEN",entityType:"campaign",payload:{private:"synthetic"}});return actionId;};
  const firstAction=await insert(),first=await freezeLocalCloudBatch(db,gm,authority,remote);expect(first.batch!.events).toHaveLength(1);expect(first.batch!.events[0]!.event.action_id).toBe(firstAction);
  await insert();const retry=await freezeLocalCloudBatch(db,gm,authority,remote);expect(retry).toEqual(first); // New data must not change the batch after an unknown network outcome.
  await db.execute(sql`UPDATE local_cloud_streams SET frozen_batch=jsonb_set(frozen_batch,'{events,0,event,payload}','{"tampered":true}'::jsonb) WHERE id=${first.streamId}`);
  await expect(freezeLocalCloudBatch(db,gm,authority,remote)).rejects.toThrow("HASH_MISMATCH");
  await db.execute(sql`UPDATE local_cloud_streams SET frozen_batch=${JSON.stringify(first.batch)}::jsonb WHERE id=${first.streamId}`);
  const receipt={originId:remote,batchHash:first.batchHash!,receiptId:crypto.randomUUID(),lastSequence:first.batch!.lastSequence,status:"STORED_ONLY" as const};
  await expect(confirmLocalCloudStoredBatch(db,gm,first.streamId,{...receipt,batchHash:"0".repeat(64)})).rejects.toThrow("CONFLICT");expect(await freezeLocalCloudBatch(db,gm,authority,remote)).toEqual(first);
  expect(await confirmLocalCloudStoredBatch(db,gm,first.streamId,receipt)).toMatchObject({status:"STORED_ONLY"});expect(await confirmLocalCloudStoredBatch(db,gm,first.streamId,receipt)).toMatchObject({lastSequence:receipt.lastSequence});
  const second=await freezeLocalCloudBatch(db,gm,authority,remote);expect(second.batch!.events).toHaveLength(1);expect(second.batch!.after).toBe(receipt.lastSequence);expect(second.batchHash).not.toBe(first.batchHash);
  const secondReceipt={...receipt,batchHash:second.batchHash!,lastSequence:second.batch!.lastSequence};
  await expect(confirmLocalCloudStoredBatch(db,gm,second.streamId,secondReceipt)).rejects.toThrow(); // Duplicate receipt ID: the entire local acknowledgement rolls back.
  expect(await freezeLocalCloudBatch(db,gm,authority,remote)).toEqual(second);
  const [before]=await db.select().from(schema.localCloudStreams).where(eq(schema.localCloudStreams.id,first.streamId));expect(before!.storedSequence).toBe(BigInt(receipt.lastSequence));
  secondReceipt.receiptId=crypto.randomUUID();await confirmLocalCloudStoredBatch(db,gm,second.streamId,secondReceipt);
  await confirmLocalCloudStoredBatch(db,gm,first.streamId,receipt); // Late old completion does not rewind the newer cursor.
  const [after]=await db.select().from(schema.localCloudStreams).where(eq(schema.localCloudStreams.id,first.streamId));expect(after!.storedSequence).toBe(BigInt(secondReceipt.lastSequence));
  expect((await freezeLocalCloudBatch(db,gm,authority,remote)).batch).toBeNull();
  const pending=await db.select().from(schema.localEventOutbox).where(eq(schema.localEventOutbox.campaignId,campaignId));expect(pending).toHaveLength(2); // STORED_ONLY never dequeues game events.
  await expect(db.execute(sql`UPDATE local_cloud_streams SET frozen_hash=${"0".repeat(64)} WHERE id=${first.streamId}`)).rejects.toThrow();
  await expect(db.execute(sql`UPDATE local_cloud_streams SET frozen_hash=${"0".repeat(64)},frozen_batch=jsonb_build_object('oversized',repeat('x',2097152)) WHERE id=${first.streamId}`)).rejects.toThrow();

  await stopLocalAuthority(db,gm,authority.epoch);const next=await startLocalAuthority(db,gm,authority.epoch);await insert();
  expect((await freezeLocalCloudBatch(db,gm,authority,remote)).batch).toBeNull();
  const newer=await freezeLocalCloudBatch(db,gm,next,crypto.randomUUID());expect(newer.batch!.events).toHaveLength(1);expect(newer.batch!.events[0]!.origin.epoch).toBe(next.epoch);
  await expect(freezeLocalCloudBatch(db,gm,next,remote)).rejects.toThrow("SCOPE_MISMATCH");
  await expect(freezeLocalCloudBatch(db,{...gm,membershipId:player,role:"PLAYER"},authority,remote)).rejects.toThrow("FORBIDDEN");
 }finally{env.LOCAL_CLOUD_SYNC_ORIGIN=oldTarget;}
});

it("manual owner send freezes before network, retries lost delivery and retains the local outbox",async()=>{
 const {authority}=await pair(),previous=env.LOCAL_CLOUD_SYNC_ORIGIN;env.LOCAL_CLOUD_SYNC_ORIGIN="https://cloud.example.invalid";
 try{
  const grant={grantId:crypto.randomUUID(),originId:crypto.randomUUID(),origin:authority,token:"t".repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString(),scope:"STAGING_ONLY" as const};
  const store={load:vi.fn(async()=>grant),save:vi.fn(),forget:vi.fn()};let fail=true;let storedAfter:string|null=null;const hashes:string[]=[];
  const deliver=vi.fn(async(input:Parameters<typeof import("./local-cloud-sync-client.js").deliverPreparedCloudBatch>[0])=>{
   const batch=verifyLocalEventBatch(input.batch,authority,storedAfter),hash=localEventBatchHash(batch);hashes.push(hash);
   const [persisted]=await db.select().from(schema.localCloudStreams).where(eq(schema.localCloudStreams.cloudOriginId,grant.originId));expect(persisted!.frozenHash).toBe(hash);
   if(fail)throw Error("SYNTHETIC_NETWORK_FAILURE");
   storedAfter=batch.lastSequence;return {originId:grant.originId,batchHash:hash,receiptId:crypto.randomUUID(),lastSequence:batch.lastSequence,status:"STORED_ONLY" as const};
  });
  const connection=createLocalCloudConnection(store,()=>true,deliver);
  expect(await connection.send(db,gm)).toEqual({state:"EMPTY",sentEvents:0,storedThrough:null});expect(deliver).not.toHaveBeenCalled();
  const insert=()=>db.insert(schema.gameEvents).values({campaignId,actionId:crypto.randomUUID(),membershipId:gm.membershipId,type:"SYNTHETIC",entityType:"campaign"});await insert();
  await expect(connection.send(db,{...gm,membershipId:player,role:"PLAYER"})).rejects.toThrow("FORBIDDEN");expect(store.load).not.toHaveBeenCalled();
  await expect(connection.send(db,gm)).rejects.toThrow("SYNTHETIC_NETWORK_FAILURE");await insert();fail=false;
  expect(await connection.send(db,gm)).toMatchObject({state:"STORED_ONLY",sentEvents:1});expect(hashes[0]).toBe(hashes[1]);
  expect(await connection.status(db,gm)).toMatchObject({state:"READY",storedThrough:expect.any(String)});
  expect(await connection.send(db,gm)).toMatchObject({state:"STORED_ONLY",sentEvents:1});const calls=deliver.mock.calls.length;
  expect(await connection.send(db,gm)).toMatchObject({state:"EMPTY",sentEvents:0});expect(deliver).toHaveBeenCalledTimes(calls);
  expect(await db.select().from(schema.localEventOutbox).where(eq(schema.localEventOutbox.campaignId,campaignId))).toHaveLength(2);
 }finally{env.LOCAL_CLOUD_SYNC_ORIGIN=previous;}
});

it("rechecks owner access after delivery before confirming storage",async()=>{
 const {authority}=await pair(),old=env.LOCAL_CLOUD_SYNC_ORIGIN;env.LOCAL_CLOUD_SYNC_ORIGIN="https://cloud.example.invalid";
 try{
  await db.insert(schema.gameEvents).values({campaignId,actionId:crypto.randomUUID(),membershipId:gm.membershipId,type:"SYNTHETIC",entityType:"campaign"});
  const grant={grantId:crypto.randomUUID(),originId:crypto.randomUUID(),origin:authority,token:"t".repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString(),scope:"STAGING_ONLY" as const};
  const connection=createLocalCloudConnection({load:vi.fn(async()=>grant),save:vi.fn(),forget:vi.fn()},()=>true,async input=>{
   const batch=verifyLocalEventBatch(input.batch,authority,null);
   await db.execute(sql`UPDATE memberships SET access_revoked_at=now() WHERE id=${gm.membershipId}`);
   return {originId:grant.originId,batchHash:localEventBatchHash(batch),receiptId:crypto.randomUUID(),lastSequence:batch.lastSequence,status:"STORED_ONLY"};
  });
  await expect(connection.send(db,gm)).rejects.toThrow("FORBIDDEN");
  const [stream]=await db.select().from(schema.localCloudStreams).where(eq(schema.localCloudStreams.cloudOriginId,grant.originId));expect(stream!.storedSequence).toBeNull();expect(stream!.frozenHash).not.toBeNull();
  expect(await db.select().from(schema.localCloudStoredBatches).where(eq(schema.localCloudStoredBatches.streamId,stream!.id))).toHaveLength(0);
 }finally{env.LOCAL_CLOUD_SYNC_ORIGIN=old;}
});

it("selects durable historical cloud scopes after stop without accepting forged scopes or mixing grants",async()=>{
 const {authority:first}=await pair(),target=env.LOCAL_CLOUD_SYNC_ORIGIN,bridge=env.LOCAL_SESSION_BRIDGE_ENABLED;env.LOCAL_CLOUD_SYNC_ORIGIN="https://cloud.example.invalid";env.LOCAL_SESSION_BRIDGE_ENABLED=true;
 const insert=()=>db.insert(schema.gameEvents).values({campaignId,actionId:crypto.randomUUID(),membershipId:gm.membershipId,type:"SYNTHETIC",entityType:"campaign"});await insert();await stopLocalAuthority(db,gm,first.epoch);const second=await startLocalAuthority(db,gm,first.epoch);await insert();await stopLocalAuthority(db,gm,second.epoch);
 const grants=new Map<string,any>(),store={load:vi.fn(async(scope:any)=>grants.get(scope.sessionId)??null),save:vi.fn(async(scope:any,grant:any)=>{if(Object.keys(scope).some(key=>scope[key]!==grant.origin[key]))throw Error("LOCAL_GRANT_SCOPE_MISMATCH");grants.set(scope.sessionId,grant);return {configured:true,expiresAt:grant.expiresAt};}),forget:vi.fn(async(scope:any)=>{grants.delete(scope.sessionId);return {configured:false};})};
 const deliver=vi.fn(async(input:Parameters<typeof import("./local-cloud-sync-client.js").deliverPreparedCloudBatch>[0])=>{const batch=verifyLocalEventBatch(input.batch,input.origin,null);return {originId:input.originId,batchHash:localEventBatchHash(batch),receiptId:crypto.randomUUID(),lastSequence:batch.lastSequence,status:"STORED_ONLY" as const};});
 const app=Fastify(),authSpy=vi.spyOn(authModule,"requireAuth").mockResolvedValue(gm as any);registerLocalSessionRoutes(app,db,async()=>{},()=>{},createLocalCloudConnection(store,()=>true,deliver));
 try{
  const call=(action:string,body:Record<string,unknown>={})=>app.inject({method:"POST",url:"/api/local-session/cloud/"+action,headers:{origin:env.WEB_ORIGIN},payload:body});
  const listed=await call("scopes");expect(listed.statusCode,listed.body).toBe(200);expect(listed.json().scopes.map((row:any)=>row.authority.epoch)).toEqual([second.epoch,first.epoch]);expect(listed.json().scopes[0].pendingEvents).toBe(1);expect(listed.json().next).toBeNull();expect(listed.body).not.toContain("SYNTHETIC");
  const older=await call("scopes",{after:{epoch:second.epoch,sessionId:second.sessionId}});expect(older.json().scopes).toHaveLength(1);expect(older.json().scopes[0].authority).toEqual(first);
  const make=(scope:any)=>({grantId:crypto.randomUUID(),originId:crypto.randomUUID(),origin:scope,token:"t".repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString(),scope:"STAGING_ONLY"});
  const a=make(first),b=make(second);expect((await call("save",{scope:first,grant:a})).statusCode).toBe(200);expect((await call("save",{scope:second,grant:b})).statusCode).toBe(200);expect((await call("save",{scope:first,grant:b})).statusCode).toBe(400);
  const forged={...first,sessionId:crypto.randomUUID()},reads=store.load.mock.calls.length;expect((await call("status",{scope:forged})).statusCode).toBe(403);expect((await call("status",{scope:{...first,campaignId:crypto.randomUUID()}})).statusCode).toBe(403);expect((await call("status",{scope:{...first,hostId:crypto.randomUUID()}})).statusCode).toBe(403);expect(store.load.mock.calls.length).toBe(reads);
  expect((await call("send",{scope:first})).json()).toMatchObject({state:"STORED_ONLY",sentEvents:1});expect((await call("send",{scope:first})).json()).toMatchObject({state:"EMPTY"});expect(deliver).toHaveBeenCalledTimes(1);expect(deliver.mock.calls[0]![0].originId).toBe(a.originId);
  expect((await call("forget",{scope:first})).statusCode).toBe(200);expect((await call("status",{scope:first})).json().state).toBe("DISCONNECTED");expect((await call("status",{scope:second})).json().state).toBe("READY");
  authSpy.mockResolvedValue({...gm,membershipId:player,role:"PLAYER"} as any);expect((await call("scopes")).statusCode).toBe(403);expect((await call("send",{scope:second})).statusCode).toBe(403);
 }finally{authSpy.mockRestore();await app.close();env.LOCAL_CLOUD_SYNC_ORIGIN=target;env.LOCAL_SESSION_BRIDGE_ENABLED=bridge;}
});

it("pages retained cloud session scopes without dropping the oldest entry",async()=>{
 let {authority}=await pair();const expected:string[]=[];
 for(let index=0;index<23;index++){
  expected.unshift(authority.sessionId);await db.insert(schema.gameEvents).values({campaignId,actionId:crypto.randomUUID(),membershipId:gm.membershipId,type:"SYNTHETIC",entityType:"campaign"});await stopLocalAuthority(db,gm,authority.epoch);if(index<22)authority=await startLocalAuthority(db,gm,authority.epoch);
 }
 const connection=createLocalCloudConnection(),first=await connection.scopes(db,gm);expect(first.scopes).toHaveLength(20);expect(first.next).not.toBeNull();const second=await connection.scopes(db,gm,first.next);expect(second.scopes).toHaveLength(3);expect(second.next).toBeNull();expect([...first.scopes,...second.scopes].map(row=>row.authority.sessionId)).toEqual(expected);
});

it('projects soundpad and canvas history through the same authenticated peer authority',async()=>{
 const {binding}=await pair();
 const soundpad=await executeLocalPeerRequest(db,{peer:binding,command:{kind:'SOUNDPAD_READ'}});
 expect(soundpad.soundpad).toEqual({packs:[],playerPlaybackEnabled:true});
 const scene=crypto.randomUUID();await db.insert(schema.scenes).values({id:scene,campaignId,name:'Peer active',grid:{enabled:false,size:64,offsetX:0,offsetY:0,color:'#777777',opacity:.2}});await db.update(schema.campaigns).set({activeSceneId:scene}).where(eq(schema.campaigns.id,campaignId));
 expect((await executeLocalPeerRequest(db,{peer:binding,command:{kind:'CANVAS_HISTORY',sceneId:scene}})).canvasHistory).toEqual([]);
 const hidden=crypto.randomUUID();await db.insert(schema.scenes).values({id:hidden,campaignId,name:'GM hidden',grid:{enabled:false,size:64,offsetX:0,offsetY:0,color:'#777777',opacity:.2}});
 await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:'CANVAS_HISTORY',sceneId:hidden}})).rejects.toThrow('SCENE_NOT_FOUND');
 await revokeLocalPeer(db,gm,{membershipId:player,deviceId:device});
 await expect(executeLocalPeerRequest(db,{peer:binding,command:{kind:'SOUNDPAD_READ'}})).rejects.toThrow('FORBIDDEN');
});

it("audits exact post-import coverage, rejects legacy gaps and detects tampering",async()=>{
 expect(await inspectLocalOutboxCoverage(db,gm)).toMatchObject({status:"NOT_IMPORTED"});
 const [host]=await db.select().from(schema.localHostInstances);
 await db.execute(sql`INSERT INTO local_campaign_imports(id,instance_id,owner_user_id,campaign_id,manifest_sha256) VALUES(${crypto.randomUUID()},${config.LOCAL_INSTANCE_ID},${host!.ownerUserId},${campaignId},${"a".repeat(64)})`);
 expect(await inspectLocalOutboxCoverage(db,gm)).toMatchObject({status:"BASELINE_UNKNOWN"});
 const baseline="9007199254747001";
 await db.execute(sql`UPDATE local_campaign_imports SET source_baseline_sequence=${baseline}::bigint WHERE campaign_id=${campaignId}`);
 expect(await inspectLocalOutboxCoverage(db,gm)).toMatchObject({status:"COVERED",checkedEvents:0,baselineSequence:baseline,throughSequence:baseline});
 await startLocalAuthority(db,gm,0);
 const sequence="9007199254747017",action=crypto.randomUUID();
 await db.execute(sql`INSERT INTO game_events(sequence,campaign_id,action_id,membership_id,type,entity_type) VALUES(${sequence}::bigint,${campaignId},${action},${gm.membershipId},'SYNTHETIC_COVERAGE','campaign')`);
 expect(await inspectLocalOutboxCoverage(db,gm)).toMatchObject({status:"COVERED",checkedEvents:1,throughSequence:sequence});
 await db.execute(sql`UPDATE local_event_outbox SET event=event||'{"type":"TAMPERED"}'::jsonb WHERE campaign_id=${campaignId}`);
 expect(await inspectLocalOutboxCoverage(db,gm)).toMatchObject({status:"INTEGRITY_CONFLICT",firstProblemSequence:sequence});
 await db.execute(sql`DELETE FROM local_event_outbox WHERE campaign_id=${campaignId}`);
 expect(await inspectLocalOutboxCoverage(db,gm)).toMatchObject({status:"MISSING_EVENTS",firstProblemSequence:sequence});
 await expect(inspectLocalOutboxCoverage(db,{...gm,membershipId:player,role:"PLAYER"})).rejects.toThrow("FORBIDDEN");
});

it("pages coverage without float cursors and flags oversized events",async()=>{
 const [host]=await db.select().from(schema.localHostInstances);const baseline="9007199254750000";
 await db.execute(sql`INSERT INTO local_campaign_imports(id,instance_id,owner_user_id,campaign_id,manifest_sha256,source_baseline_sequence) VALUES(${crypto.randomUUID()},${config.LOCAL_INSTANCE_ID},${host!.ownerUserId},${campaignId},${"b".repeat(64)},${baseline}::bigint)`);
 const a=await startLocalAuthority(db,gm,0);await stopLocalAuthority(db,gm,a.epoch);
 await db.execute(sql`INSERT INTO game_events(sequence,campaign_id,action_id,membership_id,type,entity_type) SELECT ${baseline}::bigint+n*2,${campaignId}::uuid,gen_random_uuid(),${gm.membershipId}::uuid,'SYNTHETIC_PAGE','campaign' FROM generate_series(1,130) n`);
 expect(await inspectLocalOutboxCoverage(db,gm)).toMatchObject({status:"COVERED",checkedEvents:130,throughSequence:"9007199254750260"});
 await db.execute(sql`INSERT INTO game_events(sequence,campaign_id,action_id,membership_id,type,entity_type,payload) VALUES(9007199254750261,${campaignId},${crypto.randomUUID()},${gm.membershipId},'SYNTHETIC_LARGE','campaign',jsonb_build_object('text',repeat('x',262144)))`);
 expect(await inspectLocalOutboxCoverage(db,gm)).toMatchObject({status:"EVENT_TOO_LARGE",firstProblemSequence:"9007199254750261",checkedEvents:131});
});
it("serves owner-only coverage with origin, strict body and no-store guards",async()=>{
 const previous=env.LOCAL_SESSION_BRIDGE_ENABLED;env.LOCAL_SESSION_BRIDGE_ENABLED=true;
 const app=Fastify(),spy=vi.spyOn(authModule,"requireAuth").mockResolvedValue(gm as any);registerLocalSessionRoutes(app,db,async()=>{});
 try{
  const call=(payload:object={},origin=env.WEB_ORIGIN)=>app.inject({method:"POST",url:"/api/local-session/cloud/preflight",headers:{origin},payload});
  const response=await call();expect(response.statusCode,response.body).toBe(200);expect(response.json()).toEqual({status:"NOT_IMPORTED",checkedEvents:0});expect(response.headers['cache-control']).toBe('no-store');
  expect((await call({after:"123"})).statusCode).toBe(400);
  expect((await call({},"https://foreign.invalid")).statusCode).toBe(403);
  spy.mockResolvedValue({...gm,membershipId:player,role:"PLAYER"} as any);expect((await call()).statusCode).toBe(403);
 }finally{spy.mockRestore();env.LOCAL_SESSION_BRIDGE_ENABLED=previous;await app.close();}
});

it("commits exact applied proofs and ordered cursors without deleting retained events",async()=>{
 const previous=env.LOCAL_CLOUD_SYNC_ORIGIN;env.LOCAL_CLOUD_SYNC_ORIGIN="https://cloud.example.invalid";
 try{
  const authority=await startLocalAuthority(db,gm,0),remote=crypto.randomUUID();
  const insert=async(sequence:string)=>db.execute(sql`INSERT INTO game_events(sequence,campaign_id,action_id,membership_id,type,entity_type) VALUES(${sequence}::bigint,${campaignId},${crypto.randomUUID()},${gm.membershipId},'SYNTHETIC_PROOF','campaign')`);
  const stored=async()=>{const f=await freezeLocalCloudBatch(db,gm,authority,remote),receiptId=crypto.randomUUID();await confirmLocalCloudStoredBatch(db,gm,f.streamId,{status:'STORED_ONLY',originId:remote,receiptId,batchHash:f.batchHash,lastSequence:f.batch!.lastSequence});return {f,receiptId};};
  await insert('9007199254770001');const first=await stored();await insert('9007199254770003');const second=await stored();
  const proof=(item:typeof first,cloudSequence:string)=>({status:'APPLIED',originId:remote,receiptId:item.receiptId,batchHash:item.f.batchHash,lastSequence:item.f.batch!.lastSequence,writerRevision:'9007199254740993',mappings:item.f.batch!.events.map(e=>({sourceSequence:e.event.sequence,cloudSequence,actionId:e.event.action_id}))});
  const one=proof(first,'9007199254780001'),two=proof(second,'9007199254780003');
  await db.execute(sql`UPDATE local_cloud_stored_batches SET batch_metadata=NULL WHERE stream_id=${first.f.streamId} AND receipt_id=${first.receiptId}`);
  const prepared=await prepareLocalApplicationCheck(db,gm,authority,remote);expect(prepared.check?.receiptId).toBe(first.receiptId);expect(prepared.check?.batch).toEqual(first.f.batch);
  await expect(confirmLocalAppliedBatch(db,gm,first.f.streamId,two)).rejects.toThrow('ORDER_CONFLICT');
  await expect(confirmLocalAppliedBatch(db,gm,first.f.streamId,{...one,mappings:[{...one.mappings[0],actionId:crypto.randomUUID()}]})).rejects.toThrow('MAPPING_CONFLICT');
  expect((await db.select().from(schema.localCloudStreams).where(eq(schema.localCloudStreams.id,first.f.streamId)))[0]!.appliedSequence).toBeNull();
  expect(await confirmLocalAppliedBatch(db,gm,first.f.streamId,one)).toEqual({state:'APPLIED',appliedEvents:1,appliedThrough:'9007199254770001'});
  expect(await confirmLocalAppliedBatch(db,gm,first.f.streamId,one)).toMatchObject({state:'APPLIED'});
  expect((await prepareLocalApplicationCheck(db,gm,authority,remote)).check?.receiptId).toBe(second.receiptId);
  await confirmLocalAppliedBatch(db,gm,second.f.streamId,two);expect(await prepareLocalApplicationCheck(db,gm,authority,remote)).toEqual({check:null,appliedThrough:'9007199254770003'});
  expect((await db.select().from(schema.localEventOutbox).where(eq(schema.localEventOutbox.campaignId,campaignId)))).toHaveLength(2);
  const rows=await db.select().from(schema.localCloudStoredBatches).where(eq(schema.localCloudStoredBatches.streamId,first.f.streamId));expect(rows.every(row=>row.appliedReceipt&&row.batchMetadata)).toBe(true);
  const expired=createLocalCloudConnection({load:vi.fn(async()=>{throw Error('SYNTHETIC_EXPIRED');}),save:vi.fn(),forget:vi.fn()},()=>true);
  const offline=await expired.status(db,gm,authority);expect(offline.state).toBe('RECONNECT_REQUIRED');expect(offline.history?.entries[0]).toMatchObject({originId:remote,target:'https://cloud.example.invalid',appliedThrough:'9007199254770003'});expect('appliedThrough' in offline).toBe(false);
  expect((await expired.history(db,gm,authority)).entries).toEqual(offline.history!.entries);
  env.LOCAL_CLOUD_SYNC_ORIGIN='https://replacement.example.invalid';const replacement=createLocalCloudConnection({load:vi.fn(async()=>({grantId:crypto.randomUUID(),originId:crypto.randomUUID(),origin:authority,token:'t'.repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString(),scope:'STAGING_ONLY' as const})),save:vi.fn(),forget:vi.fn()},()=>true);
  const changed=await replacement.status(db,gm,authority);expect(changed.state).toBe('READY');expect('appliedThrough' in changed).toBe(false);expect(changed.history!.entries[0]!.target).toBe('https://cloud.example.invalid');
  env.LOCAL_CLOUD_SYNC_ORIGIN='https://cloud.example.invalid';

  await expect(confirmLocalAppliedBatch(db,{...gm,membershipId:player,role:'PLAYER'},first.f.streamId,one)).rejects.toThrow('FORBIDDEN');
 }finally{env.LOCAL_CLOUD_SYNC_ORIGIN=previous;}
});
it("owner check action persists only server-fetched proof and rejects pasted receipts",async()=>{
 const previous=env.LOCAL_CLOUD_SYNC_ORIGIN,bridge=env.LOCAL_SESSION_BRIDGE_ENABLED;env.LOCAL_CLOUD_SYNC_ORIGIN='https://cloud.example.invalid';env.LOCAL_SESSION_BRIDGE_ENABLED=true;
 const app=Fastify(),spy=vi.spyOn(authModule,'requireAuth').mockResolvedValue(gm as any);
 try{
  const a=await startLocalAuthority(db,gm,0);await db.insert(schema.gameEvents).values({campaignId,actionId:crypto.randomUUID(),membershipId:gm.membershipId,type:'SYNTHETIC_CHECK',entityType:'campaign'});const remote=crypto.randomUUID(),f=await freezeLocalCloudBatch(db,gm,a,remote),receiptId=crypto.randomUUID();await confirmLocalCloudStoredBatch(db,gm,f.streamId,{status:'STORED_ONLY',originId:remote,receiptId,batchHash:f.batchHash,lastSequence:f.batch!.lastSequence});
  const grant={grantId:crypto.randomUUID(),originId:remote,origin:a,token:'t'.repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString(),scope:'STAGING_ONLY' as const},query=vi.fn(async()=>({status:'APPLIED' as const,originId:remote,receiptId,batchHash:f.batchHash!,lastSequence:f.batch!.lastSequence!,writerRevision:'1',mappings:f.batch!.events.map(e=>({sourceSequence:e.event.sequence,cloudSequence:'9007199254790001',actionId:e.event.action_id}))})),store={load:vi.fn(async()=>grant),save:vi.fn(),forget:vi.fn()};
  registerLocalSessionRoutes(app,db,async()=>{},()=>{},createLocalCloudConnection(store,()=>true,undefined,query));
  const call=(extra={})=>app.inject({method:'POST',url:'/api/local-session/cloud/check',headers:{origin:env.WEB_ORIGIN},payload:{scope:a,...extra}});
  expect((await call({receipt:{status:'APPLIED'}})).statusCode).toBe(400);expect(query).not.toHaveBeenCalled();
  const reply=await call();expect(reply.statusCode,reply.body).toBe(200);expect(reply.json()).toMatchObject({state:'APPLIED',appliedEvents:1});expect(reply.body).not.toContain(grant.token);expect(query).toHaveBeenCalledOnce();
  expect((await call()).json().state).toBe('EMPTY');expect(query).toHaveBeenCalledOnce();
  store.load.mockResolvedValue({...grant,scope:'READ_RECEIPTS_ONLY'} as any);
  const readonlyStatus=await app.inject({method:'POST',url:'/api/local-session/cloud/status',headers:{origin:env.WEB_ORIGIN},payload:{scope:a}});expect(readonlyStatus.json().canSend).toBe(false);
  const sendDenied=await app.inject({method:'POST',url:'/api/local-session/cloud/send',headers:{origin:env.WEB_ORIGIN},payload:{scope:a}});expect(sendDenied.statusCode,sendDenied.body).toBe(403);

  spy.mockResolvedValue({...gm,membershipId:player,role:'PLAYER'} as any);expect((await call()).statusCode).toBe(403);
 }finally{spy.mockRestore();await app.close();env.LOCAL_CLOUD_SYNC_ORIGIN=previous;env.LOCAL_SESSION_BRIDGE_ENABLED=bridge;}
});

it("recovers legacy hasMore=true only by matching the original full batch hash",async()=>{
 const previous=env.LOCAL_CLOUD_SYNC_ORIGIN;env.LOCAL_CLOUD_SYNC_ORIGIN='https://cloud.example.invalid';try{
  const a=await startLocalAuthority(db,gm,0),remote=crypto.randomUUID();await db.insert(schema.gameEvents).values(Array.from({length:33},()=>({campaignId,actionId:crypto.randomUUID(),membershipId:gm.membershipId,type:'SYNTHETIC_LEGACY',entityType:'campaign'})));
  const f=await freezeLocalCloudBatch(db,gm,a,remote);expect(f.batch!.events).toHaveLength(32);expect(f.batch!.hasMore).toBe(true);const receiptId=crypto.randomUUID();await confirmLocalCloudStoredBatch(db,gm,f.streamId,{status:'STORED_ONLY',originId:remote,receiptId,batchHash:f.batchHash,lastSequence:f.batch!.lastSequence});
  await db.execute(sql`UPDATE local_cloud_stored_batches SET batch_metadata=NULL WHERE stream_id=${f.streamId}`);expect((await prepareLocalApplicationCheck(db,gm,a,remote)).check?.batch).toEqual(f.batch);
  await db.execute(sql`UPDATE local_event_outbox SET event=event||'{"type":"TAMPERED"}'::jsonb WHERE campaign_id=${campaignId} AND event_sequence=${f.batch!.events[0]!.event.sequence}::bigint`);await expect(prepareLocalApplicationCheck(db,gm,a,remote)).rejects.toThrow('INTEGRITY_INVALID');
  expect((await db.select().from(schema.localCloudStreams).where(eq(schema.localCloudStreams.id,f.streamId)))[0]!.appliedSequence).toBeNull();
 }finally{env.LOCAL_CLOUD_SYNC_ORIGIN=previous;}
});

it("paginates saved proof metadata without OS keys or cross-scope disclosure",async()=>{
 const a=await startLocalAuthority(db,gm,0),store={load:vi.fn(async()=>{throw Error('NO_KEY');}),save:vi.fn(),forget:vi.fn()},connection=createLocalCloudConnection(store,()=>false),action=crypto.randomUUID();
 for(let i=0;i<21;i++){
  const streamId=crypto.randomUUID(),remote=crypto.randomUUID(),receiptId=crypto.randomUUID(),hash='a'.repeat(64),proof={status:'APPLIED',originId:remote,receiptId,batchHash:hash,lastSequence:'9007199254740993',writerRevision:'1',mappings:[{sourceSequence:'9007199254740993',cloudSequence:'1',actionId:action}]};
  await db.execute(sql`INSERT INTO local_cloud_streams(id,target_origin,cloud_origin_id,origin_host_id,campaign_id,session_id,epoch,stored_sequence,applied_sequence) VALUES(${streamId},'https://history.example.invalid',${remote},${a.hostId},${campaignId},${a.sessionId},${a.epoch},9007199254740993,9007199254740993)`);
  await db.execute(sql`INSERT INTO local_cloud_stored_batches(stream_id,batch_hash,receipt_id,last_sequence,applied_receipt) VALUES(${streamId},${hash},${receiptId},9007199254740993,${JSON.stringify(proof)}::jsonb)`);
 }
 const first=await connection.history(db,gm,a);expect(first.entries).toHaveLength(20);expect(first.next).toBe(first.entries.at(-1)!.streamId);const last=await connection.history(db,gm,a,first.next!);expect(last.entries).toHaveLength(1);expect(last.next).toBeNull();expect(first.entries.some(e=>e.streamId===last.entries[0]!.streamId)).toBe(false);expect(store.load).not.toHaveBeenCalled();
 await expect(connection.history(db,gm,{...a,sessionId:crypto.randomUUID()})).rejects.toThrow('FORBIDDEN');await expect(connection.history(db,{...gm,membershipId:player,role:'PLAYER'},a)).rejects.toThrow('FORBIDDEN');
 const id=first.entries[0]!.streamId;await db.execute(sql`UPDATE local_cloud_stored_batches SET applied_receipt=applied_receipt||jsonb_build_object('batchHash',${'b'.repeat(64)}::text) WHERE stream_id=${id}`);await expect(connection.history(db,gm,a)).rejects.toThrow('INTEGRITY_INVALID');
});

it("keeps real HTTP scene activation idempotent through pause while rejecting new paused writes",async()=>{
 const {registerSceneRoutes}=await import('./scene-routes.js'),{campaignCanvasDatabase}=await import('./campaign-pause-guard.js');const app=Fastify(),spy=vi.spyOn(authModule,'requireAuth').mockResolvedValue(gm as any),broadcast=vi.fn(async()=>{}),scene=crypto.randomUUID(),actionId=crypto.randomUUID();
 await db.insert(schema.scenes).values({id:scene,campaignId,name:'HTTP scene',grid:{enabled:true,size:64,offsetX:0,offsetY:0,color:'#777777',opacity:.2}});registerSceneRoutes(app,db,{} as any,{canvasTx:id=>campaignCanvasDatabase(db,id),broadcast});
 try{const call=(id=actionId)=>app.inject({method:'POST',url:'/api/scenes/activate',payload:{actionId:id,sceneId:scene}});const first=await call();expect(first.statusCode,first.body).toBe(200);expect(broadcast).toHaveBeenCalledOnce();await db.update(schema.campaigns).set({paused:true}).where(eq(schema.campaigns.id,campaignId));expect((await call()).json()).toEqual({ok:true,duplicate:true});expect((await call(crypto.randomUUID())).statusCode).toBe(409);expect(broadcast).toHaveBeenCalledOnce();spy.mockResolvedValue({...gm,membershipId:player,role:'PLAYER'} as any);expect((await call()).statusCode).toBe(403);}finally{spy.mockRestore();await app.close();}
});

it("keeps canonical membership UUIDs and duplicate semantics in the shared name command",async()=>{
 const {commitMembershipName}=await import('./session-state-command.js'),actionId=crypto.randomUUID();const first=await db.transaction(tx=>commitMembershipName(tx,gm,gm.membershipId.toUpperCase(),{actionId,revision:0,name:' Canonical name '}));expect(first.duplicate).not.toBe(true);if(first.duplicate)return;expect(first.event.entityId).toBe(gm.membershipId);expect(first.event.payload).toEqual({membershipId:gm.membershipId,displayName:'Canonical name'});const duplicate=await db.transaction(tx=>commitMembershipName(tx,gm,gm.membershipId.toUpperCase(),{actionId,revision:0,name:'Ignored retry'}));expect(duplicate).toEqual({duplicate:true});expect(await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.campaignId,campaignId))).toHaveLength(1);
});

it("rechecks actor permission under the shared command fence rather than trusting stale GM auth",async()=>{
 const {commitMembershipName,commitSceneActivation}=await import('./session-state-command.js'),scene=crypto.randomUUID();await db.insert(schema.scenes).values({id:scene,campaignId,name:'Permission fence',grid:{enabled:true,size:64,offsetX:0,offsetY:0,color:'#777777',opacity:.2}});await db.update(schema.memberships).set({role:'PLAYER'}).where(eq(schema.memberships.id,gm.membershipId));
 await expect(db.transaction(tx=>commitMembershipName(tx,gm,player,{actionId:crypto.randomUUID(),revision:0,name:'Escalation'}))).rejects.toThrow('MEMBERSHIP_FORBIDDEN');await expect(db.transaction(tx=>commitSceneActivation(tx,gm,{actionId:crypto.randomUUID(),sceneId:scene}))).rejects.toThrow('GM_REQUIRED');expect(await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.campaignId,campaignId))).toHaveLength(0);
});

it("updates metadata through real HTTP with normalized intent, CAS and paused retry",async()=>{
 const {registerSceneRoutes}=await import('./scene-routes.js'),{campaignCanvasDatabase}=await import('./campaign-pause-guard.js');const app=Fastify(),spy=vi.spyOn(authModule,'requireAuth').mockResolvedValue(gm as any),broadcast=vi.fn(async()=>{}),scene=crypto.randomUUID(),actionId=crypto.randomUUID();
 await db.insert(schema.scenes).values({id:scene,campaignId,name:'HTTP metadata',grid:{enabled:true,size:64,offsetX:0,offsetY:0,color:'#777777',opacity:.2}});registerSceneRoutes(app,db,{} as any,{canvasTx:id=>campaignCanvasDatabase(db,id),broadcast});
 try{const call=(payload:any)=>app.inject({method:'PATCH',url:'/api/scenes/'+scene,payload});const first=await call({actionId,revision:0,name:' New metadata ',mapAssetId:null});expect(first.statusCode,first.body).toBe(200);expect(first.json()).toMatchObject({name:'New metadata',revision:1});const [event]=await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.actionId,actionId));expect(event).toMatchObject({entityRevision:1,payload:{sceneId:scene,name:'New metadata',mapAssetId:null}});expect((await call({actionId:crypto.randomUUID(),revision:0,name:'Conflict'})).statusCode).toBe(409);await db.update(schema.campaigns).set({paused:true}).where(eq(schema.campaigns.id,campaignId));expect((await call({actionId,revision:0,name:'Retry'})).statusCode).toBe(200);expect((await call({actionId:crypto.randomUUID(),revision:1,name:'Paused'})).statusCode).toBe(409);expect(broadcast).toHaveBeenCalledOnce();spy.mockResolvedValue({...gm,membershipId:player,role:'PLAYER'} as any);expect((await call({actionId:crypto.randomUUID(),revision:1,name:'Forbidden'})).statusCode).toBe(403);}finally{spy.mockRestore();await app.close();}
});

it("creates scenes through real HTTP during pause with idempotence and GM permissions",async()=>{
 const {registerSceneRoutes}=await import('./scene-routes.js'),{campaignCanvasDatabase}=await import('./campaign-pause-guard.js');const app=Fastify(),spy=vi.spyOn(authModule,'requireAuth').mockResolvedValue(gm as any),broadcast=vi.fn(async()=>{}),actionId=crypto.randomUUID();registerSceneRoutes(app,db,{} as any,{canvasTx:id=>campaignCanvasDatabase(db,id),broadcast});
 try{await db.update(schema.campaigns).set({paused:true}).where(eq(schema.campaigns.id,campaignId));const call=(payload:any)=>app.inject({method:'POST',url:'/api/scenes',payload});const first=await call({actionId,name:' Prepared scene '});expect(first.statusCode,first.body).toBe(201);expect(first.json()).toMatchObject({name:'Prepared scene',revision:0,width:1920,height:1080});const retry=await call({actionId,name:'Ignored retry'});expect(retry.statusCode,retry.body).toBe(200);expect(retry.json().id).toBe(first.json().id);expect(broadcast).toHaveBeenCalledOnce();const [event]=await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.actionId,actionId));expect(event!.entityRevision).toBe(0);expect(event!.payload).toMatchObject({sceneId:first.json().id,command:{name:'Prepared scene',mapAssetId:null,titleLabel:null},backgroundFrame:{x:0,y:0,width:1920,height:1080}});spy.mockResolvedValue({...gm,membershipId:player,role:'PLAYER'} as any);expect((await call({actionId:crypto.randomUUID(),name:'Denied'})).statusCode).toBe(403);}finally{spy.mockRestore();await app.close();}
});
