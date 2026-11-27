import {mkdir,realpath,open,rename,unlink,lstat} from "node:fs/promises";
import {join,isAbsolute,relative} from "node:path";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {localCloudGrantSchema,localAuthoritySchema,type LocalAuthority} from "@arken/contracts";
import {env} from "./env.js";
import {createWindowsSecretProtector,type LocalSecretProtector} from "./local-secret-protector.js";
export {localCloudGrantSchema} from "@arken/contracts";
const storedSchema=z.object({format:z.literal(1),target:z.string().url(),grant:localCloudGrantSchema}).strict();
const inside=(root:string,path:string)=>{const part=relative(root,path);if(part.startsWith("..")||isAbsolute(part))throw Error("LOCAL_GRANT_PATH_INVALID");};
/** New writes are authority-scoped. Legacy campaign-only ciphertext is read
 * without mutation and only for its exact embedded authority. */
export function createLocalCloudGrantStore(protector:LocalSecretProtector=createWindowsSecretProtector()){
 let tail=Promise.resolve();
 const queue=<T>(action:()=>Promise<T>):Promise<T>=>{const result=tail.then(action);tail=result.then(()=>undefined,()=>undefined);return result;};
 const location=async(scopeInput:LocalAuthority,needTarget=true)=>{
  const scope=localAuthoritySchema.parse(scopeInput);
  if(env.DEPLOYMENT_MODE!=="LOCAL_HOST"||scope.hostId!==env.LOCAL_INSTANCE_ID||!isAbsolute(env.LOCAL_DATA_ROOT)||(needTarget&&!env.LOCAL_CLOUD_SYNC_ORIGIN))throw Error("LOCAL_GRANT_NOT_CONFIGURED");
  const target=new URL(needTarget?env.LOCAL_CLOUD_SYNC_ORIGIN:"https://forget.invalid");if(target.protocol!=="https:"||target.username||target.password||target.pathname!=="/"||target.search||target.hash)throw Error("LOCAL_GRANT_TARGET_INVALID");
  const root=await realpath(env.LOCAL_DATA_ROOT),folder=join(root,"cloud-sync-grants");await mkdir(folder,{recursive:true});const dir=await realpath(folder);inside(root,dir);
  return {scope,path:join(dir,`${scope.campaignId}.${scope.sessionId}.${scope.epoch}.grant`),legacy:join(dir,scope.campaignId+".grant"),dir,target:target.origin,context:JSON.stringify(["arken-cloud-grant-v1",scope.hostId,scope.campaignId,target.origin])};
 };
 const matches=(a:LocalAuthority,b:LocalAuthority)=>["campaignId","hostId","sessionId","epoch"].every(key=>a[key as keyof LocalAuthority]===b[key as keyof LocalAuthority]);
 const validate=(scope:LocalAuthority,input:unknown)=>{const grant=localCloudGrantSchema.parse(input);if(!matches(grant.origin,scope))throw Error("LOCAL_GRANT_SCOPE_MISMATCH");const expiry=Date.parse(grant.expiresAt);if(expiry<=Date.now()||expiry>Date.now()+13*60*60*1000)throw Error("LOCAL_GRANT_EXPIRED_OR_INVALID");return grant;};
 const read=async(path:string)=>{let file:Awaited<ReturnType<typeof open>>;try{if((await lstat(path)).isSymbolicLink())throw Error("LOCAL_GRANT_PATH_INVALID");file=await open(path,"r");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
  try{const stat=await file.stat();if(!stat.isFile()||stat.size>32768)throw Error("LOCAL_GRANT_TOO_LARGE");const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const part=await file.read(bytes,offset,bytes.length-offset,offset);if(!part.bytesRead)throw Error("LOCAL_GRANT_READ_FAILED");offset+=part.bytesRead;}return bytes;}finally{await file.close();}
 };
 const decode=async(loc:Awaited<ReturnType<typeof location>>,bytes:Uint8Array)=>{const plain=await protector.unprotect(bytes,loc.context);try{const decoded=storedSchema.parse(JSON.parse(Buffer.from(plain).toString("utf8")));if(decoded.target!==loc.target||decoded.grant.origin.hostId!==loc.scope.hostId||decoded.grant.origin.campaignId!==loc.scope.campaignId)throw Error("LOCAL_GRANT_SCOPE_MISMATCH");return decoded.grant;}finally{plain.fill(0);}};
 return {
  save(scope:LocalAuthority,input:unknown){return queue(async()=>{const loc=await location(scope),grant=validate(loc.scope,input),plain=Buffer.from(JSON.stringify({format:1,target:loc.target,grant}));let encrypted:Uint8Array;try{encrypted=await protector.protect(plain,loc.context);}finally{plain.fill(0);}if(encrypted.byteLength>32768)throw Error("LOCAL_GRANT_TOO_LARGE");
   const temporary=join(loc.dir,randomUUID()+".tmp");let file:Awaited<ReturnType<typeof open>>|undefined;
   try{try{if((await lstat(loc.path)).isSymbolicLink())throw Error("LOCAL_GRANT_PATH_INVALID");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    file=await open(temporary,"wx",0o600);await file.writeFile(encrypted);await file.sync();await file.close();file=undefined;await rename(temporary,loc.path);
   }finally{await file?.close();await unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw Error("LOCAL_GRANT_CLEANUP_FAILED");});}return {configured:true,expiresAt:grant.expiresAt};
  });},
  load(scope:LocalAuthority){return queue(async()=>{const loc=await location(scope);try{
   const current=await read(loc.path);if(current)return validate(loc.scope,await decode(loc,current));
   const legacy=await read(loc.legacy);if(!legacy)return null;const grant=await decode(loc,legacy);return matches(grant.origin,loc.scope)?validate(loc.scope,grant):null;
  }catch{throw Error("LOCAL_GRANT_UNREADABLE_OR_EXPIRED");}});},
  forget(scope:LocalAuthority){return queue(async()=>{const loc=await location(scope,false),legacy=await read(loc.legacy);let removeLegacy=false;
   // Do not erase a different historical credential or claim success when an
   // unidentifiable legacy credential could reactivate this scope later.
   if(legacy){if(!env.LOCAL_CLOUD_SYNC_ORIGIN)throw Error("LOCAL_GRANT_LEGACY_TARGET_REQUIRED");const target=await location(scope);removeLegacy=matches((await decode(target,legacy)).origin,target.scope);}
   await unlink(loc.path).catch(error=>{if(error.code!=="ENOENT")throw Error("LOCAL_GRANT_DELETE_FAILED");});if(removeLegacy)await unlink(loc.legacy);return {configured:false};
  });},
 };
}
