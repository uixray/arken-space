import {getTableColumns,sql} from "drizzle-orm";
import {worldContent,worldContentMedia,worldContentRelations} from "@arken/db";
import {worldContentDtoSchema,worldContentLifecycleSchema} from "@arken/contracts";
import {z} from "zod";

/** Select before paging, including removed relations/media whose live row no
 * longer exists. No payload UUID cast: malformed history fails validation. */
export const transferWorldHistoryScope=sql`(
 entity_id::text IN (SELECT id::text FROM arken_transfer_world_selection)
 OR (entity_type='world_content_relation' AND payload->>'fromWorldContentId' IN (SELECT id::text FROM arken_transfer_world_selection) AND payload->>'toWorldContentId' IN (SELECT id::text FROM arken_transfer_world_selection))
 OR (entity_type='world_content_media' AND payload->>'worldContentId' IN (SELECT id::text FROM arken_transfer_world_selection))
)`;
const uuid=z.string().uuid();
function rowShape(table:typeof worldContent|typeof worldContentMedia|typeof worldContentRelations){
 const shape:Record<string,z.ZodTypeAny>={};
 for(const [name,column] of Object.entries(getTableColumns(table))){
  let value:z.ZodTypeAny;
  switch(column.dataType){
   case 'string':value=column.columnType==='PgUUID'?uuid:z.string();break;
   case 'number':value=z.number().finite();break;
   case 'date':value=z.string().datetime();break;
   case 'array':value=z.array(z.string());break;
   case 'json':if(name!=='aliases'&&name!=='tags')throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_SCHEMA_UNREVIEWED');value=z.array(z.string());break;
   default:throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_SCHEMA_UNREVIEWED');
  }
  shape[name]=column.notNull?value:value.nullable();
 }
 return z.object(shape).strict();
}
const article=rowShape(worldContent).extend({requestHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),response:worldContentDtoSchema.strict().optional()}).strict();
const relation=rowShape(worldContentRelations),media=rowShape(worldContentMedia);
const lifecycle=z.object({from:worldContentLifecycleSchema,to:worldContentLifecycleSchema}).strict();
export type WorldHistoryReferences={articleIds:string[];imageIds:string[]};
/** Validate without JSON reserialization: original SQL JSON preserves bigint
 * sequence precision and the historical response used for idempotency. */
export function validateTransferWorldHistoryRow(value:unknown):WorldHistoryReferences{
 const row=z.object({type:z.string(),entity_type:z.string(),entity_id:uuid,payload:z.unknown()}).passthrough().parse(value);
 const refs:WorldHistoryReferences={articleIds:[],imageIds:[]};
 const parse=(schema:z.ZodTypeAny)=>schema.parse(row.payload) as Record<string,any>;
 switch(row.type){
  case 'world_content.created':case 'world_content.updated':{
   if(row.entity_type!=='world_content')throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_ENTITY');
   const p=parse(article);if(p.id!==row.entity_id||(p.response&&p.response.id!==row.entity_id))throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_ENTITY');
   refs.articleIds.push(row.entity_id);if(p.regionId)refs.articleIds.push(p.regionId);if(p.coverAssetId)refs.imageIds.push(p.coverAssetId);
   if(p.response?.regionId)refs.articleIds.push(p.response.regionId);if(p.response?.coverAssetId)refs.imageIds.push(p.response.coverAssetId);break;
  }
  case 'world_content.lifecycle_changed':case 'world_content.archived':
   if(row.entity_type!=='world_content')throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_ENTITY');parse(lifecycle);refs.articleIds.push(row.entity_id);break;
  case 'world_content.relation_created':case 'world_content.relation_deleted':{
   if(row.entity_type!=='world_content_relation')throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_ENTITY');const p=parse(relation);if(p.id!==row.entity_id)throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_ENTITY');refs.articleIds.push(p.fromWorldContentId,p.toWorldContentId);break;
  }
  case 'world_content.media_added':case 'world_content.media_updated':case 'world_content.media_removed':{
   if(row.entity_type!=='world_content_media')throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_ENTITY');const p=parse(media);if(p.id!==row.entity_id)throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_ENTITY');refs.articleIds.push(p.worldContentId);refs.imageIds.push(p.assetId);break;
  }
  default:throw Error('CAMPAIGN_TRANSFER_WORLD_HISTORY_TYPE_UNREVIEWED');
 }
 return {articleIds:[...new Set(refs.articleIds)],imageIds:[...new Set(refs.imageIds)]};
}
