import {z} from 'zod';
const uuid=z.string().uuid(),sequence=z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(v=>BigInt(v)<=9223372036854775807n),hashTable=z.enum(['creation_operation_quotes','creation_store_quotes','economy_quotes']);
export const campaignTransferAttachmentMetadataSchema=z.object({kind:z.literal('MATERIALIZED_ATTACHMENT_METADATA'),contentId:uuid,campaignId:uuid,uploadedByMembershipId:uuid,fileName:z.string().min(1).max(1024),mimeType:z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/).max(127),sizeBytes:z.number().int().positive().max(256*1024*1024),width:z.number().int().positive().nullable(),height:z.number().int().positive().nullable(),createdAt:z.string().datetime()}).strict();
export const campaignTransferProjectionSchema=z.union([
 z.object({kind:z.enum(['REVOKED_STICKER','HIDDEN_INSPIRATION','WITHHELD_STICKER']),messageId:uuid}).strict(),
 z.object({kind:z.enum(['WITHHELD_CHAT_EVENT_STICKER','HIDDEN_CHAT_EVENT_INSPIRATION']),table:z.literal('game_events'),rowId:sequence}).strict(),
 z.object({kind:z.literal('EXCLUDED_UPLOAD_RUNTIME_REFERENCE'),table:z.literal('game_events'),rowId:sequence}).strict(),
 z.object({kind:z.literal('EXCLUDED_AUTH_RUNTIME_REFERENCE'),table:z.literal('game_events'),rowId:sequence,referenceType:z.enum(['INVITE','PLAYER_ACCESS'])}).strict(),
 z.object({kind:z.literal('NON_REPLAYABLE_QUOTE'),table:hashTable,rowId:uuid}).strict(),
 z.object({kind:z.literal('EXTERNAL_CATALOG_METADATA'),table:z.literal('global_stickers'),rowId:uuid}).strict(),
 z.object({kind:z.literal('EXTERNAL_MEMBERSHIP_REFERENCE'),table:z.enum(['global_sticker_packs','global_sticker_media','world_content_actions']),rowId:uuid}).strict(),
 campaignTransferAttachmentMetadataSchema,
]);
/** Explicitly whitelist normalized content, excluding storage keys/upload jobs. */
export function normalizeCampaignTransferAttachmentMetadata(input:Record<string,unknown>){const {contentId,campaignId,uploadedByMembershipId,fileName,mimeType,sizeBytes,width,height,createdAt}=input;return campaignTransferAttachmentMetadataSchema.parse({kind:'MATERIALIZED_ATTACHMENT_METADATA',contentId,campaignId,uploadedByMembershipId,fileName,mimeType,sizeBytes,width,height,createdAt});}
