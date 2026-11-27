import {verifyCloudTransferOrigin} from "./campaign-transfer-origin.js";
import {cloudSourceDescriptorSchema} from "@arken/contracts";
import {localAuthoritySchema} from "@arken/contracts";
import {randomUUID} from "node:crypto";
import {hashToken,randomToken} from "./security.js";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {env} from "./env.js";
import type {AuthContext} from "./auth.js";
import {verifyLocalEventBatch,localEventBatchHash} from "./local-event-envelope.js";
type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction=Parameters<Parameters<Database["transaction"]>[0]>[0];
const uuid=z.string().uuid(),sequence=z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(s=>BigInt(s)<=9223372036854775807n);
const forbidden=()=>{throw Error("CLOUD_SYNC_FORBIDDEN");};
/** Internal only. accountUserId must come from an authenticated account session. */
async function authorized(tx:Transaction,auth:AuthContext,accountUserId:string){
 if(env.DEPLOYMENT_MODE!=="HOSTED"||auth.role!=="GM")forbidden();uuid.parse(accountUserId);
 const campaign=await tx.execute(sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`);if(!campaign.length)forbidden();
 const rows=await tx.execute(sql`SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id
 WHERE m.id=${auth.membershipId} AND m.campaign_id=${auth.campaignId} AND m.role='GM' AND m.access_revoked_at IS NULL
 AND u.id=${accountUserId} AND u.disabled_at IS NULL AND u.password_change_required=false AND ((u.identity_kind='EMAIL' AND u.verified_at IS NOT NULL) OR (u.identity_kind='HOSTED' AND u.hosted_approved_at IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM campaign_archive_state a WHERE a.campaign_id=m.campaign_id AND a.archived_at IS NOT NULL) FOR SHARE OF m,u`);
 if(!rows.length)forbidden();
}
async function baseline(tx:Transaction,campaignId:string){const [row]=await tx.execute<{sequence:string}>(sql`SELECT coalesce(max(sequence),0)::text AS sequence FROM game_events WHERE campaign_id=${campaignId}`);return row!.sequence;}
/** Registers an INBOX source only; does not transfer game-writer authority. */
export async function registerCloudSyncSource(db:Database,auth:AuthContext,accountUserId:string,input:unknown){
 const origin=z.object({hostId:uuid,sessionId:uuid,epoch:z.number().int().positive().max(2147483647),baselineSequence:sequence}).strict().parse(input);
 return db.transaction(async tx=>{await authorized(tx,auth,accountUserId);
  if(await baseline(tx,auth.campaignId)!==origin.baselineSequence)throw Error("CLOUD_SYNC_BASELINE_CONFLICT");
  const [row]=await tx.execute<{id:string;owner_user_id:string;baseline_sequence:string;closed_at:Date|null}>(sql`INSERT INTO cloud_sync_origins(campaign_id,owner_user_id,host_id,session_id,epoch,baseline_sequence)
   VALUES(${auth.campaignId},${accountUserId},${origin.hostId},${origin.sessionId},${origin.epoch},${origin.baselineSequence}::bigint)
   ON CONFLICT(campaign_id,host_id,session_id,epoch) DO UPDATE SET host_id=cloud_sync_origins.host_id RETURNING id,owner_user_id,baseline_sequence::text,closed_at`);
  if(row!.closed_at)throw Error("CLOUD_SYNC_ORIGIN_CLOSED_CONFLICT");
  if(row!.owner_user_id!==accountUserId)forbidden();if(row!.baseline_sequence!==origin.baselineSequence)throw Error("CLOUD_SYNC_BASELINE_CONFLICT");return {originId:row!.id,mode:"INBOX_ONLY" as const};
 });
}
/** UI connection registration: derives the cloud baseline under the owner lock.
 * Reissuing a key never rebases an existing stream or applies its inbox. */
export async function connectCloudSyncSource(db:Database,auth:AuthContext,accountUserId:string,input:unknown){
 const origin=cloudSourceDescriptorSchema.parse(input);if(origin.campaignId!==auth.campaignId)forbidden();
 return db.transaction(async tx=>{await authorized(tx,auth,accountUserId);
  const proof=origin.transferProof?await verifyCloudTransferOrigin(tx,auth.campaignId,accountUserId,origin.transferProof):undefined;
  const [existing]=await tx.execute<{id:string;owner_user_id:string;closed_at:Date|null;received_sequence:string|null;transfer_manifest_sha256:string|null}>(sql`SELECT id,owner_user_id,closed_at,received_sequence::text,transfer_manifest_sha256 FROM cloud_sync_origins WHERE campaign_id=${auth.campaignId} AND host_id=${origin.hostId} AND session_id=${origin.sessionId} AND epoch=${origin.epoch}`);
  if(existing){if(existing.closed_at)throw Error("CLOUD_SYNC_ORIGIN_CLOSED_CONFLICT");if(existing.owner_user_id!==accountUserId)forbidden();if(proof){if(existing.transfer_manifest_sha256&&existing.transfer_manifest_sha256!==proof.manifestSha256||!existing.transfer_manifest_sha256&&existing.received_sequence!==null)throw Error("CLOUD_SYNC_TRANSFER_PROOF_CONFLICT");await tx.execute(sql`UPDATE cloud_sync_origins SET transfer_manifest_sha256=${proof.manifestSha256} WHERE id=${existing.id}`);}return {originId:existing.id,mode:"INBOX_ONLY" as const};}
  const checkpoint=await baseline(tx,auth.campaignId);
  const [created]=await tx.execute<{id:string}>(sql`INSERT INTO cloud_sync_origins(campaign_id,owner_user_id,host_id,session_id,epoch,baseline_sequence,transfer_manifest_sha256) VALUES(${auth.campaignId},${accountUserId},${origin.hostId},${origin.sessionId},${origin.epoch},${checkpoint}::bigint,${proof?.manifestSha256??null}) RETURNING id`);
  return {originId:created!.id,mode:"INBOX_ONLY" as const};
 });
}
export async function storeCloudSyncBatch(db:Database,auth:AuthContext,accountUserId:string,originId:string,input:unknown){
 uuid.parse(originId);
 return db.transaction(tx=>storeCloudSyncBatchInTransaction(tx,auth,accountUserId,originId,input));
}
async function storeCloudSyncBatchInTransaction(tx:Transaction,auth:AuthContext,accountUserId:string,originId:string,input:unknown){
 await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(683149,hashtext(${auth.campaignId}::text))`);
 await authorized(tx,auth,accountUserId);
  const [origin]=await tx.execute<{host_id:string;session_id:string;epoch:number;received_sequence:string|null;baseline_sequence:string;applied_cloud_sequence:string|null;closed_at:Date|null}>(sql`SELECT host_id,session_id,epoch,received_sequence::text,baseline_sequence::text,applied_cloud_sequence::text,closed_at FROM cloud_sync_origins WHERE id=${originId} AND campaign_id=${auth.campaignId} AND owner_user_id=${accountUserId} FOR UPDATE`);if(!origin)forbidden();
  const expected={hostId:origin!.host_id,campaignId:auth.campaignId,sessionId:origin!.session_id,epoch:origin!.epoch};
  // Validate the entire envelope before duplicate lookup; no hash-only acceptance.
  const declaredAfter=z.object({after:sequence.nullable()}).passthrough().parse(input).after;
  const checked=verifyLocalEventBatch(input,expected,declaredAfter),hash=localEventBatchHash(checked);
  const [previous]=await tx.execute<{id:string;last_sequence:string}>(sql`SELECT id,last_sequence::text FROM cloud_sync_receipts WHERE origin_id=${originId} AND batch_hash=${hash}`);
  if(previous){await tx.execute(sql`UPDATE cloud_sync_receipts SET batch_metadata=${JSON.stringify({after:checked.after,hasMore:checked.hasMore})}::jsonb WHERE id=${previous.id} AND batch_metadata IS NULL`);return {originId,batchHash:hash,receiptId:previous.id,lastSequence:previous.last_sequence,status:"STORED_ONLY" as const};}
  if(origin!.closed_at)throw Error("CLOUD_SYNC_ORIGIN_CLOSED_CONFLICT");
  if(await baseline(tx,auth.campaignId)!==(origin!.applied_cloud_sequence??origin!.baseline_sequence))throw Error("CLOUD_SYNC_BASELINE_CONFLICT");
  const batch=verifyLocalEventBatch(input,expected,origin!.received_sequence);
  // A new stream starts after the imported checkpoint, never from retained
  // historical events. Global sequence gaps are legal; exact decimal order is not optional.
  if(batch.events.some(envelope=>BigInt(envelope.event.sequence)<=BigInt(origin!.baseline_sequence)))throw Error("CLOUD_SYNC_SOURCE_HISTORY_CONFLICT");
  const actors=[...new Set(batch.events.map(envelope=>envelope.event.membership_id))];
  const members=await tx.execute<{id:string}>(sql`SELECT id FROM memberships WHERE campaign_id=${auth.campaignId} AND id IN (${sql.join(actors.map(id=>sql`${id}`),sql`, `)}) AND access_revoked_at IS NULL FOR SHARE`);
  if(members.length!==actors.length)throw Error("CLOUD_SYNC_ACTOR_CONFLICT");
  const actions=batch.events.map(envelope=>envelope.event.action_id);
  const committed=await tx.execute(sql`SELECT action_id FROM game_events WHERE campaign_id=${auth.campaignId} AND action_id IN (${sql.join(actions.map(id=>sql`${id}`),sql`, `)}) LIMIT 1`);
  if(committed.length)throw Error("CLOUD_SYNC_ACTION_CONFLICT");

  const [receipt]=await tx.execute<{id:string}>(sql`INSERT INTO cloud_sync_receipts(origin_id,batch_hash,last_sequence,batch_metadata) VALUES(${originId},${hash},${batch.lastSequence}::bigint,${JSON.stringify({after:batch.after,hasMore:batch.hasMore})}::jsonb) RETURNING id`);
  for(const envelope of batch.events)await tx.execute(sql`INSERT INTO cloud_sync_inbox(origin_id,sequence,action_id,receipt_id,envelope) VALUES(${originId},${envelope.event.sequence}::bigint,${envelope.event.action_id},${receipt!.id},${JSON.stringify(envelope)}::jsonb)`);
  await tx.execute(sql`UPDATE cloud_sync_origins SET received_sequence=${batch.lastSequence}::bigint WHERE id=${originId}`);
  return {originId,batchHash:hash,receiptId:receipt!.id,lastSequence:batch.lastSequence,status:"STORED_ONLY" as const};
}

export async function issueCloudSyncGrant(db:Database,auth:AuthContext,accountUserId:string,originId:string){
 uuid.parse(originId);return db.transaction(async tx=>{await authorized(tx,auth,accountUserId);
  const rows=await tx.execute<{host_id:string;session_id:string;epoch:number}>(sql`SELECT host_id,session_id,epoch FROM cloud_sync_origins WHERE id=${originId} AND campaign_id=${auth.campaignId} AND owner_user_id=${accountUserId} AND closed_at IS NULL FOR UPDATE`);if(!rows.length)forbidden();
  const token=randomToken(),id=randomUUID(),tokenHash=hashToken(token);
  const [row]=await tx.execute<{expires_at:Date|string}>(sql`INSERT INTO cloud_sync_grants(origin_id,id,owner_user_id,membership_id,token_hash,expires_at,grant_scope) VALUES(${originId},${id},${accountUserId},${auth.membershipId},${tokenHash},clock_timestamp()+interval '12 hours','STAGING_ONLY')
   ON CONFLICT(origin_id) DO UPDATE SET id=excluded.id,owner_user_id=excluded.owner_user_id,membership_id=excluded.membership_id,token_hash=excluded.token_hash,expires_at=excluded.expires_at,revoked_at=NULL,grant_scope='STAGING_ONLY',created_at=clock_timestamp() RETURNING expires_at`);
  return {grantId:id,originId,origin:{hostId:rows[0]!.host_id,campaignId:auth.campaignId,sessionId:rows[0]!.session_id,epoch:rows[0]!.epoch},token,expiresAt:new Date(row!.expires_at).toISOString(),scope:"STAGING_ONLY" as const};
 });
}
export async function revokeCloudSyncGrant(db:Database,auth:AuthContext,accountUserId:string,originId:string){
 uuid.parse(originId);return db.transaction(async tx=>{await authorized(tx,auth,accountUserId);
  const rows=await tx.execute(sql`SELECT id FROM cloud_sync_origins WHERE id=${originId} AND campaign_id=${auth.campaignId} AND owner_user_id=${accountUserId} FOR UPDATE`);if(!rows.length)forbidden();
  await tx.execute(sql`UPDATE cloud_sync_grants SET revoked_at=clock_timestamp() WHERE origin_id=${originId}`);return {ok:true as const};
 });
}
export async function storeCloudSyncBatchWithGrant(db:Database,originId:string,token:string,input:unknown){
 return withCloudSyncGrant(db,originId,token,(tx,auth,userId)=>storeCloudSyncBatchInTransaction(tx,auth,userId,originId,input));
}
/** Server-only grant boundary for intake and reading its own receipt metadata.
 * It never authorizes writer reservation, applying changes or releasing a lease. */
export async function withCloudSyncGrant<T>(db:Database,originId:string,token:string,operation:(tx:Transaction,auth:AuthContext,userId:string)=>Promise<T>,options?:{statementTimeoutMs:number;readReceipts?:boolean}){
 uuid.parse(originId);if(!/^[A-Za-z0-9_-]{43}$/.test(token))forbidden();const tokenHash=hashToken(token);
 const timeout=options?z.number().int().min(1).max(30000).parse(options.statementTimeoutMs):undefined;
 return db.transaction(async tx=>{
  if(timeout!==undefined)await tx.execute(sql`SELECT set_config('statement_timeout',${String(timeout)},true),set_config('lock_timeout',${String(timeout)},true)`);
  const [identity]=await tx.execute<{campaign_id:string;owner_user_id:string;membership_id:string}>(sql`SELECT o.campaign_id,g.owner_user_id,g.membership_id FROM cloud_sync_grants g JOIN cloud_sync_origins o ON o.id=g.origin_id WHERE g.origin_id=${originId} AND g.token_hash=${tokenHash}`);if(!identity)forbidden();
  const auth={campaignId:identity!.campaign_id,membershipId:identity!.membership_id,role:"GM" as const,displayName:"Sync source"};
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(683149,hashtext(${auth.campaignId}::text))`);
  await authorized(tx,auth,identity!.owner_user_id);
  const valid=await tx.execute(sql`SELECT id FROM cloud_sync_grants WHERE origin_id=${originId} AND token_hash=${tokenHash} AND owner_user_id=${identity!.owner_user_id} AND membership_id=${identity!.membership_id} AND revoked_at IS NULL AND expires_at>clock_timestamp() AND (grant_scope='STAGING_ONLY' OR (${options?.readReceipts===true} AND grant_scope='READ_RECEIPTS_ONLY')) FOR SHARE`);if(!valid.length)forbidden();
  return operation(tx,auth,identity!.owner_user_id);
 });
}

/** Current account reauthorization for an existing CLOSED source only. It
 * rotates the credential, never reopens the source or changes writer authority. */
export async function issueCloudReceiptReadGrant(db:Database,auth:AuthContext,userId:string,input:unknown){
 const descriptor=cloudSourceDescriptorSchema.parse(input);if(descriptor.campaignId!==auth.campaignId)forbidden();
 return db.transaction(async tx=>{
  await tx.execute(sql`SET LOCAL statement_timeout='2s'`);await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(683149,hashtext(${auth.campaignId}::text))`);await authorized(tx,auth,userId);
  const [origin]=await tx.execute<{id:string;transfer_manifest_sha256:string|null}>(sql`SELECT id,transfer_manifest_sha256 FROM cloud_sync_origins WHERE campaign_id=${auth.campaignId} AND owner_user_id=${userId} AND host_id=${descriptor.hostId} AND session_id=${descriptor.sessionId} AND epoch=${descriptor.epoch} AND closed_at IS NOT NULL FOR UPDATE`);if(!origin)return forbidden();
  if(descriptor.transferProof){await verifyCloudTransferOrigin(tx,auth.campaignId,userId,descriptor.transferProof);if(origin.transfer_manifest_sha256!==descriptor.transferProof.manifestSha256)throw Error("CLOUD_SYNC_TRANSFER_PROOF_CONFLICT");}
  const token=randomToken(),id=randomUUID();const [row]=await tx.execute<{expires_at:Date|string}>(sql`INSERT INTO cloud_sync_grants(origin_id,id,owner_user_id,membership_id,token_hash,expires_at,grant_scope) VALUES(${origin.id},${id},${userId},${auth.membershipId},${hashToken(token)},clock_timestamp()+interval '12 hours','READ_RECEIPTS_ONLY') ON CONFLICT(origin_id) DO UPDATE SET id=excluded.id,owner_user_id=excluded.owner_user_id,membership_id=excluded.membership_id,token_hash=excluded.token_hash,expires_at=excluded.expires_at,revoked_at=NULL,grant_scope='READ_RECEIPTS_ONLY',created_at=clock_timestamp() RETURNING expires_at`);
  const {transferProof,...scope}=descriptor;return {grantId:id,originId:origin.id,origin:scope,token,expiresAt:new Date(row!.expires_at).toISOString(),scope:"READ_RECEIPTS_ONLY" as const};
 });
}
