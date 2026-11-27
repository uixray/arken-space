import {z} from 'zod';
/** Link undo/redo markers to their immutable journal target, using exact SQL
 * bigint keys. Current status/target existence are not historical preimages. */
export function createCampaignTransferCanvasHistoryClosure(){
 const journals=new Map<string,{id:string;type:string;actionId:string|null}>(),transitions:{sequence:string;id:string;type:string;actionId:string|null}[]=[];let closed=false,entries=0;
 const sequence=(value:unknown)=>{let text:string;if(typeof value==='bigint'||typeof value==='string')text=String(value);else if(typeof value==='number'&&Number.isSafeInteger(value))text=String(value);else throw Error('CAMPAIGN_TRANSFER_JOURNAL_SEQUENCE_PRECISION');if(!/^(0|[1-9][0-9]{0,18})$/.test(text)||BigInt(text)>9223372036854775807n)throw Error('CAMPAIGN_TRANSFER_JOURNAL_SEQUENCE_INVALID');return text;};
 const id=(v:unknown)=>z.string().uuid().parse(v).toLowerCase(),type=(v:unknown)=>z.string().min(1).parse(v).toLowerCase();
 return {
  addRow(table:string,row:Record<string,unknown>){if(closed)throw Error('CAMPAIGN_TRANSFER_CANVAS_HISTORY_CLOSED');try{
   if(table==='action_journal'){if(++entries>1000000)throw Error('CAMPAIGN_TRANSFER_CANVAS_HISTORY_LIMIT');const key=sequence(row.sequence);if(journals.has(key))throw Error('CAMPAIGN_TRANSFER_JOURNAL_DUPLICATE');journals.set(key,{id:id(row.target_id),type:type(row.target_type),actionId:row.action_id===undefined?null:id(row.action_id)});}
   else if(table==='game_events'&&(row.type==='canvas.undo'||row.type==='canvas.redo')){if(++entries>1000000)throw Error('CAMPAIGN_TRANSFER_CANVAS_HISTORY_LIMIT');const payload=row.payload as Record<string,unknown>|null;transitions.push({sequence:sequence(payload?.journalSequence),id:id(row.entity_id),type:type(row.entity_type),actionId:payload?.journalActionId===undefined?null:id(payload.journalActionId)});}
  }catch(error){closed=true;throw error;}},
  finish(){if(closed)throw Error('CAMPAIGN_TRANSFER_CANVAS_HISTORY_CLOSED');closed=true;for(const event of transitions){const journal=journals.get(event.sequence);if(!journal)throw Error('CAMPAIGN_TRANSFER_CANVAS_JOURNAL_REQUIRED');if(journal.id!==event.id||journal.type!==event.type||(event.actionId!==null&&journal.actionId!==event.actionId))throw Error('CAMPAIGN_TRANSFER_CANVAS_JOURNAL_TARGET_MISMATCH');}return {journals:journals.size,transitions:transitions.length};},
 };
}
