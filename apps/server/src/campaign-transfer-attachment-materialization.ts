import {randomUUID} from 'node:crypto';import {campaignTransferAttachmentMetadataSchema} from './campaign-transfer-projections.js';import {campaignTransferMediaBindingSchema} from './campaign-transfer-binding-schema.js';
/** Fresh CLAIMED content row for a target importer, never a restored source
 * upload/session/job. Caller must stage bytes and INSERT in its atomic import. */
export function materializeCampaignTransferAttachment(metadataInput:unknown,bindingInput:unknown){
 const metadata=campaignTransferAttachmentMetadataSchema.parse(metadataInput),binding=campaignTransferMediaBindingSchema.parse(bindingInput);
 if(binding.kind!=='CHAT_ATTACHMENT'||binding.id.toLowerCase()!==metadata.contentId.toLowerCase()||binding.bytes!==metadata.sizeBytes||binding.mimeType!==metadata.mimeType)throw Error('CAMPAIGN_TRANSFER_ATTACHMENT_BINDING_MISMATCH');
 const createdAt=new Date(metadata.createdAt);
 return {id:randomUUID(),contentId:metadata.contentId,campaignId:metadata.campaignId,uploadedByMembershipId:metadata.uploadedByMembershipId,fileName:metadata.fileName,storageKey:'transfer-'+metadata.contentId.toLowerCase()+'-'+binding.sha256,mimeType:metadata.mimeType,sizeBytes:metadata.sizeBytes,width:metadata.width,height:metadata.height,status:'CLAIMED' as const,createdAt,expiresAt:createdAt};
}
