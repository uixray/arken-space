import {transferControlEventTypes} from "./campaign-transfer-control-events.js";
import {campaignTransferProjectionSchema} from './campaign-transfer-projections.js';
/** Target/provenance consistency, not proof of source truth or importer ACL. */
export function createCampaignTransferProjectionClosure(){
 const targets=new Map<string,Set<string>>(),required=new Set<string>(),seen=new Set<string>(),members=new Set<string>();let closed=false;
 const key=(table:string,id:unknown)=>{if(typeof id!=='string'&&typeof id!=='bigint'&&!(typeof id==='number'&&Number.isSafeInteger(id)))throw Error('CAMPAIGN_TRANSFER_PROJECTION_KEY_INVALID');return table+':'+String(id).toLowerCase();};
 const marker=(target:string,kind:string)=>target+'|'+kind;
 const run=(action:()=>void)=>{if(closed)throw Error('CAMPAIGN_TRANSFER_PROJECTION_CLOSED');try{action();}catch(error){closed=true;throw error;}};
 return {
  addRow(table:string,row:Record<string,unknown>){run(()=>{
   if(table==='memberships')members.add(String(row.id).toLowerCase());
   const kinds=new Set<string>(),mandatory:string[]=[];let id=row.id;
   if(table==='game_events'){
    id=row.sequence;
    if((row.type==='invite.revoked'&&row.entity_type==='invite')||(typeof row.type==='string'&&row.type.startsWith('player_access.')&&(transferControlEventTypes as readonly string[]).includes(row.type)&&row.entity_type==='player_access')){const k='EXCLUDED_AUTH_RUNTIME_REFERENCE:'+(row.entity_type==='invite'?'INVITE':'PLAYER_ACCESS');kinds.add(k);mandatory.push(k);}
    if(row.type==='STORY_ATTACHMENT_DELETE_REQUESTED'&&row.entity_type==='STORY_ATTACHMENT'){kinds.add('EXCLUDED_UPLOAD_RUNTIME_REFERENCE');mandatory.push('EXCLUDED_UPLOAD_RUNTIME_REFERENCE');}
    if(row.type==='chat.created'||row.type==='dice.created'){const p=row.payload as Record<string,unknown>|null;if(p?.stickerId===null&&p.globalStickerId===null&&p.stickerPresentation===null)kinds.add('WITHHELD_CHAT_EVENT_STICKER');if(!(p?.dice as Record<string,unknown>|null)?.inspiration)kinds.add('HIDDEN_CHAT_EVENT_INSPIRATION');}
   }else if(['creation_operation_quotes','creation_store_quotes','economy_quotes'].includes(table)&&row.transfer_invalidated===true){kinds.add('NON_REPLAYABLE_QUOTE');mandatory.push('NON_REPLAYABLE_QUOTE');}
   else if(table==='chat_messages'){if(row.sticker_id===null&&row.global_sticker_id===null&&row.sticker_presentation===null){kinds.add('REVOKED_STICKER');kinds.add('WITHHELD_STICKER');}if(row.inspiration_source_message_id===null&&!(row.dice as Record<string,unknown>|null)?.inspiration)kinds.add('HIDDEN_INSPIRATION');}
   else if(table==='global_stickers'&&row.source_reference===null)kinds.add('EXTERNAL_CATALOG_METADATA');
   else if((table==='global_sticker_packs'&&row.creator_membership_id===null)||(table==='global_sticker_media'&&row.uploaded_by_membership_id===null)||(table==='world_content_actions'&&row.actor_membership_id===null))kinds.add('EXTERNAL_MEMBERSHIP_REFERENCE');
   else if(table==='chat_attachments'){id=row.content_id;kinds.add('MATERIALIZED_ATTACHMENT_METADATA');mandatory.push('MATERIALIZED_ATTACHMENT_METADATA');}
   if(kinds.size){const target=key(table,id);if(targets.has(target))throw Error('CAMPAIGN_TRANSFER_PROJECTION_TARGET_DUPLICATE');targets.set(target,kinds);for(const kind of mandatory)required.add(marker(target,kind));if(targets.size>1000000)throw Error('CAMPAIGN_TRANSFER_PROJECTION_TARGET_LIMIT');}
  });},
  addProjection(input:unknown){run(()=>{const p=campaignTransferProjectionSchema.parse(input),table='messageId' in p?'chat_messages':p.kind==='MATERIALIZED_ATTACHMENT_METADATA'?'chat_attachments':p.table,id='messageId' in p?p.messageId:p.kind==='MATERIALIZED_ATTACHMENT_METADATA'?p.contentId:p.rowId,kind=p.kind==='EXCLUDED_AUTH_RUNTIME_REFERENCE'?p.kind+':'+p.referenceType:p.kind,target=key(table,id),m=marker(target,kind);
   if(!targets.get(target)?.has(kind))throw Error('CAMPAIGN_TRANSFER_PROJECTION_TARGET_MISSING_OR_INVALID');if(seen.has(m))throw Error('CAMPAIGN_TRANSFER_PROJECTION_DUPLICATE');if(p.kind==='MATERIALIZED_ATTACHMENT_METADATA'&&!members.has(p.uploadedByMembershipId.toLowerCase()))throw Error('CAMPAIGN_TRANSFER_PROJECTION_UPLOADER_MISSING');seen.add(m);
  });},
  finish(){if(closed)throw Error('CAMPAIGN_TRANSFER_PROJECTION_CLOSED');closed=true;for(const m of required)if(!seen.has(m))throw Error('CAMPAIGN_TRANSFER_PROJECTION_REQUIRED');return {projections:seen.size};},
 };
}
