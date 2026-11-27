import {z} from 'zod';
import {storyEntityLinkSchema,storyPostMediaInputSchema,storyPostLifecycleSchema,storyImportProviderSchema,storyRightsStatusSchema} from '@arken/contracts';
import {knownFields} from './campaign-transfer-chat-events.js';
const uuid=z.string().uuid(),count=z.number().int().nonnegative(),stamp=z.string().datetime(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const post=z.object({id:uuid,threadId:uuid,authorMembershipId:uuid,title:z.string(),body:z.string(),revision:count,entityLinks:z.array(storyEntityLinkSchema),linkTargets:z.array(storyEntityLinkSchema.extend({label:z.string().nullable(),playerVisible:z.boolean()}).strict()),media:z.array(storyPostMediaInputSchema.extend({fileName:z.string(),mimeType:z.string(),sizeBytes:count,width:count.nullable(),height:count.nullable(),createdAt:stamp}).strict()),worldDay:count.nullable(),era:z.string().nullable(),createdAt:stamp,updatedAt:stamp,lifecycle:storyPostLifecycleSchema,publishedAt:stamp.nullable(),correctedAt:stamp.nullable(),archivedAt:stamp.nullable(),gmNotes:z.string(),importProvenance:z.object({provider:storyImportProviderSchema,sourceMessageId:z.string(),sourceAuthor:z.string(),sourceTimestamp:stamp,sourceUrl:z.string().nullable(),rightsStatus:storyRightsStatusSchema}).strict().nullable().optional()}).strict();
export const transferStoryEventTypes=['story.created','story.updated','story.published','story.withdrawn','story.archived','story.imported'] as const;
export const transferRequestEventTypes=['PLAYER_REQUEST_CREATED','PLAYER_REQUEST_UPDATED','PLAYER_REQUEST_ACKNOWLEDGE','PLAYER_REQUEST_RESOLVE','PLAYER_REQUEST_DECLINE','PLAYER_REQUEST_CANCEL'] as const;
export const transferNarrativeEventTypes=[...transferStoryEventTypes,...transferRequestEventTypes] as const;
export function narrativeEventEntities(type:string):readonly string[]{return (transferRequestEventTypes as readonly string[]).includes(type)?['PLAYER_REQUEST']:type==='story.imported'?['story_import']:(transferStoryEventTypes as readonly string[]).includes(type)?['story_post']:[];}
export type NarrativeReferences={postIds:string[];requestIds:string[];threadIds:string[];membershipIds:string[];contentIds:string[];links:z.infer<typeof storyEntityLinkSchema>[]};
export function validateTransferNarrativeEvent(input:unknown):NarrativeReferences{
 const event=z.object({type:z.enum(transferNarrativeEventTypes),entity_type:z.string(),entity_id:uuid,payload:z.unknown()}).passthrough().parse(input);
 if(narrativeEventEntities(event.type)[0]!==event.entity_type)throw Error('CAMPAIGN_TRANSFER_NARRATIVE_DOMAIN');
 const refs:NarrativeReferences={postIds:[],requestIds:[],threadIds:[],membershipIds:[],contentIds:[],links:[]};
 if(event.entity_type==='PLAYER_REQUEST'){z.object({commandHash:hash}).strict().parse(event.payload);refs.requestIds.push(event.entity_id);return refs;}
 if(event.type==='story.imported'){const payload=z.object({commandHash:hash,response:z.object({postIds:z.array(uuid).min(1),imported:count}).strict()}).strict().parse(event.payload);if(!payload.response.postIds.includes(event.entity_id)||payload.response.imported>payload.response.postIds.length)throw Error('CAMPAIGN_TRANSFER_STORY_IDENTITY');refs.postIds.push(...payload.response.postIds);return refs;}
 const schema=z.object({commandHash:hash,response:post}).strict();knownFields(schema,event.payload);const {response}=schema.parse(event.payload);if(response.id!==event.entity_id)throw Error('CAMPAIGN_TRANSFER_STORY_IDENTITY');
 const links=new Set(response.entityLinks.map(link=>link.kind+':'+link.entityId));for(const target of response.linkTargets)if(!links.has(target.kind+':'+target.entityId))throw Error('CAMPAIGN_TRANSFER_STORY_LINK_TARGET');
 refs.postIds.push(response.id);refs.threadIds.push(response.threadId);refs.membershipIds.push(response.authorMembershipId);refs.contentIds.push(...response.media.map(item=>item.contentId));refs.links.push(...response.entityLinks);return refs;
}
