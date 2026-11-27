import {z} from 'zod';import {assetKindSchema,audioPurposeSchema,generateTokenAssetSchema,audioStateUpdateSchema,audioTrackCommandSchema} from '@arken/contracts';import {knownFields} from './campaign-transfer-chat-events.js';
const sameId=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const uuid=z.string().uuid(),count=z.number().int().nonnegative(),n=z.number().finite().nonnegative(),stamp=z.string().datetime(),hash=z.string().regex(/^[a-f0-9]{64}$/),etag=z.string().regex(/^"[a-f0-9]{64}"$/);
const upload=z.object({assetId:uuid,kind:assetKindSchema,audioPurpose:audioPurposeSchema.nullable().optional()}).strict(),generated=z.object({assetId:uuid,kind:z.literal('TOKEN'),sourceAssetId:uuid,transform:generateTokenAssetSchema}).strict();
const storageKey=z.string().min(1).max(1024).regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/).refine(key=>key.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'));
const state=z.object({assetId:uuid.nullable(),playing:z.boolean(),positionSeconds:n,loop:z.boolean(),startedAt:stamp.nullable(),revision:count,updatedAt:stamp}).strict(),track=state.extend({id:uuid,mixVolume:z.number().min(0).max(1),slotOrder:count}).strict();
const deletedResponse=z.discriminatedUnion('deleted',[z.object({deleted:z.literal(true),contentId:uuid}).strict(),z.object({deleted:z.literal(false),cleanupPending:z.literal(true),contentId:uuid}).strict()]);
const schemas:Record<string,{entity:string;schema:z.ZodTypeAny}>={
 'asset.created':{entity:'asset',schema:z.union([upload,generated,z.object({sourceAssetId:uuid}).strict()])},
 'asset.sprite_frame_created':{entity:'asset',schema:z.object({requestHash:hash,spriteStorageKey:storageKey,assetId:uuid}).strict()},
 'asset.audio_purpose_changed':{entity:'asset',schema:z.object({assetId:uuid,audioPurpose:audioPurposeSchema}).strict()},
 'asset.deleted':{entity:'asset',schema:z.object({assetId:uuid,detachedUsageCount:count.optional(),detachedWorldContentCount:count.optional()}).strict()},
 'asset.replaced':{entity:'asset',schema:z.object({assetId:uuid,beforeVersion:etag,afterVersion:etag,contentSha256:hash,mimeType:z.string(),sizeBytes:count,width:count.nullable(),height:count.nullable(),durationSeconds:n.nullable()}).strict()},
 'AUDIO_COMMAND':{entity:'AUDIO_STATE',schema:z.object({command:audioStateUpdateSchema,result:state}).strict()},
 'AUDIO_TRACK_COMMAND':{entity:'AUDIO_TRACK',schema:z.union([z.object({command:audioTrackCommandSchema,result:track}).strict(),z.object({command:audioTrackCommandSchema,removedTrackId:uuid}).strict()])},
 'STORY_ATTACHMENT_DELETE_REQUESTED':{entity:'STORY_ATTACHMENT',schema:z.object({contentId:uuid,commandHash:hash,response:deletedResponse}).strict()},
};
export const transferMediaEventTypes=Object.freeze(Object.keys(schemas));
export function mediaEventEntities(type:string):readonly string[]{return schemas[type]?[schemas[type]!.entity]:[];}
export type MediaEventReferences={assetIds:string[];audioTrackIds:string[];campaignIds:string[];spriteReceiptKeys:string[];deletedAttachments:{uploadId:string;contentId:string}[]};
export function validateTransferMediaEvent(input:unknown):MediaEventReferences{
 const event=z.object({type:z.string(),entity_type:z.string(),entity_id:uuid,action_id:uuid,payload:z.unknown()}).passthrough().parse(input),descriptor=schemas[event.type];if(!descriptor||descriptor.entity!==event.entity_type)throw Error('CAMPAIGN_TRANSFER_MEDIA_EVENT_UNREVIEWED');knownFields(descriptor.schema,event.payload);const p=descriptor.schema.parse(event.payload) as any;
 const refs:MediaEventReferences={assetIds:[],audioTrackIds:[],campaignIds:[],spriteReceiptKeys:[],deletedAttachments:[]};
 if(event.entity_type==='asset'){if(p.assetId&&!sameId(p.assetId,event.entity_id))throw Error('CAMPAIGN_TRANSFER_MEDIA_EVENT_IDENTITY');refs.assetIds.push(p.assetId??event.entity_id);if(p.sourceAssetId)refs.assetIds.push(p.sourceAssetId);if(p.spriteStorageKey)refs.spriteReceiptKeys.push(p.spriteStorageKey);}
 else if(event.type==='STORY_ATTACHMENT_DELETE_REQUESTED'){if(!sameId(p.contentId,p.response.contentId))throw Error('CAMPAIGN_TRANSFER_MEDIA_EVENT_IDENTITY');refs.deletedAttachments.push({uploadId:event.entity_id,contentId:p.contentId});}
 else{
  if(!sameId(p.command.actionId,event.action_id))throw Error('CAMPAIGN_TRANSFER_AUDIO_EVENT_IDENTITY');if(p.command.assetId)refs.assetIds.push(p.command.assetId);
  if(event.entity_type==='AUDIO_STATE')refs.campaignIds.push(event.entity_id);
  else{if((p.command.trackId&&!sameId(p.command.trackId,event.entity_id))||(p.result&&!sameId(p.result.id,event.entity_id))||(p.removedTrackId&&!sameId(p.removedTrackId,event.entity_id))||(p.command.command==='REMOVE_TRACK')!==(p.removedTrackId!==undefined))throw Error('CAMPAIGN_TRANSFER_AUDIO_EVENT_IDENTITY');refs.audioTrackIds.push(event.entity_id);}
  if(p.result?.assetId)refs.assetIds.push(p.result.assetId);
 }
 for(const key of ["assetIds","audioTrackIds","campaignIds"] as const)refs[key]=[...new Set(refs[key].map(id=>id.toLowerCase()))];refs.deletedAttachments=refs.deletedAttachments.map(ref=>({uploadId:ref.uploadId.toLowerCase(),contentId:ref.contentId.toLowerCase()}));return refs;
}
