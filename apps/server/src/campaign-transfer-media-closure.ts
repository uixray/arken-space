import type {CampaignTransferMediaBinding} from './campaign-transfer-media-bindings.js';
/** Bidirectional current-row/media binding closure. Historical marker refs do
 * not create file requirements; nested JSON references need their own gates. */
export function createCampaignTransferMediaClosure(){
 const expected=new Map<string,{bytes?:unknown;mimeType?:unknown;sha256?:unknown}>(),seen=new Set<string>();let closed=false;
 const key=(kind:string,id:unknown)=>{if(typeof id!=='string')throw Error('CAMPAIGN_TRANSFER_MEDIA_TARGET_INVALID');return kind+':'+id.toLowerCase();};
 const fail=(run:()=>void)=>{if(closed)throw Error('CAMPAIGN_TRANSFER_MEDIA_CLOSURE_CLOSED');try{run();}catch(error){closed=true;throw error;}};
 const add=(kind:string,id:unknown,metadata:{bytes?:unknown;mimeType?:unknown;sha256?:unknown})=>{const k=key(kind,id);if(expected.has(k))throw Error('CAMPAIGN_TRANSFER_MEDIA_TARGET_DUPLICATE');expected.set(k,metadata);if(expected.size>100000)throw Error('CAMPAIGN_TRANSFER_MEDIA_TARGET_LIMIT');};
 return {
  addRow(table:string,row:Record<string,unknown>){fail(()=>{
   if(table==='assets'){
    add('ASSET_ORIGINAL',row.id,{bytes:row.size_bytes,mimeType:row.mime_type});
    if(Boolean(row.poster_storage_key)!==Boolean(row.poster_size_bytes))throw Error('CAMPAIGN_TRANSFER_POSTER_METADATA_INVALID');
    if(row.poster_storage_key)add('ASSET_POSTER',row.id,{bytes:row.poster_size_bytes,mimeType:'image/webp'});
   }else if(table==='world_content_images')add('WORLD_IMAGE',row.id,{bytes:row.size_bytes,mimeType:row.mime_type});
   else if(table==='sticker_media'||table==='global_sticker_media')add(table==='sticker_media'?'STICKER_MEDIA':'GLOBAL_STICKER_MEDIA',row.id,{bytes:row.size_bytes,mimeType:row.mime_type,sha256:row.sha256});
   else if(table==='chat_attachments')add('CHAT_ATTACHMENT',row.content_id,{});
  });},
  addAttachmentMetadata(metadata:{contentId:string;sizeBytes:number;mimeType:string}){fail(()=>{const target=expected.get(key('CHAT_ATTACHMENT',metadata.contentId));if(!target)throw Error('CAMPAIGN_TRANSFER_ATTACHMENT_METADATA_TARGET_MISSING');if(target.bytes!==undefined)throw Error('CAMPAIGN_TRANSFER_ATTACHMENT_METADATA_DUPLICATE');target.bytes=metadata.sizeBytes;target.mimeType=metadata.mimeType;});},
  addBinding(binding:CampaignTransferMediaBinding){fail(()=>{const k=key(binding.kind,binding.id),target=expected.get(k);if(!target)throw Error('CAMPAIGN_TRANSFER_MEDIA_TARGET_MISSING');if(seen.has(k))throw Error('CAMPAIGN_TRANSFER_MEDIA_BINDING_DUPLICATE');if(binding.kind==='CHAT_ATTACHMENT'&&target.bytes===undefined)throw Error('CAMPAIGN_TRANSFER_ATTACHMENT_METADATA_REQUIRED');for(const field of ['bytes','mimeType','sha256'] as const)if(target[field]!==undefined&&target[field]!==binding[field])throw Error('CAMPAIGN_TRANSFER_MEDIA_ROW_METADATA_MISMATCH');seen.add(k);});},
  finish(){if(closed)throw Error('CAMPAIGN_TRANSFER_MEDIA_CLOSURE_CLOSED');closed=true;if(seen.size!==expected.size)throw Error('CAMPAIGN_TRANSFER_MEDIA_BINDING_MISSING');return {bindings:seen.size};},
 };
}
