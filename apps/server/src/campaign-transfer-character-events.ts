import {z} from 'zod';
import {walletSchema,campaignPauseStateSchema,inspirationStateSchema,characterMediaCategorySchema,characterMediaVisibilitySchema} from '@arken/contracts';
import {knownFields} from './campaign-transfer-chat-events.js';
const uuid=z.string().uuid(),count=z.number().int().nonnegative(),hash=z.string().regex(/^[a-f0-9]{64}$/),stamp=z.string().datetime();
const media=z.object({id:uuid,campaignId:uuid,characterId:uuid,assetId:uuid,category:characterMediaCategorySchema,caption:z.string().nullable(),ordering:count,visibility:characterMediaVisibilitySchema,relatedEntityId:uuid.nullable(),uploadedByMembershipId:uuid,detachedAt:stamp.nullable(),detachedByMembershipId:uuid.nullable(),revision:count,createdAt:stamp,updatedAt:stamp}).strict();
const character=z.object({characterId:uuid}).strict(),nil=z.null();
const records:Record<string,{entity:string;schema:z.ZodTypeAny}>={};
function add(types:readonly string[],entity:string,schema:z.ZodTypeAny){for(const type of types)records[type]={entity,schema};}
add(['campaign.pause'],'campaign',z.object({commandHash:hash,response:campaignPauseStateSchema}).strict());
add(['campaign.clock'],'campaign',z.object({command:z.enum(['ADVANCE_DAY','LONG_REST','START_BATTLE','END_BATTLE','RESET_CLOCK']),previousDay:count,previousBattleCounter:count,day:count,battleCounter:count,recharged:count,rebasedEntries:count,restoredCharacters:count}).strict());
add(['campaign.renamed'],'campaign',z.object({name:z.string()}).strict());
add(['campaign.stat-layout.updated'],'campaign',z.object({keys:z.array(z.string())}).strict());
add(['campaign.initiative.updated'],'campaign',z.object({participants:count,added:z.number().int().optional()}).strict());
add(['campaign.battle_zone.updated'],'campaign',z.object({cleared:z.boolean()}).strict());
add(['character.stat-layout.updated'],'character',z.object({fingerprint:z.string(),keys:z.array(z.string())}).strict());
add(['character.created','character.updated'],'character',character);
add(['character.controllers_replaced'],'character',z.object({controllerMembershipIds:z.array(uuid)}).strict());
add(['character.archived'],'character',character.extend({from:z.literal('ACTIVE'),to:z.literal('ARCHIVED')}).strict());
add(['character.restored'],'character',character.extend({from:z.literal('ARCHIVED'),to:z.literal('ACTIVE')}).strict());
// Resources are a deliberate custom-key domain dictionary, not an untyped
// event envelope. Existing pool metadata must survive a campaign transfer.
add(['character.counters'],'character',z.object({commandHash:hash,wallet:walletSchema.optional(),resources:z.record(z.string(),z.unknown()).optional(),rest:z.enum(['SHORT','LONG']).optional()}).strict());
add(['character.inspiration'],'character',z.object({commandHash:hash,before:inspirationStateSchema,after:inspirationStateSchema,reason:z.string(),sourceMessageId:uuid.nullable(),result:z.object({state:inspirationStateSchema,revision:count,messageId:uuid.nullable()}).strict()}).strict());
add(['character_media.created','character_media.updated','character_media.reordered','character_media.detached'],'character_media',media);
add(['character_media.deleted'],'character_media',nil);
add(['catalog.created','catalog.updated','catalog.deleted'],'catalog_entry',nil);
add(['character_catalog.created','character_catalog.assigned','character_catalog.updated'],'character_catalog_entry',nil);
add(['character_catalog.deleted'],'character_catalog_entry',character);
add(['CHARACTER_PROGRESSION'],'PLAYER_REQUEST',z.object({commandHash:hash}).strict());
export const transferCharacterEventTypes=Object.freeze(Object.keys(records));
export function characterEventEntities(type:string):readonly string[]{return records[type]?[records[type]!.entity]:[];}
export type CharacterEventReferences={campaignIds:string[];characterIds:string[];membershipIds:string[];assetIds:string[];mediaIds:string[];catalogEntryIds:string[];entryIds:string[];requestIds:string[];messageIds:string[]};
export function validateTransferCharacterEvent(input:unknown):CharacterEventReferences{
 const event=z.object({type:z.string(),entity_type:z.string(),entity_id:uuid,payload:z.unknown()}).passthrough().parse(input),descriptor=records[event.type];
 if(!descriptor||descriptor.entity!==event.entity_type)throw Error('CAMPAIGN_TRANSFER_CHARACTER_EVENT_UNREVIEWED');knownFields(descriptor.schema,event.payload);const p=descriptor.schema.parse(event.payload) as any;
 const refs:CharacterEventReferences={campaignIds:[],characterIds:[],membershipIds:[],assetIds:[],mediaIds:[],catalogEntryIds:[],entryIds:[],requestIds:[],messageIds:[]};
 const target={campaign:'campaignIds',character:'characterIds',character_media:'mediaIds',catalog_entry:'catalogEntryIds',character_catalog_entry:'entryIds',PLAYER_REQUEST:'requestIds'} as const;refs[target[descriptor.entity as keyof typeof target]].push(event.entity_id);
 if(p){if((p.id&&p.id!==event.entity_id)||(descriptor.entity==='character'&&p.characterId&&p.characterId!==event.entity_id)||(p.response?.campaignId&&p.response.campaignId!==event.entity_id))throw Error('CAMPAIGN_TRANSFER_CHARACTER_EVENT_IDENTITY');
  if(p.campaignId)refs.campaignIds.push(p.campaignId);if(p.characterId)refs.characterIds.push(p.characterId);if(p.assetId)refs.assetIds.push(p.assetId);if(p.uploadedByMembershipId)refs.membershipIds.push(p.uploadedByMembershipId);if(p.detachedByMembershipId)refs.membershipIds.push(p.detachedByMembershipId);if(p.controllerMembershipIds)refs.membershipIds.push(...p.controllerMembershipIds);
  if(p.relatedEntityId)throw Error('CAMPAIGN_TRANSFER_MEDIA_RELATED_ENTITY_UNREVIEWED');
  if(p.sourceMessageId)refs.messageIds.push(p.sourceMessageId);if(p.result?.messageId)refs.messageIds.push(p.result.messageId);
  for(const pool of Object.values(p.resources??{})){if(pool&&typeof pool==='object'&&'imageAssetId' in pool&&pool.imageAssetId!==null&&pool.imageAssetId!==undefined)refs.assetIds.push(uuid.parse(pool.imageAssetId));}
 }
 for(const key of Object.keys(refs) as (keyof CharacterEventReferences)[])refs[key]=[...new Set(refs[key])];return refs;
}
