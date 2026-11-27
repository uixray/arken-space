import {z} from 'zod';import {gridSchema,cartographicLabelSchema,tokenConditionsSchema,tokenSpriteSetSchema,drawingPointsSchema,fogGeometrySchema,fogBoundsSchema,fogGeometryBounds,validateFogPolygon,encounterFocusRegionSchema} from '@arken/contracts';import {knownFields} from './campaign-transfer-chat-events.js';
/** Validation-only of current canvas JSON. Original row bytes are preserved;
 * nested asset/floor references still require separate cross-row closure. */
export function validateCampaignTransferCanvasJson(table:string,row:Record<string,unknown>){
 const check=(schema:z.ZodTypeAny,value:unknown)=>{knownFields(schema,value);return schema.parse(value);};
 if(table==='scenes'){check(gridSchema,row.grid);if(row.title_label!=null)check(cartographicLabelSchema,row.title_label);}
 else if(table==='world_map_locations'&&row.label!=null)check(cartographicLabelSchema,row.label);
 else if(table==='tokens')check(tokenConditionsSchema,row.conditions);
 else if(table==='token_definitions'&&row.sprite_set!=null)check(tokenSpriteSetSchema,row.sprite_set);
 else if(table==='drawings'){const kind=z.enum(['FREEHAND','STAMP','TEXTURE']).parse(row.kind);check(kind==='FREEHAND'?drawingPointsSchema:z.array(z.number().finite()).max(4096),row.points);}
 else if(table==='encounters'&&row.focus_region!=null)check(encounterFocusRegionSchema,row.focus_region);
 else if(table==='fog_reveals'){
  const geometry=check(fogGeometrySchema,row.geometry) as z.infer<typeof fogGeometrySchema>,bounds=check(fogBoundsSchema,row.bbox) as z.infer<typeof fogBoundsSchema>,expected=fogGeometryBounds(geometry);
  if(geometry.type==='POLYGON'&&!validateFogPolygon(geometry.points))throw Error('CAMPAIGN_TRANSFER_FOG_POLYGON_INVALID');
  if(row.shape!==geometry.type||(['x','y','width','height'] as const).some(key=>bounds[key]!==expected[key]||row[key]!==bounds[key]))throw Error('CAMPAIGN_TRANSFER_FOG_BOUNDS_MISMATCH');
 }
}
