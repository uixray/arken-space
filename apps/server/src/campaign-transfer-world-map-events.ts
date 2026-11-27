import {z} from 'zod';
const uuid=z.string().uuid(),map=z.object({mapId:uuid}).strict(),location=map.extend({locationId:uuid}).strict();
const schemas:Record<string,{entity:string;schema:z.ZodTypeAny}>={};
function add(types:readonly string[],entity:string,schema:z.ZodTypeAny){for(const type of types)schemas[type]={entity,schema};}
add(['world_map.created','world_map.updated','world_map.published','world_map.archived'],'WORLD_MAP',map);
add(['world_map.background_set'],'WORLD_MAP',map.extend({hasBackground:z.boolean()}).strict());
add(['world_map.background_approved'],'WORLD_MAP',map.extend({backgroundAssetId:uuid}).strict());
add(['world_map.location_created','world_map.location_updated','world_map.location_deleted'],'WORLD_MAP_LOCATION',location);
add(['world_map.location_scene_linked','world_map.location_scene_unlinked'],'WORLD_MAP_LOCATION',location.extend({sceneId:uuid}).strict());
add(['world_map.party_position_set','world_map.party_position_cleared'],'WORLD_MAP_PARTY_POSITION',location.extend({revision:z.number().int().nonnegative()}).strict());
export const transferWorldMapEventTypes=Object.freeze(Object.keys(schemas));
export function worldMapEventEntities(type:string):readonly string[]{return schemas[type]?[schemas[type]!.entity]:[];}
export type WorldMapEventReferences={mapIds:string[];locationIds:string[];sceneIds:string[];assetIds:string[]};
export function validateTransferWorldMapEvent(input:unknown):WorldMapEventReferences{
 const event=z.object({type:z.string(),entity_type:z.string(),entity_id:uuid,payload:z.unknown()}).passthrough().parse(input),descriptor=schemas[event.type];if(!descriptor||descriptor.entity!==event.entity_type)throw Error('CAMPAIGN_TRANSFER_WORLD_MAP_EVENT_UNREVIEWED');
 const payload=descriptor.schema.parse(event.payload) as {mapId:string;locationId?:string;sceneId?:string;backgroundAssetId?:string};if(event.entity_id!==(descriptor.entity==='WORLD_MAP'?payload.mapId:payload.locationId))throw Error('CAMPAIGN_TRANSFER_WORLD_MAP_EVENT_IDENTITY');
 return {mapIds:[payload.mapId],locationIds:payload.locationId?[payload.locationId]:[],sceneIds:payload.sceneId?[payload.sceneId]:[],assetIds:payload.backgroundAssetId?[payload.backgroundAssetId]:[]};
}
