import {createHash} from 'node:crypto';import {z} from 'zod';import {validateTransferApplicationEvent,transferApplicationEventTypes} from './campaign-transfer-application-events.js';import {knownFields,transferInspirationReferences} from './campaign-transfer-chat-events.js';import {skillCardSchema} from './dice-result.js';
/** Immutable application/undo binding. Does not replay receipts or reinterpret
 * historical author permissions using the member's present-day role. */
export function createCampaignTransferApplicationClosure(){
 const messages=new Map<string,{thread:string;author:string;visibility:unknown;card:string|null;cancelled:boolean}>(),applications=new Map<string,{type:string;author:string;card:string|null;undoable:boolean;references:string[]}>(),undos:{message:string;original:string;author:string}[]=[],cancelled=new Set<string>();let closed=false,entries=0;
 const uuid=(v:unknown)=>z.string().uuid().parse(v).toLowerCase(),charge=()=>{if(++entries>1000000)throw Error('CAMPAIGN_TRANSFER_APPLICATION_CLOSURE_LIMIT');};
 const canonical=(v:unknown):string=>{if(v===null)return 'null';if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(typeof v==='object')return '{'+Object.keys(v as object).filter(k=>(v as Record<string,unknown>)[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';if(typeof v==='number'&&!Number.isFinite(v)||v===undefined)throw Error('CAMPAIGN_TRANSFER_APPLICATION_JSON_INVALID');return JSON.stringify(v);};
 const card=(v:unknown)=>{if(v===null||v===undefined)return null;knownFields(skillCardSchema,v);return createHash('sha256').update(canonical(skillCardSchema.parse(v))).digest('hex');};
 return {
  addRow(table:string,row:Record<string,unknown>){if(closed)throw Error('CAMPAIGN_TRANSFER_APPLICATION_CLOSED');try{
   if(table==='chat_messages'){charge();const dice=row.dice as Record<string,unknown>|null,marker=dice?.applicationUndo;let isCancelled=false;if(marker!==undefined)isCancelled=z.object({cancelled:z.boolean()}).strict().parse(marker).cancelled;messages.set(uuid(row.id),{thread:uuid(row.thread_id),author:uuid(row.membership_id),visibility:row.visibility,card:card(dice?.skillCard),cancelled:isCancelled});}
   else if(table==='game_events'&&(transferApplicationEventTypes as readonly unknown[]).includes(row.type)){
    charge();validateTransferApplicationEvent(row);const payload=row.payload as Record<string,any>,message=uuid(row.entity_id),author=uuid(row.membership_id);
    if(row.type==='entry.undo'){undos.push({message,original:uuid(payload.originalMessageId),author});}
    else{if(applications.has(message))throw Error('CAMPAIGN_TRANSFER_APPLICATION_DUPLICATE');const receipt=payload.undoReceipt,skillCard=payload.skillCard;if(skillCard&&skillCard.execution!==(row.type==='entry.shared'?'SHARED':'EXECUTED'))throw Error('CAMPAIGN_TRANSFER_APPLICATION_MODE_INVALID');applications.set(message,{type:String(row.type),author,card:card(skillCard),undoable:!!receipt&&!(receipt.entry&&receipt.consumption),references:transferInspirationReferences(payload).map(uuid)});}
   }
  }catch(error){closed=true;throw error;}},
  finish(){if(closed)throw Error('CAMPAIGN_TRANSFER_APPLICATION_CLOSED');closed=true;
   for(const [id,event] of applications){const message=messages.get(id);if(!message||message.author!==event.author||event.card!==null&&message.card!==event.card)throw Error('CAMPAIGN_TRANSFER_APPLICATION_MESSAGE_BINDING');for(const ref of event.references)if(!messages.has(ref))throw Error('CAMPAIGN_TRANSFER_APPLICATION_INSPIRATION_FORBIDDEN');}
   for(const undo of undos){const original=applications.get(undo.original),before=messages.get(undo.original),notice=messages.get(undo.message);if(cancelled.has(undo.original))throw Error('CAMPAIGN_TRANSFER_APPLICATION_UNDO_DUPLICATE');if(!original||!before||!notice||!original.undoable||!['entry.roll','ability.area.applied'].includes(original.type)||notice.author!==undo.author||notice.thread!==before.thread||notice.visibility!==before.visibility||!before.cancelled)throw Error('CAMPAIGN_TRANSFER_APPLICATION_UNDO_BINDING');cancelled.add(undo.original);}
   for(const [id,event] of applications)if(event.undoable&&messages.get(id)?.cancelled&&!cancelled.has(id))throw Error('CAMPAIGN_TRANSFER_APPLICATION_UNDO_REQUIRED');
   return {applications:applications.size,undos:undos.length};
  },
 };
}
