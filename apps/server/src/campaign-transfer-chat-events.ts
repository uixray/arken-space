import {z} from 'zod';
import {stickerPresentationSchema,chatAttachmentMetadataSchema} from '@arken/contracts';
import {diceResultSchema,skillCardSchema} from './dice-result.js';
const uuid=z.string().uuid();
const delivery=z.object({id:uuid,sequence:z.number().int(),membershipId:uuid,displayName:z.string(),characterId:uuid.nullable(),body:z.string(),playerRequestId:uuid.nullable().optional(),visibility:z.enum(['PUBLIC','GM_ONLY']),kind:z.enum(['TEXT','DICE','SYSTEM']),threadId:uuid,stream:z.enum(['TABLE','ROLLS','STORY']).nullable(),dice:diceResultSchema.nullable(),skillCard:skillCardSchema.nullable().optional(),applicationUndo:z.object({cancelled:z.boolean()}).strict().nullable().optional(),stickerId:uuid.nullable().optional(),globalStickerId:uuid.nullable().optional(),stickerPresentation:stickerPresentationSchema.nullable().optional(),attachments:z.array(chatAttachmentMetadataSchema).optional(),createdAt:z.string().datetime(),serverCommandHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),galleryShareSourceMediaId:uuid.optional(),galleryShareCaptionProvided:z.boolean().optional(),galleryShareCaptionOverride:z.string().nullable().optional()}).strict();
/** Check all nested keys, including schemas whose runtime normalizer strips
 * unknown fields. Export must fail, not retain stripped private JSON. */
export function knownFields(schema:z.ZodTypeAny,value:unknown):void{
 const d=schema._def as any;
 if(value===null||value===undefined)return;
 switch(d.type){
  case 'object':{const shape=d.shape;if(typeof value!=='object'||Array.isArray(value))return;for(const [key,item] of Object.entries(value)){if(!Object.hasOwn(shape,key))throw Error('CAMPAIGN_TRANSFER_CHAT_EVENT_FIELD_UNREVIEWED');knownFields(shape[key],item);}break;}
  case 'array':if(Array.isArray(value))for(const item of value)knownFields(d.element,item);break;
  case 'optional':case 'nullable':case 'default':knownFields(d.innerType,value);break;
  case 'pipe':knownFields(d.in,value);break;
  case 'tuple':if(Array.isArray(value))value.forEach((item,index)=>{if(d.items[index])knownFields(d.items[index],item);});break;
  case 'union':{const selected=d.options.find((option:z.ZodTypeAny)=>option.safeParse(value).success);if(selected)knownFields(selected,value);break;}
 }
}
export function validateTransferChatDelivery(input:unknown){
 knownFields(delivery,input);return delivery.parse(input);
}
export const transferChatDeliveryTypes=['chat.created','dice.created'] as const;

export function transferInspirationReferences(value:unknown):string[]{
 const ids=new Set<string>();
 const visit=(value:unknown)=>{if(!value||typeof value!=="object")return;if(Array.isArray(value)){value.forEach(visit);return;}const record=value as Record<string,unknown>;if(record.inspiration&&typeof record.inspiration==="object"){const id=(record.inspiration as Record<string,unknown>).sourceMessageId;if(typeof id==="string")ids.add(id);}Object.values(record).forEach(visit);};visit(value);return [...ids];
}
