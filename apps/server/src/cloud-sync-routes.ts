import {readCloudApplicationWithGrant} from "./cloud-sync-application-receipt.js";
import {readCloudSyncSourceStatus} from "./cloud-sync-status.js";
import {cloudSyncStatusCursorSchema} from "@arken/contracts";
import {isSecureCloudSyncTransport} from "./cloud-sync-transport.js";
import type {FastifyInstance,FastifyRequest,FastifyReply} from "fastify";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {env} from "./env.js";
import {issueCloudReceiptReadGrant,connectCloudSyncSource,issueCloudSyncGrant,revokeCloudSyncGrant,storeCloudSyncBatchWithGrant,registerCloudSyncSource,storeCloudSyncBatch} from "./cloud-sync-staging.js";
type Database=Parameters<typeof registerCloudSyncSource>[0];
type AccountGuard=(request:FastifyRequest,reply:FastifyReply)=>Promise<{userId:string}|null>;
/** Account+CSRF control plane and scoped bearer intake; no device-key identity or state apply. */
export function registerCloudSyncRoutes(app:FastifyInstance,db:Database,accountGuard:AccountGuard){
 if(!env.CLOUD_SYNC_STAGING_ENABLED||env.DEPLOYMENT_MODE!=="HOSTED")return;
 app.addHook("onSend",async(request,reply,payload)=>{if(request.url.startsWith("/api/cloud-sync/"))reply.header("Cache-Control","no-store");return payload;});
 const scoped=z.object({campaignId:z.string().uuid()});
 const failure=(reply:FastifyReply,error:unknown)=>{
   const message=error instanceof Error?error.message:"";
   let constraintConflict=false,current:unknown=error;
   for(let i=0;i<4&&current&&typeof current==="object";i++){if("code"in current&&current.code==="23505")constraintConflict=true;current="cause"in current?current.cause:undefined;}
   const status=(message==="CLOUD_SYNC_FORBIDDEN"||message==="CAMPAIGN_WRITER_FORBIDDEN")?403:message.includes("CONFLICT")||constraintConflict?409:message.includes("TOO_LARGE")?413:error instanceof z.ZodError||message.startsWith("LOCAL_EVENT_")?400:500;
   return reply.code(status).send({error:status===403?"CLOUD_SYNC_FORBIDDEN":status===409?"CLOUD_SYNC_CONFLICT":status===413?"SYNC_PACKAGE_TOO_LARGE":status===400?"INVALID_SYNC_PACKAGE":"CLOUD_SYNC_FAILED"});
 };
 const run=async(request:FastifyRequest,reply:FastifyReply,operation:(auth:{campaignId:string;membershipId:string;role:"GM";displayName:string},userId:string)=>Promise<unknown>)=>{
  reply.header("Cache-Control","no-store");
  const account=await accountGuard(request,reply);if(!account)return;
  try{
   const {campaignId}=scoped.passthrough().parse(request.body);
   const [member]=await db.execute<{id:string;display_name:string}>(sql`SELECT id,display_name FROM memberships WHERE campaign_id=${campaignId} AND user_id=${account.userId} AND role='GM' AND access_revoked_at IS NULL LIMIT 1`);
   if(!member)return reply.code(403).send({error:"CLOUD_SYNC_FORBIDDEN"});
   return await operation({campaignId,membershipId:member.id,role:"GM",displayName:member.display_name},account.userId);
  }catch(error){return failure(reply,error);
  }
 };
 const errorHandler=(error:{statusCode?:number},_request:FastifyRequest,reply:FastifyReply)=>{
  const status=error.statusCode===413?413:error.statusCode===429?429:error.statusCode===400?400:500;
  return reply.code(status).send({error:status===413?"SYNC_PACKAGE_TOO_LARGE":status===429?"RATE_LIMITED":status===500?"CLOUD_SYNC_FAILED":"INVALID_SYNC_REQUEST"});
 };
 app.post("/api/account/cloud-sync/connect",{bodyLimit:4096,config:{rateLimit:{max:20,timeWindow:"1 minute"}},errorHandler},async(request,reply)=>run(request,reply,async(auth,userId)=>{
  const body=scoped.extend({origin:z.unknown()}).strict().parse(request.body);return connectCloudSyncSource(db,auth,userId,body.origin);
 }));
 app.post("/api/account/cloud-sync/receipt-read-grant",{bodyLimit:4096,config:{rateLimit:{max:5,timeWindow:"1 minute"}},errorHandler},async(request,reply)=>run(request,reply,async(auth,userId)=>{
  const body=scoped.extend({origin:z.unknown()}).strict().parse(request.body);
  if(env.NODE_ENV==="production"&&!isSecureCloudSyncTransport(request,env.CLOUD_SYNC_TRUSTED_PROXY_IPS))return reply.code(426).send({error:"TLS_REQUIRED"});
  return issueCloudReceiptReadGrant(db,auth,userId,body.origin);
 }));
 app.post("/api/account/cloud-sync/sources",{bodyLimit:8192,config:{rateLimit:{max:20,timeWindow:"1 minute"}},errorHandler},async(request,reply)=>run(request,reply,async(auth,userId)=>{
  const body=scoped.extend({origin:z.unknown()}).strict().parse(request.body);return registerCloudSyncSource(db,auth,userId,body.origin);
 }));
 app.post("/api/account/cloud-sync/sources/:originId/batches",{bodyLimit:1024*1024+4096,config:{rateLimit:{max:120,timeWindow:"1 minute"}},errorHandler},async(request,reply)=>run(request,reply,async(auth,userId)=>{
  const {originId}=z.object({originId:z.string().uuid()}).strict().parse(request.params),body=scoped.extend({batch:z.unknown()}).strict().parse(request.body);
  return storeCloudSyncBatch(db,auth,userId,originId,body.batch);
 }));
 app.post("/api/account/cloud-sync/sources/:originId/status",{bodyLimit:4096,config:{rateLimit:{max:20,timeWindow:"1 minute"}},errorHandler},async(request,reply)=>run(request,reply,async(auth,userId)=>{
  const body=scoped.extend({after:cloudSyncStatusCursorSchema.optional()}).strict().parse(request.body),{originId}=z.object({originId:z.string().uuid()}).strict().parse(request.params);
  return readCloudSyncSourceStatus(db,auth,userId,originId,body.after?{after:body.after}:{});
 }));
 app.post("/api/account/cloud-sync/sources/:originId/grant",{bodyLimit:4096,config:{rateLimit:{max:10,timeWindow:"1 minute"}},errorHandler},async(request,reply)=>run(request,reply,async(auth,userId)=>{
  scoped.strict().parse(request.body);const {originId}=z.object({originId:z.string().uuid()}).parse(request.params);
  if(env.NODE_ENV==="production"&&!isSecureCloudSyncTransport(request,env.CLOUD_SYNC_TRUSTED_PROXY_IPS))return reply.code(426).send({error:"TLS_REQUIRED"});
  return issueCloudSyncGrant(db,auth,userId,originId);
 }));
 app.post("/api/account/cloud-sync/sources/:originId/grant/revoke",{bodyLimit:4096,config:{rateLimit:{max:20,timeWindow:"1 minute"}},errorHandler},async(request,reply)=>run(request,reply,async(auth,userId)=>{
  scoped.strict().parse(request.body);const {originId}=z.object({originId:z.string().uuid()}).parse(request.params);return revokeCloudSyncGrant(db,auth,userId,originId);
 }));
 app.post("/api/cloud-sync/sources/:originId/receipts/:receiptId/application",{bodyLimit:4096,config:{rateLimit:{max:60,timeWindow:"1 minute"}},errorHandler},async(request,reply)=>{
  if(env.NODE_ENV==="production"&&!isSecureCloudSyncTransport(request,env.CLOUD_SYNC_TRUSTED_PROXY_IPS))return reply.code(426).send({error:"TLS_REQUIRED"});
  if(request.headers.origin&&request.headers.origin!==env.WEB_ORIGIN)return reply.code(403).send({error:"ORIGIN_FORBIDDEN"});
  const match=typeof request.headers.authorization==="string"?/^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization):null;
  if(!match)return reply.code(401).send({error:"SYNC_GRANT_REQUIRED"});
  try{
   const {originId,receiptId}=z.object({originId:z.string().uuid(),receiptId:z.string().uuid()}).strict().parse(request.params);z.object({}).strict().parse(request.body);
   return await readCloudApplicationWithGrant(db,originId,match[1]!,receiptId);
  }catch(error){return failure(reply,error);}
 });
 app.post("/api/cloud-sync/sources/:originId/batches",{bodyLimit:1024*1024+4096,config:{rateLimit:{max:120,timeWindow:"1 minute"}},errorHandler},async(request,reply)=>{
  if(env.NODE_ENV==="production"&&!isSecureCloudSyncTransport(request,env.CLOUD_SYNC_TRUSTED_PROXY_IPS))return reply.code(426).send({error:"TLS_REQUIRED"});
  if(request.headers.origin&&request.headers.origin!==env.WEB_ORIGIN)return reply.code(403).send({error:"ORIGIN_FORBIDDEN"});
  const match=typeof request.headers.authorization==="string"?/^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization):null;
  if(!match)return reply.code(401).send({error:"SYNC_GRANT_REQUIRED"});
  try{
   const {originId}=z.object({originId:z.string().uuid()}).strict().parse(request.params),{batch}=z.object({batch:z.unknown()}).strict().parse(request.body);
   return await storeCloudSyncBatchWithGrant(db,originId,match[1]!,batch);
  }catch(error){return failure(reply,error);}

 });

}
