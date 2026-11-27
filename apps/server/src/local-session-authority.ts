import {cloudTransferProofSchema} from "@arken/contracts";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "./env.js";
import { hashToken,randomToken } from "./security.js";
import type { AuthContext } from "./auth.js";
import { localAuthoritySchema,localPeerBindingSchema,type LocalAuthority } from "@arken/contracts";

type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction=Parameters<Parameters<Database["transaction"]>[0]>[0];
const uuid=z.string().uuid(),secret=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const denied=()=>{throw Object.assign(new Error("LOCAL_SESSION_FORBIDDEN"),{statusCode:403});};
export type { LocalAuthority } from "@arken/contracts";

function localOnly(){if(env.DEPLOYMENT_MODE!=="LOCAL_HOST")denied();}
export async function getLocalAuthorityStatus(db:Database,auth:AuthContext){
  return db.transaction(async tx=>{
    await lock(tx,auth.campaignId);await owner(tx,auth);
    const rows=await tx.execute<{epoch:number;active:boolean}>(sql`SELECT epoch,active FROM local_session_authorities WHERE campaign_id=${auth.campaignId}`);
    const pending=await tx.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM
      (SELECT 1 FROM local_event_outbox WHERE campaign_id=${auth.campaignId} AND origin_host_id=${env.LOCAL_INSTANCE_ID} LIMIT 100001) pending`);
    const count=pending[0]?.count??0;
    const outbox={pendingEvents:Math.min(count,100000),limited:count>100000,delivery:"NOT_CONFIGURED" as const};
    const [imported]=await tx.execute<{manifest_sha256:string;baseline:string|null;schema_digest:string|null}>(sql`SELECT i.manifest_sha256,i.source_baseline_sequence::text AS baseline,i.source_schema_digest AS schema_digest FROM local_campaign_imports i JOIN local_host_instances h ON h.id=i.instance_id AND h.owner_user_id=i.owner_user_id WHERE i.campaign_id=${auth.campaignId} AND i.instance_id=${env.LOCAL_INSTANCE_ID}`);
    const transferProof=imported?.baseline!==null&&imported?.schema_digest?cloudTransferProofSchema.parse({manifestSha256:imported.manifest_sha256,baselineSequence:imported.baseline,schemaDigest:imported.schema_digest}):undefined;
    const row=rows[0];return {...(transferProof?{transferProof}:{}),outbox,lastEpoch:row?.epoch??0,active:row?.active??false,...(row?.active?{authority:await authority(tx,auth.campaignId)}:{})};
  });
}

export async function stopLocalAuthority(db:Database,auth:AuthContext,expectedEpoch:number){
  z.number().int().min(1).max(2147483647).parse(expectedEpoch);
  await db.transaction(async tx=>{
    await lock(tx,auth.campaignId);await owner(tx,auth);
    const rows=await tx.execute(sql`UPDATE local_session_authorities SET active=false,updated_at=now()
      WHERE campaign_id=${auth.campaignId} AND host_id=${env.LOCAL_INSTANCE_ID} AND epoch=${expectedEpoch} RETURNING campaign_id`);
    if(!rows.length)throw Object.assign(new Error("LOCAL_AUTHORITY_CONFLICT"),{statusCode:409});
    await tx.execute(sql`DELETE FROM local_session_pairings WHERE campaign_id=${auth.campaignId}`);
    await tx.execute(sql`UPDATE local_session_peers SET revoked_at=now() WHERE campaign_id=${auth.campaignId}`);
  });
}
async function owner(tx:Transaction,auth:AuthContext){
  localOnly();if(auth.role!=="GM")denied();
  const rows=await tx.execute(sql`SELECT m.id FROM memberships m JOIN local_host_instances h ON h.owner_user_id=m.user_id JOIN users u ON u.id=h.owner_user_id
    WHERE m.id=${auth.membershipId} AND m.campaign_id=${auth.campaignId} AND m.role='GM'
    AND m.access_revoked_at IS NULL AND u.disabled_at IS NULL AND h.id=${env.LOCAL_INSTANCE_ID} FOR SHARE OF m,h,u`);
  if(!rows.length)denied();
}
async function lock(tx:Transaction,campaignId:string){
  // Same lock serializes start, pairing, revoke and eventual gateway writes.
  const rows=await tx.execute(sql`SELECT id FROM campaigns WHERE id=${campaignId} FOR UPDATE`);
  if(!rows.length)denied();
}
async function authority(tx:Transaction,campaignId:string):Promise<LocalAuthority>{
  const rows=await tx.execute<{campaign_id:string;host_id:string;session_id:string;epoch:number}>(sql`
    SELECT campaign_id,host_id,session_id,epoch FROM local_session_authorities
    WHERE campaign_id=${campaignId} AND host_id=${env.LOCAL_INSTANCE_ID} AND active=true`);
  const row=rows[0];if(!row)return denied();
  return {campaignId:row.campaign_id,hostId:row.host_id,sessionId:row.session_id,epoch:row.epoch};
}

/** Explicit CAS rotation. Route failure alone must never invoke this. */
export async function startLocalAuthority(db:Database,auth:AuthContext,expectedEpoch:number){
  z.number().int().min(0).max(2147483646).parse(expectedEpoch);
  return db.transaction(async tx=>{
    await lock(tx,auth.campaignId);await owner(tx,auth);
    const current=await tx.execute<{epoch:number}>(sql`SELECT epoch FROM local_session_authorities WHERE campaign_id=${auth.campaignId}`);
    if((current[0]?.epoch??0)!==expectedEpoch)throw Object.assign(new Error("LOCAL_AUTHORITY_CONFLICT"),{statusCode:409});
    const sessionId=randomUUID(),epoch=expectedEpoch+1;
    await tx.execute(sql`INSERT INTO local_session_authorities(campaign_id,host_id,session_id,epoch)
      VALUES(${auth.campaignId},${env.LOCAL_INSTANCE_ID},${sessionId},${epoch})
      ON CONFLICT(campaign_id) DO UPDATE SET host_id=excluded.host_id,session_id=excluded.session_id,epoch=excluded.epoch,active=true,updated_at=now()`);
    await tx.execute(sql`DELETE FROM local_session_pairings WHERE campaign_id=${auth.campaignId}`);
    await tx.execute(sql`UPDATE local_session_peers SET revoked_at=now() WHERE campaign_id=${auth.campaignId}`);
    return {campaignId:auth.campaignId,hostId:env.LOCAL_INSTANCE_ID,sessionId,epoch};
  });
}

/** Pairing is scoped to an already approved PLAYER membership, not an invite to become GM. */
export async function issueLocalPairing(db:Database,auth:AuthContext,input:unknown){
  const body=z.object({membershipId:uuid,deviceId:uuid}).strict().parse(input);
  return db.transaction(async tx=>{
    await lock(tx,auth.campaignId);await owner(tx,auth);const a=await authority(tx,auth.campaignId);
    const member=await tx.execute(sql`SELECT id FROM memberships WHERE id=${body.membershipId} AND campaign_id=${auth.campaignId}
      AND role='PLAYER' AND access_revoked_at IS NULL FOR SHARE`);
    if(!member.length)denied();
    await tx.execute(sql`DELETE FROM local_session_pairings WHERE campaign_id=${auth.campaignId}
      AND membership_id=${body.membershipId} AND device_id=${body.deviceId}`);
    const token=randomToken(),id=randomUUID();
    await tx.execute(sql`INSERT INTO local_session_pairings(id,campaign_id,session_id,epoch,membership_id,device_id,token_hash,expires_at)
      VALUES(${id},${auth.campaignId},${a.sessionId},${a.epoch},${body.membershipId},${body.deviceId},${hashToken(token)},now()+interval '5 minutes')`);
    return {authority:a,pairingId:id,token,expiresInSeconds:300};
  });
}

/** Trusted local pairing entrypoint; the secret is never stored in plaintext. */
export async function redeemLocalPairing(db:Database,input:unknown){
  localOnly();const body=z.object({campaignId:uuid,deviceId:uuid,token:secret}).strict().parse(input);
  return db.transaction(async tx=>{
    await lock(tx,body.campaignId);const a=await authority(tx,body.campaignId);
    const rows=await tx.execute<{id:string;membership_id:string}>(sql`SELECT p.id,p.membership_id FROM local_session_pairings p
      JOIN memberships m ON m.id=p.membership_id AND m.campaign_id=p.campaign_id
      WHERE p.campaign_id=${body.campaignId} AND p.session_id=${a.sessionId} AND p.epoch=${a.epoch}
      AND p.device_id=${body.deviceId} AND p.token_hash=${hashToken(body.token)} AND p.expires_at>now() AND p.consumed_at IS NULL
      AND m.role='PLAYER' AND m.access_revoked_at IS NULL FOR SHARE OF m`);
    const row=rows[0];if(!row)return denied();
    const credential=randomToken();
    await tx.execute(sql`UPDATE local_session_pairings SET consumed_at=now() WHERE id=${row.id}`);
    await tx.execute(sql`INSERT INTO local_session_peers(campaign_id,membership_id,device_id,session_id,epoch,credential_hash,expires_at)
      VALUES(${body.campaignId},${row.membership_id},${body.deviceId},${a.sessionId},${a.epoch},${hashToken(credential)},now()+interval '12 hours')
      ON CONFLICT(campaign_id,membership_id,device_id) DO UPDATE SET session_id=excluded.session_id,epoch=excluded.epoch,
      credential_hash=excluded.credential_hash,expires_at=excluded.expires_at,revoked_at=NULL`);
    return {authority:a,membershipId:row.membership_id,deviceId:body.deviceId,credential,expiresInSeconds:43200};
  });
}

/** Execute the future gateway command under the SAME transaction/fence as auth. */
export async function withLocalPeer<T>(db:Database,input:unknown,operation:(tx:Transaction,auth:AuthContext,a:LocalAuthority)=>Promise<T>,options?:{isolationLevel:"serializable"}):Promise<T>{
  localOnly();const body=localPeerBindingSchema.parse(input);
  return db.transaction(async tx=>{
    await lock(tx,body.campaignId);const a=await authority(tx,body.campaignId);
    if(a.sessionId!==body.sessionId||a.epoch!==body.epoch)return denied();
    const rows=await tx.execute<{id:string;display_name:string}>(sql`SELECT m.id,m.display_name FROM local_session_peers p
      JOIN memberships m ON m.id=p.membership_id AND m.campaign_id=p.campaign_id
      WHERE p.campaign_id=${body.campaignId} AND p.device_id=${body.deviceId} AND p.session_id=${a.sessionId} AND p.epoch=${a.epoch}
      AND p.credential_hash=${hashToken(body.credential)} AND p.revoked_at IS NULL AND p.expires_at>now()
      AND m.role='PLAYER' AND m.access_revoked_at IS NULL FOR SHARE OF m`);
    const row=rows[0];if(!row)return denied();
    return operation(tx,{campaignId:body.campaignId,membershipId:row.id,role:"PLAYER",displayName:row.display_name},a);
  },options);
}

export async function revokeLocalPeer(db:Database,auth:AuthContext,input:unknown){
  const body=z.object({membershipId:uuid,deviceId:uuid}).strict().parse(input);
  await db.transaction(async tx=>{
    await lock(tx,auth.campaignId);await owner(tx,auth);
    await tx.execute(sql`DELETE FROM local_session_pairings WHERE campaign_id=${auth.campaignId} AND membership_id=${body.membershipId} AND device_id=${body.deviceId}`);
    await tx.execute(sql`UPDATE local_session_peers SET revoked_at=now() WHERE campaign_id=${auth.campaignId} AND membership_id=${body.membershipId} AND device_id=${body.deviceId}`);
  });
}

/** Internal owner boundary for server-only sync preparation, never peer auth. */
export async function withLocalOwner<T>(db:Database,auth:AuthContext,read:(tx:Transaction)=>Promise<T>,options?:{statementTimeoutMs:number}):Promise<T>{
 const timeout=options?z.number().int().min(1).max(30000).parse(options.statementTimeoutMs):undefined;
 return db.transaction(async tx=>{
  if(timeout!==undefined)await tx.execute(sql`SELECT set_config('statement_timeout',${String(timeout)},true),set_config('lock_timeout',${String(timeout)},true)`);
  await lock(tx,auth.campaignId);await owner(tx,auth);return read(tx);
 });
}

export async function withLocalOwnerAuthority<T>(db:Database,auth:AuthContext,read:(scope:LocalAuthority,tx:Transaction)=>Promise<T>):Promise<T>{
 return withLocalOwner(db,auth,async tx=>read(await authority(tx,auth.campaignId),tx));
}

/** Historical credentials are reachable only for an owner and a scope proven by
 * this host's durable outbox, not an arbitrary client-supplied authority. */
export async function withLocalOwnerOutboxAuthority<T>(db:Database,auth:AuthContext,input:unknown,read:(scope:LocalAuthority,tx:Transaction)=>Promise<T>):Promise<T>{
 const scope=localAuthoritySchema.parse(input);
 return withLocalOwner(db,auth,async tx=>{
  if(scope.campaignId!==auth.campaignId||scope.hostId!==env.LOCAL_INSTANCE_ID)denied();
  const rows=await tx.execute(sql`SELECT 1 FROM local_event_outbox WHERE campaign_id=${scope.campaignId} AND origin_host_id=${scope.hostId} AND authority_session_id=${scope.sessionId} AND authority_epoch=${scope.epoch} LIMIT 1`);
  if(!rows.length)denied();return read(scope,tx);
 });
}

/** Owner-only cloud control accepts a selected durable historical scope or the
 * current active authority. It never authorizes an arbitrary device identity. */
export async function withLocalOwnerCloudAuthority<T>(db:Database,auth:AuthContext,input:unknown,read:(scope:LocalAuthority,tx:Transaction)=>Promise<T>,options?:{statementTimeoutMs:number}):Promise<T>{
 if(input===undefined)return withLocalOwner(db,auth,async tx=>read(await authority(tx,auth.campaignId),tx),options);
 const scope=localAuthoritySchema.parse(input);
 return withLocalOwner(db,auth,async tx=>{
  if(scope.campaignId!==auth.campaignId||scope.hostId!==env.LOCAL_INSTANCE_ID)denied();
  const proof=await tx.execute(sql`SELECT 1 FROM local_event_outbox WHERE campaign_id=${scope.campaignId} AND origin_host_id=${scope.hostId} AND authority_session_id=${scope.sessionId} AND authority_epoch=${scope.epoch}
   UNION ALL SELECT 1 FROM local_session_authorities WHERE campaign_id=${scope.campaignId} AND host_id=${scope.hostId} AND session_id=${scope.sessionId} AND epoch=${scope.epoch} AND active=true LIMIT 1`);
  if(!proof.length)denied();return read(scope,tx);
 },options);
}
