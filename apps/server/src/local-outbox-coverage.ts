import {sql} from "drizzle-orm";
import type {AuthContext} from "./auth.js";
import {env} from "./env.js";
import {withLocalOwner} from "./local-session-authority.js";
type Database=Parameters<typeof withLocalOwner>[0];
/** Event-log coverage only: NOT proof that arbitrary SQL state matches the cloud.
 * Never backfills missing events or invents historical authority epochs. */
export async function inspectLocalOutboxCoverage(db:Database,auth:AuthContext){
 return withLocalOwner(db,auth,async tx=>{
  // Owner boundary already owns the campaign row. Never wait on an inverted
  // writer-lock order: an in-flight writer causes an honest retry instead.
  const [fence]=await tx.execute<{locked:boolean}>(sql`SELECT pg_try_advisory_xact_lock(683149,hashtext(${auth.campaignId}::text)) AS locked`);
  if(!fence?.locked)return {status:"BUSY" as const,checkedEvents:0};
  const [receipt]=await tx.execute<{baseline:string|null}>(sql`SELECT i.source_baseline_sequence::text AS baseline FROM local_campaign_imports i JOIN local_host_instances h ON h.id=i.instance_id AND h.owner_user_id=i.owner_user_id WHERE i.campaign_id=${auth.campaignId} AND i.instance_id=${env.LOCAL_INSTANCE_ID}`);
  if(!receipt)return {status:"NOT_IMPORTED" as const,checkedEvents:0};
  if(receipt.baseline===null)return {status:"BASELINE_UNKNOWN" as const,checkedEvents:0};
  const baseline=receipt.baseline;
  const [ceiling]=await tx.execute<{sequence:string}>(sql`SELECT GREATEST(coalesce(max(sequence),0),${baseline}::bigint)::text AS sequence FROM game_events WHERE campaign_id=${auth.campaignId}`);
  const throughSequence=ceiling!.sequence;let after=baseline,checkedEvents=0;
  const deadline=performance.now()+10000;
  const result=(status:"COVERED"|"MISSING_EVENTS"|"INTEGRITY_CONFLICT"|"EVENT_TOO_LARGE"|"LIMIT_REACHED",firstProblemSequence?:string)=>({status,baselineSequence:baseline,throughSequence,checkedEvents,...(firstProblemSequence?{firstProblemSequence}:{})});
  while(BigInt(after)<BigInt(throughSequence)){
   if(checkedEvents>=1000000||performance.now()>=deadline)return result("LIMIT_REACHED");
   const rows=await tx.execute<{sequence:string;present:boolean;valid:boolean;oversized:boolean}>(sql`
    SELECT g.sequence::text AS sequence,o.event_sequence IS NOT NULL AS present,
     (o.campaign_id=g.campaign_id AND o.action_id=g.action_id AND o.event IS NOT DISTINCT FROM to_jsonb(g)) AS valid,
     octet_length(to_jsonb(g)::text)>262144 AS oversized
    FROM game_events g LEFT JOIN local_event_outbox o ON o.origin_host_id=${env.LOCAL_INSTANCE_ID} AND o.event_sequence=g.sequence
    WHERE g.campaign_id=${auth.campaignId} AND g.sequence>${after}::bigint AND g.sequence<=${throughSequence}::bigint ORDER BY g.sequence LIMIT ${Math.min(128,1000000-checkedEvents)}`);
   if(performance.now()>=deadline)return result("LIMIT_REACHED");
   if(!rows.length)return result("INTEGRITY_CONFLICT",after);
   for(const row of rows){
    checkedEvents++;
    if(!row.present)return result("MISSING_EVENTS",row.sequence);
    if(row.oversized)return result("EVENT_TOO_LARGE",row.sequence);
    if(!row.valid)return result("INTEGRITY_CONFLICT",row.sequence);
    after=row.sequence;
   }
  }
  return result("COVERED");
 },{statementTimeoutMs:2000});
}
