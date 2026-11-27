import {validateCampaignTransferCanvasJson} from "./campaign-transfer-canvas-json.js";
import {createCampaignTransferMagicClosure} from "./campaign-transfer-magic-closure.js";
import {createCampaignTransferApplicationClosure} from "./campaign-transfer-application-closure.js";
import {createCampaignTransferCommerceClosure} from "./campaign-transfer-commerce-closure.js";
import {createCampaignTransferCanvasHistoryClosure} from "./campaign-transfer-canvas-history-closure.js";
import {createCampaignTransferChatClosure} from "./campaign-transfer-chat-closure.js";
import {validateCampaignTransferHistoryRow} from "./campaign-transfer-history-validation.js";
import {createCampaignTransferProjectionClosure} from "./campaign-transfer-projection-closure.js";
import {createCampaignTransferMediaClosure} from "./campaign-transfer-media-closure.js";
import {createCampaignTransferRelationValidator,parseCampaignTransferRelationRow} from "./campaign-transfer-relations.js";
import {verifyCampaignTransferFiles,verifyCampaignTransferManifest} from './campaign-transfer-manifest.js';
import {createCampaignTransferRowShapeValidator} from './campaign-transfer-rows.js';
import type {CampaignTransferTable} from './campaign-transfer-policy.js';
/** Read-only structural qualification. No target writes and no reusable PASS
 * token: an importer must validate the exact pinned input it will consume.
 * Nested domain/media-reference closure and identity remapping remain mandatory. */
export async function verifyCampaignTransferStructure(input:unknown,expected:{campaignId:string;migrations:readonly string[]},read:(key:string,expectedBytes:number)=>Promise<Uint8Array>){
 const manifest=verifyCampaignTransferManifest(input,expected),verifyRow=createCampaignTransferRowShapeValidator(),relations=createCampaignTransferRelationValidator(),mediaClosure=createCampaignTransferMediaClosure(),projectionClosure=createCampaignTransferProjectionClosure(),chatClosure=createCampaignTransferChatClosure(manifest.sourceOwnerMembershipId),canvasHistory=createCampaignTransferCanvasHistoryClosure(),commerce=createCampaignTransferCommerceClosure(manifest.campaignId),applications=createCampaignTransferApplicationClosure(),magic=createCampaignTransferMagicClosure();const attachments=new Map<string,unknown>();let ownerCount=0;
 await verifyCampaignTransferFiles(manifest,expected,read,(table,row,raw)=>{
  const exactRow=parseCampaignTransferRelationRow(raw);
  verifyRow(table as CampaignTransferTable,exactRow,manifest.campaignId);
  validateCampaignTransferHistoryRow(table,row,exactRow);
  validateCampaignTransferCanvasJson(table,row);
  relations.add(table as CampaignTransferTable,exactRow);
  mediaClosure.addRow(table,exactRow);projectionClosure.addRow(table,exactRow);chatClosure.addRow(table,row);canvasHistory.addRow(table,exactRow);commerce.addRow(table,row);applications.addRow(table,row);magic.addRow(table,row);
  if(table==='memberships'&&typeof row.id==='string'&&row.id.toLowerCase()===manifest.sourceOwnerMembershipId.toLowerCase()){
   if(row.role!=='GM')throw Error('CAMPAIGN_TRANSFER_OWNER_ROLE_INVALID');
   if(++ownerCount>1)throw Error('CAMPAIGN_TRANSFER_OWNER_DUPLICATE');
  }
 },binding=>{mediaClosure.addBinding(binding);if(binding.kind==='CHAT_ATTACHMENT')relations.addAttachmentMaterialization(attachments.get(binding.id.toLowerCase()),binding);},projection=>{projectionClosure.addProjection(projection);if(projection.kind==='MATERIALIZED_ATTACHMENT_METADATA'){mediaClosure.addAttachmentMetadata(projection);attachments.set(projection.contentId.toLowerCase(),projection);}});
 if(ownerCount!==1)throw Error('CAMPAIGN_TRANSFER_OWNER_REQUIRED');
 relations.finish();mediaClosure.finish();projectionClosure.finish();chatClosure.finish();canvasHistory.finish();commerce.finish();applications.finish();magic.finish();
 return manifest;
}
