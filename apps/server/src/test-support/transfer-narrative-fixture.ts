import Fastify from 'fastify';import cookie from '@fastify/cookie';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {eq} from 'drizzle-orm';import * as schema from '@arken/db';
import {registerStoryRoutes} from '../story.js';import {registerPlayerRequestRoutes} from '../player-requests.js';import {env} from '../env.js';import {hashToken,randomToken} from '../security.js';
type Database=Parameters<typeof registerStoryRoutes>[1];
export async function seedTransferNarrative(db:Database,campaignId:string,gm:string){
 const [campaign]=await db.select().from(schema.campaigns).where(eq(schema.campaigns.id,campaignId));const [owner]=await db.select().from(schema.memberships).where(eq(schema.memberships.id,gm));if(!campaign?.name.startsWith('Synthetic')||owner?.campaignId!==campaignId||owner.role!=='GM'||!owner.userId)throw Error('SYNTHETIC_NARRATIVE_SCOPE_REQUIRED');
 const user=randomUUID(),player=randomUUID();await db.insert(schema.users).values({id:user,identityKind:'HOSTED',hostedLogin:'nr-'+user.replaceAll('-',''),hostedApprovedAt:new Date(),passwordHash:'synthetic'});await db.insert(schema.memberships).values({id:player,campaignId,userId:user,role:'PLAYER',displayName:'Synthetic author'});
 const tokens={gm:randomToken(),player:randomToken()};for(const role of ['gm','player'] as const){const accountSessionId=randomUUID();await db.insert(schema.accountSessions).values({id:accountSessionId,userId:role==='gm'?owner.userId:user,tokenHash:hashToken(randomToken()),csrfHash:hashToken(randomToken()),expiresAt:new Date(Date.now()+3600000)});await db.insert(schema.sessions).values({membershipId:role==='gm'?gm:player,accountSessionId,authSource:'ACCOUNT',tokenHash:hashToken(tokens[role]),expiresAt:new Date(Date.now()+3600000)});}
 const io={to(){return this;},emit(){}};const app=Fastify();await app.register(cookie);registerStoryRoutes(app,db,io as never);registerPlayerRequestRoutes(app,db,io as never);
 const request=async(role:keyof typeof tokens,url:string,payload:Record<string,unknown>,method:'POST'|'PATCH'='POST')=>{const response=await app.inject({method,url,headers:{cookie:`${env.SESSION_COOKIE_NAME}=${tokens[role]}`},payload});assert.ok([200,201].includes(response.statusCode),response.statusCode+': '+response.body);return response.json();};
 try{
  const body={actionId:randomUUID(),title:'Synthetic chronicle',body:'Synthetic narrative text',gmNotes:'SYNTHETIC_GM_NARRATIVE_SECRET',entityLinks:[],media:[]};let post=await request('gm','/api/story/posts',body);assert.deepEqual(await request('gm','/api/story/posts',body),post);const postId=post.id;
  post=await request('gm','/api/story/posts/'+postId,{actionId:randomUUID(),revision:post.revision,title:'Synthetic corrected title'},'PATCH');
  for(const transition of ['publish','archive'])post=await request('gm',`/api/story/posts/${postId}/${transition}`,{actionId:randomUUID(),revision:post.revision});
  const create=()=>request('player','/api/player-requests',{actionId:randomUUID(),audience:'GM_ONLY',horizon:'NEXT_SESSION',title:'Synthetic request',body:'Synthetic request body'});
  let ask=await create();const requestId=ask.id;ask=await request('player','/api/player-requests/'+requestId,{actionId:randomUUID(),revision:ask.revision,title:'Synthetic revised request',body:'Synthetic revised body'},'PATCH');
  for(const action of ['ACKNOWLEDGE','RESOLVE'])ask=await request('gm',`/api/player-requests/${requestId}/actions`,{actionId:randomUUID(),revision:ask.revision,action});
  const cancel=await create();await request('player',`/api/player-requests/${cancel.id}/actions`,{actionId:randomUUID(),revision:cancel.revision,action:'CANCEL'});
  const decline=await create();await request('gm',`/api/player-requests/${decline.id}/actions`,{actionId:randomUUID(),revision:decline.revision,action:'DECLINE'});
  return {postId,requestIds:[requestId,cancel.id,decline.id],player};
 }finally{await app.close();}
}
