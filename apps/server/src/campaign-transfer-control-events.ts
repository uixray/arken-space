import {z} from 'zod';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),nil=z.null();
export const transferControlEventTypes=['player_access.created','player_access.reused','player_access.reactivated','player_access.revoked','player_access.rotated','invite.revoked','gm_access.rotated','membership.renamed','entry.recharged','ability.area.cancelled'] as const;
export function controlEventEntities(type:string):readonly string[]{return type.startsWith('player_access.')?['player_access']:type==='invite.revoked'?['invite']:type==='gm_access.rotated'?['campaign']:type==='membership.renamed'?['membership']:type==='entry.recharged'?['character_catalog_entry']:type==='ability.area.cancelled'?['action']:[];}
export type ControlEventReferences={campaignIds:string[];membershipIds:string[];characterIds:string[];entryIds:string[];actionIds:string[];authRuntimeRefs:{kind:'PLAYER_ACCESS'|'INVITE';id:string}[]};
export function validateTransferControlEvent(input:unknown):ControlEventReferences{
 const event=z.object({type:z.enum(transferControlEventTypes),entity_type:z.string(),entity_id:uuid,action_id:uuid,payload:z.unknown()}).passthrough().parse(input);if(controlEventEntities(event.type)[0]!==event.entity_type)throw Error('CAMPAIGN_TRANSFER_CONTROL_EVENT_DOMAIN');
 const refs:ControlEventReferences={campaignIds:[],membershipIds:[],characterIds:[],entryIds:[],actionIds:[],authRuntimeRefs:[]};
 if(event.type==='ability.area.cancelled'){z.object({requestHash:hash}).strict().parse(event.payload);if(event.entity_id!==event.action_id)throw Error('CAMPAIGN_TRANSFER_CONTROL_EVENT_IDENTITY');refs.actionIds.push(event.action_id);}
 else if(event.type==='entry.recharged'){z.object({commandHash:hash}).strict().parse(event.payload);refs.entryIds.push(event.entity_id);}
 else if(event.type==='membership.renamed'){const p=z.object({membershipId:uuid,displayName:z.string()}).strict().parse(event.payload);if(p.membershipId!==event.entity_id)throw Error('CAMPAIGN_TRANSFER_CONTROL_EVENT_IDENTITY');refs.membershipIds.push(p.membershipId);}
 else if(event.type==='gm_access.rotated'){nil.parse(event.payload);refs.campaignIds.push(event.entity_id);}
 else if(event.entity_type==='invite'){nil.parse(event.payload);refs.authRuntimeRefs.push({kind:'INVITE',id:event.entity_id});}
 else{
  if(event.type==='player_access.created'){const p=z.object({membershipId:uuid,characterId:uuid}).strict().parse(event.payload);refs.membershipIds.push(p.membershipId);refs.characterIds.push(p.characterId);}
  else if(event.type==='player_access.reused'||event.type==='player_access.reactivated'){const p=z.object({characterId:uuid}).strict().parse(event.payload);refs.characterIds.push(p.characterId);}
  else nil.parse(event.payload);
  refs.authRuntimeRefs.push({kind:'PLAYER_ACCESS',id:event.entity_id});
 }
 return refs;
}
