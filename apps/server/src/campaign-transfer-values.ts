import {isCampaignTransferText,isCampaignTransferTimestamp} from "./campaign-transfer-scalars.js";
import * as schema from '@arken/db';import {PgTable,getTableConfig} from 'drizzle-orm/pg-core';
/** SQL primitive gate, not nested JSON/domain validation. Unknown types fail. */
export function createCampaignTransferValueValidator(){
 const columns=new Map(Object.values(schema).filter(v=>v instanceof PgTable).map(t=>{const c=getTableConfig(t as PgTable);return [c.name,new Map(c.columns.map(column=>[column.name,column]))] as const;}));
 return (table:string,name:string,value:unknown)=>{
  if(value===null)return;const column=columns.get(table)?.get(name);if(!column)throw Error('CAMPAIGN_TRANSFER_VALUE_COLUMN_UNKNOWN');const type=column.getSQLType(),enums=column.enumValues;
  let valid=false;
  if(enums?.length)valid=typeof value==='string'&&enums.includes(value);
  else if(type==='text')valid=typeof value==='string'&&isCampaignTransferText(value);
  else if(type==='uuid')valid=typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  else if(type==='boolean')valid=typeof value==='boolean';
  else if(type==='integer')valid=typeof value==='number'&&Number.isInteger(value)&&value>=-2147483648&&value<=2147483647;
  else if(type==='bigint'||type==='bigserial'){if(typeof value==='bigint')valid=value>=-9223372036854775808n&&value<=9223372036854775807n;else valid=typeof value==='number'&&Number.isSafeInteger(value);}
  else if(type==='double precision')valid=typeof value==='number'&&Number.isFinite(value);
  else if(type==='timestamp with time zone')valid=typeof value==='string'&&isCampaignTransferTimestamp(value);
  else if(type==='jsonb')valid=true;
  else throw Error('CAMPAIGN_TRANSFER_VALUE_TYPE_UNREVIEWED');
  if(!valid)throw Error('CAMPAIGN_TRANSFER_VALUE_INVALID');
 };
}
