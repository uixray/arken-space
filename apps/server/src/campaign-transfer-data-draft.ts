import type {CampaignTransferManifest} from "./campaign-transfer-manifest.js";
import {campaignTransferProjectionSchema,normalizeCampaignTransferAttachmentMetadata} from "./campaign-transfer-projections.js";
import {writeCampaignTransferSidecar} from "./campaign-transfer-sidecar.js";
import {campaignTransferMediaBindingSchema} from "./campaign-transfer-binding-schema.js";
import {createCampaignTransferMediaStage} from "./campaign-transfer-media.js";
import {captureCampaignTransferPageMedia,type CampaignTransferMediaBinding} from "./campaign-transfer-media-bindings.js";
import {Buffer} from 'node:buffer';
import {campaignTransferCatalog,type CampaignTransferTable} from './campaign-transfer-policy.js';
import {captureCampaignTransferTable} from './campaign-transfer-capture.js';
import {createCampaignTransferDataStage} from './campaign-transfer-data-stage.js';
import type {CampaignTransferSource} from './campaign-transfer-source.js';
type OwnedDraft={root:string;mediaRoot:string;campaignId:string;sourceOwnerMembershipId:string;createdAt:string;source:CampaignTransferManifest['source'];tables:CampaignTransferManifest['tables'];media:CampaignTransferManifest['media'];projectionsFile:CampaignTransferManifest['projections'];mediaBindingsFile:CampaignTransferManifest['mediaBindings']};
const ownedDrafts=new WeakMap<object,OwnedDraft>();
/** One-shot ownership capability, not an arbitrary-path filesystem API. */
export function claimCampaignTransferDataDraft(draft:object){const snapshot=ownedDrafts.get(draft);if(!snapshot)throw Error('CAMPAIGN_TRANSFER_DRAFT_UNOWNED_OR_CONSUMED');ownedDrafts.delete(draft);return structuredClone(snapshot);}
export type CampaignTransferCaptureMetadata={table:string;reader:string;rows:number;redactions?:unknown[];references?:unknown;contents?:unknown[];journalSequences?:string[]};
/** Private draft only. Metadata is retained, never silently dropped; media and
 * projection bindings must be resolved before a full manifest can be published.
 * Invoke inside the authorized source snapshot, not after it closes. */
export async function captureCampaignTransferDataDraft(source:CampaignTransferSource,parent:string){
 await source.assertEventCoverage();const stage=await createCampaignTransferDataStage(parent),metadata:CampaignTransferCaptureMetadata[]=[],mediaStage=await createCampaignTransferMediaStage(parent),bindings=new Map<string,CampaignTransferMediaBinding>(),projections:string[]=[];let metadataBytes=0;
 for(const table of campaignTransferCatalog()){
  if(table.policy==='EXCLUDED_AUTH_RUNTIME')continue;
  async function* rows(){for await(const page of captureCampaignTransferTable(source,table.name as CampaignTransferTable)){
   const {rows,nextOffset:_,...details}=page.result,item={table:table.name,reader:page.reader,rows:rows.length,...details};
   metadataBytes+=Buffer.byteLength(JSON.stringify(item));if(metadataBytes>64*1024*1024)throw Error('CAMPAIGN_TRANSFER_DRAFT_METADATA_LIMIT');metadata.push(item);
   for(const projection of details.redactions??[])projections.push(JSON.stringify(campaignTransferProjectionSchema.parse(projection)));
   for(const content of details.contents??[])projections.push(JSON.stringify(normalizeCampaignTransferAttachmentMetadata(content as Record<string,unknown>)));
   if(projections.length>100000)throw Error("CAMPAIGN_TRANSFER_PROJECTION_LIMIT");
   for(const binding of await captureCampaignTransferPageMedia(source,table.name,rows,mediaStage)){
    const key=binding.kind+":"+binding.id,previous=bindings.get(key);if(previous&&JSON.stringify(previous)!==JSON.stringify(binding))throw Error("CAMPAIGN_TRANSFER_MEDIA_BINDING_CONFLICT");bindings.set(key,binding);if(bindings.size>100000)throw Error("CAMPAIGN_TRANSFER_MEDIA_BINDING_LIMIT");
   }
   yield* rows;
  }}
  await stage.write(table.name as CampaignTransferTable,rows());
 }
 const mediaBindingsFile=await writeCampaignTransferSidecar(stage.root,"media-bindings.ndjson",[...bindings.values()].map(b=>JSON.stringify(campaignTransferMediaBindingSchema.parse(b))));
 const projectionsFile=await writeCampaignTransferSidecar(stage.root,"projections.ndjson",projections);
 const entries=new Map(stage.entries().map(e=>[e.name,e]));
 const draft={state:'PRIVATE_DATA_DRAFT' as const,root:stage.root,mediaRoot:mediaStage.root,media:mediaStage.entries(),mediaBindings:[...bindings.values()],mediaBindingsFile,projectionsFile,campaignId:source.campaignId,sourceOwnerMembershipId:source.ownerMembershipId,createdAt:source.createdAt,source:{schemaDigest:source.schemaDigest,migrations:[...source.migrations],baselineSequence:source.baselineSequence},tables:campaignTransferCatalog().map(t=>entries.get(t.name as CampaignTransferTable)??{name:t.name,policy:t.policy,rows:0,file:null}),metadata};
 const {metadata:_,mediaBindings:__,state:___,...snapshot}=draft;ownedDrafts.set(draft,structuredClone(snapshot));return Object.freeze(draft);
}
