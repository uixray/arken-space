import {getTableColumns} from "drizzle-orm";
import {tokens,drawings,fogReveals} from "@arken/db";
import {z} from "zod";
import {tokenConditionsSchema,gridSchema,fogGeometrySchema,fogBoundsSchema} from "@arken/contracts";
const uuid=z.string().uuid(),n=z.number().finite(),revision=z.number().int().nonnegative();
function snapshot(table:typeof tokens|typeof drawings|typeof fogReveals,json:Record<string,z.ZodTypeAny>){
 const shape:Record<string,z.ZodTypeAny>={};
 for(const [key,column] of Object.entries(getTableColumns(table))){
  let value:z.ZodTypeAny;
  switch(column.dataType){
   case 'string':value=column.columnType==='PgUUID'?uuid:column.enumValues?.length?z.enum(column.enumValues as [string,...string[]]):z.string();break;
   case 'number':value=n;break;
   case 'date':value=z.string().datetime();break;
   case 'boolean':value=z.boolean();break;
   case 'json':if(!json[key])throw Error('CAMPAIGN_TRANSFER_JOURNAL_SCHEMA_UNREVIEWED');value=json[key]!;break;
   default:throw Error('CAMPAIGN_TRANSFER_JOURNAL_SCHEMA_UNREVIEWED');
  }
  shape[key]=column.notNull?value:value.nullable();
 }
 return z.object(shape).strict();
}
const token=snapshot(tokens,{conditions:tokenConditionsSchema}),drawing=snapshot(drawings,{points:z.array(n)}),fog=snapshot(fogReveals,{geometry:fogGeometrySchema,bbox:fogBoundsSchema});
const point=z.object({x:n,y:n,z:n,levelId:uuid.nullable()}).strict();
const size=z.object({width:n,height:n}).strict(),appearance=z.object({baseColor:z.string(),frameColor:z.string().nullable()}).strict(),conditions=z.object({conditions:tokenConditionsSchema}).strict(),layer=z.object({layer:z.enum(['MAP','GM','PLAYER'])}).strict();
const revisions=z.object({tokens:z.record(uuid,revision),drawings:z.record(uuid,revision)}).strict();
const bulk=z.object({tokens:z.array(token).max(250),drawings:z.array(drawing).max(250),revisions}).strict();
const geometry=z.object({tokens:z.array(z.object({id:uuid,x:n,y:n,width:n,height:n,revision}).strict())}).strict();
const scene=z.object({name:z.string(),titleLabel:z.object({presentation:z.enum(['plain','ribbon']),offsetX:n,offsetY:n}).strict().nullable(),mapAssetId:uuid.nullable(),grid:gridSchema.strict(),mapScale:n,world:size,backgroundFrame:z.object({x:n,y:n,width:n,height:n}).strict(),tokenGeometry:geometry.optional()}).strict();
export type JournalTransferReferences={sceneIds:string[];assetIds:string[];definitionIds:string[];characterIds:string[];membershipIds:string[]};
/** GM canvas undo/redo history only. Never a generic arbitrary JSON history
 * reader: unknown types, scopes and snapshot fields fail the whole capture. */
export function validateTransferJournalRow(input:unknown):JournalTransferReferences{
 const row=z.object({type:z.string(),target_type:z.string(),target_id:uuid,scene_id:uuid,scope:z.enum(['PUBLIC','GM']),before:z.unknown(),after:z.unknown()}).passthrough().parse(input);
 const refs:JournalTransferReferences={sceneIds:[row.scene_id],assetIds:[],definitionIds:[],characterIds:[],membershipIds:[]};
 let kind:string,shape:z.ZodTypeAny,mode:'CREATE'|'DELETE'|'UPDATE'='UPDATE';
 switch(row.type){
  case 'TOKEN_CREATE':kind='TOKEN';shape=token;mode='CREATE';break;
  case 'TOKEN_DELETE':kind='TOKEN';shape=token;mode='DELETE';break;
  case 'TOKEN_MOVE':kind='TOKEN';shape=point;break;
  case 'TOKEN_RESIZE':kind='TOKEN';shape=size;break;
  case 'TOKEN_APPEARANCE':kind='TOKEN';shape=appearance;break;
  case 'TOKEN_CONDITIONS':kind='TOKEN';shape=conditions;break;
  case 'TOKEN_LAYER':kind='TOKEN';shape=layer;break;
  case 'DRAWING_CREATE':kind='DRAWING';shape=drawing;mode='CREATE';break;
  case 'DRAWING_DELETE':kind='DRAWING';shape=drawing;mode='DELETE';break;
  case 'DRAWING_UPDATE':kind='DRAWING';shape=drawing;break;
  case 'FOG_CREATE':kind='FOG';shape=fog;mode='CREATE';break;
  case 'CANVAS_BULK_MOVE':case 'CANVAS_BULK_DELETE':kind='CANVAS_BULK';shape=bulk;break;
  case 'SCENE_CANVAS':kind='SCENE';shape=scene;break;
  default:throw Error('CAMPAIGN_TRANSFER_JOURNAL_TYPE_UNREVIEWED');
 }
 if(row.target_type!==kind||(kind==='SCENE'&&row.target_id!==row.scene_id))throw Error('CAMPAIGN_TRANSFER_JOURNAL_TARGET');
 if((mode==='CREATE'&&row.before!==null)||(mode==='DELETE'&&row.after!==null))throw Error('CAMPAIGN_TRANSFER_JOURNAL_SNAPSHOT');
 for(const [side,value] of [['before',row.before],['after',row.after]] as const){
  if(value===null){if((side==='before'&&mode==='CREATE')||(side==='after'&&mode==='DELETE'))continue;throw Error('CAMPAIGN_TRANSFER_JOURNAL_SNAPSHOT');}
  const parsed=shape.parse(value) as Record<string,any>;
  const snapshots=kind==='CANVAS_BULK'?[...parsed.tokens,...parsed.drawings]:[parsed];
  for(const item of snapshots){
   if(item.id&&kind!=='CANVAS_BULK'&&item.id!==row.target_id)throw Error('CAMPAIGN_TRANSFER_JOURNAL_TARGET');
   if(item.sceneId&&item.sceneId!==row.scene_id)throw Error('CAMPAIGN_TRANSFER_JOURNAL_SCENE');
   if(item.assetId)refs.assetIds.push(item.assetId);if(item.mapAssetId)refs.assetIds.push(item.mapAssetId);
   if(item.definitionId)refs.definitionIds.push(item.definitionId);if(item.characterId)refs.characterIds.push(item.characterId);
   if(item.ownerMembershipId)refs.membershipIds.push(item.ownerMembershipId);if(item.authorMembershipId)refs.membershipIds.push(item.authorMembershipId);
   if((item.kind==='STAMP'||item.kind==='TEXTURE')&&uuid.safeParse(item.stampAssetKey).success)refs.assetIds.push(item.stampAssetKey);
  }
 }
 for(const key of Object.keys(refs) as (keyof JournalTransferReferences)[])refs[key]=[...new Set(refs[key])];
 return refs;
}

export const transferCanvasSnapshots={token,drawing,fog,scene};
