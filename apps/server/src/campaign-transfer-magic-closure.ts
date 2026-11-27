import {z} from 'zod';import {createHash} from 'node:crypto';import {validateTransferMagicAwardEvent,transferMagicAwardEventTypes} from './campaign-transfer-magic-award-events.js';
/** Version/award binding only. Historical prerequisite overrides are preserved,
 * not reevaluated against present-day character or pack state. */
export function createCampaignTransferMagicClosure(){
 const packs=new Map<string,{pack:unknown;version:unknown;lifecycle:unknown}>(),assignments=new Map<string,Record<string,unknown>>(),awards=new Map<string,number>(),bindings=new Map<string,{actor:unknown;entity:unknown}>(),events:ReturnType<typeof validateTransferMagicAwardEvent>[]=[];let closed=false,entries=0;
 const uuid=(v:unknown)=>z.string().uuid().parse(v).toLowerCase(),same=(a:unknown,b:unknown)=>a===null||b===null?a===b:uuid(a)===uuid(b),charge=()=>{if(++entries>1000000)throw Error('CAMPAIGN_TRANSFER_MAGIC_CLOSURE_LIMIT');},awardKey=(action:unknown,actor:unknown,entity:unknown)=>uuid(action)+':'+uuid(actor)+':'+(entity===null||entity===undefined?'NULL':uuid(entity)),reason=(v:unknown)=>typeof v==='string'?createHash('sha256').update(v).digest('hex'):v;
 return {
  addRow(table:string,row:Record<string,unknown>){if(closed)throw Error('CAMPAIGN_TRANSFER_MAGIC_CLOSED');try{
   if(table==='spell_pack_versions'){charge();const key=uuid(row.id);if(packs.has(key))throw Error('CAMPAIGN_TRANSFER_SPELL_VERSION_DUPLICATE');packs.set(key,{pack:row.pack_id,version:row.version,lifecycle:row.lifecycle});}
   else if(table==='character_spell_assignment_versions'){charge();const {assignment_id,version,character_id,pack_id,pack_version_id,kind,school_id,node_id,rank,override_reason,assigned_by_membership_id}=row;const key=uuid(row.id);if(assignments.has(key))throw Error('CAMPAIGN_TRANSFER_ASSIGNMENT_VERSION_DUPLICATE');assignments.set(key,{assignment_id,version,character_id,pack_id,pack_version_id,kind,school_id,node_id,rank,override_reason:reason(override_reason),assigned_by_membership_id});}
   else if(table==='achievement_history'){const p=row.payload as Record<string,unknown>|null;if(p?.actionId){charge();const key=awardKey(p.actionId,row.actor_membership_id,p.entityId);awards.set(key,(awards.get(key)??0)+1);}}
   else if(table==='world_content_instance_actions'&&row.type==='world_content_instance.bindings'){charge();const key=uuid(row.action_id);if(bindings.has(key))throw Error('CAMPAIGN_TRANSFER_BINDING_HISTORY_DUPLICATE');bindings.set(key,{actor:row.actor_membership_id,entity:row.entity_id});}
   else if(table==='game_events'&&(transferMagicAwardEventTypes as readonly unknown[]).includes(row.type)){charge();events.push(validateTransferMagicAwardEvent(row));}
  }catch(error){closed=true;throw error;}},
  finish(){if(closed)throw Error('CAMPAIGN_TRANSFER_MAGIC_CLOSED');closed=true;
   for(const event of events){const p=event.payload as Record<string,unknown>;
    if(event.entity_type==='SPELL_PACK'){const version=packs.get(uuid(p.targetVersionId));if(!version||!same(version.pack,event.entity_id)||version.version!==p.targetVersion||version.lifecycle!==p.lifecycle)throw Error('CAMPAIGN_TRANSFER_SPELL_VERSION_REQUIRED');if(p.previousVersionId){const previous=packs.get(uuid(p.previousVersionId));if(!previous||!same(previous.pack,event.entity_id)||previous.version!==p.expectedVersion||previous.lifecycle!==p.previousLifecycle)throw Error('CAMPAIGN_TRANSFER_SPELL_PREVIOUS_VERSION_REQUIRED');}}
    else if(event.entity_type==='CHARACTER_SPELL_ASSIGNMENT'){
     const v=assignments.get(uuid(p.assignmentVersionId));if(!v||!same(v.assignment_id,event.entity_id)||v.version!==p.targetVersion||!same(v.character_id,p.characterId)||!same(v.pack_id,p.packId)||!same(v.pack_version_id,p.packVersionId)||v.kind!==p.kind||!same(v.school_id,p.schoolId)||!same(v.node_id,p.nodeId)||v.rank!==p.rank||v.override_reason!==reason(p.overrideReason)||!same(v.assigned_by_membership_id,event.membership_id))throw Error('CAMPAIGN_TRANSFER_SPELL_ASSIGNMENT_REQUIRED');
     if(p.previousAssignmentVersionId){const previous=assignments.get(uuid(p.previousAssignmentVersionId));if(!previous||!same(previous.assignment_id,event.entity_id)||previous.version!==(p.targetVersion as number)-1)throw Error('CAMPAIGN_TRANSFER_ASSIGNMENT_PREVIOUS_VERSION_REQUIRED');}
    }else if(event.type==='achievement.command'){if(awards.get(awardKey(event.action_id,event.membership_id,event.entity_id))!==1)throw Error('CAMPAIGN_TRANSFER_ACHIEVEMENT_HISTORY_REQUIRED');}
    else{const binding=bindings.get(uuid(event.action_id));if(!binding||!same(binding.actor,event.membership_id)||!same(binding.entity,event.entity_id))throw Error('CAMPAIGN_TRANSFER_BINDING_HISTORY_REQUIRED');}
   }return {events:events.length,packVersions:packs.size,assignmentVersions:assignments.size};
  },
 };
}
