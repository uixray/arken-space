import {assertCampaignTransferTargetSchema} from "./campaign-transfer-target-schema.js";
import {createHash} from 'node:crypto';import {sql} from 'drizzle-orm';
import {verifyCampaignTransferStructure} from './campaign-transfer-structure.js';import {verifyCampaignTransferFiles,verifyCampaignTransferRowFile} from './campaign-transfer-manifest.js';import {campaignTransferCatalog} from './campaign-transfer-policy.js';
type Database=ReturnType<typeof import('@arken/db').createDatabase>['db'];
/** Read-only to public campaign data. Native SQL checks, expression/partial
 * unique indexes and nullability are exercised in ON COMMIT DROP temp clones.
 * LIKE does not copy FK/triggers: FK closure is the preceding separate gate.
 * Invoke on an idle connection, never re-enter an active source snapshot. */
export async function qualifyCampaignTransferSqlRows(db:Database,input:unknown,expected:{campaignId:string;migrations:readonly string[]},read:(key:string,expectedBytes:number)=>Promise<Uint8Array>){
 const manifest=await verifyCampaignTransferStructure(input,expected,read),catalog=campaignTransferCatalog(),prefix='arken_tq_'+crypto.randomUUID().replaceAll('-','').slice(0,20);let rows=0;
 return db.transaction(async tx=>{
  await tx.execute(sql`SET LOCAL statement_timeout='30s'`);await tx.execute(sql`SET LOCAL lock_timeout='5s'`);
  await assertCampaignTransferTargetSchema(tx,expected.migrations);
  const qualified:string[]=[];
  await verifyCampaignTransferFiles(manifest,expected,async(key,size)=>{
   const bytes=Buffer.from(await read(key,size));
   if(key.startsWith('tables/')){
    const table=manifest.tables.find(t=>key===`tables/${t.name}.ndjson`),ordinal=catalog.findIndex(t=>t.name===table?.name);if(!table?.file||ordinal<0||bytes.length!==table.file.bytes||createHash('sha256').update(bytes).digest('hex')!==table.file.sha256)throw Error('CAMPAIGN_TRANSFER_SQL_INPUT_INTEGRITY_INVALID');
    const lines:string[]=[];verifyCampaignTransferRowFile(bytes,table.rows,(_row,raw)=>lines.push(raw));
    const temporary=prefix+'_'+ordinal;
    await tx.execute(sql`CREATE TEMP TABLE ${sql.identifier(temporary)} (LIKE public.${sql.identifier(table.name)} INCLUDING ALL) ON COMMIT DROP`);
    for(const raw of lines)await tx.execute(sql`INSERT INTO pg_temp.${sql.identifier(temporary)} SELECT * FROM jsonb_populate_record(NULL::pg_temp.${sql.identifier(temporary)},${raw}::jsonb)`);
    qualified.push(table.name);rows+=lines.length;
   }
   return bytes;
  });
  return {scope:'SQL_LOCAL_CONSTRAINTS_ONLY' as const,tables:qualified,rows};
 });
}
