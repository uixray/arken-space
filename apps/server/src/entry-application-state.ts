import {createHash} from "node:crypto";
import {z} from "zod";
import {entryRollRequestSchema} from "@arken/contracts";
import {campaigns,characters,characterControllers,gameEvents} from "@arken/db";
import type {AuthContext} from "./auth.js";
import {requireCreationMember} from "./creation-state.js";
import { and, eq, sql } from "drizzle-orm";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Apply and cancellation use the same transaction barrier. */
export async function lockEntryApplication(
  tx: Transaction,
  campaignId: string,
  actionId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`entry:${campaignId}:${actionId}`}, 0))`,
  );
}

export class EntryApplicationStateError extends Error{
 constructor(readonly status:400|403|404|409,readonly code:string){super(code);}
}
/** Preserve the existing shared core's exact normalized command preimage. */
export function entryApplicationHash(characterId:string,entryId:string,body:ReturnType<typeof entryRollRequestSchema.parse>){
 return createHash("sha256").update(JSON.stringify({characterId,entryId,...body,mode:body.mode??"EXECUTE"})).digest("hex");
}
export type EntryApplicationReceipt={actionId:string;messageId:string}|{actionId:string;cancelled:true;notApplied:true};
export function entryApplicationReceipt(event:typeof gameEvents.$inferSelect,membershipId:string,hash:string,mode:"EXECUTE"|"SHARE"):EntryApplicationReceipt{
 const p=event.payload as Record<string,unknown>|null,cancelled=event.type==="entry.application.cancelled";
 if(event.membershipId!==membershipId||!p||p.commandHash!==hash||(cancelled?mode!=="EXECUTE"||event.entityRevision!==0||event.entityType!=="action"||event.entityId!==event.actionId:event.type!==(mode==="EXECUTE"?"entry.roll":"entry.shared")||event.entityType!=="chat"||p.messageId!==event.entityId||!z.string().uuid().safeParse(event.entityId).success))throw new EntryApplicationStateError(409,"ACTION_ID_CONFLICT");
 return cancelled?{actionId:event.actionId,cancelled:true,notApplied:true}:{actionId:event.actionId,messageId:event.entityId!};
}
/** Root/action lock order matches executeCharacterEntry. No resource or chat mutation. */
export async function cancelEntryApplication(db:Database,auth:AuthContext,characterId:string,entryId:string,input:unknown){
 const ids=z.object({characterId:z.string().uuid(),entryId:z.string().uuid()}).parse({characterId,entryId}),body=entryRollRequestSchema.parse(input);if(body.mode==="SHARE")throw new EntryApplicationStateError(400,"ENTRY_CANCEL_EXECUTE_ONLY");
 return db.transaction(async tx=>{
  const [campaign]=await tx.select({id:campaigns.id}).from(campaigns).where(eq(campaigns.id,auth.campaignId)).for("update");if(!campaign)throw new EntryApplicationStateError(404,"CAMPAIGN_NOT_FOUND");
  await lockEntryApplication(tx,auth.campaignId,body.actionId);
  try{await requireCreationMember(tx,auth);}catch(e){if(e instanceof Error&&e.message==="CREATION_FORBIDDEN")throw new EntryApplicationStateError(403,"CHARACTER_ENTRY_FORBIDDEN");throw e;}
  const [character]=await tx.select().from(characters).where(and(eq(characters.id,ids.characterId),eq(characters.campaignId,auth.campaignId))).for("update");if(!character)throw new EntryApplicationStateError(404,"CHARACTER_NOT_FOUND");
  if(auth.role!=="GM"&&character.ownerMembershipId!==auth.membershipId){const [controller]=await tx.select({id:characterControllers.membershipId}).from(characterControllers).where(and(eq(characterControllers.characterId,character.id),eq(characterControllers.membershipId,auth.membershipId))).for("share");if(!controller)throw new EntryApplicationStateError(403,"CHARACTER_ENTRY_FORBIDDEN");}
  const hash=entryApplicationHash(ids.characterId,ids.entryId,body),[prior]=await tx.select().from(gameEvents).where(and(eq(gameEvents.campaignId,auth.campaignId),eq(gameEvents.actionId,body.actionId))).limit(1);
  if(prior)return entryApplicationReceipt(prior,auth.membershipId,hash,"EXECUTE");
  const [event]=await tx.insert(gameEvents).values({campaignId:auth.campaignId,actionId:body.actionId,membershipId:auth.membershipId,type:"entry.application.cancelled",entityType:"action",entityId:body.actionId,entityRevision:0,payload:{commandHash:hash,characterId:ids.characterId,entryId:ids.entryId}}).returning();if(!event)throw Error("EVENT_RECORD_FAILED");return entryApplicationReceipt(event,auth.membershipId,hash,"EXECUTE");
 });
}
