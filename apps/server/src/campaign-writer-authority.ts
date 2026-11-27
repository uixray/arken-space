import {sql} from "drizzle-orm";
import {z} from "zod";
import {env} from "./env.js";
import type {AuthContext} from "./auth.js";
type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction=Parameters<Parameters<Database["transaction"]>[0]>[0];
const revision=z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(s=>BigInt(s)<=9223372036854775807n),uuid=z.string().uuid();
const authoritySchema=z.object({campaignId:uuid,revision,originId:uuid}).strict();
async function owner(tx:Transaction,auth:AuthContext,userId:string){
 if(env.DEPLOYMENT_MODE!=="HOSTED"||auth.role!=="GM")throw Error("CAMPAIGN_WRITER_FORBIDDEN");
 uuid.parse(userId);
 const rows=await tx.execute(sql`SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=${auth.membershipId} AND m.campaign_id=${auth.campaignId} AND m.role='GM' AND m.access_revoked_at IS NULL AND u.id=${userId} AND u.disabled_at IS NULL AND u.password_change_required=false AND ((u.identity_kind='EMAIL' AND u.verified_at IS NOT NULL) OR (u.identity_kind='HOSTED' AND u.hosted_approved_at IS NOT NULL)) AND NOT EXISTS(SELECT 1 FROM campaign_archive_state a WHERE a.campaign_id=m.campaign_id AND a.archived_at IS NOT NULL) FOR SHARE OF m,u`);
 if(rows.length!==1)throw Error("CAMPAIGN_WRITER_FORBIDDEN");
}
async function lock(tx:Transaction,campaignId:string,exclusive:boolean){
 await tx.execute(exclusive?sql`SELECT pg_advisory_xact_lock(683149,hashtext(${campaignId}::text))`:sql`SELECT pg_advisory_xact_lock_shared(683149,hashtext(${campaignId}::text))`);
}
async function current(tx:Transaction,campaignId:string){
 const [row]=await tx.execute<{revision:string;writer:string;origin_id:string|null}>(sql`SELECT revision::text,writer,origin_id FROM campaign_writer_authorities WHERE campaign_id=${campaignId}`);
 return row??{revision:"0",writer:"HOSTED",origin_id:null};
}
/** Trusted owner control-plane only. An inbox grant never calls this implicitly. */
export async function reserveCloudCampaignWriter(db:Database,auth:AuthContext,userId:string,input:unknown){
 return db.transaction(tx=>reserveCloudCampaignWriterInTransaction(tx,auth,userId,input));
}
/** Trusted same-transaction entry for a complete fenced archive comparison. */
export async function reserveCloudCampaignWriterInTransaction(tx:Transaction,auth:AuthContext,userId:string,input:unknown){
 const command=z.object({expectedRevision:revision,originId:uuid,baselineSequence:revision}).strict().parse(input);

  await owner(tx,auth,userId);await lock(tx,auth.campaignId,true);await owner(tx,auth,userId);const previous=await current(tx,auth.campaignId);
  if(previous.revision!==command.expectedRevision||previous.writer!=="HOSTED"||BigInt(previous.revision)===9223372036854775807n)throw Error("CAMPAIGN_WRITER_CONFLICT");
  const [source]=await tx.execute<{baseline_sequence:string}>(sql`SELECT baseline_sequence::text FROM cloud_sync_origins WHERE id=${command.originId} AND campaign_id=${auth.campaignId} AND owner_user_id=${userId} AND closed_at IS NULL FOR SHARE`);
  const [cloud]=await tx.execute<{baseline:string}>(sql`SELECT coalesce(max(sequence),0)::text AS baseline FROM game_events WHERE campaign_id=${auth.campaignId}`);
  if(!source||source.baseline_sequence!==command.baselineSequence||cloud?.baseline!==command.baselineSequence)throw Error("CAMPAIGN_WRITER_BASELINE_CONFLICT");
  const next=(BigInt(previous.revision)+1n).toString();
  await tx.execute(sql`INSERT INTO campaign_writer_authorities(campaign_id,revision,writer,origin_id) VALUES(${auth.campaignId},${next}::bigint,'LOCAL',${command.originId}) ON CONFLICT(campaign_id) DO UPDATE SET revision=excluded.revision,writer=excluded.writer,origin_id=excluded.origin_id,updated_at=clock_timestamp()`);
  return {campaignId:auth.campaignId,revision:next,originId:command.originId,writer:"LOCAL" as const};

}
/** Explicit release is possible only for an empty inbox until typed apply receipts exist. */
export async function releaseCloudCampaignWriter(db:Database,auth:AuthContext,userId:string,input:unknown){
 const expected=authoritySchema.parse(input);if(expected.campaignId!==auth.campaignId)throw Error("CAMPAIGN_WRITER_FORBIDDEN");
 return db.transaction(async tx=>{
  await owner(tx,auth,userId);await lock(tx,auth.campaignId,true);await owner(tx,auth,userId);const row=await current(tx,auth.campaignId);
  if(row.writer!=="LOCAL"||row.revision!==expected.revision||row.origin_id!==expected.originId||BigInt(row.revision)===9223372036854775807n)throw Error("CAMPAIGN_WRITER_CONFLICT");
  const pending=await tx.execute(sql`SELECT 1 FROM cloud_sync_inbox i JOIN cloud_sync_origins o ON o.id=i.origin_id WHERE o.campaign_id=${auth.campaignId} AND NOT EXISTS(SELECT 1 FROM cloud_sync_applications a WHERE a.receipt_id=i.receipt_id AND a.origin_id=i.origin_id) LIMIT 1`);
  if(pending.length)throw Error("CAMPAIGN_WRITER_RECONCILIATION_REQUIRED");
  await tx.execute(sql`UPDATE cloud_sync_origins SET closed_at=clock_timestamp() WHERE id=${expected.originId}`);
  const next=(BigInt(row.revision)+1n).toString();await tx.execute(sql`UPDATE campaign_writer_authorities SET revision=${next}::bigint,writer='HOSTED',origin_id=NULL,updated_at=clock_timestamp() WHERE campaign_id=${auth.campaignId}`);
  return {campaignId:auth.campaignId,revision:next,writer:"HOSTED" as const};
 });
}
/** Server-internal typed appliers only; never expose an arbitrary SQL/callback API. */
export async function withReservedCloudWriter<T>(db:Database,auth:AuthContext,userId:string,input:unknown,operation:(tx:Transaction)=>Promise<T>):Promise<T>{
 const expected=authoritySchema.parse(input);if(expected.campaignId!==auth.campaignId)throw Error("CAMPAIGN_WRITER_FORBIDDEN");
 return db.transaction(async tx=>{
  await owner(tx,auth,userId);await lock(tx,auth.campaignId,false);await owner(tx,auth,userId);const row=await current(tx,auth.campaignId);
  if(row.writer!=="LOCAL"||row.revision!==expected.revision||row.origin_id!==expected.originId)throw Error("CAMPAIGN_WRITER_CONFLICT");
  await tx.execute(sql`SELECT set_config('arken.cloud_writer',${JSON.stringify(expected)},true)`);
  return operation(tx);
 });
}

/** Authenticated receipt/status reads, including after explicit authority release. */
export async function withHostedCampaignOwner<T>(db:Database,auth:AuthContext,userId:string,operation:(tx:Transaction)=>Promise<T>,options?:{statementTimeoutMs:number}):Promise<T>{
 const timeout=options?z.number().int().min(1).max(30000).parse(options.statementTimeoutMs):undefined;
 return db.transaction(async tx=>{
  if(timeout!==undefined)await tx.execute(sql`SELECT set_config('statement_timeout',${String(timeout)},true),set_config('lock_timeout',${String(timeout)},true)`);
  await owner(tx,auth,userId);await lock(tx,auth.campaignId,false);await owner(tx,auth,userId);return operation(tx);
 });
}
