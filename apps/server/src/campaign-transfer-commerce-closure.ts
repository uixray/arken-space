import {z} from 'zod';import {creationCancellationReceiptSchema} from '@arken/contracts';import {transferCreationEventTypes,validateTransferCommerceEvent} from './campaign-transfer-commerce-events.js';
/** Immutable command/event binding, not a reinterpretation of old licences,
 * prices or rules using current campaign state. */
export function createCampaignTransferCommerceClosure(campaignId:string){
 const actions=new Map<string,{type:unknown;actor:string;hash:unknown;cancelled:z.infer<typeof creationCancellationReceiptSchema>|null}>(),purchases=new Map<string,{actor:string;quote:string;receipt:Record<string,unknown>}>(),instanceActions=new Map<string,{actor:string;id:string;hash:unknown}>(),events:ReturnType<typeof validateTransferCommerceEvent>[]=[];let closed=false,entries=0;
 const uuid=(v:unknown)=>z.string().uuid().parse(v).toLowerCase(),charge=()=>{if(++entries>1000000)throw Error('CAMPAIGN_TRANSFER_COMMERCE_CLOSURE_LIMIT');};
 return {
  addRow(table:string,row:Record<string,unknown>){if(closed)throw Error('CAMPAIGN_TRANSFER_COMMERCE_CLOSED');try{
   if(table==='creation_actions'){charge();const key=uuid(row.action_id);if(actions.has(key))throw Error('CAMPAIGN_TRANSFER_CREATION_ACTION_DUPLICATE');const parsed=creationCancellationReceiptSchema.safeParse(row.receipt);actions.set(key,{type:row.type,actor:uuid(row.actor_membership_id),hash:row.request_hash,cancelled:parsed.success?parsed.data:null});}
   else if(table==='economy_purchases'){charge();const key=uuid(row.action_id);if(purchases.has(key))throw Error('CAMPAIGN_TRANSFER_ECONOMY_PURCHASE_DUPLICATE');const receipt=z.object({actionId:z.string().uuid(),quoteId:z.string().uuid(),inventoryInstanceId:z.string().uuid(),characterId:z.string().uuid()}).passthrough().parse(row.receipt);purchases.set(key,{actor:uuid(row.actor_membership_id),quote:uuid(row.quote_id),receipt});}
   else if(table==='world_content_instance_actions'&&row.type==='economy.purchase'){charge();const key=uuid(row.action_id);if(instanceActions.has(key))throw Error('CAMPAIGN_TRANSFER_ECONOMY_ACTION_DUPLICATE');instanceActions.set(key,{actor:uuid(row.actor_membership_id),id:uuid(row.entity_id),hash:(row.payload as Record<string,unknown>|null)?.requestHash});}
   else if(table==='game_events'&&typeof row.type==='string'&&(row.type.startsWith('creation.')||row.type.startsWith('economy.'))){charge();events.push(validateTransferCommerceEvent(row));}
  }catch(error){closed=true;throw error;}},
  finish(){if(closed)throw Error('CAMPAIGN_TRANSFER_COMMERCE_CLOSED');closed=true;
   for(const event of events){const actionId=uuid(event.action_id),actor=uuid(event.membership_id);
    if(event.entity_type==='creation'){
     const action=actions.get(actionId);if(!action||action.actor!==actor||action.hash!==event.payload.requestHash)throw Error('CAMPAIGN_TRANSFER_CREATION_ACTION_REQUIRED');
     if(event.type==='creation.action.cancelled'){if(!action.cancelled||uuid(action.cancelled.actionId)!==actionId||action.cancelled.type!==action.type||!(transferCreationEventTypes as readonly unknown[]).includes(action.type)||action.type==='creation.action.cancelled')throw Error('CAMPAIGN_TRANSFER_CREATION_CANCELLATION_INVALID');}
     else if(action.type!==event.type||action.cancelled!==null)throw Error('CAMPAIGN_TRANSFER_CREATION_ACTION_REQUIRED');
    }else if(event.type==='economy.config'){if(uuid(event.entity_id)!==uuid(campaignId))throw Error('CAMPAIGN_TRANSFER_ECONOMY_FOREIGN_REFERENCE');}
    else if(event.type==='economy.purchase'){
     const purchase=purchases.get(actionId),instanceAction=instanceActions.get(actionId);if(!purchase||purchase.actor!==actor||uuid(purchase.receipt.actionId)!==actionId||uuid(purchase.receipt.quoteId)!==purchase.quote||uuid(purchase.receipt.inventoryInstanceId)!==uuid(event.entity_id)||!instanceAction||instanceAction.actor!==actor||instanceAction.id!==uuid(event.entity_id)||instanceAction.hash!==event.payload.requestHash)throw Error('CAMPAIGN_TRANSFER_ECONOMY_PURCHASE_REQUIRED');
    }
   }return {events:events.length,actions:actions.size,purchases:purchases.size};
  },
 };
}
