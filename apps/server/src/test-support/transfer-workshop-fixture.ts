import Fastify from "fastify";
import cookie from "@fastify/cookie";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import * as schema from "@arken/db";
import {registerCreationRoutes} from "../creation-routes.js";
import {env} from "../env.js";
import {hashToken,randomToken} from "../security.js";
type Database=Parameters<typeof registerCreationRoutes>[1];
/** Synthetic-only fixture shared by PGlite and native transfer qualification.
 * Uses real account-bound cookies and workshop APIs; no made-up licence rows. */
export async function seedTransferWorkshop(db:Database,campaignId:string,gm:string){
 const [campaign]=await db.select().from(schema.campaigns).where(eq(schema.campaigns.id,campaignId));
 if(!campaign?.name.startsWith("Synthetic"))throw Error("SYNTHETIC_WORKSHOP_REQUIRED");
 const player=randomUUID(),buyer=randomUUID(),authorCharacter=randomUUID(),buyerCharacter=randomUUID();
 await db.insert(schema.memberships).values([{id:player,campaignId,role:"PLAYER",displayName:"Synthetic author"},{id:buyer,campaignId,role:"PLAYER",displayName:"Synthetic buyer"}]);
 const memberIds={gm,player,buyer},tokens:{gm:string;player:string;buyer:string}={gm:randomToken(),player:randomToken(),buyer:randomToken()};
 for(const role of ["gm","player","buyer"] as const){
  const member=memberIds[role];let userId:string;
  if(role==="gm"){const [row]=await db.select().from(schema.memberships).where(eq(schema.memberships.id,gm));if(!row?.userId)throw Error("SYNTHETIC_ACCOUNT_GM_REQUIRED");userId=row.userId;}
  else{userId=randomUUID();await db.insert(schema.users).values({id:userId,identityKind:"HOSTED",hostedLogin:"cw-"+userId.replaceAll("-",""),hostedApprovedAt:new Date(),passwordHash:"synthetic"});await db.update(schema.memberships).set({userId}).where(eq(schema.memberships.id,member));}
  const accountSessionId=randomUUID();await db.insert(schema.accountSessions).values({id:accountSessionId,userId,tokenHash:hashToken(randomToken()),csrfHash:hashToken(randomToken()),expiresAt:new Date(Date.now()+3600000)});await db.insert(schema.sessions).values({membershipId:member,accountSessionId,authSource:"ACCOUNT",tokenHash:hashToken(tokens[role]),expiresAt:new Date(Date.now()+3600000)});
 }
 await db.insert(schema.characters).values([{id:authorCharacter,campaignId,ownerMembershipId:player,name:"Synthetic author",wallet:{gold:1,silver:0,copper:0,sp:10}},{id:buyerCharacter,campaignId,ownerMembershipId:buyer,name:"Synthetic buyer",wallet:{gold:1,silver:0,copper:0,sp:0}}]);
 const app=Fastify();await app.register(cookie);registerCreationRoutes(app,db,async()=>{});
 const request=async(role:keyof typeof memberIds,path:string,payload:Record<string,unknown>,method:"POST"|"PUT"="POST")=>{const response=await app.inject({method,url:"/api/creation/"+path,headers:{cookie:`${env.SESSION_COOKIE_NAME}=${tokens[role]}`,"x-creation-campaign":campaignId,"x-creation-membership":memberIds[role]},payload});assert.equal(response.statusCode,200,response.body);return response.json();};
 try{
  const zero={power:0,priceCopper:0,craftSp:0,usageCost:0},range={power:{min:0,max:100},priceCopper:{min:0,max:100},craftSp:{min:0,max:100},usageCost:{min:0,max:100}},manual={power:{min:0,max:0},priceCopper:{min:0,max:0},craftSp:{min:0,max:0},usageCost:{min:0,max:0}};
  const rule=await request("gm","rules/versions",{actionId:randomUUID(),packId:randomUUID(),expectedRevision:null,publish:true,source:{format:1,kind:"SKILL",name:"Synthetic transfer rules",description:"",slots:["ACTION","TARGET","SCHOOL","EFFECT","MODIFIER","LIMITATION"].map(slot=>({slot,min:slot==="EFFECT"?1:0,max:1})),components:[{id:"effect",name:"Synthetic effect",description:"",slot:"EFFECT",tags:[],parameters:[],contribution:{...zero,power:1},factorsBasisPoints:{power:10000,priceCopper:10000,craftSp:10000,usageCost:10000},requirements:[],materials:[],artifact:null,effects:[{kind:"MANUAL",text:"Synthetic"}]}],compatibility:[],limits:range,manualAdjustment:manual,usageResource:null}});
  const template=await request("player","templates/versions",{actionId:randomUUID(),templateId:randomUUID(),expectedRevision:null,previousVersionId:null,ruleVersionId:rule.versionId,design:{name:"Synthetic transfer skill",lore:"",appearance:"",selections:[{componentId:"effect",parameters:{}}],adjustments:zero,adjustmentReason:""}});
  await request("gm","reviews",{actionId:randomUUID(),versionId:template.versionId,expectedRevision:null,decision:"APPROVED",reason:"Synthetic"});
  const recipe=await request("gm","recipes/versions",{actionId:randomUUID(),recipeId:randomUUID(),expectedRevision:null,publish:true,source:{format:1,name:"Synthetic craft",reason:"Synthetic",kind:"SKILL",operation:"CRAFT",inputs:[],output:{versionId:template.versionId,level:1,stage:"CRAFTED"},cost:{copper:0,sp:0,materials:[]},refund:null}});
  const operationQuote=await request("player","operations/quote",{characterId:authorCharacter,recipeVersionId:recipe.versionId,inputObjectIds:[],materialPicks:[]});
  await request("gm","store/policy",{actionId:randomUUID(),expectedRevision:null,reason:"Synthetic",policy:{format:1,enabled:true,allowPlayerListings:true,allowedKinds:["SKILL"],minimumPriceCopper:0,maximumPriceCopper:100,commissionBasisPoints:2500}},"PUT");
  const listing=await request("player","store/listings",{actionId:randomUUID(),listingId:randomUUID(),expectedRevision:null,source:{format:1,versionId:template.versionId,mode:"TEMPLATE",recipeVersionId:null,priceCopper:8,payout:"AUTHOR",payoutCharacterId:authorCharacter,collection:"",note:"",maxPurchases:null,availableUntil:null}});
  const shopQuote=await request("buyer","store/quote",{listingVersionId:listing.versionId,characterId:buyerCharacter,materialPicks:[]});const command={actionId:randomUUID(),quoteId:shopQuote.id},receipt=await request("buyer","store/commit",command);assert.equal((await request("buyer","store/commit",command)).duplicate,true);
  const derivative=await request("buyer","templates/fork",{actionId:randomUUID(),templateId:randomUUID(),sourceVersionId:template.versionId,ruleVersionId:rule.versionId,name:"Synthetic derivative"});
  return {player,buyer,authorCharacter,buyerCharacter,rule,template,recipe,operationQuote,shopQuote,receipt,derivative};
 }finally{await app.close();}
}
