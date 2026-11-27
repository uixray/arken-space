import {sql} from "drizzle-orm";
import {z} from "zod";
import {localAuthoritySchema,type LocalAuthority} from "@arken/contracts";
import type {AuthContext} from "./auth.js";
import {env} from "./env.js";
import {withLocalOwner} from "./local-session-authority.js";
import {createLocalEventEnvelope,localEventSequenceSchema} from "./local-event-envelope.js";
type Database=Parameters<typeof withLocalOwner>[0];
/** Server-only preparation; no outbound request, ACK or destructive dequeue. */
type Transaction=Parameters<Parameters<Database["transaction"]>[0]>[0];
const querySchema=z.object({after:localEventSequenceSchema.optional(),limit:z.number().int().min(1).max(64).default(32)}).strict();
export async function prepareLocalEventBatch(db:Database,auth:AuthContext,input:unknown){
 const query=querySchema.parse(input);return withLocalOwner(db,auth,tx=>readBatch(tx,auth.campaignId,query));
}
/** Internal transaction helper; caller must hold the owner/outbox authority fence. */
export async function prepareLocalEventBatchForAuthority(tx:Transaction,inputScope:LocalAuthority,input:unknown){
 const scope=localAuthoritySchema.parse(inputScope);if(scope.hostId!==env.LOCAL_INSTANCE_ID)throw Error("LOCAL_EVENT_SCOPE_MISMATCH");return readBatch(tx,scope.campaignId,querySchema.parse(input),scope);
}
async function readBatch(tx:Transaction,campaignId:string,query:ReturnType<typeof querySchema.parse>,scope?:LocalAuthority){
  const rows=await tx.execute<{sequence:string;session_id:string;epoch:number}>(sql`
   SELECT event_sequence::text AS sequence,authority_session_id AS session_id,authority_epoch AS epoch FROM local_event_outbox
   WHERE campaign_id=${campaignId} AND origin_host_id=${env.LOCAL_INSTANCE_ID}
    AND ${scope?sql`authority_session_id=${scope.sessionId} AND authority_epoch=${scope.epoch}`:sql`true`} AND event_sequence>${query.after??"0"}::bigint ORDER BY event_sequence LIMIT ${query.limit+1}`);
  const events:ReturnType<typeof createLocalEventEnvelope>[]=[];let bytes=0;
  for(const row of rows.slice(0,query.limit)){
   // One registered session/epoch per intake batch; handoff is a separate gate.
   const first=events[0]?.origin;
   if(first&&(first.sessionId!==row.session_id||first.epoch!==row.epoch))break;
   const [stored]=await tx.execute<{event:unknown;bytes:number;valid:boolean}>(sql`
    SELECT octet_length(event::text)::int AS bytes,
     (event->>'sequence'=event_sequence::text AND event->>'campaign_id'=campaign_id::text AND event->>'action_id'=action_id::text) AS valid,
     CASE WHEN octet_length(event::text)<=262144 THEN event||jsonb_build_object('sequence',event_sequence::text) ELSE NULL END AS event
    FROM local_event_outbox WHERE origin_host_id=${env.LOCAL_INSTANCE_ID} AND event_sequence=${row.sequence}::bigint AND campaign_id=${campaignId}`);
   if(!stored||!stored.valid)throw Error("LOCAL_EVENT_INTEGRITY_INVALID");
   if(stored.bytes>262144)throw Error("LOCAL_EVENT_TOO_LARGE");
   const envelope=createLocalEventEnvelope({hostId:env.LOCAL_INSTANCE_ID,campaignId:campaignId,sessionId:row.session_id,epoch:row.epoch},stored.event);
   const size=Buffer.byteLength(JSON.stringify(envelope));
   // Reserve bounded DTO metadata and array separators within the wire budget.
   if(bytes+size>1024*1024-2048)break;
   events.push(envelope);bytes+=size;
  }
  return {version:1 as const,hostId:env.LOCAL_INSTANCE_ID,campaignId:campaignId,events,
   after:query.after??null,lastSequence:events.at(-1)?.event.sequence??query.after??null,
   hasMore:rows.length>events.length,delivery:"NOT_CONFIGURED" as const};

}
