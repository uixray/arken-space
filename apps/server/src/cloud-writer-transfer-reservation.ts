import {mkdtemp,lstat,realpath,rm} from "node:fs/promises";
import {join,resolve,dirname} from "node:path";
import {sql} from "drizzle-orm";
import {z} from "zod";
import type {AuthContext} from "./auth.js";
import type {TransferExportActor} from "./campaign-transfer-export.js";
import {cloudTransferProofSchema} from "@arken/contracts";
import {campaignTransferCatalog} from "./campaign-transfer-policy.js";
import {withCampaignTransferSnapshot} from "./campaign-transfer-source.js";
import {captureCampaignTransferDataDraft} from "./campaign-transfer-data-draft.js";
import {assembleCampaignTransferStructuralCandidate} from "./campaign-transfer-candidate.js";
import {campaignTransferSnapshotDigest,verifyCloudTransferOrigin} from "./campaign-transfer-origin.js";
import {reserveCloudCampaignWriterInTransaction} from "./campaign-writer-authority.js";
type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];
/** Server-only handoff preparation. Never trust a browser-supplied current
 * digest: capture the real approved projection/media under the same fence and
 * transaction as authority CAS. Not exposed by the public connection routes. */
export async function reserveCloudWriterFromTransfer(db:Database,auth:AuthContext,actor:TransferExportActor,input:unknown,options:{root:string;migrations:readonly string[]}){
 const command=z.object({originId:z.string().uuid(),expectedRevision:z.string().regex(/^(0|[1-9][0-9]{0,18})$/),transferProof:cloudTransferProofSchema}).strict().parse(input);
 if(actor.campaignId!==auth.campaignId||actor.membershipId!==auth.membershipId)throw Error("CAMPAIGN_WRITER_FORBIDDEN");
 const parent=resolve(options.root);if((await lstat(parent)).isSymbolicLink()||await realpath(parent)!==parent)throw Error("CLOUD_WRITER_CAPTURE_PATH_INVALID");
 const scratch=await mkdtemp(join(parent,"writer-check-"));
 let committed=false,result:(Awaited<ReturnType<typeof reserveCloudCampaignWriterInTransaction>>&{cleanupPending?:boolean})|undefined;
 try{result=await db.transaction(async tx=>{
  await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
  const [fence]=await tx.execute<{locked:boolean}>(sql`SELECT pg_try_advisory_xact_lock(683149,hashtext(${auth.campaignId}::text)) AS locked`);
  if(!fence?.locked)throw Error("CLOUD_WRITER_CAPTURE_BUSY");
  // Shared libraries/references are not all campaign-scoped writer guards.
  // A fail-fast read fence includes them so concurrent unlogged edits cannot
  // slip between comparison and the authority CAS. Temporary capture only.
  const tables=campaignTransferCatalog().filter(t=>t.policy!=="EXCLUDED_AUTH_RUNTIME").map(t=>t.name).sort();
  await tx.execute(sql`LOCK TABLE ${sql.join(tables.map(t=>sql`public.${sql.identifier(t)}`),sql`, `)} IN SHARE MODE NOWAIT`);
  const started=performance.now();
  const candidate=await withCampaignTransferSnapshot(db,auth,actor.userId,options.migrations,async source=>{
   const draft=await captureCampaignTransferDataDraft(source,scratch);
   return assembleCampaignTransferStructuralCandidate(draft);
  },{accountProof:{sessionId:actor.sessionId,passwordHash:actor.passwordHash}},tx);
  if(performance.now()-started>30000)throw Error("CLOUD_WRITER_CAPTURE_LIMIT");
  const proof=await verifyCloudTransferOrigin(tx,auth.campaignId,actor.userId,command.transferProof);
  const [issued]=await tx.execute<{snapshot_digest:string}>(sql`SELECT snapshot_digest FROM campaign_transfer_exports WHERE manifest_sha256=${proof.manifestSha256} FOR SHARE`);
  const [origin]=await tx.execute<{transfer_manifest_sha256:string|null}>(sql`SELECT transfer_manifest_sha256 FROM cloud_sync_origins WHERE id=${command.originId} AND campaign_id=${auth.campaignId} AND owner_user_id=${actor.userId} AND closed_at IS NULL FOR SHARE`);
  if(origin?.transfer_manifest_sha256!==proof.manifestSha256||!issued||campaignTransferSnapshotDigest(candidate.manifest)!==issued.snapshot_digest)throw Error("CLOUD_WRITER_SNAPSHOT_CONFLICT");
  return reserveCloudCampaignWriterInTransaction(tx,auth,actor.userId,{originId:command.originId,expectedRevision:command.expectedRevision,baselineSequence:proof.baselineSequence});
 },{isolationLevel:"read committed"});committed=true;return result;}
 finally{
  try{
  if(dirname(scratch)!==parent||!/^writer-check-[A-Za-z0-9]+$/.test(scratch.slice(parent.length+1))||await realpath(scratch)!==scratch)throw Error("CLOUD_WRITER_CAPTURE_CLEANUP_PATH");
  await rm(scratch,{recursive:true,force:true});
  }catch(error){if(committed&&result)result.cleanupPending=true;else throw error;}
 }
}
