import {CampaignTransferFileBusy} from './campaign-transfer-replace.js';
import {writeCampaignTransferMarker} from './campaign-transfer-markers.js';
import {recoverCampaignTransferUploads} from './campaign-transfer-upload-recovery.js';
import {recoverPendingCampaignTransfers} from './campaign-transfer-import.js';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {mkdir,mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {stageCampaignTransferArchive} from './campaign-transfer-archive.js';
import {importCampaignTransferStage,repairCampaignTransferMedia} from './campaign-transfer-import.js';
import {inspectLocalHost} from './local-host-identity.js';
import {verifyPassword} from './password-security.js';
import {z} from 'zod';
type Database=ReturnType<typeof import('@arken/db').createDatabase>['db'];
type Account={id:string;userId:string;passwordHash:string};
type Options={root:string;instanceId:string;migrations:readonly string[];account:(request:FastifyRequest,reply:FastifyReply,mutation:boolean)=>Promise<Account|null>};
const LIMIT=33*1024*1024*1024;
const credentials=z.object({operation:z.enum(['IMPORT','REPAIR']).default('IMPORT'),accountPassword:z.string().min(1).max(512),archivePassword:z.string().min(1).max(1024).refine(value=>Buffer.byteLength(value)<=1024)}).strict();
/** Multipart passwords precede the streamed file. No request-selected path,
 * URL, campaign ID or SQL connection is accepted. Plaintext stages are private
 * and scoped to one upload; imported media/recovery lives in its own namespace. */
export async function registerCampaignTransferUpload(app:FastifyInstance,db:Database,options:Options){
 await mkdir(options.root,{recursive:true,mode:0o700});if((await lstat(options.root)).isSymbolicLink()||await realpath(options.root)!==options.root)throw Error('TRANSFER_UPLOAD_ROOT');
 const identity=await inspectLocalHost(db,options.instanceId);if(!identity.initialized)throw Error('TRANSFER_IMPORT_OWNER_REQUIRED');
 const uploads=await recoverCampaignTransferUploads(options.root,options.instanceId);
 const recovery=await recoverPendingCampaignTransfers(db,{instanceId:options.instanceId,ownerId:identity.ownerId,migrations:options.migrations});
 app.log.info({event:'campaign_transfer_startup_recovery',...recovery,uploadsRemoved:uploads.removed,liveUploads:uploads.live,preservedUploads:uploads.preserved});
 let busy=false;
 app.post('/api/account/campaign-transfers/import',{bodyLimit:LIMIT,config:{rateLimit:{max:3,timeWindow:'10 minutes'}}},async(request,reply)=>{
  reply.header('cache-control','no-store').header('referrer-policy','no-referrer');
  const account=await options.account(request,reply,true);if(!account)return;
  const identity=await inspectLocalHost(db,options.instanceId);if(!identity.initialized||identity.ownerId!==account.userId)return reply.code(403).send({error:'TRANSFER_IMPORT_OWNER_REQUIRED'});
  if(busy)return reply.code(409).send({error:'TRANSFER_IMPORT_BUSY'});busy=true;
  let operation:'IMPORT'|'REPAIR'='IMPORT',work:string|undefined,fileSeen=false,stage:Awaited<ReturnType<typeof stageCampaignTransferArchive>>|undefined;
  const fields:Record<string,string>={};
  try{
   if(!request.isMultipart()){reply.code(400);return {error:'TRANSFER_IMPORT_MULTIPART_REQUIRED'};}
   for await(const part of request.parts({limits:{files:1,fields:3,parts:4,fileSize:LIMIT,fieldSize:2048}})){
    if(part.type==='field'){
     if(fileSeen||!['accountPassword','archivePassword','operation'].includes(part.fieldname)||Object.hasOwn(fields,part.fieldname)||typeof part.value!=='string')throw Error('INVALID_TRANSFER_FIELDS');
     fields[part.fieldname]=part.value;continue;
    }
    if(fileSeen||part.fieldname!=='archive')throw Error('INVALID_TRANSFER_FILE');fileSeen=true;
    const body=credentials.parse(fields);operation=body.operation;
    if(!(await verifyPassword(body.accountPassword,account.passwordHash))){part.file.resume();reply.code(403);return {error:'TRANSFER_IMPORT_REAUTH_REQUIRED'};}
    work=await mkdtemp(join(options.root,'upload-'));
    await writeCampaignTransferMarker(join(work,'owner.json'),{version:1,instanceId:options.instanceId,pid:process.pid});
    stage=await stageCampaignTransferArchive(part.file,body.archivePassword,{migrations:options.migrations},work);
    if(part.file.truncated)throw Error('TRANSFER_FILE_TRUNCATED');
    body.accountPassword='';body.archivePassword='';for(const key of Object.keys(fields))fields[key]='';
   }
   if(!fileSeen||!stage)throw Error('TRANSFER_FILE_REQUIRED');
   const current=await options.account(request,reply,true);if(!current)return;
   if(current.id!==account.id||current.passwordHash!==account.passwordHash){reply.code(403);return {error:'TRANSFER_IMPORT_REAUTH_REQUIRED'};}
   const scope={instanceId:options.instanceId,ownerId:account.userId,migrations:options.migrations,accountProof:{sessionId:account.id,passwordHash:account.passwordHash}};
   const result=operation==='REPAIR'?await repairCampaignTransferMedia(db,stage,scope):await importCampaignTransferStage(db,stage,scope);
   reply.code(operation==='REPAIR'?200:201);return result;
  }catch(error){
   if(error instanceof CampaignTransferFileBusy&&!reply.sent){reply.code(409);return {error:'TRANSFER_REPAIR_FILE_BUSY'};}
   // A transport/COMMIT failure can be ambiguous: the UI must refresh the
   // campaign list before retrying. Never claim that a caught error rolled back.
   if(!reply.sent){reply.code(400);return {error:'TRANSFER_IMPORT_RESULT_UNCONFIRMED'};}
  }finally{
   for(const key of Object.keys(fields))fields[key]='';
   try{if(work){if(dirname(work)!==options.root||!/^upload-[A-Za-z0-9]+$/.test(basename(work))||await realpath(work)!==work)throw Error('TRANSFER_UPLOAD_CLEANUP_PATH');await rm(work,{recursive:true,force:true});}}
   finally{busy=false;}
  }
 });
}
