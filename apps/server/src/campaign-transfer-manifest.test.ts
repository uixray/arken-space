import {campaignTransferSnapshotDigest} from "./campaign-transfer-origin.js";
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {createMigratedPglite} from "../../../tests/helpers/pglite-template.js";
import {campaignTransferCatalog} from "./campaign-transfer-policy.js";
import {campaignTransferSchemaDigest,createCampaignTransferManifest,verifyCampaignTransferManifest,verifyCampaignTransferFiles} from "./campaign-transfer-manifest.js";
const campaignId="11111111-1111-4111-8111-111111111111",memberId="22222222-2222-4222-8222-222222222222",migrations=["a".repeat(64),"b".repeat(64)];
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function fixture(){
 const root=Buffer.from(JSON.stringify({id:campaignId,name:"РЎРёРЅС‚РµС‚РёС‡РµСЃРєР°СЏ РєР°РјРїР°РЅРёСЏ"})+"\n"),member=Buffer.from(JSON.stringify({id:memberId,campaign_id:campaignId,role:"GM"})+"\n"),media=Buffer.from("synthetic-media");
 const files=new Map<string,Uint8Array>([["tables/campaigns.ndjson",root],["tables/memberships.ndjson",member],[`media/${digest(media)}`,media]]);
 const bindingBytes=Buffer.from(JSON.stringify({kind:"ASSET_ORIGINAL",id:memberId,sha256:digest(media),bytes:media.length,mimeType:"image/webp"})+"\n");files.set("media-bindings.ndjson",bindingBytes);
 const tables=campaignTransferCatalog().map(table=>{const bytes=files.get(`tables/${table.name}.ndjson`);return {name:table.name,policy:table.policy,rows:bytes?1:0,file:bytes?{bytes:bytes.byteLength,sha256:digest(bytes)}:null};});
 const manifest=createCampaignTransferManifest({format:"ARKEN_CAMPAIGN_TRANSFER",version:2,capturePolicyVersion:1,campaignId,sourceOwnerMembershipId:memberId,projections:null,mediaBindings:{bytes:bindingBytes.length,sha256:digest(bindingBytes)},createdAt:"2026-11-27T00:00:00.000Z",source:{schemaDigest:campaignTransferSchemaDigest(),migrations,baselineSequence:"9007199254740993"},tables,media:[{sha256:digest(media),bytes:media.byteLength,mimeType:"image/webp"}]});
 return {manifest,files};
}
it("has an explicit transfer policy for every migrated public table",async()=>{
 const pg=await createMigratedPglite();try{const result=await pg.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");expect(result.rows.map(row=>row.tablename).sort()).toEqual(campaignTransferCatalog().map(table=>table.name).sort());}finally{await pg.close();}
});
it("verifies canonical metadata and all table/media bytes with fixed safe keys",async()=>{
 const {manifest,files}=fixture(),reads:string[]=[];
 const result=await verifyCampaignTransferFiles(manifest,{campaignId,migrations},async(key,bytes)=>{reads.push(key);expect(files.get(key)!.byteLength).toBe(bytes);return files.get(key)!;});
 expect(result.source.baselineSequence).toBe("9007199254740993");expect(reads).toHaveLength(4);expect(reads).not.toContain("tables/users.ndjson");expect(reads).not.toContain("tables/sessions.ndjson");
 const reordered=JSON.parse(JSON.stringify(manifest,(key,value)=>value)) as typeof manifest;reordered.source={baselineSequence:manifest.source.baselineSequence,migrations,schemaDigest:manifest.source.schemaDigest};expect(verifyCampaignTransferManifest(reordered,{campaignId,migrations})).toEqual(manifest);
});
it("rejects missing or unknown tables, policy substitution and credential files",()=>{
 const {manifest}=fixture();const build=(tables:typeof manifest.tables)=>createCampaignTransferManifest({...manifest,tables});
 expect(()=>build(manifest.tables.slice(1))).toThrow("COVERAGE");
 expect(()=>build(manifest.tables.map((entry,index)=>index===0?{...entry,name:"../users"}:entry))).toThrow();
 expect(()=>build(manifest.tables.map(entry=>entry.name==="users"?{...entry,rows:1,file:{bytes:10,sha256:"0".repeat(64)}}:entry))).toThrow("CREDENTIALS_FORBIDDEN");
 expect(()=>build(manifest.tables.map(entry=>entry.name==="chat_messages"?{...entry,policy:"CAMPAIGN_ROWS"}:entry))).toThrow("POLICY");
 expect(()=>build(manifest.tables.map(entry=>entry.name==="campaigns"?{...entry,rows:0,file:null}:entry))).toThrow("ROOT");
 expect(()=>build(manifest.tables.map(entry=>entry.name==="memberships"?{...entry,rows:0,file:null}:entry))).toThrow("MEMBERSHIP");
});
it("binds campaign, exact schema and ordered migration hashes without rounding sequence",()=>{
 const {manifest}=fixture();expect(()=>verifyCampaignTransferManifest(manifest,{campaignId:memberId,migrations})).toThrow("SCOPE");expect(()=>verifyCampaignTransferManifest(manifest,{campaignId,migrations:[...migrations].reverse()})).toThrow("MIGRATION");
 expect(()=>verifyCampaignTransferManifest({...manifest,source:{...manifest.source,schemaDigest:"0".repeat(64)}},{campaignId,migrations})).toThrow("SCHEMA");
 expect(()=>verifyCampaignTransferManifest({...manifest,source:{...manifest.source,baselineSequence:9007199254740992}},{campaignId,migrations})).toThrow();
 expect(()=>verifyCampaignTransferManifest({...manifest,source:{...manifest.source,baselineSequence:"9223372036854775808"}},{campaignId,migrations})).toThrow();
});
it("rejects altered metadata, duplicate media, wrong file lengths and tampered bytes",async()=>{
 const {manifest,files}=fixture();expect(()=>verifyCampaignTransferManifest({...manifest,createdAt:"2026-11-28T00:00:00.000Z"},{campaignId,migrations})).toThrow("HASH");
 expect(()=>createCampaignTransferManifest({...manifest,media:[...manifest.media,...manifest.media]})).toThrow("DUPLICATE");
 await expect(verifyCampaignTransferFiles(manifest,{campaignId,migrations},async()=>Buffer.from("wrong"))).rejects.toThrow("INTEGRITY");
 await expect(verifyCampaignTransferFiles(manifest,{campaignId,migrations},async key=>{const bytes=Buffer.from(files.get(key)!);bytes[0]=bytes[0]!^1;return bytes;})).rejects.toThrow("INTEGRITY");
});

it("binds projection provenance bytes separately from source rows",async()=>{
 const {manifest,files}=fixture(),bytes=Buffer.from(JSON.stringify({messageId:memberId,kind:"REVOKED_STICKER"})+"\n");files.set("projections.ndjson",bytes);const projected=createCampaignTransferManifest({...manifest,projections:{bytes:bytes.byteLength,sha256:digest(bytes)}});const reads:string[]=[];await verifyCampaignTransferFiles(projected,{campaignId,migrations},async key=>{reads.push(key);return files.get(key)!;});expect(reads).toContain("projections.ndjson");await expect(verifyCampaignTransferFiles(projected,{campaignId,migrations},async key=>key==="projections.ndjson"?Buffer.alloc(bytes.byteLength):files.get(key)!)).rejects.toThrow("INTEGRITY");
});
it.each(['null\n','[]\n','1\n','{}\n\n','{}','{broken}\n','\ufeff{}\n'])("rejects rehashed but invalid table NDJSON: %j",async text=>{
 const {manifest,files}=fixture(),bytes=Buffer.from(text);files.set('tables/campaigns.ndjson',bytes);const candidate=createCampaignTransferManifest({...manifest,tables:manifest.tables.map(t=>t.name==='campaigns'?{...t,file:{bytes:bytes.length,sha256:digest(bytes)}}:t)});
 await expect(verifyCampaignTransferFiles(candidate,{campaignId,migrations},async key=>files.get(key)!)).rejects.toThrow('NDJSON');
});
it('rejects declared row count mismatch even with correct file hash',async()=>{
 const {manifest,files}=fixture(),bytes=Buffer.from('{}\n{}\n');files.set('tables/campaigns.ndjson',bytes);const candidate=createCampaignTransferManifest({...manifest,tables:manifest.tables.map(t=>t.name==='campaigns'?{...t,file:{bytes:bytes.length,sha256:digest(bytes)}}:t)});await expect(verifyCampaignTransferFiles(candidate,{campaignId,migrations},async key=>files.get(key)!)).rejects.toThrow('ROW_COUNT');
});
it('rejects malformed UTF8 even when its descriptor hash is correct',async()=>{
 const {manifest,files}=fixture(),bytes=Buffer.from([123,34,120,34,58,34,255,34,125,10]);files.set('tables/campaigns.ndjson',bytes);const candidate=createCampaignTransferManifest({...manifest,tables:manifest.tables.map(t=>t.name==='campaigns'?{...t,file:{bytes:bytes.length,sha256:digest(bytes)}}:t)});await expect(verifyCampaignTransferFiles(candidate,{campaignId,migrations},async key=>files.get(key)!)).rejects.toThrow('UTF8');
});
it('requires version2 and a hash-bound media binding descriptor',()=>{const {manifest}=fixture();expect(()=>verifyCampaignTransferManifest({...manifest,version:1},{campaignId,migrations})).toThrow();expect(()=>createCampaignTransferManifest({...manifest,mediaBindings:null})).toThrow('BINDINGS_REQUIRED');});
it.each(['duplicate','missingBlob','metadata','unbound'])('rejects rehashed invalid media bindings: %s',async mode=>{
 const {manifest,files}=fixture(),binding=JSON.parse(Buffer.from(files.get('media-bindings.ndjson')!).toString());let rows=[binding];if(mode==='duplicate')rows.push({...binding,id:binding.id.toUpperCase()});if(mode==='missingBlob')binding.sha256='f'.repeat(64);if(mode==='metadata')binding.bytes++;if(mode==='unbound')rows=[];
 const bytes=Buffer.from(rows.length?rows.map(r=>JSON.stringify(r)).join('\n')+'\n':'{}\n');files.set('media-bindings.ndjson',bytes);const candidate=createCampaignTransferManifest({...manifest,mediaBindings:{bytes:bytes.length,sha256:digest(bytes)}});await expect(verifyCampaignTransferFiles(candidate,{campaignId,migrations},async key=>files.get(key)!)).rejects.toThrow();
});

it("fingerprints captured contents independently of outer capture time while retaining state changes",()=>{const {manifest}=fixture(),{sha256,...input}=manifest,other=createCampaignTransferManifest({...input,createdAt:"2026-11-28T00:00:00.000Z"});expect(other.sha256).not.toBe(manifest.sha256);expect(campaignTransferSnapshotDigest(other)).toBe(campaignTransferSnapshotDigest(manifest));expect(campaignTransferSnapshotDigest({...manifest,source:{...manifest.source,baselineSequence:"9007199254740994"}})).not.toBe(campaignTransferSnapshotDigest(manifest));});
