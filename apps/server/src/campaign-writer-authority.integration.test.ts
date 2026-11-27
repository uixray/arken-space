import {beforeEach,afterEach,it,expect} from "vitest";
import {drizzle} from "drizzle-orm/pglite";
import {sql} from "drizzle-orm";
import * as schema from "@arken/db";
import {createMigratedPglite} from "../../../tests/helpers/pglite-template.js";
import {env} from "./env.js";
import {registerCloudSyncSource,storeCloudSyncBatch} from "./cloud-sync-staging.js";
import {createLocalEventEnvelope} from "./local-event-envelope.js";
import {reserveCloudCampaignWriter,releaseCloudCampaignWriter,withReservedCloudWriter} from "./campaign-writer-authority.js";
import {campaignTransferCatalog} from "./campaign-transfer-policy.js";
let pg:Awaited<ReturnType<typeof createMigratedPglite>>,db:ReturnType<typeof schema.createDatabase>["db"],userId:string,characterId:string,otherId:string,gm:{campaignId:string;membershipId:string;role:"GM";displayName:string},originId:string,origin:{campaignId:string;hostId:string;sessionId:string;epoch:number},mode:typeof env.DEPLOYMENT_MODE;
function adapt(value:any):any{return new Proxy(value,{get(o,k){if(k==="execute")return async(...args:any[])=>{const r=await o.execute(...args);return Array.isArray(r)?r:r.rows;};if(k==="transaction")return(cb:any,opts:any)=>o.transaction((t:any)=>cb(adapt(t)),opts);const v=Reflect.get(o,k);return typeof v==="function"?v.bind(o):v;}});}
beforeEach(async()=>{mode=env.DEPLOYMENT_MODE;env.DEPLOYMENT_MODE="HOSTED";pg=await createMigratedPglite();db=adapt(drizzle(pg,{schema}));userId=crypto.randomUUID();characterId=crypto.randomUUID();otherId=crypto.randomUUID();gm={campaignId:crypto.randomUUID(),membershipId:crypto.randomUUID(),role:"GM",displayName:"Synthetic owner"};await db.insert(schema.users).values({id:userId,identityKind:"HOSTED",hostedLogin:"fence-"+userId.replaceAll("-",""),hostedApprovedAt:new Date(),passwordHash:"synthetic"});await db.insert(schema.campaigns).values([{id:gm.campaignId,name:"Synthetic fenced campaign"},{id:otherId,name:"Unrelated campaign"}]);await db.insert(schema.memberships).values({id:gm.membershipId,campaignId:gm.campaignId,userId,role:"GM",displayName:gm.displayName});await db.insert(schema.characters).values({id:characterId,campaignId:gm.campaignId,name:"Before"});origin={campaignId:gm.campaignId,hostId:crypto.randomUUID(),sessionId:crypto.randomUUID(),epoch:1};originId=(await registerCloudSyncSource(db,gm,userId,{hostId:origin.hostId,sessionId:origin.sessionId,epoch:1,baselineSequence:"0"})).originId;});
afterEach(async()=>{await pg?.close();env.DEPLOYMENT_MODE=mode;});
const reserve=(expectedRevision="0")=>reserveCloudCampaignWriter(db,gm,userId,{originId,expectedRevision,baselineSequence:"0"});
it("fences ordinary root/direct/dependent writes and permits only exact transaction-scoped authority",async()=>{
 const authority=await reserve();expect(authority.revision).toBe("1");
 await expect(db.execute(sql`UPDATE campaigns SET name='Forbidden' WHERE id=${gm.campaignId}`)).rejects.toThrow();
 await expect(db.execute(sql`UPDATE characters SET name='Forbidden' WHERE id=${characterId}`)).rejects.toThrow();
 await expect(db.insert(schema.characterControllers).values({characterId,membershipId:gm.membershipId})).rejects.toThrow();
 await expect(db.execute(sql`DELETE FROM campaigns WHERE id=${gm.campaignId}`)).rejects.toThrow();
 await expect(db.execute(sql`UPDATE characters SET campaign_id=${otherId} WHERE id=${characterId}`)).rejects.toThrow();
 await expect(db.insert(schema.gameEvents).values({campaignId:gm.campaignId,actionId:crypto.randomUUID(),membershipId:gm.membershipId,type:"SYNTHETIC",entityType:"campaign"})).rejects.toThrow();

 await db.execute(sql`UPDATE campaigns SET name='Allowed unrelated' WHERE id=${otherId}`);
 const permit={campaignId:authority.campaignId,revision:authority.revision,originId:authority.originId};
 await expect(withReservedCloudWriter(db,gm,userId,{...permit,revision:"0"},async()=>true)).rejects.toThrow("CONFLICT");
 await withReservedCloudWriter(db,gm,userId,permit,async tx=>{await tx.execute(sql`UPDATE characters SET name='Applied' WHERE id=${characterId}`);await tx.insert(schema.characterControllers).values({characterId,membershipId:gm.membershipId});});
 await expect(db.execute(sql`UPDATE characters SET name='Leaked permit' WHERE id=${characterId}`)).rejects.toThrow();
 expect((await db.select().from(schema.characters))[0]!.name).toBe("Applied");
 const released=await releaseCloudCampaignWriter(db,gm,userId,permit);expect(released.revision).toBe("2");await db.execute(sql`UPDATE characters SET name='Hosted again' WHERE id=${characterId}`);
 await expect(reserve()).rejects.toThrow("CONFLICT");originId=(await registerCloudSyncSource(db,gm,userId,{hostId:origin.hostId,sessionId:origin.sessionId,epoch:2,baselineSequence:"0"})).originId;expect((await reserve("2")).revision).toBe("3");
});
it("rolls back typed-applier state and authority CAS atomically",async()=>{
 const a=await reserve(),permit={campaignId:a.campaignId,revision:a.revision,originId:a.originId};
 await expect(withReservedCloudWriter(db,gm,userId,permit,async tx=>{await tx.execute(sql`UPDATE characters SET name='Rolled back' WHERE id=${characterId}`);throw Error("SYNTHETIC_FAILURE");})).rejects.toThrow("SYNTHETIC_FAILURE");expect((await db.select().from(schema.characters))[0]!.name).toBe("Before");
 await expect(withReservedCloudWriter(db,{...gm,role:"PLAYER"},userId,permit,async()=>true)).rejects.toThrow("FORBIDDEN");
 await expect(releaseCloudCampaignWriter(db,gm,userId,{...permit,originId:crypto.randomUUID()})).rejects.toThrow("CONFLICT");
});
it("keeps a nonempty inbox reserved until reconciliation is proved",async()=>{
 const a=await reserve();const e=createLocalEventEnvelope(origin,{sequence:"1",campaign_id:gm.campaignId,action_id:crypto.randomUUID(),membership_id:gm.membershipId,type:"SYNTHETIC",entity_type:"campaign",entity_id:null,entity_revision:null,payload:{},created_at:new Date(0).toISOString()});await storeCloudSyncBatch(db,gm,userId,originId,{version:1,hostId:origin.hostId,campaignId:gm.campaignId,events:[e],after:null,lastSequence:"1",hasMore:false,delivery:"NOT_CONFIGURED"});
 await expect(releaseCloudCampaignWriter(db,gm,userId,{campaignId:a.campaignId,revision:a.revision,originId:a.originId})).rejects.toThrow("RECONCILIATION_REQUIRED");
});
it("has an explicit installed fence for every campaign-owned and dependent transfer table",async()=>{
 const expected=campaignTransferCatalog().filter(t=>t.name==='campaigns'||t.policy!=='EXCLUDED_AUTH_RUNTIME'&&t.columns.some(c=>c.name==='campaign_id')||t.policy==='DEPENDENT').map(t=>t.name).sort();
 const rows=await db.execute<{name:string}>(sql`SELECT c.relname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname='campaign_writer_fence' ORDER BY c.relname`);expect(rows.map(r=>r.name)).toEqual(expected);expect(expected).toHaveLength(78);
});

it("preserves exact revision CAS above the JavaScript safe integer range",async()=>{
 await db.insert(schema.campaignWriterAuthorities).values({campaignId:gm.campaignId,revision:9007199254740993n,writer:"HOSTED"});
 const a=await reserve("9007199254740993");expect(a.revision).toBe("9007199254740994");
 await expect(reserve("9007199254740992")).rejects.toThrow("CONFLICT");
 expect((await releaseCloudCampaignWriter(db,gm,userId,{campaignId:a.campaignId,originId:a.originId,revision:a.revision})).revision).toBe("9007199254740995");
});
it("refuses a changed cloud baseline and a foreign origin before reserving",async()=>{
 await expect(reserveCloudCampaignWriter(db,gm,userId,{originId:crypto.randomUUID(),expectedRevision:"0",baselineSequence:"0"})).rejects.toThrow("BASELINE_CONFLICT");
 await db.insert(schema.gameEvents).values({campaignId:gm.campaignId,actionId:crypto.randomUUID(),membershipId:gm.membershipId,type:"SYNTHETIC",entityType:"campaign"});
 await expect(reserve()).rejects.toThrow("BASELINE_CONFLICT");expect(await db.select().from(schema.campaignWriterAuthorities)).toHaveLength(0);
});
