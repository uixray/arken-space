import {z} from 'zod';
export const transferCreationEventTypes=['creation.rules.version','creation.rules.enabled','creation.template.version','creation.template.fork','creation.template.review','creation.recipe.version','creation.recipe.enabled','creation.operation','creation.transfer','creation.store.policy','creation.store.listing','creation.store.listing.enabled','creation.store.purchase','creation.action.cancelled'] as const;
export const transferEconomyEventTypes=['economy.config','economy.merchant','economy.offer','economy.purchase'] as const;
export const transferCommerceEventTypes=[...transferCreationEventTypes,...transferEconomyEventTypes] as const;
const creation=new Set<string>(transferCreationEventTypes),economy=new Set<string>(transferEconomyEventTypes),uuid=z.string().uuid();
export function commerceEventEntities(type:string):readonly string[]{return creation.has(type)?['creation']:economy.has(type)?['economy']:[];}
export function validateTransferCommerceEvent(input:unknown){
 const event=z.object({type:z.enum(transferCommerceEventTypes),entity_type:z.string(),entity_id:uuid.nullable(),action_id:uuid,membership_id:uuid,payload:z.object({requestHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).passthrough().parse(input);
 if(event.entity_type!==commerceEventEntities(event.type)[0]||(creation.has(event.type)?event.entity_id!==null:event.entity_id===null))throw Error('CAMPAIGN_TRANSFER_COMMERCE_EVENT_ENTITY');return event;
}
