import {sceneCreateEventSchema} from "./scene-create-event.js";
import {z} from 'zod';
import {tokenConditionsSchema} from '@arken/contracts';
import {transferCanvasSnapshots as snapshots} from './campaign-transfer-journal.js';
import {knownFields} from './campaign-transfer-chat-events.js';
const uuid=z.string().uuid(),n=z.number().finite(),count=z.number().int().nonnegative();
const sceneId=z.object({sceneId:uuid}).strict(),placement=z.object({definitionId:uuid,sceneId:uuid}).strict(),nil=z.null();
const history=z.object({journalActionId:uuid.optional(),journalSequence:z.union([z.number().int().nonnegative(),z.string().regex(/^(0|[1-9][0-9]*)$/)])}).strict();
const bulk=z.object({sceneId:uuid,targets:z.array(z.object({targetType:z.enum(['TOKEN','DRAWING']),targetId:uuid,revision:count}).strict()).min(1).max(250)}).strict();
const entries:Record<string,{entities:readonly string[];schema:z.ZodTypeAny}>={};
function add(types:readonly string[],entities:readonly string[],schema:z.ZodTypeAny){for(const type of types)entries[type]={entities,schema};}
add(['scene.activated','scene.isometric'],['scene'],sceneId);
add(['scene.created'],['scene'],z.union([sceneId,sceneCreateEventSchema]));
add(['scene.updated'],['scene'],sceneId.extend({name:z.string().trim().min(1).max(100).optional(),mapAssetId:uuid.nullable().optional()}).strict());
add(['scene.canvas'],['scene'],snapshots.scene.omit({tokenGeometry:true}).extend({rescaledTokens:count.optional()}).strict());
add(['token.created'],['token'],z.object({tokenId:uuid}).strict());
add(['token.placed'],['token'],placement);add(['TOKEN_DELETED'],['TOKEN'],placement);
add(['TOKEN_MOVED'],['TOKEN'],z.object({x:n,y:n,z:n,levelId:uuid.nullable()}).strict());
add(['TOKEN_RESIZED'],['TOKEN'],z.object({width:n,height:n}).strict());
add(['TOKEN_APPEARANCE_UPDATED'],['TOKEN'],z.object({baseColor:z.string(),frameColor:z.string().nullable()}).strict());
add(['TOKEN_CONDITIONS_UPDATED'],['TOKEN'],z.object({conditions:tokenConditionsSchema}).strict());
add(['token.layer'],['token'],snapshots.token);
add(['token_definition.created','token_definition.updated'],['token_definition'],nil);
add(['token_definition.sprite_set'],['token_definition'],z.object({requestHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict());
add(['token_definition.deleted'],['token_definition'],z.object({placementsRemoved:count,sceneIds:z.array(uuid),undoable:z.literal(false),reason:z.literal('destructive definition deletion cascades placements')}).strict());
add(['token.controllers_replaced'],['token_definition'],z.object({controllerMembershipIds:z.array(uuid)}).strict());
add(['drawing.created','drawing.updated'],['drawing'],snapshots.drawing);
add(['drawing.copied'],['drawing'],z.object({copy:snapshots.drawing,sourceDrawingId:uuid}).strict());
add(['drawing.deleted'],['drawing'],nil);add(['fog.created'],['fog'],snapshots.fog);
add(['canvas.bulk.move','canvas.bulk.delete'],['canvas_bulk'],bulk);
add(['canvas.undo','canvas.redo'],['token','drawing','fog','scene','canvas_bulk'],history);
export const transferCanvasEventTypes=Object.freeze(Object.keys(entries));
export function canvasEventEntities(type:string):readonly string[]{return entries[type]?.entities??[];}
export type CanvasEventReferences={sceneIds:string[];tokenIds:string[];drawingIds:string[];fogIds:string[];definitionIds:string[];assetIds:string[];characterIds:string[];membershipIds:string[]};
export function validateTransferCanvasEvent(input:unknown):CanvasEventReferences{
 const event=z.object({type:z.string(),entity_type:z.string(),entity_id:uuid,payload:z.unknown()}).passthrough().parse(input),descriptor=entries[event.type];
 if(!descriptor||!descriptor.entities.includes(event.entity_type))throw Error('CAMPAIGN_TRANSFER_CANVAS_EVENT_UNREVIEWED');
 knownFields(descriptor.schema,event.payload);const p=descriptor.schema.parse(event.payload) as any;
 const refs:CanvasEventReferences={sceneIds:[],tokenIds:[],drawingIds:[],fogIds:[],definitionIds:[],assetIds:[],characterIds:[],membershipIds:[]};
 const domain=event.entity_type.toLowerCase();if(domain==='scene')refs.sceneIds.push(event.entity_id);if(domain==='token')refs.tokenIds.push(event.entity_id);if(domain==='drawing')refs.drawingIds.push(event.entity_id);if(domain==='fog')refs.fogIds.push(event.entity_id);if(domain==='token_definition')refs.definitionIds.push(event.entity_id);
 if(p){const row=p.copy??p;
  if(event.type==='scene.created'&&p.command?.mapAssetId)refs.assetIds.push(p.command.mapAssetId);
  if(row.id&&row.id!==event.entity_id)throw Error('CAMPAIGN_TRANSFER_CANVAS_EVENT_IDENTITY');
  if(p.tokenId&&p.tokenId!==event.entity_id)throw Error('CAMPAIGN_TRANSFER_CANVAS_EVENT_IDENTITY');
  if(domain==='scene'&&p.sceneId&&p.sceneId!==event.entity_id)throw Error('CAMPAIGN_TRANSFER_CANVAS_EVENT_IDENTITY');
  if(row.sceneId)refs.sceneIds.push(row.sceneId);if(p.sceneIds)refs.sceneIds.push(...p.sceneIds);
  if(row.definitionId)refs.definitionIds.push(row.definitionId);if(row.assetId)refs.assetIds.push(row.assetId);if(row.mapAssetId)refs.assetIds.push(row.mapAssetId);if(row.characterId)refs.characterIds.push(row.characterId);if(row.ownerMembershipId)refs.membershipIds.push(row.ownerMembershipId);if(row.authorMembershipId)refs.membershipIds.push(row.authorMembershipId);
  if((row.kind==='STAMP'||row.kind==='TEXTURE')&&uuid.safeParse(row.stampAssetKey).success)refs.assetIds.push(row.stampAssetKey);
  if(p.sourceDrawingId)refs.drawingIds.push(p.sourceDrawingId);if(p.controllerMembershipIds)refs.membershipIds.push(...p.controllerMembershipIds);
  for(const target of p.targets??[])(target.targetType==='TOKEN'?refs.tokenIds:refs.drawingIds).push(target.targetId);
 }
 for(const key of Object.keys(refs) as (keyof CanvasEventReferences)[])refs[key]=[...new Set(refs[key])];return refs;
}
