import {recordCloudTransferExport} from "./campaign-transfer-origin.js";
import {env} from "./env.js";
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createCampaignTransferExporter,type TransferExportActor} from './campaign-transfer-export.js';
import {verifyPassword} from './password-security.js';
import {withCampaignTransferSnapshot} from './campaign-transfer-source.js';
import {captureCampaignTransferDataDraft} from './campaign-transfer-data-draft.js';
import {assembleCampaignTransferStructuralCandidate} from './campaign-transfer-candidate.js';
import {qualifyCampaignTransferSqlRows} from './campaign-transfer-sql-qualification.js';
type Database=ReturnType<typeof import('@arken/db').createDatabase>['db'];
type Account={id:string;userId:string;passwordHash:string};
type Owner={id:string;campaignId:string;role:'GM'|'PLAYER';displayName:string};
type Options={root:string;migrations:readonly string[];account:(request:FastifyRequest,reply:FastifyReply,mutation:boolean)=>Promise<Account|null>;owner:(userId:string,campaignId:string)=>Promise<Owner|null>};
export async function registerCampaignTransferRoutes(app:FastifyInstance,db:Database,options:Options){
 const exporter=await createCampaignTransferExporter(options.root);app.addHook('onClose',()=>exporter.close());
 const scope=z.object({campaignId:z.string().uuid()}).strict(),jobScope=scope.extend({jobId:z.string().uuid()});
 const command=z.object({accountPassword:z.string().min(1).max(512),archivePassword:z.string().min(1).max(1024).refine(s=>Array.from(s).length>=12&&Buffer.byteLength(s)<=1024)}).strict();
 async function authorize(request:FastifyRequest,reply:FastifyReply,mutation:boolean,job=false){
  reply.header('cache-control','no-store').header('referrer-policy','no-referrer');
  const account=await options.account(request,reply,mutation);if(!account)return null;
  const parsed=(job?jobScope:scope).safeParse(request.params);if(!parsed.success){await reply.code(400).send({error:'TRANSFER_EXPORT_SCOPE_INVALID'});return null;}
  const owner=await options.owner(account.userId,parsed.data.campaignId);if(!owner||owner.role!=='GM'){await reply.code(404).send({error:'CAMPAIGN_NOT_FOUND'});return null;}
  return {account,owner,actor:{userId:account.userId,sessionId:account.id,passwordHash:account.passwordHash,campaignId:owner.campaignId,membershipId:owner.id} satisfies TransferExportActor,jobId:job?(parsed.data as z.infer<typeof jobScope>).jobId:undefined};
 }
 app.post('/api/account/campaigns/:campaignId/transfer-exports',{bodyLimit:4096,config:{rateLimit:{max:3,timeWindow:'10 minutes'}}},async(request,reply)=>{
  const auth=await authorize(request,reply,true);if(!auth)return;
  const body=command.safeParse(request.body);if(!body.success)return reply.code(400).send({error:'TRANSFER_EXPORT_INPUT_INVALID'});
  if(!(await verifyPassword(body.data.accountPassword,auth.account.passwordHash)))return reply.code(403).send({error:'TRANSFER_EXPORT_REAUTH_REQUIRED'});
  try{
   const result=exporter.start(auth.actor,body.data.archivePassword,async root=>{
    const draft=await withCampaignTransferSnapshot(db,{campaignId:auth.owner.campaignId,membershipId:auth.owner.id,role:'GM',displayName:auth.owner.displayName},auth.account.userId,options.migrations,source=>captureCampaignTransferDataDraft(source,root),{accountProof:{sessionId:auth.account.id,passwordHash:auth.account.passwordHash}});
    const candidate=await assembleCampaignTransferStructuralCandidate(draft);
    await qualifyCampaignTransferSqlRows(db,candidate.manifest,{campaignId:auth.owner.campaignId,migrations:options.migrations},async key=>readFile(join(candidate.root,key)));
    return candidate;
   },async manifest=>{if(env.DEPLOYMENT_MODE==="HOSTED")await recordCloudTransferExport(db,auth.actor,manifest,options.migrations);});
   return reply.code(202).send(result);
  }catch{return reply.code(409).send({error:'TRANSFER_EXPORT_BUSY'});}
  finally{body.data.accountPassword='';body.data.archivePassword='';request.body=undefined;}
 });
 app.get('/api/account/campaigns/:campaignId/transfer-exports/:jobId',async(request,reply)=>{
  const auth=await authorize(request,reply,false,true);if(!auth)return;
  const result=exporter.status(auth.jobId!,auth.actor);return result?reply.send(result):reply.code(404).send({error:'TRANSFER_EXPORT_NOT_FOUND'});
 });
 app.get('/api/account/campaigns/:campaignId/transfer-exports/:jobId/download',async(request,reply)=>{
  const auth=await authorize(request,reply,false,true);if(!auth)return;
  const result=exporter.download(auth.jobId!,auth.actor);if(!result)return reply.code(404).send({error:'TRANSFER_EXPORT_NOT_FOUND'});
  return reply.header('content-type','application/octet-stream').header('content-disposition','attachment; filename="arken-campaign.arken"').header('content-length',String(result.bytes)).header('x-content-type-options','nosniff').send(result.stream);
 });
}
