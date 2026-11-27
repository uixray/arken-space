import {createCampaignTransferValueValidator} from "./campaign-transfer-values.js";
import {campaignTransferCatalog,type CampaignTransferTable} from './campaign-transfer-policy.js';
/** Structural import gate. Foreign keys, ACL and domain JSON are validated by
 * their dedicated handlers before any target database write. */
export function createCampaignTransferRowShapeValidator(){
 const validateValue=createCampaignTransferValueValidator();
 const catalog=new Map(campaignTransferCatalog().map(t=>[t.name,{...t,columnNames:new Set(t.columns.map(c=>c.name))}]));
 return (table:CampaignTransferTable,input:unknown,campaignId:string)=>{
 const descriptor=catalog.get(table);if(!descriptor)throw Error('CAMPAIGN_TRANSFER_TABLE_UNKNOWN');
 if(descriptor.policy==='EXCLUDED_AUTH_RUNTIME')throw Error('CAMPAIGN_TRANSFER_CREDENTIALS_FORBIDDEN');
 if(input===null||typeof input!=='object'||Array.isArray(input))throw Error('CAMPAIGN_TRANSFER_ROW_OBJECT_REQUIRED');
 const row=input as Record<string,unknown>,keys=Object.keys(row),columns=descriptor.columnNames;
 if(keys.length!==columns.size||keys.some(key=>!columns.has(key)))throw Error('CAMPAIGN_TRANSFER_ROW_COLUMNS_INVALID');
 for(const column of descriptor.columns)if(row[column.name]===undefined||(!column.nullable&&row[column.name]===null))throw Error('CAMPAIGN_TRANSFER_ROW_NULLABILITY_INVALID');
 for(const column of descriptor.columns)validateValue(table,column.name,row[column.name]);
 const same=(value:unknown)=>typeof value==='string'&&value.toLowerCase()===campaignId.toLowerCase();
 if((table==='campaigns'&&!same(row.id))||(columns.has('campaign_id')&&!same(row.campaign_id)))throw Error('CAMPAIGN_TRANSFER_ROW_SCOPE_INVALID');
 if(table==='memberships'&&row.user_id!==null)throw Error('CAMPAIGN_TRANSFER_SOURCE_ACCOUNT_FORBIDDEN');
 if(descriptor.policy==='NON_REPLAYABLE'&&row.transfer_invalidated!==true)throw Error('CAMPAIGN_TRANSFER_QUOTE_REPLAY_FORBIDDEN');
 return row;
 };
}
export function verifyCampaignTransferRowShape(table:CampaignTransferTable,input:unknown,campaignId:string){return createCampaignTransferRowShapeValidator()(table,input,campaignId);}
