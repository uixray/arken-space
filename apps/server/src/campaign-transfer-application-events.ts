import {z} from 'zod';
import {entryDataSchema} from '@arken/contracts';
import {consumptionReceiptSchema} from './creation-consumption.js';
import {skillCardSchema} from './dice-result.js';
import {knownFields} from './campaign-transfer-chat-events.js';
const uuid=z.string().uuid(),revision=z.number().int().nonnegative(),n=z.number().finite(),hash=z.string().regex(/^[a-f0-9]{64}$/);
// These two dictionaries are intentional domain extension bags, just as in the
// actual command/undo contract. They are not arbitrary event envelope fields.
const entry=z.object({id:uuid,beforeData:entryDataSchema,afterRevision:revision}).strict();
const character=z.object({id:uuid,beforeResources:z.record(z.string(),z.unknown()),afterRevision:revision}).strict();
const receipt=z.object({version:z.literal(1),entry:entry.nullable(),consumption:consumptionReceiptSchema.optional(),characters:z.array(character).max(10000)}).strict();
const cost=z.object({type:z.enum(['physical','magic']),amount:n,before:n,after:n}).strict().nullable();
const application=z.object({commandHash:hash,skillCard:skillCardSchema,messageId:uuid,undoReceipt:receipt.nullable(),resourceCost:cost}).strict();
const area=z.object({requestHash:hash,messageId:uuid,entryId:uuid,sceneId:uuid,sharedRoll:z.number().int().min(1).max(6),effects:z.array(z.object({characterId:uuid,before:n,after:n,restored:n}).strict()).max(10000),spent:cost,undoReceipt:receipt}).strict();
const undo=z.object({originalMessageId:uuid}).strict();
export const transferApplicationEventTypes=['entry.roll','entry.shared','ability.area.applied','entry.undo'] as const;
export type ApplicationTransferReferences={messageIds:string[];characterIds:string[];entryIds:string[];catalogEntryIds:string[];objectIds:string[];instanceIds:string[];sceneIds:string[];membershipIds:string[]};
export function validateTransferApplicationEvent(input:unknown):ApplicationTransferReferences{
 const event=z.object({type:z.enum(transferApplicationEventTypes),entity_type:z.literal('chat'),entity_id:uuid,membership_id:uuid,payload:z.unknown()}).passthrough().parse(input);
 const refs:ApplicationTransferReferences={messageIds:[event.entity_id],characterIds:[],entryIds:[],catalogEntryIds:[],objectIds:[],instanceIds:[],sceneIds:[],membershipIds:[event.membership_id]};
 const schema=event.type==='entry.undo'?undo:event.type==='ability.area.applied'?area:application;
 // Runtime entryData explicitly permits author-defined extension keys; inspect
 // the envelope/card, not that intentional historical dictionary as a DTO.
 const payload=schema.parse(event.payload) as any;
 const inspect=event.payload as any;
 if(event.type==='entry.undo')knownFields(undo,inspect);
 else {
  const withoutBags={...inspect,undoReceipt:inspect.undoReceipt?{...inspect.undoReceipt,entry:null,characters:[],consumption:undefined}:inspect.undoReceipt};
  knownFields(schema,withoutBags);
  if(inspect.undoReceipt){knownFields(receipt,{...inspect.undoReceipt,entry:null,characters:[],consumption:undefined});for(const person of inspect.undoReceipt.characters)knownFields(character,person);if(inspect.undoReceipt.entry)knownFields(entry,{...inspect.undoReceipt.entry,beforeData:{}});if(inspect.undoReceipt.consumption)knownFields(consumptionReceiptSchema,{...inspect.undoReceipt.consumption,entry:{...inspect.undoReceipt.consumption.entry,data:{}}});}
 }
 if(event.type==='entry.undo'){refs.messageIds.push(payload.originalMessageId);return refs;}
 if(payload.messageId!==event.entity_id)throw Error('CAMPAIGN_TRANSFER_APPLICATION_MESSAGE');
 if(payload.skillCard){if(payload.skillCard.actor.membershipId!==event.membership_id)throw Error('CAMPAIGN_TRANSFER_APPLICATION_ACTOR');refs.characterIds.push(payload.skillCard.actor.characterId);refs.entryIds.push(payload.skillCard.entry.id);if(payload.skillCard.entry.sourceCatalogEntryId)refs.catalogEntryIds.push(payload.skillCard.entry.sourceCatalogEntryId);}
 if(payload.entryId)refs.entryIds.push(payload.entryId);if(payload.sceneId)refs.sceneIds.push(payload.sceneId);
 for(const effect of payload.effects??[])refs.characterIds.push(effect.characterId);
 const before=payload.undoReceipt;
 if(before){if(before.entry)refs.entryIds.push(before.entry.id);for(const person of before.characters)refs.characterIds.push(person.id);if(before.consumption){const consumed=before.consumption;refs.objectIds.push(consumed.objectId);refs.instanceIds.push(consumed.instanceId);refs.entryIds.push(consumed.entryId);refs.characterIds.push(consumed.entry.characterId);}}
 for(const key of Object.keys(refs) as (keyof ApplicationTransferReferences)[])refs[key]=[...new Set(refs[key])];return refs;
}
