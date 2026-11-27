import {registerSessionRoutes} from "../session-routes.js";
import Fastify from 'fastify';import cookie from '@fastify/cookie';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {eq} from 'drizzle-orm';import * as schema from '@arken/db';
import {registerAccessRoutes} from '../access-routes.js';import {rechargeCharacterEntry} from '../entry-recharge-command.js';import {cancelAbilityArea} from '../ability-area-state.js';import {env} from '../env.js';import {hashToken,randomToken} from '../security.js';
type Database=Parameters<typeof registerAccessRoutes>[1];
export async function seedTransferControl(db:Database,campaignId:string,gm:string){
 const [campaign]=await db.select().from(schema.campaigns).where(eq(schema.campaigns.id,campaignId)),[owner]=await db.select().from(schema.memberships).where(eq(schema.memberships.id,gm));if(!campaign?.name.startsWith('Synthetic')||owner?.campaignId!==campaignId||owner.role!=='GM'||!owner.userId)throw Error('SYNTHETIC_CONTROL_SCOPE_REQUIRED');
 const session=randomUUID(),token=randomToken();await db.insert(schema.accountSessions).values({id:session,userId:owner.userId,tokenHash:hashToken(randomToken()),csrfHash:hashToken(randomToken()),expiresAt:new Date(Date.now()+3600000)});await db.insert(schema.sessions).values({membershipId:gm,accountSessionId:session,authSource:'ACCOUNT',tokenHash:hashToken(token),expiresAt:new Date(Date.now()+3600000)});
 const character=randomUUID(),entry=randomUUID();await db.insert(schema.characters).values({id:character,campaignId,name:'Synthetic access character'});await db.insert(schema.characterCatalogEntries).values({id:entry,characterId:character,kind:'ABILITY',name:'Synthetic recharge',data:{uses:{current:0,max:3,recharge:'DAY'}}});
 const app=Fastify();await app.register(cookie);const io={in(){return {disconnectSockets(){}}}};registerAccessRoutes(app,db,io as never);registerSessionRoutes(app,db,io as never);
 const request=async(url:string,payload:Record<string,unknown>)=>{const response=await app.inject({method:'POST',url,headers:{cookie:`${env.SESSION_COOKIE_NAME}=${token}`},payload});assert.ok([200,201,204].includes(response.statusCode),response.statusCode+': '+response.body);return response.statusCode===204?null:response.json();};
 try{
  const create=()=>request('/api/invites',{actionId:randomUUID(),characterId:character,label:'Synthetic player access'});
  const first=await create();const reused=await create();assert.equal(reused.grant.id,first.grant.id);assert.equal(reused.url,null);
  const rotated=await request(`/api/player-access/${first.grant.id}/rotate`,{actionId:randomUUID(),revision:reused.grant.revision});await request(`/api/player-access/${first.grant.id}/revoke`,{actionId:randomUUID()});const reactivated=await create();assert.equal(reactivated.grant.id,first.grant.id);
  const legacyInvite=randomUUID();await db.insert(schema.invites).values({id:legacyInvite,campaignId,characterId:character,label:'Synthetic legacy invite',tokenHash:hashToken(randomToken()),expiresAt:new Date(Date.now()+3600000)});await request(`/api/invites/${legacyInvite}/revoke`,{actionId:randomUUID()});
  const auth={campaignId,membershipId:gm,role:'GM' as const,displayName:owner.displayName};await rechargeCharacterEntry(db,auth,character,entry,{actionId:randomUUID(),revision:0});
  const cancel={actionId:randomUUID(),characterId:character,entryId:entry,entryRevision:1,sceneId:randomUUID(),sceneRevision:0,casterTokenId:randomUUID(),casterTokenRevision:0};await cancelAbilityArea(db,auth,cancel);await cancelAbilityArea(db,auth,cancel);
  const nextGmToken=randomToken();await db.insert(schema.gmAccessCredentials).values({campaignId,tokenHash:hashToken(randomToken())}).onConflictDoNothing();await request('/api/gm-access/rotate',{actionId:randomUUID(),token:nextGmToken});
  return {character,entry,grant:first.grant.id,legacyInvite,cancelActionId:cancel.actionId,member:first.grant.membershipId,syntheticPrivateValues:[first.url,rotated.url,reactivated.url,nextGmToken].filter((url):url is string=>typeof url==='string')};
 }finally{await app.close();}
}
