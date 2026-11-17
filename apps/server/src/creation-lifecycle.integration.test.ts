import { CREATION_HISTORY_PROBE_KEYS } from "../../../tests/helpers/campaign-isolation-routes.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { drizzle } from "drizzle-orm/pglite";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";
import { rehearseCreationMigration } from "../../../tests/helpers/uix461-migration-rehearsal.js";
import { registerCreationRoutes } from "./creation-routes.js";
import { registerCharacterPlayRoutes } from "./character-play-routes.js";
import { hashToken } from "./security.js";
import { env } from "./env.js";

const id = () => crypto.randomUUID();
describe("UIX-461 creation lifecycle", () => {
 it("creates, merges and disassembles an approved skill without double spending", async () => {
  const pgUrl = process.env.UIX461_SYNTHETIC_PG_URL;
  let pg: Awaited<ReturnType<typeof createMigratedPglite>> | undefined;
  let real: ReturnType<typeof schema.createDatabase> | undefined;
  let db: ReturnType<typeof schema.createDatabase>["db"];
  if (pgUrl) {
   const url = new URL(pgUrl);
   if (url.hostname !== "127.0.0.1" || !/^\/uix461_synthetic_[a-f0-9]{16}$/.test(url.pathname)) throw new Error("Refusing non-synthetic PostgreSQL target");
   real = schema.createDatabase(pgUrl);
   const tables = await real.client`select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S') limit 1`;
   if (tables.length) throw new Error("Refusing non-empty synthetic PostgreSQL database");
   await rehearseCreationMigration(real);
   db = real.db;
  } else { pg = await createMigratedPglite(); db = drizzle(pg, { schema }) as unknown as typeof db; }
  const app = Fastify();
  try {
   const campaignId=id(), gm=id(), player=id(), buyer=id(), characterId=id(), buyerCharacter=id(), packId=id(), templateId=id(), recipeId=id();
   const secrets = { gm:"g".repeat(40), player:"p".repeat(40), buyer:"b".repeat(40) };
   await db.insert(schema.campaigns).values({id:campaignId,name:"QA"});
   await db.insert(schema.memberships).values([{id:gm,campaignId,role:"GM",displayName:"GM"},{id:player,campaignId,role:"PLAYER",displayName:"Player"},{id:buyer,campaignId,role:"PLAYER",displayName:"Buyer"}]);
   await db.insert(schema.sessions).values([{membershipId:gm,tokenHash:hashToken(secrets.gm),expiresAt:new Date(Date.now()+120000)}, {membershipId:player,tokenHash:hashToken(secrets.player),expiresAt:new Date(Date.now()+120000)}, {membershipId:buyer,tokenHash:hashToken(secrets.buyer),expiresAt:new Date(Date.now()+120000)}]);
   await db.insert(schema.characters).values([{id:characterId,campaignId,ownerMembershipId:player,name:"Author",wallet:{gold:1,silver:0,copper:0,sp:10}},{id:buyerCharacter,campaignId,ownerMembershipId:buyer,name:"Buyer",wallet:{gold:1,silver:0,copper:0,sp:0}}]);
   // A pre-existing, non-workshop entry must never be adopted or rewritten by
   // any recipe, purchase, replay, or material operation in this scenario.
   const legacyId=id();
   await db.insert(schema.characterCatalogEntries).values({id:legacyId,characterId,kind:"SKILL",name:"Existing issued entry",description:"unchanged",data:{}});
   const [legacyBefore]=await db.select().from(schema.characterCatalogEntries).where(eq(schema.characterCatalogEntries.id,legacyId));
   await app.register(cookie); registerCreationRoutes(app,db as never,async()=>{});
   registerCharacterPlayRoutes(app,db as never,{to:()=>({emit:()=>{}})} as never,{broadcast:async()=>{},publishCharacter:async()=>{}});
   await app.ready();
   const request = async (who:"gm"|"player"|"buyer", path:string, payload:Record<string, unknown>, method:"POST"|"PUT"="POST") => {
    const response = await app.inject({method,url:`/api/creation/${path}`,headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets[who]}`,"x-creation-campaign":campaignId,"x-creation-membership":who==="gm"?gm:who==="player"?player:buyer},payload});
    expect(response.statusCode,`${path}: ${response.body}`).toBe(200); return response.json();
   };
   const metrics = {power:1,priceCopper:0,craftSp:0,usageCost:0}, zero={power:0,priceCopper:0,craftSp:0,usageCost:0};
   const range = {power:{min:0,max:100},priceCopper:{min:0,max:100},craftSp:{min:0,max:100},usageCost:{min:0,max:100}};
   const manual = {power:{min:0,max:0},priceCopper:{min:0,max:0},craftSp:{min:0,max:0},usageCost:{min:0,max:0}};
   const source={format:1,kind:"SKILL",name:"QA rules",description:"",slots:["ACTION","TARGET","SCHOOL","EFFECT","MODIFIER","LIMITATION"].map(slot=>({slot,min:slot==="EFFECT"?1:0,max:1})),components:[{id:"effect",name:"QA effect",description:"",slot:"EFFECT",tags:[],parameters:[],contribution:metrics,factorsBasisPoints:{power:10000,priceCopper:10000,craftSp:10000,usageCost:10000},requirements:[],materials:[],artifact:null,effects:[{kind:"MANUAL",text:"QA"}]}],compatibility:[],limits:range,manualAdjustment:manual,usageResource:null};
   const rules=await request("gm","rules/versions",{actionId:id(),packId,expectedRevision:null,source,publish:true});
   const design={name:"QA skill",lore:"",appearance:"",selections:[{componentId:"effect",parameters:{}}],adjustments:zero,adjustmentReason:""};
   const template=await request("player","templates/versions",{actionId:id(),templateId,expectedRevision:null,previousVersionId:null,ruleVersionId:rules.versionId,design});
   await request("gm","reviews",{actionId:id(),versionId:template.versionId,expectedRevision:null,decision:"APPROVED",reason:"QA"});
   await request("gm","store/policy",{actionId:id(),expectedRevision:null,reason:"QA",policy:{format:1,enabled:true,allowPlayerListings:true,
     allowedKinds:["SKILL"],minimumPriceCopper:0,maximumPriceCopper:100,commissionBasisPoints:2500}},"PUT");
   const listing=await request("player","store/listings",{actionId:id(),listingId:id(),expectedRevision:null,source:{format:1,
     versionId:template.versionId,mode:"TEMPLATE",recipeVersionId:null,priceCopper:8,payout:"AUTHOR",payoutCharacterId:characterId,
     collection:"",note:"",maxPurchases:null,availableUntil:null}});
   const shopQuote=await request("buyer","store/quote",{listingVersionId:listing.versionId,characterId:buyerCharacter,materialPicks:[]});
   expect(shopQuote).toMatchObject({priceCopper:8,authorIncomeCopper:6,sinkCopper:2,beneficiaryMembershipId:buyer});
   const shopCommand={actionId:id(),quoteId:shopQuote.id};
   const shopReceipt=await request("buyer","store/commit",shopCommand);
   expect(await request("buyer","store/commit",shopCommand)).toMatchObject({...shopReceipt,duplicate:true});
   const licences=await db.select().from(schema.creationLicences).where(eq(schema.creationLicences.ownerMembershipId,buyer));
   expect(licences).toHaveLength(1); expect(licences[0]).toMatchObject({versionId:template.versionId});
   const derivative=await request("buyer","templates/fork",{actionId:id(),templateId:id(),sourceVersionId:template.versionId,
     ruleVersionId:rules.versionId,name:"QA derivative"});
   expect(derivative).toMatchObject({sourceVersionId:template.versionId,sourceAuthorMembershipId:player,approval:null});
   const origins=await db.select().from(schema.creationTemplateOrigins).where(eq(schema.creationTemplateOrigins.templateId,derivative.templateId));
   expect(origins).toHaveLength(1); expect(origins[0]).toMatchObject({sourceVersionId:template.versionId});
   const [authorWallet]=await db.select().from(schema.characters).where(eq(schema.characters.id,characterId));
   const [buyerWallet]=await db.select().from(schema.characters).where(eq(schema.characters.id,buyerCharacter));
   expect(authorWallet?.wallet).toMatchObject({gold:1,silver:0,copper:6,sp:10});
   expect(buyerWallet?.wallet).toMatchObject({gold:0,silver:9,copper:2,sp:0});
   const recipeSource={format:1,name:"QA craft",reason:"QA",kind:"SKILL",operation:"CRAFT",inputs:[],output:{versionId:template.versionId,level:1,stage:"CRAFTED"},cost:{copper:7,sp:0,materials:[]},refund:null};
   const recipe=await request("gm","recipes/versions",{actionId:id(),recipeId,expectedRevision:null,source:recipeSource,publish:true});
   const foreignQuote=await app.inject({method:"POST",url:"/api/creation/operations/quote",headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets.buyer}`,
    "x-creation-campaign":campaignId,"x-creation-membership":buyer},payload:{characterId,recipeVersionId:recipe.versionId,inputObjectIds:[],materialPicks:[]}});
   expect(foreignQuote.statusCode,foreignQuote.body).toBe(403);
   const copyListing=await request("player","store/listings",{actionId:id(),listingId:id(),expectedRevision:null,source:{format:1,
     versionId:template.versionId,mode:"COPY",recipeVersionId:recipe.versionId,priceCopper:8,payout:"AUTHOR",payoutCharacterId:characterId,
     collection:"",note:"",maxPurchases:1,availableUntil:null}});
   const copyQuote=await request("buyer","store/quote",{listingVersionId:copyListing.versionId,characterId:buyerCharacter,materialPicks:[]});
   const competingCopyQuote=await request("buyer","store/quote",{listingVersionId:copyListing.versionId,characterId:buyerCharacter,materialPicks:[]});
   expect(copyQuote).toMatchObject({priceCopper:8,authorIncomeCopper:6,sinkCopper:2,total:{copper:15,sp:0,materials:[]}});
   const copyCommand={actionId:id(),quoteId:copyQuote.id};
   const competingCopyCommand={actionId:id(),quoteId:competingCopyQuote.id};
   let copyPurchase: Awaited<ReturnType<typeof request>>, winningCopyCommand=copyCommand;
   if (real) {
    const commit=(payload:{actionId:string;quoteId:string})=>app.inject({method:"POST",url:"/api/creation/store/commit",
     headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets.buyer}`,"x-creation-campaign":campaignId,"x-creation-membership":buyer},payload});
    const [first,secondAttempt]=await Promise.all([commit(copyCommand),commit(competingCopyCommand)]);
    expect([first.statusCode,secondAttempt.statusCode].sort()).toEqual([200,409]);
    winningCopyCommand=first.statusCode===200?copyCommand:competingCopyCommand;
    copyPurchase=(first.statusCode===200?first:secondAttempt).json();
   } else copyPurchase=await request("buyer","store/commit",copyCommand);
   expect(await request("buyer","store/commit",winningCopyCommand)).toMatchObject({...copyPurchase,duplicate:true});
   const soldOut=real ? null : await app.inject({method:"POST",url:"/api/creation/store/commit",headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets.buyer}`,
     "x-creation-campaign":campaignId,"x-creation-membership":buyer},payload:{actionId:id(),quoteId:competingCopyQuote.id}});
   if (soldOut) expect(soldOut.statusCode,soldOut.body).toBe(409);
   expect(await db.select().from(schema.creationPurchases).where(eq(schema.creationPurchases.listingVersionId,copyListing.versionId))).toHaveLength(1);
   expect(copyPurchase.operation.outputObjectId).toBeTruthy();
   const [copyObject]=await db.select().from(schema.creationObjects).where(eq(schema.creationObjects.id,copyPurchase.operation.outputObjectId));
   expect(copyObject).toMatchObject({characterId:buyerCharacter,paidBasis:{copper:7,sp:0,materials:[]}});
   const quote=await request("player","operations/quote",{characterId,recipeVersionId:recipe.versionId,inputObjectIds:[],materialPicks:[]});
   const actionId=id(), command={actionId,quoteId:quote.id};
   const created=await request("player","operations/commit",command); const replay=await request("player","operations/commit",command);
   expect(replay).toMatchObject({...created,duplicate:true});
   const objects=await db.select().from(schema.creationObjects).where(eq(schema.creationObjects.characterId,characterId));
   expect(objects).toHaveLength(1); expect(objects[0]).toMatchObject({characterId,status:"ACTIVE",level:1,stage:"CRAFTED"});
   // Read actual issued data in the owning context before checking isolation.
   const otherCampaign=id(), otherGm=id(), otherSecret="z".repeat(40);
   await db.insert(schema.campaigns).values({id:otherCampaign,name:"Foreign synthetic campaign"});
   await db.insert(schema.memberships).values({id:otherGm,campaignId:otherCampaign,role:"GM",displayName:"Foreign GM"});
   await db.insert(schema.sessions).values({membershipId:otherGm,tokenHash:hashToken(otherSecret),expiresAt:new Date(Date.now()+120000)});
   const read=(url:string,campaign:string,member:string,secret:string)=>app.inject({method:"GET",url,headers:{
     cookie:`${env.SESSION_COOKIE_NAME}=${secret}`,"x-creation-campaign":campaign,"x-creation-membership":member}});
   const probeIds: Record<(typeof CREATION_HISTORY_PROBE_KEYS)[number], string> = {
     "GET /api/creation/actions/:id": actionId,
     "GET /api/creation/objects/:id/lineage": created.outputObjectId,
     "GET /api/creation/recipes/:id/versions": recipeId,
     "GET /api/creation/rules/:id/versions": packId,
     "GET /api/creation/store/listings/:id/versions": listing.listingId,
     "GET /api/creation/templates/:id/versions": templateId,
     "GET /api/creation/versions/:id/reviews": template.versionId,
   };
   const gmOnly="GET /api/creation/recipes/:id/versions";
   for(const key of CREATION_HISTORY_PROBE_KEYS){
     const url=key.slice(4).replace(":id",probeIds[key]);
     const own=key===gmOnly ? await read(url,campaignId,gm,secrets.gm) : await read(url,campaignId,player,secrets.player);
     expect(own.statusCode,key).toBe(200);
     const foreign=await read(url,otherCampaign,otherGm,otherSecret);
     expect(foreign.statusCode,key).toBe(404);
     expect(foreign.json(),key).toMatchObject({error:"CREATION_UNAVAILABLE"});
   }
   const buyerRead=(path:string)=>read(`/api/creation/${path}`,campaignId,buyer,secrets.buyer);
   for(const path of [`actions/${actionId}`,`templates/${templateId}/versions`,`versions/${template.versionId}/reviews`]){
     expect((await buyerRead(path)).statusCode,path).toBe(404);
   }
   expect((await buyerRead(`recipes/${recipeId}/versions`)).statusCode).toBe(403);
   expect((await buyerRead(`objects/${created.outputObjectId}/lineage`)).statusCode).toBe(403);
   const buyerListing=await buyerRead(`store/listings/${listing.listingId}/versions`);
   expect(buyerListing.statusCode).toBe(200);
   expect(buyerListing.json().items[0]).not.toHaveProperty("source");
   const [character]=await db.select().from(schema.characters).where(eq(schema.characters.id,characterId));
   expect(character?.wallet).toMatchObject({gold:1,silver:0,copper:5,sp:10});
   const [entry] = await db.select().from(schema.characterCatalogEntries).where(eq(schema.characterCatalogEntries.id, created.entryId));
   expect(entry).toMatchObject({ characterId, name: "QA skill" });
   const secondQuote=await request("player","operations/quote",{characterId,recipeVersionId:recipe.versionId,inputObjectIds:[],materialPicks:[]});
   const second=await request("player","operations/commit",{actionId:id(),quoteId:secondQuote.id});
   const point={versionId:template.versionId,level:1,stage:"CRAFTED"};
   const mergedPoint={versionId:template.versionId,level:2,stage:"EVOLVING"};
   const mergeRecipe=await request("gm","recipes/versions",{actionId:id(),recipeId:id(),expectedRevision:null,publish:true,
     source:{format:1,name:"QA merge",reason:"QA",kind:"SKILL",operation:"MERGE",inputs:[point,point],output:mergedPoint,
       cost:{copper:0,sp:0,materials:[]},refund:null}});
   const mergeQuote=await request("player","operations/quote",{characterId,recipeVersionId:mergeRecipe.versionId,
     inputObjectIds:[created.outputObjectId,second.outputObjectId],materialPicks:[]});
   const competingMergeQuote=await request("player","operations/quote",{characterId,recipeVersionId:mergeRecipe.versionId,
     inputObjectIds:[created.outputObjectId,second.outputObjectId],materialPicks:[]});
   const mergeCommand={actionId:id(),quoteId:mergeQuote.id};
   let merged: Awaited<ReturnType<typeof request>>;
   if (real) {
    // Two connections compete to consume the same two immutable inputs.
    const commit = (payload: {actionId:string;quoteId:string}) => app.inject({method:"POST",url:"/api/creation/operations/commit",
     headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets.player}`,"x-creation-campaign":campaignId,"x-creation-membership":player},payload});
    const [first,secondAttempt]=await Promise.all([commit(mergeCommand),commit({actionId:id(),quoteId:competingMergeQuote.id})]);
    expect([first.statusCode,secondAttempt.statusCode].sort()).toEqual([200,409]);
    // Replay the actual winner, never assume the first request won the race.
    const winner = first.statusCode === 200 ? first : secondAttempt;
    merged=winner.json();
   } else merged=await request("player","operations/commit",mergeCommand);
   if (!real) expect(await request("player","operations/commit",mergeCommand)).toMatchObject({...merged,duplicate:true});
   const staleMerge=real ? null : await app.inject({method:"POST",url:"/api/creation/operations/commit",headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets.player}`,
     "x-creation-campaign":campaignId,"x-creation-membership":player},payload:{actionId:id(),quoteId:competingMergeQuote.id}});
   if (staleMerge) expect(staleMerge.statusCode,staleMerge.body).toBe(409);
   expect(await db.select().from(schema.creationOperations).where(inArray(schema.creationOperations.quoteId,[mergeQuote.id,competingMergeQuote.id]))).toHaveLength(1);
   expect(merged.consumedObjectIds.sort()).toEqual([created.outputObjectId,second.outputObjectId].sort());
   const parents=await db.select().from(schema.creationObjectEdges).where(eq(schema.creationObjectEdges.outputObjectId,merged.outputObjectId));
   expect(parents.map(row=>row.inputObjectId).sort()).toEqual([created.outputObjectId,second.outputObjectId].sort());
   expect(await db.select().from(schema.characterCatalogEntries).where(eq(schema.characterCatalogEntries.id,created.entryId))).toHaveLength(0);
   expect(await db.select().from(schema.characterCatalogEntries).where(eq(schema.characterCatalogEntries.id,second.entryId))).toHaveLength(0);
   const upgradedPoint={versionId:template.versionId,level:3,stage:"MASTERWORK"};
   const upgradeRecipe=await request("gm","recipes/versions",{actionId:id(),recipeId:id(),expectedRevision:null,publish:true,
     source:{format:1,name:"QA upgrade",reason:"QA",kind:"SKILL",operation:"UPGRADE",inputs:[mergedPoint],output:upgradedPoint,
       cost:{copper:0,sp:0,materials:[]},refund:null}});
   const upgradeQuote=await request("player","operations/quote",{characterId,recipeVersionId:upgradeRecipe.versionId,
     inputObjectIds:[merged.outputObjectId],materialPicks:[]});
   const upgraded=await request("player","operations/commit",{actionId:id(),quoteId:upgradeQuote.id});
   const lineage=await db.select().from(schema.creationObjectEdges).where(eq(schema.creationObjectEdges.outputObjectId,upgraded.outputObjectId));
   expect(lineage.map(row=>row.inputObjectId)).toEqual([merged.outputObjectId]);
   const disassembly = await request("gm", "recipes/versions", { actionId:id(), recipeId:id(), expectedRevision:null, publish:true,
    source:{format:1,name:"QA disassemble",reason:"QA",kind:"SKILL",operation:"DISASSEMBLE",
      inputs:[upgradedPoint],output:null,cost:{copper:0,sp:0,materials:[]},
      refund:{copperBasisPoints:5000,spBasisPoints:0,materialsBasisPoints:0}} });
   const copyDisassembly=await request("gm", "recipes/versions", { actionId:id(), recipeId:id(), expectedRevision:null, publish:true,
    source:{format:1,name:"QA copy disassemble",reason:"QA",kind:"SKILL",operation:"DISASSEMBLE",inputs:[point],output:null,
      cost:{copper:0,sp:0,materials:[]},refund:{copperBasisPoints:5000,spBasisPoints:0,materialsBasisPoints:0}} });
   const copyDismantleQuote=await request("buyer","operations/quote",{characterId:buyerCharacter,recipeVersionId:copyDisassembly.versionId,
     inputObjectIds:[copyPurchase.operation.outputObjectId],materialPicks:[]});
   expect(copyDismantleQuote.returns.copper).toBe(3);
   await request("buyer","operations/commit",{actionId:id(),quoteId:copyDismantleQuote.id});
   const [buyerAfterCopy]=await db.select().from(schema.characters).where(eq(schema.characters.id,buyerCharacter));
   expect(buyerAfterCopy?.wallet).toMatchObject({gold:0,silver:8,copper:0,sp:0});
   const dismantleQuote = await request("player", "operations/quote", { characterId, recipeVersionId:disassembly.versionId,
     inputObjectIds:[upgraded.outputObjectId], materialPicks:[] });
   expect(dismantleQuote.returns.copper).toBe(7);
   const dismantleCommand={actionId:id(),quoteId:dismantleQuote.id};
   const dismantled=await request("player", "operations/commit", dismantleCommand);
   expect(dismantled.consumedObjectIds).toEqual([upgraded.outputObjectId]);
   expect(await request("player", "operations/commit", dismantleCommand)).toMatchObject({...dismantled,duplicate:true});
   const [consumed] = await db.select().from(schema.creationObjects).where(eq(schema.creationObjects.id,upgraded.outputObjectId));
   expect(consumed?.status).toBe("CONSUMED");
   expect(await db.select().from(schema.characterCatalogEntries).where(eq(schema.characterCatalogEntries.id,upgraded.entryId))).toHaveLength(0);
   const [after] = await db.select().from(schema.characters).where(eq(schema.characters.id,characterId));
   expect(after?.wallet).toMatchObject({gold:1,silver:0,copper:5,sp:10});
   const baseId=id(), materialId=id(), baseStack=id(), materialStack=id();
   await db.insert(schema.worldContent).values([{id:baseId,slug:`base-${baseId}`,type:"ITEM",name:"QA base",lifecycle:"PUBLISHED"},
    {id:materialId,slug:`material-${materialId}`,type:"ITEM",name:"QA material",lifecycle:"PUBLISHED"}]);
   await db.insert(schema.worldContentInstances).values([{id:baseStack,campaignId,worldContentId:baseId,inventoryCharacterId:characterId,quantity:1,discovered:true},
    {id:materialStack,campaignId,worldContentId:materialId,inventoryCharacterId:characterId,quantity:3,discovered:true}]);
   const artifactRulesSource={...source,kind:"ARTIFACT",name:"QA artifacts",
    slots:["BASE","MATERIAL","CORE","EFFECT","MODIFIER","LIMITATION"].map(slot=>({slot,min:slot==="BASE"?1:0,max:1})),
    components:[{...source.components[0],id:"base",name:"QA base",slot:"BASE",materials:[{worldContentId:materialId,quantity:2}],
      artifact:{baseItemId:baseId,category:"RELIC",rarity:"QA"}}]};
   const artifactRules=await request("gm","rules/versions",{actionId:id(),packId:id(),expectedRevision:null,source:artifactRulesSource,publish:true});
   const artifactTemplate=await request("player","templates/versions",{actionId:id(),templateId:id(),expectedRevision:null,previousVersionId:null,
    ruleVersionId:artifactRules.versionId,design:{...design,name:"QA artifact",selections:[{componentId:"base",parameters:{}}]}});
   await request("gm","reviews",{actionId:id(),versionId:artifactTemplate.versionId,expectedRevision:null,decision:"APPROVED",reason:"QA"});
   const artifactPoint={versionId:artifactTemplate.versionId,level:1,stage:"CRAFTED"};
   const artifactRecipe=await request("gm","recipes/versions",{actionId:id(),recipeId:id(),expectedRevision:null,publish:true,
    source:{format:1,name:"QA artifact craft",reason:"QA",kind:"ARTIFACT",operation:"CRAFT",inputs:[],output:artifactPoint,
     cost:{copper:0,sp:0,materials:[{worldContentId:baseId,quantity:1},{worldContentId:materialId,quantity:2}]},refund:null}});
   const artifactQuote=await request("player","operations/quote",{characterId,recipeVersionId:artifactRecipe.versionId,inputObjectIds:[],
    materialPicks:[{instanceId:baseStack,quantity:1},{instanceId:materialStack,quantity:2}]});
   const artifact=await request("player","operations/commit",{actionId:id(),quoteId:artifactQuote.id});
   const [physical]=await db.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.id,artifact.instanceId));
   expect(physical).toMatchObject({worldContentId:baseId,inventoryCharacterId:characterId,quantity:1});
   // Transfer an existing artifact and its inventory instance together, then
   // return it so the lifecycle below can verify the original cost basis.
   const [oldBase]=await db.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.id,baseStack));
   const [remaining]=await db.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.id,materialStack));
   expect(oldBase).toMatchObject({quantity:0,inventoryCharacterId:null}); expect(remaining?.quantity).toBe(1);
   const artifactBreakdown=await request("gm","recipes/versions",{actionId:id(),recipeId:id(),expectedRevision:null,publish:true,
    source:{format:1,name:"QA artifact breakdown",reason:"QA",kind:"ARTIFACT",operation:"DISASSEMBLE",inputs:[artifactPoint],output:null,
     cost:{copper:0,sp:0,materials:[]},refund:{copperBasisPoints:0,spBasisPoints:0,materialsBasisPoints:5000}}});
   const artifactBreakdownQuote=await request("player","operations/quote",{characterId,recipeVersionId:artifactBreakdown.versionId,
    inputObjectIds:[artifact.outputObjectId],materialPicks:[]});
   expect(artifactBreakdownQuote.returns.materials).toEqual([{worldContentId:materialId,quantity:1}]);
   await request("player","operations/commit",{actionId:id(),quoteId:artifactBreakdownQuote.id});
   const [spentArtifact]=await db.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.id,artifact.instanceId));
   expect(spentArtifact).toMatchObject({quantity:0,inventoryCharacterId:null});
   const materialInstances=await db.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.worldContentId,materialId));
   expect(materialInstances.filter(item=>item.inventoryCharacterId===characterId).reduce((sum,item)=>sum+(item.quantity??0),0)).toBe(2);
   const consumableBase=id(),consumableMaterial=id();
   await db.insert(schema.worldContentInstances).values([{id:consumableBase,campaignId,worldContentId:baseId,inventoryCharacterId:characterId,quantity:1,discovered:true},
    {id:consumableMaterial,campaignId,worldContentId:materialId,inventoryCharacterId:characterId,quantity:2,discovered:true}]);
   const consumableRules=await request("gm","rules/versions",{actionId:id(),packId:id(),expectedRevision:null,publish:true,
    source:{...artifactRulesSource,name:"QA consumables",components:[{...artifactRulesSource.components[0],
      artifact:{baseItemId:baseId,category:"CONSUMABLE",rarity:"QA"},effects:[{kind:"ACTIVATION"},{kind:"CONSUME_ITEM"}]}]}});
   const consumableTemplate=await request("player","templates/versions",{actionId:id(),templateId:id(),expectedRevision:null,previousVersionId:null,
    ruleVersionId:consumableRules.versionId,design:{...design,name:"QA consumable",selections:[{componentId:"base",parameters:{}}]}});
   await request("gm","reviews",{actionId:id(),versionId:consumableTemplate.versionId,expectedRevision:null,decision:"APPROVED",reason:"QA"});
   const consumableRecipe=await request("gm","recipes/versions",{actionId:id(),recipeId:id(),expectedRevision:null,publish:true,
    source:{format:1,name:"QA consumable craft",reason:"QA",kind:"ARTIFACT",operation:"CRAFT",inputs:[],
     output:{versionId:consumableTemplate.versionId,level:1,stage:"CRAFTED"},
     cost:{copper:0,sp:0,materials:[{worldContentId:baseId,quantity:1},{worldContentId:materialId,quantity:2}]},refund:null}});
   const consumableQuote=await request("player","operations/quote",{characterId,recipeVersionId:consumableRecipe.versionId,inputObjectIds:[],
    materialPicks:[{instanceId:consumableBase,quantity:1},{instanceId:consumableMaterial,quantity:2}]});
   const consumable=await request("player","operations/commit",{actionId:id(),quoteId:consumableQuote.id});
   const useAction=id(), usePayload={actionId:useAction,visibility:"PUBLIC"};
   const use=()=>app.inject({method:"POST",url:`/api/characters/${characterId}/catalog/${consumable.entryId}/roll`,
    headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets.player}`},payload:usePayload});
   const used=await use(); expect(used.statusCode,used.body).toBe(201);
   const retried=await use(); expect(retried.statusCode,retried.body).toBe(200);
   // The published character-roll replay contract returns only duplicate;
   // the durable event below independently verifies the original action ID.
   expect(retried.json()).toEqual({duplicate:true});
   expect(await db.select().from(schema.characterCatalogEntries).where(eq(schema.characterCatalogEntries.id,consumable.entryId))).toHaveLength(0);
   const [usedObject]=await db.select().from(schema.creationObjects).where(eq(schema.creationObjects.id,consumable.outputObjectId));
   const [usedItem]=await db.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.id,consumable.instanceId));
   expect(usedObject?.status).toBe("CONSUMED"); expect(usedItem).toMatchObject({quantity:0,inventoryCharacterId:null});
   expect(await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.actionId,useAction))).toHaveLength(1);
   const newAction=id();
   const attemptedAgain=await app.inject({method:"POST",url:`/api/characters/${characterId}/catalog/${consumable.entryId}/roll`,
    headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets.player}`},payload:{actionId:newAction,visibility:"PUBLIC"}});
   expect(attemptedAgain.statusCode).toBe(403);
   expect(await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.actionId,newAction))).toHaveLength(0);
   const [legacyAfter]=await db.select().from(schema.characterCatalogEntries).where(eq(schema.characterCatalogEntries.id,legacyId));
   expect(legacyAfter).toEqual(legacyBefore);
  } finally { await app.close(); await pg?.close(); await real?.client.end(); }
 }, 30000);
});
