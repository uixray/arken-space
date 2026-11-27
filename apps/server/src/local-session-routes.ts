import {inspectLocalOutboxCoverage} from "./local-outbox-coverage.js";
import {createLocalCloudConnection} from "./local-cloud-connection.js";
import {localAuthoritySchema,localCloudScopeCursorSchema,localPeerRequestSchema} from "@arken/contracts";
import {submitLocalTokenPreview,type LocalPreviewDelivery} from "./local-token-preview-submit.js";
import {pollLocalTokenPreviews} from "./local-token-preview-poll.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "./env.js";
import { requireAuth } from "./auth.js";
import { getLocalAuthorityStatus,issueLocalPairing,redeemLocalPairing,revokeLocalPeer,startLocalAuthority,stopLocalAuthority } from "./local-session-authority.js";
import { executeLocalPeerRequest } from "./local-session-gateway.js";

type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Loopback host control plane. Does not expose the local HTTP server to LAN. */
export function registerLocalSessionRoutes(app:FastifyInstance,db:Database,onChanged:(campaignId:string)=>Promise<void>,onPreview:LocalPreviewDelivery=()=>undefined,cloudConnection=createLocalCloudConnection()){
  if(env.DEPLOYMENT_MODE!=="LOCAL_HOST"||!env.LOCAL_SESSION_BRIDGE_ENABLED)return;
  const ownerOptions={bodyLimit:4096,config:{rateLimit:{max:20,timeWindow:"1 minute"}}};
  app.addHook("onRequest",async(request,reply)=>{
    if(!request.url.startsWith("/api/local-session/"))return;
    reply.header("Cache-Control","no-store");
    // Host/remote-address restrictions also apply in server-runtime.
    if(request.headers.origin!==env.WEB_ORIGIN)return reply.code(403).send({error:"ORIGIN_FORBIDDEN"});
  });
  for(const action of ["status","save","forget","send","scopes","check","history"] as const)app.post(`/api/local-session/cloud/${action}`,{...ownerOptions,bodyLimit:16384},async(request,reply)=>{
    const auth=await requireAuth(request,reply,db);if(!auth)return;
    try{
      if(action==="scopes"){const body=z.object({after:localCloudScopeCursorSchema.optional()}).strict().parse(request.body);return await cloudConnection.scopes(db,auth,body.after);}
      if(action==="history"){const body=z.object({scope:localAuthoritySchema.optional(),after:z.string().uuid().optional()}).strict().parse(request.body);return cloudConnection.history(db,auth,body.scope,body.after);}
      const selected=z.object({scope:localAuthoritySchema.optional()});
      if(action==="save"){const body=selected.extend({grant:z.unknown()}).strict().parse(request.body);return await cloudConnection.save(db,auth,body.grant,body.scope);}
      const body=selected.strict().parse(request.body);return await cloudConnection[action](db,auth,body.scope);
    }catch(error){const message=error instanceof Error?error.message:"";const status=(message==="LOCAL_SESSION_FORBIDDEN"||message==="LOCAL_CLOUD_READ_ONLY_GRANT")?403:error instanceof z.ZodError||message==="LOCAL_GRANT_SCOPE_MISMATCH"||message==="LOCAL_GRANT_EXPIRED_OR_INVALID"?400:message==="LOCAL_CLOUD_STORE_UNAVAILABLE"?503:500;
      return reply.code(status).send({error:"LOCAL_CLOUD_CONNECTION_FAILED"});}
  });
  app.post("/api/local-session/cloud/preflight",{...ownerOptions,config:{rateLimit:{max:3,timeWindow:"1 minute"}}},async(request,reply)=>{
    const auth=await requireAuth(request,reply,db);if(!auth)return;
    if(!z.object({}).strict().safeParse(request.body).success)return reply.code(400).send({error:"INVALID_PREFLIGHT_REQUEST"});
    try{return await inspectLocalOutboxCoverage(db,auth);}catch(error){
      const status=error instanceof Error&&error.message==="LOCAL_SESSION_FORBIDDEN"?403:503;
      return reply.code(status).send({error:"LOCAL_PREFLIGHT_UNAVAILABLE"});
    }
  });
  app.post("/api/local-session/start",ownerOptions,async(request,reply)=>{
    const auth=await requireAuth(request,reply,db);if(!auth)return;
    const body=z.object({expectedEpoch:z.number().int().min(0).max(2147483646)}).strict().parse(request.body);
    return startLocalAuthority(db,auth,body.expectedEpoch);
  });
  app.post("/api/local-session/status",ownerOptions,async(request,reply)=>{
    const auth=await requireAuth(request,reply,db);if(!auth)return;
    return getLocalAuthorityStatus(db,auth);
  });
  app.post("/api/local-session/stop",ownerOptions,async(request,reply)=>{
    const auth=await requireAuth(request,reply,db);if(!auth)return;
    const body=z.object({expectedEpoch:z.number().int().positive().max(2147483647)}).strict().parse(request.body);
    await stopLocalAuthority(db,auth,body.expectedEpoch);return {ok:true};
  });
  app.post("/api/local-session/pairings",ownerOptions,async(request,reply)=>{
    const auth=await requireAuth(request,reply,db);if(!auth)return;
    return issueLocalPairing(db,auth,request.body);
  });
  app.post("/api/local-session/revoke",ownerOptions,async(request,reply)=>{
    const auth=await requireAuth(request,reply,db);if(!auth)return;
    await revokeLocalPeer(db,auth,request.body);return {ok:true};
  });
  app.post("/api/local-session/redeem",{bodyLimit:4096,config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async request=>
    redeemLocalPairing(db,request.body));
  app.post("/api/local-session/preview",{bodyLimit:4096,config:{rateLimit:{max:600,timeWindow:"1 minute"}}},async request=>submitLocalTokenPreview(db,request.body,onPreview));
  app.post("/api/local-session/previews",{bodyLimit:4096,config:{rateLimit:{max:900,timeWindow:"1 minute"}}},async request=>pollLocalTokenPreviews(db,request.body));
  app.post("/api/local-session/upload",{bodyLimit:32768,config:{rateLimit:{max:1100,timeWindow:"1 minute"}}},async(request,reply)=>{
    const input=localPeerRequestSchema.parse(request.body);
    if(input.command.kind!=="CHAT_UPLOAD_CHUNK")return reply.code(400).send({error:"UPLOAD_COMMAND_REQUIRED"});
    return executeLocalPeerRequest(db,input);
  });
  app.post("/api/local-session/media",{bodyLimit:4096,config:{rateLimit:{max:1100,timeWindow:"1 minute"}}},async(request,reply)=>{
    const input=localPeerRequestSchema.parse(request.body);
    if(input.command.kind!=="ASSET_CHUNK"&&input.command.kind!=="CHAT_ATTACHMENT_CHUNK"&&input.command.kind!=="STORY_MEDIA_CHUNK")return reply.code(400).send({error:"MEDIA_COMMAND_REQUIRED"});
    return executeLocalPeerRequest(db,input);
  });
  app.post("/api/local-session/peer",{bodyLimit:32768,config:{rateLimit:{max:400,timeWindow:"1 minute"}}},async request=>{
    const result=await executeLocalPeerRequest(db,request.body);
    if((result.areaResult&&!("cancelled"in result.areaResult)&&!result.areaResult.duplicate)||(result.applicationUndo&&"ok"in result.applicationUndo)||(result.entryRoll&&!result.entryRoll.duplicate)||(result.entryRecharge&&!result.entryRecharge.duplicate)||(result.ack?.ok&&result.ack.status==="APPLIED")||Boolean(result.directThread)||(result.chatResult&&!("duplicate" in result.chatResult))){
      // Commit already happened. A notification failure must not turn its ACK
      // into an apparent failed mutation or expose SQL/payload in diagnostics.
      try{await onChanged(result.authority.campaignId);}catch{request.log.warn("local_session.broadcast_pending");}
    }
    return result;
  });
}
