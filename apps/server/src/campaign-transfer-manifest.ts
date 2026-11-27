import {campaignTransferProjectionSchema} from "./campaign-transfer-projections.js";
import {campaignTransferMediaBindingSchema} from "./campaign-transfer-binding-schema.js";
import {assertCampaignTransferUniqueJsonKeys} from "./campaign-transfer-json.js";
import {TextDecoder} from "node:util";
import {createHash} from "node:crypto";
import {z} from "zod";
import {campaignTransferCatalog} from "./campaign-transfer-policy.js";

const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid();
const sequence=z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(value=>BigInt(value)<=9223372036854775807n);
const file=z.object({sha256:hash,bytes:z.number().int().min(1).max(256*1024*1024)}).strict();
const table=z.object({name:z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),policy:z.string().max(40),rows:z.number().int().min(0).max(1000000),file:file.nullable()}).strict();
const schema=z.object({
 format:z.literal("ARKEN_CAMPAIGN_TRANSFER"),version:z.literal(2),capturePolicyVersion:z.literal(1),
 campaignId:uuid,sourceOwnerMembershipId:uuid,createdAt:z.string().datetime(),
 source:z.object({schemaDigest:hash,migrations:z.array(hash).min(1).max(4096),baselineSequence:sequence}).strict(),
 projections:file.nullable(),mediaBindings:file.nullable(),
 tables:z.array(table).max(512),media:z.array(file.extend({mimeType:z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/).max(127)}).strict()).max(100000),
 sha256:hash,
}).strict();
export type CampaignTransferManifest=z.infer<typeof schema>;
const sha=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
/** Canonical metadata only. Row/media bytes are hashed separately; this digest
 * is integrity, never authentication, consent, a licence or proof of ACL. */
function canonical(value:unknown):string{
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 if(value!==null&&typeof value==="object")return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical((value as Record<string,unknown>)[key])).join(",")+"}";
 return JSON.stringify(value);
}
export const campaignTransferSchemaDigest=()=>sha(canonical(campaignTransferCatalog()));
const bodyHash=(manifest:CampaignTransferManifest)=>{const {sha256:_,...body}=manifest;return sha("arken-campaign-transfer-v2\0"+canonical(body));};

/** Internal format gate. Capture/import must still enforce row-level policies,
 * FK closure, licence handling, media ACL and identity remapping themselves. */
export function verifyCampaignTransferManifest(input:unknown,expected:{campaignId:string;migrations:readonly string[]}){
 const manifest=schema.parse(input),catalog=campaignTransferCatalog();
 if(manifest.campaignId!==uuid.parse(expected.campaignId))throw Error("CAMPAIGN_TRANSFER_SCOPE_MISMATCH");
 if(manifest.source.schemaDigest!==campaignTransferSchemaDigest())throw Error("CAMPAIGN_TRANSFER_SCHEMA_MISMATCH");
 if(manifest.source.migrations.length!==expected.migrations.length||manifest.source.migrations.some((entry,index)=>entry!==expected.migrations[index]))throw Error("CAMPAIGN_TRANSFER_MIGRATION_MISMATCH");
 if(manifest.tables.length!==catalog.length||new Set(manifest.tables.map(entry=>entry.name)).size!==catalog.length)throw Error("CAMPAIGN_TRANSFER_TABLE_COVERAGE_INVALID");
 let bytes=(manifest.projections?.bytes??0)+(manifest.mediaBindings?.bytes??0);
 for(const entry of manifest.tables){
  const target=catalog.find(item=>item.name===entry.name);
  if(!target||entry.policy!==target.policy)throw Error("CAMPAIGN_TRANSFER_TABLE_POLICY_INVALID");
  if(target.policy==="EXCLUDED_AUTH_RUNTIME"){
   if(entry.rows!==0||entry.file!==null)throw Error("CAMPAIGN_TRANSFER_CREDENTIALS_FORBIDDEN");
  }else if(entry.rows===0?entry.file!==null:entry.file===null)throw Error("CAMPAIGN_TRANSFER_TABLE_FILE_INVALID");
  if(target.policy==="ROOT"&&entry.rows!==1)throw Error("CAMPAIGN_TRANSFER_ROOT_INVALID");
  if(target.policy==="IDENTITY_REMAP"&&entry.rows<1)throw Error("CAMPAIGN_TRANSFER_MEMBERSHIP_INVALID");
  bytes+=entry.file?.bytes??0;
 }
 const media=new Set<string>();
 for(const entry of manifest.media){if(media.has(entry.sha256))throw Error("CAMPAIGN_TRANSFER_MEDIA_DUPLICATE");media.add(entry.sha256);bytes+=entry.bytes;}
 if(Boolean(manifest.media.length)!==Boolean(manifest.mediaBindings))throw Error("CAMPAIGN_TRANSFER_MEDIA_BINDINGS_REQUIRED");
 if(bytes>32*1024*1024*1024)throw Error("CAMPAIGN_TRANSFER_PACKAGE_TOO_LARGE");
 if(bodyHash(manifest)!==manifest.sha256)throw Error("CAMPAIGN_TRANSFER_HASH_MISMATCH");
 return manifest;
}
/** Trusted capture builder, not an endpoint accepting arbitrary table payloads. */
export function createCampaignTransferManifest(input:Omit<CampaignTransferManifest,"sha256">){
 const parsed=schema.parse({...input,sha256:"0".repeat(64)});parsed.sha256=bodyHash(parsed);
 return verifyCampaignTransferManifest(parsed,{campaignId:input.campaignId,migrations:input.source.migrations});
}

/** Syntax/count gate only: does not replace schema, ACL or FK validation.
 * Parsing is for validation only; bigint-bearing source text is never emitted
 * from parsed JS numbers or reserialized by this function. */
export function verifyCampaignTransferRowFile(bytes:Uint8Array,expectedRows?:number,validateRow?:(row:Record<string,unknown>,raw:string)=>void){
 let text:string;try{text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error("CAMPAIGN_TRANSFER_NDJSON_UTF8_INVALID");}
 if(!text.endsWith("\n"))throw Error("CAMPAIGN_TRANSFER_NDJSON_FRAMING_INVALID");
 let start=0,rows=0;
 for(let end=text.indexOf("\n");end!==-1;end=text.indexOf("\n",start)){
  const line=text.slice(start,end);start=end+1;
  if(!line.trim())throw Error("CAMPAIGN_TRANSFER_NDJSON_ROW_INVALID");
  let row:unknown;try{row=JSON.parse(line);}catch{throw Error("CAMPAIGN_TRANSFER_NDJSON_ROW_INVALID");}
  if(row===null||typeof row!=="object"||Array.isArray(row))throw Error("CAMPAIGN_TRANSFER_NDJSON_ROW_INVALID");
  assertCampaignTransferUniqueJsonKeys(line);
  validateRow?.(row as Record<string,unknown>,line);
  if(++rows>1000000)throw Error("CAMPAIGN_TRANSFER_NDJSON_ROW_LIMIT");
 }
 if(expectedRows!==undefined&&rows!==expectedRows)throw Error("CAMPAIGN_TRANSFER_NDJSON_ROW_COUNT_INVALID");
 return rows;
}

/** Reader receives generated fixed keys only, never archive paths from input.
 * One bounded file at a time; the eventual archive adapter must also reject
 * duplicate entries, symlinks and extra files before it reaches this gate. */
export async function verifyCampaignTransferFiles(input:unknown,expected:{campaignId:string;migrations:readonly string[]},read:(key:string,expectedBytes:number)=>Promise<Uint8Array>,validateTableRow?:(table:string,row:Record<string,unknown>,raw:string)=>void,validateMediaBinding?:(binding:z.infer<typeof campaignTransferMediaBindingSchema>)=>void,validateProjection?:(projection:z.infer<typeof campaignTransferProjectionSchema>)=>void){
 const manifest=verifyCampaignTransferManifest(input,expected);
 const verify=async(key:string,entry:z.infer<typeof file>)=>{const bytes=await read(key,entry.bytes);if(bytes.byteLength!==entry.bytes||sha(bytes)!==entry.sha256)throw Error("CAMPAIGN_TRANSFER_FILE_INTEGRITY_INVALID");return bytes;};
 for(const entry of manifest.tables)if(entry.file)verifyCampaignTransferRowFile(await verify(`tables/${entry.name}.ndjson`,entry.file),entry.rows,validateTableRow?(row,raw)=>validateTableRow(entry.name,row,raw):undefined);
 let projectionCount=0;
 if(manifest.projections)verifyCampaignTransferRowFile(await verify("projections.ndjson",manifest.projections),undefined,row=>{if(++projectionCount>100000)throw Error("CAMPAIGN_TRANSFER_PROJECTION_LIMIT");const projection=campaignTransferProjectionSchema.parse(row);if(projection.kind==="MATERIALIZED_ATTACHMENT_METADATA"&&projection.campaignId.toLowerCase()!==manifest.campaignId.toLowerCase())throw Error("CAMPAIGN_TRANSFER_PROJECTION_SCOPE_INVALID");validateProjection?.(projection);});
 const mediaByHash=new Map(manifest.media.map(m=>[m.sha256,m])),bound=new Set<string>(),identities=new Set<string>();let bindingCount=0;
 if(manifest.mediaBindings)verifyCampaignTransferRowFile(await verify("media-bindings.ndjson",manifest.mediaBindings),undefined,row=>{
  const binding=campaignTransferMediaBindingSchema.parse(row),key=binding.kind+":"+binding.id.toLowerCase();if(identities.has(key))throw Error("CAMPAIGN_TRANSFER_MEDIA_BINDING_DUPLICATE");identities.add(key);
  const media=mediaByHash.get(binding.sha256);if(!media||media.bytes!==binding.bytes||media.mimeType!==binding.mimeType)throw Error("CAMPAIGN_TRANSFER_MEDIA_BINDING_INVALID");bound.add(binding.sha256);validateMediaBinding?.(binding);if(++bindingCount>100000)throw Error("CAMPAIGN_TRANSFER_MEDIA_BINDING_LIMIT");
 });
 if(bound.size!==manifest.media.length)throw Error("CAMPAIGN_TRANSFER_MEDIA_UNBOUND");
 for(const entry of manifest.media)await verify(`media/${entry.sha256}`,entry);
 return manifest;
}
