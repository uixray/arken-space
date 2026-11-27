import {materializeCampaignTransferAttachment} from "./campaign-transfer-attachment-materialization.js";
import {campaignTransferCatalog,type CampaignTransferTable} from './campaign-transfer-policy.js';
/** Internal, bounded SQL-FK closure index. Input rows must already pass shape,
 * domain and projection validation. No implicit exemptions for excluded tables.
 * JSON/domain references not declared as SQL FKs require separate collectors. */
export function createCampaignTransferRelationValidator(maxEntries=1000000){
 if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>10000000)throw Error('CAMPAIGN_TRANSFER_RELATION_LIMIT_INVALID');
 const catalog=campaignTransferCatalog(),tables=new Map(catalog.map(t=>[t.name,t]));
 const indexes=new Map<string,Set<string>>(),requirements=new Map<string,Set<string>>();let entries=0,closed=false;
 const slot=(table:string,columns:readonly string[])=>JSON.stringify([table,...columns]);
 const indexed=new Map<string,string[][]>();
 const register=(table:string,columns:string[])=>{if(!columns.length)return;const list=indexed.get(table)??[];if(!list.some(c=>JSON.stringify(c)===JSON.stringify(columns)))list.push(columns);indexed.set(table,list);indexes.set(slot(table,columns),new Set());};
 for(const table of catalog){register(table.name,table.primaryKey);for(const fk of table.foreignKeys)register(fk.table,fk.target);}
 const key=(table:string,columns:readonly string[],row:Record<string,unknown>)=>{
  const descriptor=tables.get(table);if(!descriptor)throw Error('CAMPAIGN_TRANSFER_RELATION_TABLE_UNKNOWN');
  return JSON.stringify(columns.map(name=>{const value=row[name],column=descriptor.columns.find(c=>c.name===name);if(value===null||value===undefined)throw Error('CAMPAIGN_TRANSFER_RELATION_KEY_NULL');
   if(column?.sqlType==='uuid'){if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw Error('CAMPAIGN_TRANSFER_RELATION_KEY_INVALID');return value.toLowerCase();}
   if(typeof value==='bigint')return {integer:value.toString()};
   if(typeof value==='number'){if(!Number.isSafeInteger(value))throw Error('CAMPAIGN_TRANSFER_RELATION_KEY_PRECISION');return {integer:String(value)};}
   if(typeof value==='string'||typeof value==='boolean')return value;
   throw Error('CAMPAIGN_TRANSFER_RELATION_KEY_INVALID');
  }));
 };
 const charge=()=>{if(++entries>maxEntries)throw Error('CAMPAIGN_TRANSFER_RELATION_LIMIT');};
 const addRecord=(table:CampaignTransferTable,row:Record<string,unknown>,materialized=false)=>{
   if(closed)throw Error('CAMPAIGN_TRANSFER_RELATION_CLOSED');try {const descriptor=tables.get(table);if(!descriptor)throw Error('CAMPAIGN_TRANSFER_RELATION_TABLE_UNKNOWN');
   if(descriptor.policy==='EXCLUDED_AUTH_RUNTIME'&&!(materialized&&table==='chat_attachment_uploads'))throw Error('CAMPAIGN_TRANSFER_CREDENTIALS_FORBIDDEN');
   for(const columns of indexed.get(table)??[]){if(columns.some(c=>row[c]===null))continue;const index=indexes.get(slot(table,columns))!,value=key(table,columns,row);if(index.has(value))throw Error('CAMPAIGN_TRANSFER_RELATION_DUPLICATE');charge();index.add(value);}
   for(const fk of descriptor.foreignKeys){if(fk.columns.some(c=>row[c]===null))continue;const targetRow=Object.fromEntries(fk.target.map((c,i)=>[c,row[fk.columns[i]!] ])),value=key(fk.table,fk.target,targetRow),id=slot(fk.table,fk.target),required=requirements.get(id)??new Set<string>();if(!required.has(value)){charge();required.add(value);}requirements.set(id,required);}
   }catch(error){closed=true;indexes.clear();requirements.clear();throw error;}
 };
 return {
  add:(table:CampaignTransferTable,row:Record<string,unknown>)=>addRecord(table,row),
  addAttachmentMaterialization(metadata:unknown,binding:unknown){
   if(closed)throw Error("CAMPAIGN_TRANSFER_RELATION_CLOSED");try{const record=materializeCampaignTransferAttachment(metadata,binding);
   addRecord('chat_attachment_uploads',{id:record.id,content_id:record.contentId,campaign_id:record.campaignId,uploaded_by_membership_id:record.uploadedByMembershipId},true);return record;}catch(error){closed=true;indexes.clear();requirements.clear();throw error;}
  },
  finish(){if(closed)throw Error('CAMPAIGN_TRANSFER_RELATION_CLOSED');closed=true;for(const [id,required] of requirements){const actual=indexes.get(id);for(const value of required)if(!actual?.has(value))throw Error('CAMPAIGN_TRANSFER_RELATION_MISSING');}return {entries};},
 };
}

/** Reviver source context is required only for integers JS cannot represent.
 * Never returns these objects to serializers or mutates original row bytes. */
export function parseCampaignTransferRelationRow(raw:string):Record<string,unknown>{
 const parse=JSON.parse as (text:string,reviver:(key:string,value:unknown,context?:{source?:string})=>unknown)=>unknown;
 return parse(raw,(_key,value,context)=>{
  if(typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)){
   if(!context?.source||!/^[-]?(0|[1-9][0-9]*)$/.test(context.source))throw Error('CAMPAIGN_TRANSFER_RELATION_KEY_PRECISION');
   return BigInt(context.source);
  }
  return value;
 }) as Record<string,unknown>;
}
