import {z} from 'zod';import type {CampaignTransferSource} from './campaign-transfer-source.js';import type {CampaignTransferMediaStage,TransferMediaFile} from './campaign-transfer-media.js';
export type CampaignTransferMediaBinding=TransferMediaFile&{kind:'ASSET_ORIGINAL'|'ASSET_POSTER'|'WORLD_IMAGE'|'STICKER_MEDIA'|'GLOBAL_STICKER_MEDIA'|'CHAT_ATTACHMENT';id:string};
/** Bind authorized current media to bytes, never historical deleted IDs or
 * sprite receipt paths. No source storage path is exported by this binding. */
export async function captureCampaignTransferPageMedia(source:CampaignTransferSource,table:string,rows:readonly string[],stage:CampaignTransferMediaStage){
 const bindings:CampaignTransferMediaBinding[]=[];const id=(value:unknown)=>z.string().uuid().parse(value).toLowerCase();
 const add=async(kind:CampaignTransferMediaBinding['kind'],key:string,copy:Promise<TransferMediaFile>)=>bindings.push({kind,id:key,...await copy});
 for(const raw of rows){
  if(!['assets','world_content_images','stickers','global_stickers','chat_attachments'].includes(table))break;
  const row=JSON.parse(raw) as Record<string,unknown>;
  if(table==='assets'){
   const asset=id(row.id);
   if(Boolean(row.poster_storage_key)!==Boolean(row.poster_size_bytes))throw Error('CAMPAIGN_TRANSFER_POSTER_METADATA_INVALID');
   await add('ASSET_ORIGINAL',asset,source.captureAssetMedia(asset,stage));
   if(row.poster_storage_key)await add('ASSET_POSTER',asset,source.captureAssetMedia(asset,stage,'poster'));
  }else if(table==='world_content_images'){const image=id(row.id);await add('WORLD_IMAGE',image,source.captureWorldImage(image,stage));}
  else if(table==='chat_attachments'){const content=id(row.content_id);await add('CHAT_ATTACHMENT',content,source.captureChatAttachmentMedia(content,stage));}
  else{const sticker=id(row.id),media=id(row.media_id),global=table==='global_stickers';await add(global?'GLOBAL_STICKER_MEDIA':'STICKER_MEDIA',media,source.captureStickerMedia(sticker,stage,global?'global':'campaign'));}
 }
 return bindings;
}
