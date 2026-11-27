import {initializeLocalOwner,inspectLocalHost} from "./local-host-identity.js";
import {encryptCampaignTransferArchive,stageCampaignTransferArchive} from './campaign-transfer-archive.js';
import {seedTransferPopulatedCampaign} from "./test-support/transfer-populated-campaign-fixture.js";
import {projectChatMessages} from "./chat-history.js";
import {assertCampaignTransferTargetSchema} from "./campaign-transfer-target-schema.js";
import {qualifyCampaignTransferSqlRows} from "./campaign-transfer-sql-qualification.js";
import {assembleCampaignTransferStructuralCandidate} from "./campaign-transfer-candidate.js";
import {captureCampaignTransferDataDraft} from "./campaign-transfer-data-draft.js";

import {captureCampaignTransferTable} from "./campaign-transfer-capture.js";
import type {CampaignTransferTable} from "./campaign-transfer-policy.js";
import {verifyCampaignTransferStructure} from "./campaign-transfer-structure.js";
import {createCampaignTransferManifest} from "./campaign-transfer-manifest.js";
import {campaignTransferCatalog} from "./campaign-transfer-policy.js";
import {verifyCampaignTransferRowShape} from "./campaign-transfer-rows.js";
import {seedTransferMediaMarkers} from "./test-support/transfer-media-marker-fixture.js";
import {transferMediaEventTypes} from "./campaign-transfer-media-events.js";
import {seedTransferControl} from "./test-support/transfer-control-fixture.js";
import {seedTransferMagicAwards} from "./test-support/transfer-magic-award-fixture.js";
import {transferMagicAwardEventTypes} from "./campaign-transfer-magic-award-events.js";
import {seedTransferWorldMap} from "./test-support/transfer-world-map-fixture.js";
import {transferWorldMapEventTypes} from "./campaign-transfer-world-map-events.js";
import {seedTransferNarrative} from "./test-support/transfer-narrative-fixture.js";
import {seedTransferEconomy} from "./test-support/transfer-economy-fixture.js";
import {cancelCreationAction} from "./creation-state.js";
import {updateCharacterCounters} from "./character-counters-command.js";
import {archiveCharacter,restoreCharacter} from "./character-archive-service.js";
import {transferCanvasEventTypes} from "./campaign-transfer-canvas-events.js";
import {executeCharacterEntry} from "./entry-roll-command.js";
import {undoApplication} from "./undo-application.js";
import {purchaseEconomy} from "./economy-purchase.js";
import {seedTransferWorkshop} from "./test-support/transfer-workshop-fixture.js";
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,relative,isAbsolute} from "node:path";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {createCampaignTransferMediaStage} from "./campaign-transfer-media.js";
import {afterAll,beforeAll,beforeEach,expect,it,vi} from "vitest";
import {resolve} from "node:path";
import {drizzle} from "drizzle-orm/pglite";
import {readMigrationFiles} from "drizzle-orm/migrator";
import {sql} from "drizzle-orm";
import * as schema from "@arken/db";
import {createMigratedPglite} from "../../../tests/helpers/pglite-template.js";
import {withCampaignTransferSnapshot,type CampaignTransferSource} from "./campaign-transfer-source.js";
import {env} from "./env.js";
type Database=ReturnType<typeof schema.createDatabase>["db"];
let pg:Awaited<ReturnType<typeof createMigratedPglite>>,db:Database,userId:string,auth:{campaignId:string;membershipId:string;role:"GM";displayName:string};
const migrations=readMigrationFiles({migrationsFolder:resolve("packages/db/drizzle")}),hashes=migrations.map(entry=>entry.hash);
const previous=env.DEPLOYMENT_MODE;
function adapt(value:any):Database{return new Proxy(value,{get(target,key){if(key==="execute")return async(...args:any[])=>{const result=await target.execute(...args);return Array.isArray(result)?result:result.rows;};if(key==="transaction")return(callback:any,options:any)=>target.transaction((tx:any)=>callback(adapt(tx)),options);const found=Reflect.get(target,key);return typeof found==="function"?found.bind(target):found;}}) as Database;}
beforeAll(async()=>{
 pg=await createMigratedPglite();db=adapt(drizzle(pg,{schema}));
 // The common PGlite helper applies SQL files without a Drizzle ledger. Mirror
 // their installed hashes explicitly; native migrator evidence is separate.
 await pg.exec("CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)");
 for(const entry of migrations)await db.execute(sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(${entry.hash},${entry.folderMillis})`);
},60000);
afterAll(async()=>{env.DEPLOYMENT_MODE=previous;await pg?.close();});
beforeEach(async()=>{env.DEPLOYMENT_MODE="HOSTED";userId=crypto.randomUUID();auth={campaignId:crypto.randomUUID(),membershipId:crypto.randomUUID(),role:"GM",displayName:"Synthetic GM"};await db.insert(schema.users).values({id:userId,identityKind:"HOSTED",hostedLogin:"t75-"+userId.replaceAll("-",""),hostedApprovedAt:new Date(),passwordHash:"synthetic"});await db.insert(schema.campaigns).values({id:auth.campaignId,name:"Synthetic owned campaign"});await db.insert(schema.memberships).values({id:auth.membershipId,campaignId:auth.campaignId,userId,role:"GM",displayName:auth.displayName});});
it("captures paged tenant rows and exact bigint baseline inside the authorized snapshot",async()=>{
 const other=crypto.randomUUID();await db.insert(schema.campaigns).values({id:other,name:"PRIVATE OTHER CAMPAIGN"});await db.insert(schema.scenes).values([{campaignId:auth.campaignId,name:"First"},{campaignId:auth.campaignId,name:"Second"},{campaignId:other,name:"PRIVATE OTHER SCENE"}].map(row=>({...row,grid:{enabled:true,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2}})));
 await db.execute(sql`INSERT INTO game_events(sequence,campaign_id,action_id,membership_id,type,entity_type,payload) VALUES(9007199254740993,${auth.campaignId},${crypto.randomUUID()},${auth.membershipId},'SYNTHETIC','campaign','{}'::jsonb)`);
 let escaped!:CampaignTransferSource;
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
  escaped=source;expect(source.baselineSequence).toBe("9007199254740993");expect(source.migrations).toEqual(hashes);expect(source.createdAt).toMatch(/Z$/);
  const root=await source.readOwnedRows("campaigns");for(const raw of root.rows)verifyCampaignTransferRowShape("campaigns",JSON.parse(raw),auth.campaignId);expect(root.rows).toHaveLength(1);expect(JSON.parse(root.rows[0]!).id).toBe(auth.campaignId);
  const first=await source.readOwnedRows("scenes",{limit:1}),second=await source.readOwnedRows("scenes",{offset:first.nextOffset!,limit:1});expect(first.nextOffset).toBe(1);expect(second.nextOffset).toBeNull();
  const rows=[...first.rows,...second.rows].map(row=>JSON.parse(row));for(const row of rows)verifyCampaignTransferRowShape("scenes",row,auth.campaignId);expect(new Set(rows.map(row=>row.name))).toEqual(new Set(["First","Second"]));expect(rows.every(row=>row.campaign_id===auth.campaignId)).toBe(true);expect(JSON.stringify(rows)).not.toContain("PRIVATE OTHER");
  for(const name of ["users","sessions","memberships","chat_messages","game_events","creation_licences","world_content"] as const)await expect(source.readOwnedRows(name)).rejects.toThrow("SPECIAL_POLICY_REQUIRED");
  await expect(source.readOwnedRows("scenes; DROP TABLE users" as any)).rejects.toThrow("TABLE_UNKNOWN");await expect(source.readOwnedRows("scenes",{limit:501})).rejects.toThrow();
 });
 await expect(escaped.readOwnedRows("scenes")).rejects.toThrow("SNAPSHOT_CLOSED");
});
it("denies player, another account, revoked owner and LOCAL identities before capture",async()=>{
 let called=false;const capture=async()=>{called=true;};
 await expect(withCampaignTransferSnapshot(db,{...auth,role:"PLAYER"},userId,hashes,capture)).rejects.toThrow("FORBIDDEN");await expect(withCampaignTransferSnapshot(db,auth,crypto.randomUUID(),hashes,capture)).rejects.toThrow("FORBIDDEN");
 await db.execute(sql`UPDATE memberships SET access_revoked_at=now() WHERE id=${auth.membershipId}`);await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,capture)).rejects.toThrow("FORBIDDEN");env.DEPLOYMENT_MODE="LOCAL_HOST";await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,capture)).rejects.toThrow("FORBIDDEN");expect(called).toBe(false);
});
it("refuses mismatched migrations, unreviewed SQL tables and a closed failed snapshot",async()=>{
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes.slice(1),async()=>true)).rejects.toThrow("MIGRATION_MISMATCH");
 await pg.exec("CREATE TABLE unreviewed_transfer_probe(id integer)");try{await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,async()=>true)).rejects.toThrow("SCHEMA_UNREVIEWED");}finally{await pg.exec("DROP TABLE unreviewed_transfer_probe");}
 let escaped!:CampaignTransferSource;await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{escaped=source;throw Error("SYNTHETIC_CAPTURE_FAILURE");})).rejects.toThrow("SYNTHETIC_CAPTURE_FAILURE");await expect(escaped.readOwnedRows("campaigns")).rejects.toThrow("SNAPSHOT_CLOSED");
});

it("remaps participants without cloud users and exports only the owner's private notes and threads",async()=>{
 const a=crypto.randomUUID(),b=crypto.randomUUID(),character=crypto.randomUUID();await db.insert(schema.memberships).values([{id:a,campaignId:auth.campaignId,role:"PLAYER",displayName:"Synthetic A"},{id:b,campaignId:auth.campaignId,role:"PLAYER",displayName:"Synthetic B"}]);await db.insert(schema.characters).values({id:character,campaignId:auth.campaignId,name:"Synthetic character"});
 await db.insert(schema.characterPrivateNotebooks).values([{campaignId:auth.campaignId,characterId:character,authorMembershipId:auth.membershipId,text:"OWNER_NOTE"},{campaignId:auth.campaignId,characterId:character,authorMembershipId:a,text:"PRIVATE_PLAYER_NOTE"}]);
 const fixedStreams=await db.select({id:schema.chatThreads.id,stream:schema.chatThreads.stream}).from(schema.chatThreads).where(sql`campaign_id=${auth.campaignId}`);const stream=fixedStreams.find(row=>row.stream==="TABLE")!.id,own=crypto.randomUUID(),hidden=crypto.randomUUID(),pair=[auth.membershipId,a].sort(),otherPair=[a,b].sort();await db.insert(schema.chatThreads).values([{id:own,campaignId:auth.campaignId,type:"DIRECT",stream:null,participantAMembershipId:pair[0]!,participantBMembershipId:pair[1]!},{id:hidden,campaignId:auth.campaignId,type:"DIRECT",stream:null,participantAMembershipId:otherPair[0]!,participantBMembershipId:otherPair[1]!}]);
 await db.insert(schema.chatReadCursors).values([{campaignId:auth.campaignId,membershipId:auth.membershipId,threadId:stream},{campaignId:auth.campaignId,membershipId:auth.membershipId,threadId:hidden},{campaignId:auth.campaignId,membershipId:a,threadId:stream}]);
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
  const participants=(await source.readParticipants()).rows.map(row=>JSON.parse(row));expect(participants).toHaveLength(3);expect(participants.every(row=>row.user_id===null)).toBe(true);expect(participants.some(row=>row.id===auth.membershipId&&row.role==="GM")).toBe(true);expect(JSON.stringify(participants)).not.toContain(userId);
  const notes=(await source.readMemberRows("character_private_notebooks")).rows;expect(notes).toHaveLength(1);expect(notes[0]).toContain("OWNER_NOTE");expect(notes.join()).not.toContain("PRIVATE_PLAYER_NOTE");
  const threads=(await source.readMemberRows("chat_threads")).rows.map(row=>JSON.parse(row).id);expect(new Set(threads)).toEqual(new Set([...fixedStreams.map(row=>row.id),own]));
  const cursors=(await source.readMemberRows("chat_read_cursors")).rows.map(row=>JSON.parse(row));expect(cursors).toHaveLength(1);expect(cursors[0]).toMatchObject({thread_id:stream,membership_id:auth.membershipId});
  await expect(source.readMemberRows("chat_messages" as any)).rejects.toThrow("SPECIAL_POLICY_REQUIRED");
 });
});
it("captures all six dependent object groups through campaign parents rather than global IDs",async()=>{
 const other=crypto.randomUUID();await db.insert(schema.campaigns).values({id:other,name:"Foreign campaign"});
 const selected:Array<{campaignId:string;character:string;scene:string;definition:string}>=[];for(const campaignId of [auth.campaignId,other]){
  const character=crypto.randomUUID(),scene=crypto.randomUUID(),definition=crypto.randomUUID();selected.push({campaignId,character,scene,definition});
  await db.insert(schema.characters).values({id:character,campaignId,name:"Synthetic dependent character"});await db.insert(schema.scenes).values({id:scene,campaignId,name:"Synthetic dependent scene",grid:{enabled:true,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2}});await db.insert(schema.tokenDefinitions).values({id:definition,campaignId,name:"Synthetic token"});
  await db.insert(schema.characterControllers).values({characterId:character,membershipId:auth.membershipId});await db.insert(schema.characterCatalogEntries).values({characterId:character,kind:"SKILL",name:"Synthetic skill"});await db.insert(schema.drawings).values({sceneId:scene,authorMembershipId:auth.membershipId,points:[0,0,10,10]});await db.insert(schema.fogReveals).values({sceneId:scene,x:0,y:0,width:10,height:10,geometry:{type:"RECT",x:0,y:0,width:10,height:10},bbox:{x:0,y:0,width:10,height:10}});await db.insert(schema.tokenControllers).values({tokenDefinitionId:definition,membershipId:auth.membershipId});await db.insert(schema.tokens).values({sceneId:scene,definitionId:definition,name:"Synthetic token",x:0,y:0});
 }
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
  for(const name of ["character_catalog_entries","character_controllers","drawings","fog_reveals","token_controllers","tokens"] as const){const result=await source.readRelatedRows(name);expect(result.rows,name).toHaveLength(1);expect(result.nextOffset).toBeNull();expect(result.rows[0]).not.toContain(selected[1]!.character);expect(result.rows[0]).not.toContain(selected[1]!.scene);expect(result.rows[0]).not.toContain(selected[1]!.definition);}
 });
});

it("transfers visible chat and claimed attachment metadata, with auditable consent and hidden-link redactions",async()=>{
 const a=crypto.randomUUID(),b=crypto.randomUUID();await db.insert(schema.memberships).values([{id:a,campaignId:auth.campaignId,role:"PLAYER",displayName:"Synthetic A"},{id:b,campaignId:auth.campaignId,role:"PLAYER",displayName:"Synthetic B"}]);const stream=(await db.select({id:schema.chatThreads.id}).from(schema.chatThreads).where(sql`campaign_id=${auth.campaignId} AND stream='TABLE'`))[0]!.id;
 const hiddenThread=crypto.randomUUID(),pair=[a,b].sort();await db.insert(schema.chatThreads).values({id:hiddenThread,campaignId:auth.campaignId,type:"DIRECT",stream:null,participantAMembershipId:pair[0]!,participantBMembershipId:pair[1]!});
 const hiddenMessage=crypto.randomUUID(),visibleMessage=crypto.randomUUID(),restrictedMessage=crypto.randomUUID(),stickerMessage=crypto.randomUUID();await db.insert(schema.chatMessages).values({id:hiddenMessage,campaignId:auth.campaignId,membershipId:a,threadId:hiddenThread,body:"PRIVATE_PEER_DM"});await db.insert(schema.chatMessages).values([{id:visibleMessage,campaignId:auth.campaignId,membershipId:auth.membershipId,threadId:stream,body:"VISIBLE_MESSAGE",inspirationSourceMessageId:hiddenMessage},{id:restrictedMessage,campaignId:auth.campaignId,membershipId:a,threadId:stream,body:"RESTRICTED_AUDIENCE",stickerViewerMembershipIds:[a,b]}]);
 const pack=crypto.randomUUID(),media=crypto.randomUUID(),sticker=crypto.randomUUID();await db.insert(schema.stickerPacks).values({id:pack,campaignId:auth.campaignId,name:"Synthetic revoked pack",subject:"PLAYER",subjectMembershipId:a});await db.insert(schema.playerLikenessConsents).values({campaignId:auth.campaignId,packId:pack,membershipId:a,status:"REVOKED",grantedAt:new Date(0),revokedAt:new Date(1)});await db.insert(schema.stickerMedia).values({id:media,campaignId:auth.campaignId,uploadedByMembershipId:auth.membershipId,storageKey:"synthetic-"+media+".webp",mimeType:"image/webp",sizeBytes:10,width:1,height:1,sha256:"a".repeat(64)});await db.insert(schema.stickers).values({id:sticker,campaignId:auth.campaignId,packId:pack,mediaId:media,name:"Synthetic",altText:"Synthetic",provenanceType:"ORIGINAL"});await db.insert(schema.chatMessages).values({id:stickerMessage,campaignId:auth.campaignId,membershipId:a,threadId:stream,body:"Comment preserved",stickerId:sticker,stickerPresentation:{name:"PRIVATE_OLD_STICKER_NAME",altText:"PRIVATE_OLD_ALT",assetUrl:"/api/stickers/PRIVATE_OLD_URL/content",width:1,height:1}});
 const visibleContent=crypto.randomUUID(),hiddenContent=crypto.randomUUID();for(const item of [{content:visibleContent,message:visibleMessage,thread:stream},{content:hiddenContent,message:hiddenMessage,thread:hiddenThread}]){await db.insert(schema.chatAttachmentUploads).values({contentId:item.content,campaignId:auth.campaignId,uploadedByMembershipId:a,fileName:"synthetic.webp",storageKey:"synthetic-"+item.content+".webp",mimeType:"image/webp",sizeBytes:10,width:1,height:1,status:"CLAIMED",expiresAt:new Date(0)});await db.insert(schema.chatAttachments).values({contentId:item.content,campaignId:auth.campaignId,messageId:item.message,threadId:item.thread});}
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
  const result=await source.readChatMessages(),rows=result.rows.map(row=>JSON.parse(row));expect(new Set(rows.map(row=>row.id))).toEqual(new Set([visibleMessage,stickerMessage]));expect(result.rows.join()).not.toMatch(/PRIVATE_PEER_DM|RESTRICTED_AUDIENCE|PRIVATE_OLD_/);
  expect(rows.find(row=>row.id===visibleMessage).inspiration_source_message_id).toBeNull();expect(rows.find(row=>row.id===stickerMessage)).toMatchObject({sticker_id:null,global_sticker_id:null,sticker_presentation:null,body:"Comment preserved [Sticker unavailable]"});expect(result.redactions).toEqual(expect.arrayContaining([{messageId:visibleMessage,kind:"HIDDEN_INSPIRATION"},{messageId:stickerMessage,kind:"REVOKED_STICKER"}]));
  const firstPage=await source.readChatMessages({limit:1}),lastPage=await source.readChatMessages({limit:1,offset:firstPage.nextOffset!});expect(firstPage.rows).toHaveLength(1);expect(firstPage.nextOffset).toBe(1);expect(lastPage.rows).toHaveLength(1);expect(lastPage.nextOffset).toBeNull();expect(new Set([...firstPage.rows,...lastPage.rows].map(row=>JSON.parse(row).id))).toEqual(new Set([visibleMessage,stickerMessage]));
  const attachments=await source.readChatAttachments();expect(attachments.rows).toHaveLength(1);expect(attachments.contents).toHaveLength(1);expect(attachments.contents[0]).toMatchObject({contentId:visibleContent,campaignId:auth.campaignId,sizeBytes:10});expect(JSON.stringify(attachments)).not.toContain(hiddenContent);expect(attachments.contents[0]).not.toHaveProperty("expiresAt");expect(attachments.contents[0]).not.toHaveProperty("status");expect(attachments.contents[0]).not.toHaveProperty("id");
 });
 await db.execute(sql`UPDATE chat_attachment_uploads SET status='EXPIRED' WHERE content_id=${visibleContent}`);await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readChatAttachments())).rejects.toThrow("ATTACHMENT_STATE_INVALID");
});

it("copies only owned assets/posters and participant-visible claimed attachment bytes",async()=>{
 const temporary=await mkdtemp(join(tmpdir(),"arken-transfer-source-")),mediaRoot=join(temporary,"media"),staging=join(temporary,"staging"),previousMedia=env.MEDIA_ROOT;await mkdir(mediaRoot);await mkdir(staging);env.MEDIA_ROOT=mediaRoot;
 try{
  const original=await sharp({create:{width:16,height:16,channels:4,background:"#ff0000"}}).webp().toBuffer(),poster=await sharp({create:{width:16,height:16,channels:4,background:"#0000ff"}}).webp().toBuffer(),asset=crypto.randomUUID(),foreignAsset=crypto.randomUUID(),other=crypto.randomUUID();await writeFile(join(mediaRoot,"original.webp"),original);await writeFile(join(mediaRoot,"poster.webp"),poster);await db.insert(schema.campaigns).values({id:other,name:"Foreign media campaign"});await db.insert(schema.assets).values([{id:asset,campaignId:auth.campaignId,uploadedByMembershipId:auth.membershipId,kind:"DICE_FRAME",name:"Owned",storageKey:"original.webp",mimeType:"image/webp",sizeBytes:original.length,posterStorageKey:"poster.webp",posterSizeBytes:poster.length},{id:foreignAsset,campaignId:other,uploadedByMembershipId:auth.membershipId,kind:"IMAGE",name:"Foreign",storageKey:"missing-foreign.webp",mimeType:"image/webp",sizeBytes:original.length}]);
  const a=crypto.randomUUID(),b=crypto.randomUUID(),peer=crypto.randomUUID(),pair=[a,b].sort();await db.insert(schema.memberships).values([{id:a,campaignId:auth.campaignId,role:"PLAYER",displayName:"A"},{id:b,campaignId:auth.campaignId,role:"PLAYER",displayName:"B"}]);await db.insert(schema.chatThreads).values({id:peer,campaignId:auth.campaignId,type:"DIRECT",stream:null,participantAMembershipId:pair[0]!,participantBMembershipId:pair[1]!});const table=(await db.select({id:schema.chatThreads.id}).from(schema.chatThreads).where(sql`campaign_id=${auth.campaignId} AND stream='TABLE'`))[0]!.id;
  const visible=crypto.randomUUID(),hidden=crypto.randomUUID();for(const item of [{content:visible,thread:table,key:"original.webp"},{content:hidden,thread:peer,key:"missing-peer.webp"}]){const message=crypto.randomUUID();await db.insert(schema.chatMessages).values({id:message,campaignId:auth.campaignId,membershipId:a,threadId:item.thread,body:"Synthetic attachment"});await db.insert(schema.chatAttachmentUploads).values({contentId:item.content,campaignId:auth.campaignId,uploadedByMembershipId:a,fileName:"synthetic.webp",storageKey:item.key,mimeType:"image/webp",sizeBytes:original.length,status:"CLAIMED",expiresAt:new Date(0)});await db.insert(schema.chatAttachments).values({contentId:item.content,campaignId:auth.campaignId,threadId:item.thread,messageId:message});}
  const stage=await createCampaignTransferMediaStage(staging);
  await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
   const image=await source.captureAssetMedia(asset,stage),thumbnail=await source.captureAssetMedia(asset,stage,"poster"),attachment=await source.captureChatAttachmentMedia(visible,stage);expect(image.sha256).toBe(createHash("sha256").update(original).digest("hex"));expect(thumbnail.sha256).toBe(createHash("sha256").update(poster).digest("hex"));expect(attachment).toEqual(image);expect(await readFile(join(stage.root,"media",image.sha256))).toEqual(original);expect(stage.entries()).toHaveLength(2);
   await expect(source.captureAssetMedia(foreignAsset,stage)).rejects.toThrow("MEDIA_FORBIDDEN");await expect(source.captureChatAttachmentMedia(hidden,stage)).rejects.toThrow("MEDIA_FORBIDDEN");await expect(source.captureChatAttachmentMedia(crypto.randomUUID(),stage)).rejects.toThrow("MEDIA_FORBIDDEN");
  });
 }finally{env.MEDIA_ROOT=previousMedia;const part=relative(resolve(tmpdir()),resolve(temporary));if(!part||part.startsWith("..")||isAbsolute(part)||!temporary.includes("arken-transfer-source-"))throw Error("TEST_CLEANUP_SCOPE_INVALID");await rm(temporary,{recursive:true,force:true});}
});

it("selects consented campaign stickers and referenced or own global media, not the full library",async()=>{
 const temporary=await mkdtemp(join(tmpdir(),"arken-transfer-stickers-")),mediaRoot=join(temporary,"media"),staging=join(temporary,"staging"),oldRoot=env.MEDIA_ROOT,oldGlobal=env.GLOBAL_STICKERS_ENABLED;await mkdir(mediaRoot);await mkdir(staging);env.MEDIA_ROOT=mediaRoot;env.GLOBAL_STICKERS_ENABLED=true;
 try{
  const a=crypto.randomUUID(),b=crypto.randomUUID(),foreignCampaign=crypto.randomUUID(),foreignMember=crypto.randomUUID();await db.insert(schema.memberships).values([{id:a,campaignId:auth.campaignId,role:"PLAYER",displayName:"A"},{id:b,campaignId:auth.campaignId,role:"PLAYER",displayName:"B"}]);await db.insert(schema.campaigns).values({id:foreignCampaign,name:"Other library owner"});await db.insert(schema.memberships).values({id:foreignMember,campaignId:foreignCampaign,role:"GM",displayName:"Other GM"});const bytes=await sharp({create:{width:16,height:16,channels:4,background:"#00ff00"}}).webp().toBuffer(),hash=createHash("sha256").update(bytes).digest("hex");
  const media=crypto.randomUUID(),storageKey=media+".webp";await writeFile(join(mediaRoot,storageKey),bytes);await db.insert(schema.stickerMedia).values({id:media,campaignId:auth.campaignId,uploadedByMembershipId:auth.membershipId,storageKey,mimeType:"image/webp",sizeBytes:bytes.length,width:16,height:16,sha256:hash});
  const allowedPack=crypto.randomUUID(),revokedPack=crypto.randomUUID(),pendingPack=crypto.randomUUID(),allowedSticker=crypto.randomUUID(),revokedSticker=crypto.randomUUID(),pendingSticker=crypto.randomUUID();for(const [id,subject] of [[allowedPack,a],[revokedPack,b],[pendingPack,a]])await db.insert(schema.stickerPacks).values({id:id!,campaignId:auth.campaignId,name:"Synthetic consent pack",subject:"PLAYER",subjectMembershipId:subject!});await db.insert(schema.playerLikenessConsents).values([{campaignId:auth.campaignId,packId:allowedPack,membershipId:a,status:"GRANTED",grantedAt:new Date(0)},{campaignId:auth.campaignId,packId:revokedPack,membershipId:b,status:"REVOKED",grantedAt:new Date(0),revokedAt:new Date(1)}]);for(const [id,packId] of [[allowedSticker,allowedPack],[revokedSticker,revokedPack],[pendingSticker,pendingPack]])await db.insert(schema.stickers).values({id:id!,campaignId:auth.campaignId,packId:packId!,mediaId:media,name:"Synthetic consent art",altText:"Synthetic",provenanceType:"ORIGINAL"});
  const publishedPack=crypto.randomUUID(),ownDraft=crypto.randomUUID(),foreignDraft=crypto.randomUUID(),unusedPack=crypto.randomUUID();await db.insert(schema.globalStickerPacks).values([{id:publishedPack,name:"Referenced global",creatorMembershipId:foreignMember,createActionId:crypto.randomUUID(),lifecycle:"ACTIVE"},{id:ownDraft,name:"Own draft",creatorMembershipId:auth.membershipId,createActionId:crypto.randomUUID()},{id:foreignDraft,name:"Other private draft",creatorMembershipId:foreignMember,createActionId:crypto.randomUUID()},{id:unusedPack,name:"Unreferenced public",creatorMembershipId:foreignMember,createActionId:crypto.randomUUID(),lifecycle:"ACTIVE"}]);
  const globalMedia=crypto.randomUUID();await db.insert(schema.globalStickerMedia).values({id:globalMedia,uploadedByMembershipId:foreignMember,storageKey:"global-"+storageKey,mimeType:"image/webp",sizeBytes:bytes.length,width:16,height:16,sha256:hash});await writeFile(join(mediaRoot,"global-"+storageKey),bytes);
  const used=crypto.randomUUID(),sibling=crypto.randomUUID(),own=crypto.randomUUID(),blocked=crypto.randomUUID(),unused=crypto.randomUUID();for(const [id,packId] of [[used,publishedPack],[sibling,publishedPack],[own,ownDraft],[blocked,foreignDraft],[unused,unusedPack]])await db.insert(schema.globalStickers).values({id:id!,packId:packId!,mediaId:globalMedia,actionId:crypto.randomUUID(),name:"Synthetic global",altText:"Synthetic",authorCredit:"Synthetic author",licenseNote:"Synthetic test permission",sourceReference:"PRIVATE_MANAGER_REFERENCE"});
  const stream=(await db.select({id:schema.chatThreads.id}).from(schema.chatThreads).where(sql`campaign_id=${auth.campaignId} AND stream='TABLE'`))[0]!.id,blockedMessage=crypto.randomUUID(),presentation={name:"Synthetic global",altText:"Synthetic",assetUrl:"/api/global-stickers/synthetic/content",width:16,height:16};await db.insert(schema.chatMessages).values([{campaignId:auth.campaignId,membershipId:a,threadId:stream,body:"Referenced",globalStickerId:used,stickerPresentation:presentation},{id:blockedMessage,campaignId:auth.campaignId,membershipId:a,threadId:stream,body:"Unavailable private draft",globalStickerId:blocked,stickerPresentation:presentation}]);const stage=await createCampaignTransferMediaStage(staging);
  await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
   await expect(source.readOwnedRows("stickers")).rejects.toThrow("SPECIAL_POLICY_REQUIRED");expect((await source.readStickerRows("sticker_packs")).rows).toHaveLength(3);expect((await source.readStickerRows("player_likeness_consents")).rows).toHaveLength(2);expect((await source.readStickerRows("stickers")).rows.map(row=>JSON.parse(row).id)).toEqual([allowedSticker]);expect((await source.captureStickerMedia(allowedSticker,stage)).sha256).toBe(hash);await expect(source.captureStickerMedia(revokedSticker,stage)).rejects.toThrow("MEDIA_FORBIDDEN");await expect(source.captureStickerMedia(pendingSticker,stage)).rejects.toThrow("MEDIA_FORBIDDEN");
   const packs=await source.readStickerRows("global_sticker_packs"),globalItems=await source.readStickerRows("global_stickers"),globalBlobs=await source.readStickerRows("global_sticker_media");expect(new Set(packs.rows.map(row=>JSON.parse(row).id))).toEqual(new Set([publishedPack,ownDraft]));expect(new Set(globalItems.rows.map(row=>JSON.parse(row).id))).toEqual(new Set([used,own]));expect(JSON.parse(packs.rows.find(row=>JSON.parse(row).id===publishedPack)!).creator_membership_id).toBeNull();expect(JSON.parse(globalBlobs.rows[0]!).uploaded_by_membership_id).toBeNull();expect(packs.redactions).toContainEqual({table:"global_sticker_packs",rowId:publishedPack,kind:"EXTERNAL_MEMBERSHIP_REFERENCE"});expect(globalBlobs.redactions).toContainEqual({table:"global_sticker_media",rowId:globalMedia,kind:"EXTERNAL_MEMBERSHIP_REFERENCE"});expect(globalItems.rows.join()).toContain("Synthetic test permission");expect(JSON.parse(globalItems.rows.find(row=>JSON.parse(row).id===used)!).source_reference).toBeNull();expect(JSON.parse(globalItems.rows.find(row=>JSON.parse(row).id===own)!).source_reference).toBe("PRIVATE_MANAGER_REFERENCE");expect(globalItems.redactions).toContainEqual({table:"global_stickers",rowId:used,kind:"EXTERNAL_CATALOG_METADATA"});
   expect((await source.captureStickerMedia(used,stage,"global")).sha256).toBe(hash);await expect(source.captureStickerMedia(sibling,stage,"global")).rejects.toThrow("MEDIA_FORBIDDEN");await expect(source.captureStickerMedia(blocked,stage,"global")).rejects.toThrow("MEDIA_FORBIDDEN");await expect(source.captureStickerMedia(unused,stage,"global")).rejects.toThrow("MEDIA_FORBIDDEN");const chat=await source.readChatMessages();expect(JSON.parse(chat.rows.find(row=>JSON.parse(row).id===blockedMessage)!).global_sticker_id).toBeNull();expect(chat.redactions).toContainEqual({messageId:blockedMessage,kind:"WITHHELD_STICKER"});
  });
 }finally{env.MEDIA_ROOT=oldRoot;env.GLOBAL_STICKERS_ENABLED=oldGlobal;const part=relative(resolve(tmpdir()),resolve(temporary));if(!part||part.startsWith("..")||isAbsolute(part)||!temporary.includes("arken-transfer-stickers-"))throw Error("TEST_CLEANUP_SCOPE_INVALID");await rm(temporary,{recursive:true,force:true});}
});

it("transfers the campaign world graph, region ancestors, article links and only referenced illustrations",async()=>{
 const temporary=await mkdtemp(join(tmpdir(),"arken-transfer-world-")),mediaRoot=join(temporary,"media"),staging=join(temporary,"staging"),previousMedia=env.MEDIA_ROOT;await mkdir(mediaRoot);await mkdir(staging);env.MEDIA_ROOT=mediaRoot;
 try{
  const root=crypto.randomUUID(),region=crypto.randomUUID(),related=crypto.randomUUID(),linked=crypto.randomUUID(),unrelated=crypto.randomUUID(),merchantRegion=crypto.randomUUID(),mapArticle=crypto.randomUUID(),foreignArticle=crypto.randomUUID();const cover=crypto.randomUUID(),gallery=crypto.randomUUID(),unusedImage=crypto.randomUUID(),bytes=await sharp({create:{width:16,height:16,channels:4,background:"#c08040"}}).webp().toBuffer(),digest=createHash("sha256").update(bytes).digest("hex");for(const id of [cover,gallery,unusedImage])await db.insert(schema.worldContentImages).values({id,name:"Synthetic world image",storageKey:id+".webp",mimeType:"image/webp",sizeBytes:bytes.length,width:16,height:16});for(const id of [cover,gallery])await writeFile(join(mediaRoot,id+".webp"),bytes);
  for(const id of [root,region,related,linked,unrelated,merchantRegion,mapArticle,foreignArticle])await db.insert(schema.worldContent).values({id,slug:"w80-"+id.replaceAll("-",""),type:"LOCATION",name:"Synthetic world node",gmOnlyText:id===root?"OWNER_GM_SECRET":"OTHER_GM_TEXT",coverAssetId:id===root?cover:id===unrelated?unusedImage:null});await db.execute(sql`UPDATE world_content SET region_id=${region},public_text=${"[Linked article](/campaign/"+auth.campaignId+"?article="+linked+")"} WHERE id=${root}`);await db.execute(sql`UPDATE world_content SET region_id=${root} WHERE id=${region}`);await db.execute(sql`UPDATE world_content SET region_id=${region} WHERE id=${unrelated}`);
  await db.insert(schema.worldContentInstances).values({campaignId:auth.campaignId,worldContentId:root});await db.insert(schema.worldContentRelations).values([{fromWorldContentId:root,toWorldContentId:related,relationType:"RELATED"},{fromWorldContentId:related,toWorldContentId:root,relationType:"RETURN"}]);await db.insert(schema.worldContentMedia).values({worldContentId:related,assetId:gallery});await db.insert(schema.economyMerchants).values({id:crypto.randomUUID(),campaignId:auth.campaignId,name:"Synthetic merchant",regionId:merchantRegion,percent:100});const map=crypto.randomUUID();await db.insert(schema.worldMaps).values({id:map,campaignId:auth.campaignId,name:"Synthetic map"});await db.insert(schema.worldMapLocations).values({campaignId:auth.campaignId,mapId:map,canonicalLocationId:mapArticle,name:"Synthetic map article",x:.5,y:.5});const other=crypto.randomUUID();await db.insert(schema.campaigns).values({id:other,name:"Other world campaign"});await db.insert(schema.worldContentInstances).values({campaignId:other,worldContentId:foreignArticle});
  const stage=await createCampaignTransferMediaStage(staging);
  await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
   const [articles,images,relations]=await Promise.all([source.readWorldRows("world_content"),source.readWorldRows("world_content_images"),source.readWorldRows("world_content_relations")]);expect(new Set(articles.rows.map(row=>JSON.parse(row).id))).toEqual(new Set([root,region,related,linked,merchantRegion,mapArticle]));expect(articles.rows.join()).toContain("OWNER_GM_SECRET");expect(articles.rows.join()).not.toContain(foreignArticle);expect(articles.rows.join()).not.toContain(unrelated);expect(new Set(images.rows.map(row=>JSON.parse(row).id))).toEqual(new Set([cover,gallery]));expect(relations.rows).toHaveLength(2);expect((await source.readWorldRows("world_content_media")).rows).toHaveLength(1);expect((await source.captureWorldImage(cover,stage)).sha256).toBe(digest);expect((await source.captureWorldImage(gallery,stage)).sha256).toBe(digest);expect(stage.entries()).toHaveLength(1);await expect(source.captureWorldImage(unusedImage,stage)).rejects.toThrow("MEDIA_FORBIDDEN");await expect(source.readWorldRows("world_content_actions" as any)).rejects.toThrow("SPECIAL_POLICY_REQUIRED");
  });
  await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{expect((await source.readWorldRows("world_content")).rows.some(row=>JSON.parse(row).id===unrelated)).toBe(true);},{worldArticleIds:[unrelated,unrelated]});
  await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readWorldRows("world_content"),{worldArticleIds:[crypto.randomUUID()]})).rejects.toThrow("WORLD_SELECTION_INVALID");
 }finally{env.MEDIA_ROOT=previousMedia;const part=relative(resolve(tmpdir()),resolve(temporary));if(!part||part.startsWith("..")||isAbsolute(part)||!temporary.includes("arken-transfer-world-"))throw Error("TEST_CLEANUP_SCOPE_INVALID");await rm(temporary,{recursive:true,force:true});}
});

it("preserves workshop authors, purchased licences and receipts while invalidating transferred quotes",async()=>{
 const fixture=await seedTransferWorkshop(db,auth.campaignId,auth.membershipId),[originalQuote]=await db.select().from(schema.creationOperationQuotes).where(sql`id=${fixture.operationQuote.id}`),[originalPurchaseQuote]=await db.select().from(schema.creationStoreQuotes).where(sql`id=${fixture.shopQuote.id}`);expect(originalQuote!.transferInvalidated).toBe(false);expect(originalPurchaseQuote!.transferInvalidated).toBe(false);
 const economyQuote=crypto.randomUUID();await db.insert(schema.economyQuotes).values({id:economyQuote,campaignId:auth.campaignId,actorMembershipId:auth.membershipId,characterId:fixture.buyerCharacter,offerId:crypto.randomUUID(),inputHash:"a".repeat(64),inputs:{},view:{quantity:1},expiresAt:new Date(Date.now()+3600000)});
 await cancelCreationAction(db,auth,{method:"PUT",path:"rules/enabled",body:{actionId:crypto.randomUUID(),packId:crypto.randomUUID(),expectedRevision:0,enabled:false,reason:"Synthetic cancellation"}});
 const ledger=await db.select().from(schema.creationActions).where(sql`campaign_id=${auth.campaignId}`);await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const commerce=await source.readCommerceEvents();expect(commerce.rows).toHaveLength(ledger.length);expect(commerce.references.creationActionIds).toHaveLength(ledger.length);expect(commerce.rows.join()).toContain("creation.action.cancelled");});
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
  await expect(source.readOwnedRows("creation_templates")).rejects.toThrow("SPECIAL_POLICY_REQUIRED");const licences=(await source.readCreationRows("creation_licences")).rows.map(row=>JSON.parse(row));expect(licences).toHaveLength(1);expect(licences[0]).toMatchObject({owner_membership_id:fixture.buyer,version_id:fixture.template.versionId,purchase_id:fixture.receipt.purchaseId});expect(licences[0].owner_membership_id).not.toBe(auth.membershipId);
  const purchases=(await source.readCreationRows("creation_purchases")).rows.map(row=>JSON.parse(row));expect(purchases).toHaveLength(1);expect(purchases[0].receipt).toMatchObject({purchaseId:fixture.receipt.purchaseId,beneficiaryMembershipId:fixture.buyer,priceCopper:8,authorIncomeCopper:6,sinkCopper:2});
  expect((await source.readCreationRows("creation_template_origins")).rows.map(row=>JSON.parse(row))).toContainEqual(expect.objectContaining({template_id:fixture.derivative.templateId,source_version_id:fixture.template.versionId}));expect((await source.readCreationRows("creation_reviews")).rows.map(row=>JSON.parse(row))).toHaveLength(1);expect((await source.readCreationRows("creation_template_versions")).rows).toHaveLength(2);
  const operation=await source.readCreationRows("creation_operation_quotes"),row=JSON.parse(operation.rows[0]!);expect(row.transfer_invalidated).toBe(true);expect(row.request).toEqual(originalQuote!.request);expect(row.inputs).toEqual(originalQuote!.inputs);expect(row.view).toEqual(originalQuote!.view);expect(new Date(row.expires_at).toISOString()).toBe(originalQuote!.expiresAt.toISOString());expect(operation.redactions).toContainEqual({table:"creation_operation_quotes",rowId:fixture.operationQuote.id,kind:"NON_REPLAYABLE_QUOTE"});
  const shop=await source.readCreationRows("creation_store_quotes");expect(JSON.parse(shop.rows[0]!).transfer_invalidated).toBe(true);expect(JSON.parse(shop.rows[0]!).view).toEqual(originalPurchaseQuote!.view);expect(JSON.parse((await source.readNonReplayableQuotes("economy_quotes")).rows[0]!).transfer_invalidated).toBe(true);
 });
 const [sourceEconomyQuote]=await db.select().from(schema.economyQuotes).where(sql`id=${economyQuote}`);const blockedEconomyQuote=crypto.randomUUID();await db.insert(schema.economyQuotes).values({...sourceEconomyQuote!,id:blockedEconomyQuote,transferInvalidated:true});const [walletBefore]=await db.select().from(schema.characters).where(sql`id=${fixture.buyerCharacter}`);const clock=vi.spyOn(Date,"now").mockReturnValue(Date.UTC(1960,0,1));try{await expect(purchaseEconomy(db,auth,{actionId:crypto.randomUUID(),quoteId:blockedEconomyQuote})).rejects.toThrow("ECONOMY_QUOTE_EXPIRED");}finally{clock.mockRestore();}const [walletAfter]=await db.select().from(schema.characters).where(sql`id=${fixture.buyerCharacter}`);expect(walletAfter).toEqual(walletBefore);
 const [after]=await db.select().from(schema.creationOperationQuotes).where(sql`id=${fixture.operationQuote.id}`);expect(after).toEqual(originalQuote);expect(await db.select().from(schema.creationLicences).where(sql`campaign_id=${auth.campaignId}`)).toHaveLength(1);
});

it("captures typed world audit history including deleted edges and media without unrelated history or foreign actor bindings",async()=>{
 const articleId=crypto.randomUUID(),peer=crypto.randomUUID(),other=crypto.randomUUID(),image=crypto.randomUUID(),relationId=crypto.randomUUID(),mediaId=crypto.randomUUID(),foreignActor=crypto.randomUUID();
 await db.insert(schema.worldContent).values([{id:articleId,slug:"history-selected",name:"Selected",type:"LOCATION",gmOnlyText:"GM historical secret"},{id:other,slug:"history-other",name:"Other",type:"LOCATION"},{id:peer,slug:"history-peer",name:"Peer",type:"LOCATION"}]);
 await db.insert(schema.worldContentImages).values({id:image,name:"Old cover",storageKey:"synthetic-history.webp",mimeType:"image/webp",sizeBytes:1});
 const [saved]=await db.select().from(schema.worldContent).where(sql`id=${articleId}`),stamp=new Date().toISOString();
 const articlePayload=JSON.parse(JSON.stringify(saved));
 const entries=[
  ...["created","updated"].map(type=>({type:"world_content."+type,entityType:"world_content",entityId:articleId,payload:articlePayload})),
  ...["lifecycle_changed","archived"].map(type=>({type:"world_content."+type,entityType:"world_content",entityId:articleId,payload:{from:"DRAFT",to:"ARCHIVED"}})),
  ...["relation_created","relation_deleted"].map(type=>({type:"world_content."+type,entityType:"world_content_relation",entityId:relationId,payload:{id:relationId,fromWorldContentId:articleId,toWorldContentId:peer,relationType:"historical",note:null,revision:0,createdAt:stamp,updatedAt:stamp}})),
  ...["media_added","media_updated","media_removed"].map(type=>({type:"world_content."+type,entityType:"world_content_media",entityId:mediaId,payload:{id:mediaId,worldContentId:articleId,assetId:image,caption:null,ordering:0,createdAt:stamp}})),
 ];
 await db.insert(schema.worldContentActions).values(entries.map(entry=>({...entry,actionId:crypto.randomUUID(),actorMembershipId:foreignActor})));
 await db.insert(schema.worldContentActions).values({type:"world_content.archived",entityType:"world_content",entityId:other,actionId:crypto.randomUUID(),payload:{from:"DRAFT",to:"ARCHIVED"}});
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
  let offset:number|undefined=undefined;const rows:string[]=[],redactions:any[]=[],images:string[]=[];
  do{const batch=await source.readWorldHistory({limit:2,offset});rows.push(...batch.rows);redactions.push(...batch.redactions);images.push(...batch.references.imageIds);offset=batch.nextOffset??undefined;}while(offset!==undefined);
  expect(rows).toHaveLength(9);expect(redactions).toHaveLength(9);expect(rows.map(row=>JSON.parse(row).actor_membership_id)).toEqual(Array(9).fill(null));expect(rows.join()).toContain("GM historical secret");expect(rows.join()).not.toContain(foreignActor);expect(new Set(images)).toEqual(new Set([image]));
 },{worldArticleIds:[articleId,peer]});
 await db.insert(schema.worldContentActions).values({type:"world_content.future_type",entityType:"world_content",entityId:articleId,actionId:crypto.randomUUID(),payload:{privateUnknown:"must fail"}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readWorldHistory(),{worldArticleIds:[articleId,peer]})).rejects.toThrow("TYPE_UNREVIEWED");
});
it("transfers all current canvas journal variants with undo snapshots and historical dependencies",async()=>{
 const grid={enabled:true,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2};
 const [scene]=await db.insert(schema.scenes).values({campaignId:auth.campaignId,name:"Journal scene",grid}).returning();
 const [definition]=await db.insert(schema.tokenDefinitions).values({campaignId:auth.campaignId,name:"Journal token"}).returning();
 const [placed]=await db.insert(schema.tokens).values({definitionId:definition!.id,sceneId:scene!.id,name:"Historical GM token",x:1,y:2,layer:"GM"}).returning();
 const [drawn]=await db.insert(schema.drawings).values({sceneId:scene!.id,authorMembershipId:auth.membershipId,points:[0,0,10,10]}).returning();
 const [fog]=await db.insert(schema.fogReveals).values({sceneId:scene!.id,x:0,y:0,width:64,height:64,geometry:{type:"RECT",x:0,y:0,width:64,height:64},bbox:{x:0,y:0,width:64,height:64}}).returning();
 const json=(row:unknown)=>JSON.parse(JSON.stringify(row));const token=json(placed),drawing=json(drawn),reveal=json(fog);
 const revisions={tokens:{[token.id]:token.revision},drawings:{[drawing.id]:drawing.revision}},bulk={tokens:[token],drawings:[drawing],revisions};
 const canvas={name:scene!.name,titleLabel:null,mapAssetId:null,grid,mapScale:1,world:{width:1920,height:1080},backgroundFrame:{x:0,y:0,width:1920,height:1080},tokenGeometry:{tokens:[{id:token.id,x:1,y:2,width:64,height:64,revision:0}]}};
 const rows=[
  {type:"TOKEN_CREATE",targetType:"TOKEN",targetId:token.id,before:null,after:token},
  {type:"TOKEN_DELETE",targetType:"TOKEN",targetId:token.id,before:token,after:null},
  ...Object.entries({TOKEN_MOVE:{x:1,y:2,z:0,levelId:null},TOKEN_RESIZE:{width:64,height:64},TOKEN_APPEARANCE:{baseColor:"#ffffff",frameColor:null},TOKEN_CONDITIONS:{conditions:[]},TOKEN_LAYER:{layer:"GM"}}).map(([type,value])=>({type,targetType:"TOKEN",targetId:token.id,before:value,after:value})),
  {type:"DRAWING_CREATE",targetType:"DRAWING",targetId:drawing.id,before:null,after:drawing},
  {type:"DRAWING_UPDATE",targetType:"DRAWING",targetId:drawing.id,before:drawing,after:drawing},
  {type:"DRAWING_DELETE",targetType:"DRAWING",targetId:drawing.id,before:drawing,after:null},
  {type:"FOG_CREATE",targetType:"FOG",targetId:reveal.id,before:null,after:reveal},
  ...["MOVE","DELETE"].map(operation=>({type:"CANVAS_BULK_"+operation,targetType:"CANVAS_BULK",targetId:crypto.randomUUID(),before:bulk,after:operation==="MOVE"?bulk:{tokens:[],drawings:[],revisions}})),
  {type:"SCENE_CANVAS",targetType:"SCENE",targetId:scene!.id,before:canvas,after:canvas},
 ];
 await db.insert(schema.actionJournal).values(rows.map(row=>({...row,campaignId:auth.campaignId,sceneId:scene!.id,actorMembershipId:auth.membershipId,actionId:crypto.randomUUID(),scope:"GM"})));
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const captured=await source.readActionJournal();expect(captured.rows).toHaveLength(14);expect(captured.rows.join()).toContain("Historical GM token");expect(captured.references.definitionIds).toEqual([definition!.id]);expect(captured.references.membershipIds).toEqual([auth.membershipId]);});
 const scenePayload={...canvas,tokenGeometry:undefined,rescaledTokens:1};
 const cases:[string,string,string,unknown][]=[
  ...["scene.created","scene.updated","scene.activated","scene.isometric"].map(type=>[type,"scene",scene!.id,{sceneId:scene!.id}] as [string,string,string,unknown]),
  ["scene.canvas","scene",scene!.id,scenePayload],
  ["token.created","token",token.id,{tokenId:token.id}],["token.placed","token",token.id,{definitionId:definition!.id,sceneId:scene!.id}],
  ["TOKEN_DELETED","TOKEN",token.id,{definitionId:definition!.id,sceneId:scene!.id}],
  ["TOKEN_MOVED","TOKEN",token.id,{x:1,y:2,z:0,levelId:null}],["TOKEN_RESIZED","TOKEN",token.id,{width:64,height:64}],
  ["TOKEN_APPEARANCE_UPDATED","TOKEN",token.id,{baseColor:"#ffffff",frameColor:null}],["TOKEN_CONDITIONS_UPDATED","TOKEN",token.id,{conditions:[]}],["token.layer","token",token.id,token],
  ["token_definition.created","token_definition",definition!.id,null],["token_definition.updated","token_definition",definition!.id,null],
  ["token_definition.sprite_set","token_definition",definition!.id,{requestHash:"a".repeat(64)}],
  ["token_definition.deleted","token_definition",definition!.id,{placementsRemoved:1,sceneIds:[scene!.id],undoable:false,reason:"destructive definition deletion cascades placements"}],
  ["token.controllers_replaced","token_definition",definition!.id,{controllerMembershipIds:[auth.membershipId]}],
  ["drawing.created","drawing",drawing.id,drawing],["drawing.updated","drawing",drawing.id,drawing],["drawing.copied","drawing",drawing.id,{copy:drawing,sourceDrawingId:drawing.id}],["drawing.deleted","drawing",drawing.id,null],["fog.created","fog",reveal.id,reveal],
  ...["canvas.bulk.move","canvas.bulk.delete"].map(type=>[type,"canvas_bulk",crypto.randomUUID(),{sceneId:scene!.id,targets:[{targetType:"TOKEN",targetId:token.id,revision:0}]}] as [string,string,string,unknown]),
 ];
 const [journal]=await db.select().from(schema.actionJournal).where(sql`campaign_id=${auth.campaignId} AND type='TOKEN_MOVE'`);for(const type of ["canvas.undo","canvas.redo"])cases.push([type,"token",token.id,{journalSequence:journal!.sequence}]);
 expect(new Set(cases.map(entry=>entry[0]))).toEqual(new Set(transferCanvasEventTypes));
 await db.insert(schema.gameEvents).values(cases.map(([type,entityType,entityId,payload])=>({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type,entityType,entityId,payload})));
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const captured=await source.readCanvasEvents();expect(captured.rows).toHaveLength(27);expect(captured.journalSequences).toEqual([String(journal!.sequence)]);expect(captured.references.definitionIds).toContain(definition!.id);expect(captured.references.sceneIds).toEqual([scene!.id]);expect((await source.assertEventCoverage()).totalRows).toBe("27");});
 await db.insert(schema.actionJournal).values({campaignId:auth.campaignId,sceneId:scene!.id,actorMembershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"FUTURE_PRIVATE",targetType:"TOKEN",targetId:token.id,before:{secret:"unknown"},after:null});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readActionJournal())).rejects.toThrow("TYPE_UNREVIEWED");
});
it("filters delivery events by real chat ACL before pagination and rejects payload identity smuggling",async()=>{
 const a=crypto.randomUUID(),b=crypto.randomUUID();await db.insert(schema.memberships).values([{id:a,campaignId:auth.campaignId,role:"PLAYER",displayName:"A"},{id:b,campaignId:auth.campaignId,role:"PLAYER",displayName:"B"}]);
 const table=(await db.select({id:schema.chatThreads.id}).from(schema.chatThreads).where(sql`campaign_id=${auth.campaignId} AND stream='TABLE'`))[0]!.id;
 const pair=[a,b].sort(),hidden=crypto.randomUUID();await db.insert(schema.chatThreads).values({id:hidden,campaignId:auth.campaignId,type:"DIRECT",stream:null,participantAMembershipId:pair[0]!,participantBMembershipId:pair[1]!});
 const make=async(thread:string,body:string)=>{const [message]=await db.insert(schema.chatMessages).values({campaignId:auth.campaignId,membershipId:a,threadId:thread,body}).returning();const dto={id:message!.id,sequence:message!.sequence,membershipId:a,displayName:"A",characterId:null,body,visibility:"PUBLIC",kind:"TEXT",threadId:thread,stream:thread===table?"TABLE":null,dice:null,createdAt:message!.createdAt.toISOString()};await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:a,actionId:crypto.randomUUID(),type:"chat.created",entityType:"chat",entityId:message!.id,payload:dto});return {message:message!,dto};};
 const secret=await make(hidden,"PRIVATE PEER SECRET");const first=await make(table,"Visible first"),second=await make(table,"Visible second");
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const page=await source.readChatDeliveryEvents({limit:1});expect(page.rows).toHaveLength(1);expect(page.rows[0]).toContain("Visible first");expect(page.rows[0]).not.toContain("PRIVATE PEER SECRET");expect(page.nextOffset).toBe(1);const last=await source.readChatDeliveryEvents({limit:1,offset:1});expect(last.rows[0]).toContain("Visible second");expect(last.nextOffset).toBeNull();});
 const dice={formula:"1d20",resolvedFormula:"1d20",terms:[],modifiers:[],total:10,inspiration:{sourceMessageId:secret.message.id,sourceTotal:99,sourceLabel:"PRIVATE ORIGINAL LABEL"}};
 await db.update(schema.chatMessages).set({dice,inspirationSourceMessageId:secret.message.id}).where(sql`id=${first.message.id}`);
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:a,actionId:crypto.randomUUID(),type:"dice.created",entityType:"chat",entityId:first.message.id,payload:{...first.dto,kind:"DICE",dice}});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:a,actionId:crypto.randomUUID(),type:"chat.created",entityType:"chat",entityId:second.message.id,payload:{...second.dto,stickerId:crypto.randomUUID(),stickerPresentation:{name:"Forbidden sticker",altText:"Secret alt",assetUrl:"https://example.invalid/private-art",width:64,height:64}}});
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const captured=await source.readChatDeliveryEvents();expect(captured.rows).toHaveLength(4);const output=captured.rows.join();expect(output).not.toContain("PRIVATE ORIGINAL LABEL");expect(output).not.toContain(secret.message.id);expect(output).not.toContain("private-art");expect(output).toContain("Sticker unavailable");expect(captured.redactions.some(item=>item.kind==="HIDDEN_CHAT_EVENT_INSPIRATION")).toBe(true);expect(captured.redactions.some(item=>item.kind==="WITHHELD_CHAT_EVENT_STICKER")).toBe(true);const messages=await source.readChatMessages();expect(messages.rows.join()).not.toContain("PRIVATE ORIGINAL LABEL");expect(messages.rows.join()).not.toContain(secret.message.id);});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:a,actionId:crypto.randomUUID(),type:"dice.created",entityType:"chat",entityId:first.message.id,payload:{...first.dto,threadId:hidden,body:"Smuggled"}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readChatDeliveryEvents())).rejects.toThrow("IDENTITY");
});

it("captures actual application, shared card and undo events with historical dependencies",async()=>{
 const [character]=await db.insert(schema.characters).values({campaignId:auth.campaignId,name:"Transfer caster",ownerMembershipId:auth.membershipId}).returning();
 const [entry]=await db.insert(schema.characterCatalogEntries).values({characterId:character!.id,kind:"SKILL",name:"Transfer skill",data:{skillValue:2}}).returning();
 const actionId=crypto.randomUUID();const rolled=await executeCharacterEntry(db,auth,character!.id,entry!.id,{actionId,visibility:"PUBLIC"});
 expect(rolled.duplicate).toBe(false);const original=(await db.select().from(schema.gameEvents).where(sql`action_id=${actionId}`))[0]!;
 await executeCharacterEntry(db,auth,character!.id,entry!.id,{actionId:crypto.randomUUID(),visibility:"PUBLIC",mode:"SHARE"});
 await undoApplication(db,auth,{actionId:crypto.randomUUID(),messageId:original.entityId});
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readApplicationEvents();expect(result.rows).toHaveLength(3);expect(result.references.characterIds).toEqual([character!.id]);expect(result.references.entryIds).toContain(entry!.id);expect(result.references.messageIds).toContain(original.entityId);expect(result.rows.join()).toContain("undoReceipt");});
 const players=[crypto.randomUUID(),crypto.randomUUID()].sort();await db.insert(schema.memberships).values(players.map((id,index)=>({id,campaignId:auth.campaignId,role:"PLAYER" as const,displayName:"Private "+index})));const privateThread=crypto.randomUUID();await db.insert(schema.chatThreads).values({id:privateThread,campaignId:auth.campaignId,type:"DIRECT",stream:null,participantAMembershipId:players[0]!,participantBMembershipId:players[1]!});const [secret]=await db.insert(schema.chatMessages).values({campaignId:auth.campaignId,membershipId:players[0]!,threadId:privateThread,body:"PRIVATE APPLICATION"}).returning();
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"entry.undo",entityType:"chat",entityId:original.entityId,payload:{originalMessageId:secret!.id}});
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readApplicationEvents();expect(result.rows).toHaveLength(3);expect(result.rows.join()).not.toContain(secret!.id);});
 const foreignCampaign=crypto.randomUUID(),foreignCharacter=crypto.randomUUID();await db.insert(schema.campaigns).values({id:foreignCampaign,name:"Synthetic foreign receipt campaign"});await db.insert(schema.characters).values({id:foreignCharacter,campaignId:foreignCampaign,name:"Foreign receipt"});
 const payload=original.payload as any;await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"entry.roll",entityType:"chat",entityId:original.entityId,payload:{...payload,undoReceipt:{...payload.undoReceipt,characters:[{id:foreignCharacter,beforeResources:{},afterRevision:0}]}}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readApplicationEvents())).rejects.toThrow("FOREIGN_REFERENCE");
});
it("requires complete event handler coverage in the current owned snapshot",async()=>{
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{expect((await source.assertEventCoverage()).totalRows).toBe("0");});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"FUTURE_UNHANDLED_EVENT",entityType:"campaign",payload:{unreviewed:"must not be silently lost"}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.assertEventCoverage())).rejects.toThrow("HANDLER_REQUIRED");
});
it("rejects foreign canvas references and undo without its matching campaign journal",async()=>{
 const other=crypto.randomUUID(),scene=crypto.randomUUID();await db.insert(schema.campaigns).values({id:other,name:"Synthetic other canvas campaign"});await db.insert(schema.scenes).values({id:scene,campaignId:other,name:"Foreign canvas",grid:{enabled:true,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2}});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"scene.created",entityType:"scene",entityId:scene,payload:{sceneId:scene}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readCanvasEvents())).rejects.toThrow("FOREIGN_REFERENCE");
 await db.delete(schema.gameEvents).where(sql`campaign_id=${auth.campaignId}`);
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"canvas.undo",entityType:"token",entityId:crypto.randomUUID(),payload:{journalSequence:1}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readCanvasEvents())).rejects.toThrow("JOURNAL_REQUIRED");
});

it("transfers actual character counters and archive/restore history",async()=>{
 const [character]=await db.insert(schema.characters).values({campaignId:auth.campaignId,name:"Transfer counters",ownerMembershipId:auth.membershipId}).returning();
 await updateCharacterCounters(db,auth,character!.id,{actionId:crypto.randomUUID(),revision:character!.revision,wallet:{gold:0,silver:0,copper:7,sp:0}});
 const [updated]=await db.select().from(schema.characters).where(sql`id=${character!.id}`);const archived=await archiveCharacter(db,{campaignId:auth.campaignId,membershipId:auth.membershipId,characterId:character!.id,revision:updated!.revision,actionId:crypto.randomUUID()});expect(archived.kind).toBe("updated");if(archived.kind!=="updated")throw Error("Archive failed");
 expect((await restoreCharacter(db,{campaignId:auth.campaignId,membershipId:auth.membershipId,characterId:character!.id,revision:archived.character.revision,actionId:crypto.randomUUID()})).kind).toBe("updated");
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readCharacterEvents();expect(result.rows).toHaveLength(3);expect(result.references.characterIds).toEqual([character!.id]);expect((await source.assertEventCoverage()).totalRows).toBe("3");});
 const others=[crypto.randomUUID(),crypto.randomUUID()].sort();await db.insert(schema.memberships).values(others.map(id=>({id,campaignId:auth.campaignId,role:"PLAYER" as const,displayName:"Private source"})));const thread=crypto.randomUUID();await db.insert(schema.chatThreads).values({id:thread,campaignId:auth.campaignId,type:"DIRECT",stream:null,participantAMembershipId:others[0]!,participantBMembershipId:others[1]!});const [secret]=await db.insert(schema.chatMessages).values({campaignId:auth.campaignId,membershipId:others[0]!,threadId:thread,body:"Private inspiration source"}).returning();
 const state={current:1,maximum:3};await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"character.inspiration",entityType:"character",entityId:character!.id,payload:{commandHash:"a".repeat(64),before:state,after:state,reason:"Synthetic",sourceMessageId:secret!.id,result:{state,revision:1,messageId:null}}});
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readCharacterEvents({limit:3});expect(result.rows).toHaveLength(3);expect(result.nextOffset).toBeNull();expect(result.rows.join()).not.toContain(secret!.id);});
});

it("transfers actual economy config, merchant, offer and one replay-protected purchase",async()=>{
 const fixture=await seedTransferEconomy(db,auth);
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readCommerceEvents();expect(result.rows).toHaveLength(4);expect(result.references.characterIds).toEqual([fixture.character]);expect(result.references.quoteIds).toEqual([fixture.quote.id]);expect(result.references.instanceIds).toEqual([fixture.receipt.inventoryInstanceId]);expect(result.references.merchantIds).toEqual([fixture.merchant]);expect(result.references.offerIds).toEqual([fixture.offer]);expect((await source.assertEventCoverage()).totalRows).toBe("4");});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"creation.operation",entityType:"creation",entityId:null,payload:{requestHash:"a".repeat(64)}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readCommerceEvents())).rejects.toThrow("CREATION_ACTION_REQUIRED");
});
it.each(["hash","cancellation"])("rejects a creation ledger mismatch: %s",async mode=>{
 const actionId=crypto.randomUUID();await db.insert(schema.creationActions).values({campaignId:auth.campaignId,actionId,actorMembershipId:auth.membershipId,type:"creation.operation",requestHash:"a".repeat(64),receipt:mode==="hash"?{result:"Synthetic"}:{actionId,outcome:"CANCELLED",type:"creation.rules.enabled"}});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId,type:mode==="hash"?"creation.operation":"creation.action.cancelled",entityType:"creation",entityId:null,payload:{requestHash:(mode==="hash"?"b":"a").repeat(64)}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readCommerceEvents())).rejects.toThrow(mode==="hash"?"ACTION_REQUIRED":"CANCELLATION_INVALID");
});

it("transfers real story revisions and player request transitions through account-bound HTTP",async()=>{
 const fixture=await seedTransferNarrative(db,auth.campaignId,auth.membershipId);
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readNarrativeEvents();expect(result.rows).toHaveLength(12);expect(result.references.postIds).toEqual([fixture.postId]);expect(new Set(result.references.requestIds)).toEqual(new Set(fixture.requestIds));expect(result.rows.join()).toContain("SYNTHETIC_GM_NARRATIVE_SECRET");expect((await source.assertEventCoverage()).totalRows).toBe("12");});
 const other=crypto.randomUUID();await db.insert(schema.memberships).values({id:other,campaignId:auth.campaignId,role:"PLAYER",displayName:"Synthetic private peer"});const pair=[fixture.player,other].sort(),thread=crypto.randomUUID();await db.insert(schema.chatThreads).values({id:thread,campaignId:auth.campaignId,type:"DIRECT",stream:null,participantAMembershipId:pair[0]!,participantBMembershipId:pair[1]!});
 const [original]=await db.select().from(schema.gameEvents).where(sql`campaign_id=${auth.campaignId} AND type='story.created'`);const payload=original!.payload as any;
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"story.updated",entityType:"story_post",entityId:fixture.postId,payload:{...payload,response:{...payload.response,threadId:thread}}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readNarrativeEvents())).rejects.toThrow("THREAD_FORBIDDEN");

});

it("transfers world-map HTTP history including a deleted location and cleared position",async()=>{
 const fixture=await seedTransferWorldMap(db,auth.campaignId,auth.membershipId);
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readWorldMapEvents();expect(result.rows).toHaveLength(14);expect(new Set(result.rows.map(row=>JSON.parse(row).type))).toEqual(new Set(transferWorldMapEventTypes));expect(result.references.mapIds).toEqual([fixture.mapId]);expect(new Set(result.references.locationIds)).toEqual(new Set([fixture.locationId,fixture.deletedLocationId]));expect(result.references.assetIds).toEqual([fixture.asset]);expect(result.references.sceneIds).toEqual([fixture.scene]);expect((await source.assertEventCoverage()).totalRows).toBe("14");});
});
it("rejects a wrong current location map and a foreign background asset",async()=>{
 const first=crypto.randomUUID(),second=crypto.randomUUID(),location=crypto.randomUUID();await db.insert(schema.worldMaps).values([{id:first,campaignId:auth.campaignId,name:"Synthetic first map"},{id:second,campaignId:auth.campaignId,name:"Synthetic second map"}]);await db.insert(schema.worldMapLocations).values({id:location,campaignId:auth.campaignId,mapId:first,name:"Synthetic location",x:.5,y:.5});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"world_map.location_updated",entityType:"WORLD_MAP_LOCATION",entityId:location,payload:{mapId:second,locationId:location}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readWorldMapEvents())).rejects.toThrow("LOCATION_MISMATCH");await db.delete(schema.gameEvents).where(sql`campaign_id=${auth.campaignId}`);
 const other=crypto.randomUUID(),member=crypto.randomUUID(),asset=crypto.randomUUID();await db.insert(schema.campaigns).values({id:other,name:"Synthetic foreign map"});await db.insert(schema.memberships).values({id:member,campaignId:other,role:"GM",displayName:"Synthetic GM"});await db.insert(schema.assets).values({id:asset,campaignId:other,uploadedByMembershipId:member,kind:"MAP",name:"Foreign background",storageKey:"synthetic-foreign-"+asset,mimeType:"image/webp",sizeBytes:1});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"world_map.background_approved",entityType:"WORLD_MAP",entityId:first,payload:{mapId:first,backgroundAssetId:asset}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readWorldMapEvents())).rejects.toThrow("FOREIGN_REFERENCE");
});

it("binds actual spell versions, character assignments, awards and instance history",async()=>{
 const fixture=await seedTransferMagicAwards(db,auth.campaignId,auth.membershipId);
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readMagicAwardEvents();expect(result.rows).toHaveLength(10);expect(new Set(result.rows.map(row=>JSON.parse(row).type))).toEqual(new Set(transferMagicAwardEventTypes));expect(new Set(result.references.packVersionIds)).toEqual(new Set(fixture.packVersions));expect(new Set(result.references.assignmentVersionIds)).toEqual(new Set(fixture.assignmentVersions));expect(result.references.achievementHistoryIds).toHaveLength(2);expect(result.references.instanceIds).toEqual([fixture.instance]);expect((await source.assertEventCoverage()).totalRows).toBe("10");});
});
it.each(["spell_pack.created","achievement.command","instance.bindings"])("rejects magic/award events without their durable origin: %s",async type=>{
 const pack=type==="spell_pack.created";await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type,entityType:pack?"SPELL_PACK":type,entityId:crypto.randomUUID(),payload:pack?{commandHash:"a".repeat(64),targetVersionId:crypto.randomUUID(),targetVersion:1,expectedVersion:0,lifecycle:"DRAFT"}:{commandHash:"a".repeat(64)}});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readMagicAwardEvents())).rejects.toThrow(pack?"SPELL_VERSION_REQUIRED":type==="achievement.command"?"ACHIEVEMENT_HISTORY_REQUIRED":"BINDING_HISTORY_REQUIRED");
});

it("transfers actual access lifecycle, recharge and cancellation while excluding credentials",async()=>{
 const fixture=await seedTransferControl(db,auth.campaignId,auth.membershipId);
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readControlEvents();expect(result.rows).toHaveLength(9);expect(result.references.authRuntimeRefs).toEqual([{kind:"PLAYER_ACCESS",id:fixture.grant},{kind:"INVITE",id:fixture.legacyInvite}]);expect(result.references.entryIds).toEqual([fixture.entry]);expect(result.references.actionIds).toEqual([fixture.cancelActionId]);expect(result.redactions).toHaveLength(6);for(const url of fixture.syntheticPrivateValues)expect(result.rows.join().includes(url)).toBe(false);await expect(source.readOwnedRows("player_access_grants")).rejects.toThrow("SPECIAL_POLICY_REQUIRED");expect((await source.assertEventCoverage()).totalRows).toBe("9");});
});
it.each(["grant","gm","member"])("rejects foreign control references: %s",async mode=>{
 const other=crypto.randomUUID(),member=crypto.randomUUID(),grant=crypto.randomUUID();await db.insert(schema.campaigns).values({id:other,name:"Synthetic foreign control"});await db.insert(schema.memberships).values({id:member,campaignId:other,role:"PLAYER",displayName:"Synthetic foreign player"});await db.insert(schema.playerAccessGrants).values({id:grant,campaignId:other,membershipId:member,label:"Synthetic foreign grant",tokenHash:createHash("sha256").update(crypto.randomUUID()).digest("hex")});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:mode==="grant"?"player_access.revoked":mode==="gm"?"gm_access.rotated":"membership.renamed",entityType:mode==="grant"?"player_access":mode==="gm"?"campaign":"membership",entityId:mode==="grant"?grant:mode==="gm"?other:member,payload:mode==="member"?{membershipId:member,displayName:"Synthetic foreign name"}:null});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readControlEvents())).rejects.toThrow("CONTROL_FOREIGN_REFERENCE");
});

it("captures media and audio event metadata with excluded upload provenance",async()=>{
 const fixture=await seedTransferMediaMarkers(db,auth.campaignId,auth.membershipId);
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readMediaEvents();expect(result.rows).toHaveLength(13);expect(new Set(result.rows.map(row=>JSON.parse(row).type))).toEqual(new Set(transferMediaEventTypes));expect(result.references.assetIds).toEqual(expect.arrayContaining([fixture.image,fixture.token,fixture.sprite,fixture.audio,fixture.deleted]));expect(result.references.audioTrackIds).toEqual([fixture.track,fixture.removedTrack]);expect(result.references.deletedAttachments).toEqual([{uploadId:fixture.pendingUpload,contentId:fixture.pendingContent},{uploadId:fixture.goneUpload,contentId:fixture.goneContent}]);expect(result.redactions).toHaveLength(2);expect((await source.assertEventCoverage()).totalRows).toBe("13");});
});
it.each(["asset","track","campaign","upload","content"])("rejects invalid media ownership or upload binding: %s",async mode=>{
 const other=crypto.randomUUID(),member=crypto.randomUUID(),asset=crypto.randomUUID(),track=crypto.randomUUID(),upload=crypto.randomUUID(),content=crypto.randomUUID(),action=crypto.randomUUID();
 await db.insert(schema.campaigns).values({id:other,name:"Synthetic foreign media"});await db.insert(schema.memberships).values({id:member,campaignId:other,role:"GM",displayName:"Synthetic foreign GM"});
 await db.insert(schema.assets).values({id:asset,campaignId:other,uploadedByMembershipId:member,kind:"AUDIO",audioPurpose:"MUSIC",name:"Synthetic foreign audio",storageKey:"synthetic-"+asset,mimeType:"audio/mpeg",sizeBytes:1});
 await db.insert(schema.campaignAudioTracks).values({id:track,campaignId:other,assetId:asset,slotOrder:0});
 await db.insert(schema.chatAttachmentUploads).values({id:upload,contentId:content,campaignId:mode==="content"?auth.campaignId:other,uploadedByMembershipId:mode==="content"?auth.membershipId:member,fileName:"Synthetic upload",storageKey:"synthetic-"+content,mimeType:"image/webp",sizeBytes:1,status:"EXPIRED",expiresAt:new Date(0)});
 const event=mode==="asset"?{type:"asset.created",entityType:"asset",entityId:asset,payload:{sourceAssetId:asset}}:mode==="track"?{type:"AUDIO_TRACK_COMMAND",entityType:"AUDIO_TRACK",entityId:track,payload:{command:{actionId:action,revision:0,command:"REMOVE_TRACK",trackId:track},removedTrackId:track}}:mode==="campaign"?{type:"AUDIO_COMMAND",entityType:"AUDIO_STATE",entityId:other,payload:{command:{actionId:action,revision:0,command:"SELECT",assetId:null},result:{assetId:null,playing:false,positionSeconds:0,loop:false,startedAt:null,revision:1,updatedAt:new Date().toISOString()}}}:{type:"STORY_ATTACHMENT_DELETE_REQUESTED",entityType:"STORY_ATTACHMENT",entityId:upload,payload:{contentId:mode==="content"?asset:content,commandHash:"a".repeat(64),response:{deleted:true,contentId:mode==="content"?asset:content}}};
 await db.insert(schema.gameEvents).values({...event,campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:action});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,source=>source.readMediaEvents())).rejects.toThrow("MEDIA_FOREIGN_REFERENCE");
});
it.each([false,true])("scopes encounter history before transfer; foreign=%s",async foreign=>{
 const campaignId=foreign?crypto.randomUUID():auth.campaignId,scene=crypto.randomUUID(),encounter=crypto.randomUUID(),initiator=foreign?crypto.randomUUID():auth.membershipId;if(foreign){await db.insert(schema.campaigns).values({id:campaignId,name:"Synthetic foreign encounter"});await db.insert(schema.memberships).values({id:initiator,campaignId,role:"GM",displayName:"Synthetic GM"});}
 await db.insert(schema.scenes).values({id:scene,campaignId,name:"Synthetic encounter scene",grid:{enabled:true,size:64,offsetX:0,offsetY:0,color:"#777777",opacity:.2}});
 await db.insert(schema.encounters).values({id:encounter,campaignId,mode:"SCENE_REGION",sourceSceneId:scene,targetSceneId:scene,sourceSceneRevision:0,initiatorMembershipId:initiator,focusRegion:{x:0,y:0,width:10,height:10}});
 await db.insert(schema.gameEvents).values({campaignId:auth.campaignId,membershipId:auth.membershipId,actionId:crypto.randomUUID(),type:"ENCOUNTER_STARTED",entityType:"ENCOUNTER",entityId:encounter,entityRevision:0,payload:{commandHash:"a".repeat(64),clockBefore:{battleActive:false,battleCounter:0,revision:0},clockAfter:{battleActive:true,battleCounter:1,revision:1},transitionApplied:true,recharged:0,initiativeBefore:0,initiativeAfter:0}});
 const capture=()=>withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{const result=await source.readEncounterEvents();expect(result.rows).toHaveLength(1);expect(result.references.encounterIds).toEqual([encounter]);expect((await source.assertEventCoverage()).totalRows).toBe("1");});
 if(foreign)await expect(capture()).rejects.toThrow("ENCOUNTER_FOREIGN_REFERENCE");else await capture();
});

it("captures every policy-routed table of a real empty campaign and validates its package",async()=>{
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
  const files=new Map<string,Buffer>(),counts=new Map<string,number>();
  for(const table of campaignTransferCatalog()){
   const rows:string[]=[];for await(const page of captureCampaignTransferTable(source,table.name as CampaignTransferTable))rows.push(...page.result.rows);
   counts.set(table.name,rows.length);if(rows.length)files.set(`tables/${table.name}.ndjson`,Buffer.from(rows.join("\n")+"\n"));
  }
  const manifest=createCampaignTransferManifest({format:"ARKEN_CAMPAIGN_TRANSFER",version:2,capturePolicyVersion:1,campaignId:source.campaignId,sourceOwnerMembershipId:source.ownerMembershipId,createdAt:source.createdAt,source:{schemaDigest:source.schemaDigest,migrations:[...source.migrations],baselineSequence:source.baselineSequence},tables:campaignTransferCatalog().map(t=>{const bytes=files.get(`tables/${t.name}.ndjson`);return {name:t.name,policy:t.policy,rows:counts.get(t.name)!,file:bytes?{bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")}:null};}),projections:null,mediaBindings:null,media:[]});
  const verified=await verifyCampaignTransferStructure(manifest,{campaignId:auth.campaignId,migrations:hashes},async key=>files.get(key)!);
  expect(verified.sha256).toBe(manifest.sha256);expect(JSON.parse(files.get("tables/memberships.ndjson")!.toString()).user_id).toBeNull();
 });
});

it("captures all source table files on disk and verifies a real minimal data draft",async()=>{
 const base=resolve(".qa-temp" );await mkdir(base,{recursive:true});const parent=await mkdtemp(join(base,"transfer-draft-")),previousMediaRoot=env.MEDIA_ROOT,asset=crypto.randomUUID(),storageKey="synthetic-"+asset+".png",payload=await sharp({create:{width:2,height:2,channels:4,background:"#2468ac"}}).png().toBuffer();
 await mkdir(join(parent,"source"));await mkdir(join(parent,"output"));env.MEDIA_ROOT=join(parent,"source");let sqlCandidate:Awaited<ReturnType<typeof assembleCampaignTransferStructuralCandidate>>|undefined;
 try{const {magicFixture,content,journalSequence}=await seedTransferPopulatedCampaign(db,auth,{asset,storageKey,payload});
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{
  const draft=await captureCampaignTransferDataDraft(source,join(parent,"output"));expect(draft.state).toBe("PRIVATE_DATA_DRAFT");expect(draft.tables).toHaveLength(campaignTransferCatalog().length);expect(draft.metadata.some(m=>m.reader==="readParticipants"&&m.rows===2)).toBe(true);
  const manifest=createCampaignTransferManifest({format:"ARKEN_CAMPAIGN_TRANSFER",version:2,capturePolicyVersion:1,campaignId:draft.campaignId,sourceOwnerMembershipId:draft.sourceOwnerMembershipId,createdAt:draft.createdAt,source:draft.source,tables:draft.tables,projections:draft.projectionsFile,mediaBindings:draft.mediaBindingsFile,media:draft.media});
  await verifyCampaignTransferStructure(manifest,{campaignId:auth.campaignId,migrations:hashes},async key=>readFile(join(key.startsWith("media/")?draft.mediaRoot:draft.root,key)));
  const projectionRows=(await readFile(join(draft.root,"projections.ndjson"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
  const withoutAuth=Buffer.from(projectionRows.filter(p=>p.kind!=="EXCLUDED_AUTH_RUNTIME_REFERENCE").map(p=>JSON.stringify(p)).join("\n")+"\n");
  await expect(verifyCampaignTransferStructure(createCampaignTransferManifest({...manifest,projections:{bytes:withoutAuth.length,sha256:createHash("sha256").update(withoutAuth).digest("hex")}}),{campaignId:auth.campaignId,migrations:hashes},async key=>key==="projections.ndjson"?withoutAuth:readFile(join(key.startsWith("media/")?draft.mediaRoot:draft.root,key)))).rejects.toThrow("PROJECTION_REQUIRED");
  expect(projectionRows).toEqual(expect.arrayContaining([expect.objectContaining({kind:"EXCLUDED_AUTH_RUNTIME_REFERENCE",referenceType:"INVITE"}),expect.objectContaining({kind:"MATERIALIZED_ATTACHMENT_METADATA",contentId:content})]));
  expect(JSON.stringify(projectionRows)).not.toContain('"storageKey"');expect(draft.mediaBindings).toHaveLength(2);expect(draft.media).toHaveLength(1);expect(draft.mediaBindings).toEqual(expect.arrayContaining([expect.objectContaining({kind:"ASSET_ORIGINAL",id:asset}),expect.objectContaining({kind:"CHAT_ATTACHMENT",id:content})]));expect(await readFile(join(draft.mediaRoot,"media",draft.mediaBindings[0]!.sha256))).toEqual(payload);
  const transferredMembers=(await readFile(join(draft.root,"tables/memberships.ndjson"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));expect(transferredMembers).toHaveLength(2);expect(transferredMembers.map(m=>m.role).sort()).toEqual(["GM","PLAYER"]);expect(transferredMembers.every(m=>m.user_id===null)).toBe(true);
  const candidate=await assembleCampaignTransferStructuralCandidate(draft);sqlCandidate=candidate;expect(candidate.manifest.tables.find(t=>t.name==="spell_pack_versions")?.rows).toBe(4);expect(candidate.manifest.tables.find(t=>t.name==="character_spell_assignment_versions")?.rows).toBe(3);expect((await readFile(join(candidate.root,"tables/action_journal.ndjson"),"utf8"))).toContain(journalSequence);expect((await readFile(join(candidate.root,"tables/game_events.ndjson"),"utf8"))).toContain(journalSequence);expect(candidate.state).toBe("STRUCTURAL_CANDIDATE");expect(JSON.parse(await readFile(join(candidate.root,"candidate-manifest.json"),"utf8"))).toEqual(candidate.manifest);
  await verifyCampaignTransferStructure(candidate.manifest,{campaignId:auth.campaignId,migrations:hashes},async key=>readFile(join(candidate.root,key)));
  await expect(readFile(join(candidate.root,"manifest.json"))).rejects.toMatchObject({code:"ENOENT"});await expect(assembleCampaignTransferStructuralCandidate(draft)).rejects.toThrow("CONSUMED");
 });
 const candidate=sqlCandidate!,readCandidate=async(key:string)=>readFile(join(candidate.root,key));
 const archiveParts:Buffer[]=[];
 for await(const part of encryptCampaignTransferArchive(candidate.manifest,async function*(key){yield await readCandidate(key);},'synthetic-transfer-password-126'))archiveParts.push(part);
 const encrypted=Buffer.concat(archiveParts),expectedArchive={campaignId:auth.campaignId,migrations:hashes};
 async function* transport(bytes:Buffer){for(let offset=0;offset<bytes.length;offset+=37)yield bytes.subarray(offset,offset+37);}
 const imported=await stageCampaignTransferArchive(transport(encrypted),'synthetic-transfer-password-126',expectedArchive,parent);
 expect(imported.state).toBe('AUTHENTICATED_PRIVATE_STAGE');expect(imported.manifest).toEqual(candidate.manifest);
 expect(await readFile(join(imported.root,'tables/game_events.ndjson'))).toEqual(await readCandidate('tables/game_events.ndjson'));
 expect(encrypted.includes(Buffer.from(auth.campaignId))).toBe(false);
 const stageNames=(await readdir(parent)).sort();
 await expect(stageCampaignTransferArchive(transport(encrypted),'wrong-synthetic-password',expectedArchive,parent)).rejects.toThrow();
 await expect(stageCampaignTransferArchive(transport(encrypted),'synthetic-transfer-password-126',{...expectedArchive,campaignId:crypto.randomUUID()},parent)).rejects.toThrow('SCOPE_MISMATCH');
 const mismatchedParts:Buffer[]=[];
 await expect((async()=>{for await(const part of encryptCampaignTransferArchive(candidate.manifest,async function*(){yield Buffer.from('incorrect');},'synthetic-transfer-password-126'))mismatchedParts.push(part);})()).rejects.toThrow('SOURCE_INTEGRITY');
 await expect(stageCampaignTransferArchive(transport(Buffer.concat(mismatchedParts)),'synthetic-transfer-password-126',expectedArchive,parent)).rejects.toThrow();
 const tampered=Buffer.from(encrypted);tampered[tampered.length-1]!^=1;
 for(const broken of [tampered,encrypted.subarray(0,encrypted.length-25),Buffer.concat([encrypted,Buffer.from('extra')])])await expect(stageCampaignTransferArchive(transport(broken),'synthetic-transfer-password-126',expectedArchive,parent)).rejects.toThrow();

 expect((await readdir(parent)).sort()).toEqual(stageNames);
 const versionRows=(await readCandidate("tables/spell_pack_versions.ndjson")).toString("utf8").trim().split("\n").map(line=>JSON.parse(line));versionRows.find(v=>v.id===magicFixture.packVersions[0])!.lifecycle="ARCHIVED";const badVersionBytes=Buffer.from(versionRows.map(v=>JSON.stringify(v)).join("\n")+"\n"),badVersionManifest=createCampaignTransferManifest({...candidate.manifest,tables:candidate.manifest.tables.map(t=>t.name==="spell_pack_versions"?{...t,file:{bytes:badVersionBytes.length,sha256:createHash("sha256").update(badVersionBytes).digest("hex")}}:t)});
 await expect(verifyCampaignTransferStructure(badVersionManifest,{campaignId:auth.campaignId,migrations:hashes},async key=>key==="tables/spell_pack_versions.ndjson"?badVersionBytes:readCandidate(key))).rejects.toThrow("SPELL_VERSION_REQUIRED");
 const action=JSON.parse((await readCandidate("tables/creation_actions.ndjson")).toString("utf8")),badActionBytes=Buffer.from(JSON.stringify({...action,request_hash:"b".repeat(64)})+"\n"),badActionManifest=createCampaignTransferManifest({...candidate.manifest,tables:candidate.manifest.tables.map(t=>t.name==="creation_actions"?{...t,file:{bytes:badActionBytes.length,sha256:createHash("sha256").update(badActionBytes).digest("hex")}}:t)});
 await expect(verifyCampaignTransferStructure(badActionManifest,{campaignId:auth.campaignId,migrations:hashes},async key=>key==="tables/creation_actions.ndjson"?badActionBytes:readCandidate(key))).rejects.toThrow("CREATION_ACTION_REQUIRED");
 const qualification=await qualifyCampaignTransferSqlRows(db,candidate.manifest,{campaignId:auth.campaignId,migrations:hashes},readCandidate);expect(qualification.scope).toBe("SQL_LOCAL_CONSTRAINTS_ONLY");expect(qualification.tables).toContain("assets");
 const originalAsset=JSON.parse(await readFile(join(candidate.root,"tables/assets.ndjson"),"utf8")),extraId=crypto.randomUUID(),assetBytes=Buffer.from(JSON.stringify(originalAsset)+"\n"+JSON.stringify({...originalAsset,id:extraId})+"\n");
 const bindingRows=(await readFile(join(candidate.root,"media-bindings.ndjson"),"utf8")).trim().split("\n").map(line=>JSON.parse(line)),originalBinding=bindingRows.find(b=>b.kind==="ASSET_ORIGINAL");bindingRows.push({...originalBinding,id:extraId});const bindingBytes=Buffer.from(bindingRows.map(b=>JSON.stringify(b)).join("\n")+"\n");
 const invalid=createCampaignTransferManifest({...candidate.manifest,tables:candidate.manifest.tables.map(t=>t.name==="assets"?{...t,rows:2,file:{bytes:assetBytes.length,sha256:createHash("sha256").update(assetBytes).digest("hex")}}:t),mediaBindings:{bytes:bindingBytes.length,sha256:createHash("sha256").update(bindingBytes).digest("hex")}});
 let rejected=false;try{await qualifyCampaignTransferSqlRows(db,invalid,{campaignId:auth.campaignId,migrations:hashes},async key=>key==="tables/assets.ndjson"?assetBytes:key==="media-bindings.ndjson"?bindingBytes:readCandidate(key));}catch(error){rejected=true;const e=error as {cause?:{code?:string};code?:string};expect(e.cause?.code??e.code).toBe("23505");}expect(rejected).toBe(true);
 expect(await db.select().from(schema.assets).where(sql`campaign_id=${auth.campaignId}`)).toHaveLength(1);
 const temporary=await db.execute<{tablename:string}>(sql`SELECT tablename FROM pg_tables WHERE schemaname LIKE 'pg_temp_%' AND tablename ~ '^arken_tq_'`);expect(temporary).toHaveLength(0);
 for(const probe of ["column","ledger"]){await expect(db.transaction(async tx=>{if(probe==="column")await tx.execute(sql`ALTER TABLE public.assets ADD COLUMN synthetic_transfer_probe text`);else await tx.execute(sql`UPDATE drizzle.__drizzle_migrations SET hash=${"f".repeat(64)} WHERE id=(SELECT min(id) FROM drizzle.__drizzle_migrations)`);await expect(assertCampaignTransferTargetSchema(tx,hashes)).rejects.toThrow(probe==="column"?"TARGET_SCHEMA_MISMATCH":"TARGET_MIGRATION_MISMATCH");throw Error("ROLLBACK_SCHEMA_PROBE");})).rejects.toThrow("ROLLBACK_SCHEMA_PROBE");}
 await db.transaction(tx=>assertCampaignTransferTargetSchema(tx,hashes));
 }finally{env.MEDIA_ROOT=previousMediaRoot;const part=relative(base,parent);if(!part.startsWith("transfer-draft-")||part.includes("..")||isAbsolute(part))throw Error("UNSAFE_DRAFT_CLEANUP");await rm(parent,{recursive:true,force:true});}
});

it('binds HTTP export proof to a live account session and the reauthenticated password generation',async()=>{
 const sessionId=crypto.randomUUID();await db.insert(schema.accountSessions).values({id:sessionId,userId,tokenHash:'synthetic-proof-'+sessionId,csrfHash:'synthetic-proof',expiresAt:new Date(Date.now()+60000)});
 const proof={sessionId,passwordHash:'synthetic'};
 await withCampaignTransferSnapshot(db,auth,userId,hashes,async source=>{expect((await source.readOwnedRows('campaigns')).rows).toHaveLength(1);},{accountProof:proof});
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,async()=>{throw Error('UNREACHABLE');},{accountProof:{...proof,passwordHash:'changed'}})).rejects.toThrow('FORBIDDEN');
 await db.execute(sql`UPDATE account_sessions SET revoked_at=clock_timestamp() WHERE id=${sessionId}`);
 await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,async()=>{throw Error('UNREACHABLE');},{accountProof:proof})).rejects.toThrow('FORBIDDEN');
});

it("captures only the initialized local instance owner and keeps hosted identities out of local exports",async()=>{
 const isolated=await createMigratedPglite(),db=adapt(drizzle(isolated,{schema}));
 await isolated.exec("CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)");
 for(const entry of migrations)await db.execute(sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(${entry.hash},${entry.folderMillis})`);
 const previousInstance=env.LOCAL_INSTANCE_ID,instanceId=crypto.randomUUID();env.DEPLOYMENT_MODE="LOCAL_HOST";env.LOCAL_INSTANCE_ID=instanceId;
 try{
  let called=false;const capture=async()=>{called=true;};
  await expect(withCampaignTransferSnapshot(db,auth,userId,hashes,capture)).rejects.toThrow("FORBIDDEN");
  await initializeLocalOwner(db,instanceId,{login:"synthetic-local-export",password:"synthetic-local-export-password"});
  const local=await inspectLocalHost(db,instanceId);if(!local.initialized)throw Error("LOCAL_SETUP");
  await db.insert(schema.campaigns).values({id:auth.campaignId,name:"Synthetic local export"});
  await db.insert(schema.memberships).values({id:auth.membershipId,campaignId:auth.campaignId,userId:local.ownerId,role:"GM",displayName:"Local owner"});
  const result=await withCampaignTransferSnapshot(db,auth,local.ownerId,hashes,async source=>{
   const rows=await source.readOwnedRows("campaigns");expect(rows.rows).toHaveLength(1);expect(JSON.parse(rows.rows[0]!).id).toBe(auth.campaignId);
   return source.baselineSequence;
  });expect(result).toBe("0");
  env.LOCAL_INSTANCE_ID=crypto.randomUUID();await expect(withCampaignTransferSnapshot(db,auth,local.ownerId,hashes,capture)).rejects.toThrow("FORBIDDEN");env.LOCAL_INSTANCE_ID=instanceId;
  await expect(withCampaignTransferSnapshot(db,{...auth,role:"PLAYER"},local.ownerId,hashes,capture)).rejects.toThrow("FORBIDDEN");
  await db.execute(sql`UPDATE users SET disabled_at=now() WHERE id=${local.ownerId}`);await expect(withCampaignTransferSnapshot(db,auth,local.ownerId,hashes,capture)).rejects.toThrow("FORBIDDEN");
  expect(called).toBe(false);
 }finally{await isolated.close();env.LOCAL_INSTANCE_ID=previousInstance;env.DEPLOYMENT_MODE="HOSTED";}
});

it("reserves from an issued archive only after same-transaction full cloud equality",async()=>{
 const {captureCampaignTransferDataDraft}=await import("./campaign-transfer-data-draft.js"),{assembleCampaignTransferStructuralCandidate}=await import("./campaign-transfer-candidate.js"),{recordCloudTransferExport}=await import("./campaign-transfer-origin.js"),{connectCloudSyncSource}=await import("./cloud-sync-staging.js"),{reserveCloudWriterFromTransfer}=await import("./cloud-writer-transfer-reservation.js");
 const parent=await mkdtemp(join(tmpdir(),"arken-writer159-")),sessionId=crypto.randomUUID(),actor={userId,sessionId,passwordHash:"synthetic",campaignId:auth.campaignId,membershipId:auth.membershipId};
 await db.insert(schema.accountSessions).values({id:sessionId,userId,tokenHash:crypto.randomUUID(),csrfHash:crypto.randomUUID(),expiresAt:new Date(Date.now()+3600000)});
 try{
  const draft=await withCampaignTransferSnapshot(db,auth,userId,hashes,source=>captureCampaignTransferDataDraft(source,parent));
  const candidate=await assembleCampaignTransferStructuralCandidate(draft);await recordCloudTransferExport(db,actor,candidate.manifest,hashes);
  const transferProof={manifestSha256:candidate.manifest.sha256,baselineSequence:candidate.manifest.source.baselineSequence,schemaDigest:candidate.manifest.source.schemaDigest};
  const origin={campaignId:auth.campaignId,hostId:crypto.randomUUID(),sessionId:crypto.randomUUID(),epoch:1};
  const connected=await connectCloudSyncSource(db,auth,userId,{...origin,transferProof});
  const command={originId:connected.originId,expectedRevision:"0",transferProof},options={root:parent,migrations:hashes};
  // No game event is added: numeric baseline alone cannot detect this edit.
  await db.execute(sql`UPDATE campaigns SET name='Unlogged divergent edit' WHERE id=${auth.campaignId}`);
  await expect(reserveCloudWriterFromTransfer(db,auth,actor,command,options)).rejects.toThrow("SNAPSHOT_CONFLICT");
  expect(await db.execute(sql`SELECT 1 FROM campaign_writer_authorities WHERE campaign_id=${auth.campaignId}`)).toHaveLength(0);
  await db.execute(sql`UPDATE campaigns SET name='Synthetic owned campaign' WHERE id=${auth.campaignId}`);
  const result=await reserveCloudWriterFromTransfer(db,auth,actor,command,options);expect(result).toMatchObject({writer:"LOCAL",revision:"1",originId:connected.originId});
  await expect(db.execute(sql`UPDATE campaigns SET name='Forbidden after reservation' WHERE id=${auth.campaignId}`)).rejects.toThrow();
  expect((await readdir(parent)).filter(name=>name.startsWith('writer-check-'))).toEqual([]);
 }finally{await rm(parent,{recursive:true,force:true});}
},60000);
