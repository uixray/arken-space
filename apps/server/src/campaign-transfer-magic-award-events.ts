import {z} from 'zod';import {spellPackLifecycleSchema,spellPrerequisiteFailureSchema} from '@arken/contracts';
const uuid=z.string().uuid(),count=z.number().int().nonnegative(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const transferSpellPackEventTypes=['spell_pack.created','spell_pack.version_created','spell_pack.lifecycle_changed','spell_pack.archived'] as const;
export const transferSpellAssignmentEventTypes=['character_spell_assignment.assigned','character_spell_assignment.reassigned','character_spell_assignment.overridden'] as const;
export const transferAwardEventTypes=['achievement.command','instance.bindings'] as const;
export const transferMagicAwardEventTypes=[...transferSpellPackEventTypes,...transferSpellAssignmentEventTypes,...transferAwardEventTypes] as const;
const pack=z.object({commandHash:hash,targetVersionId:uuid,targetVersion:z.number().int().positive(),expectedVersion:count,lifecycle:spellPackLifecycleSchema,previousVersionId:uuid.optional(),previousLifecycle:spellPackLifecycleSchema.optional()}).strict();
const assignment=z.object({operation:z.enum(['CREATE','APPEND']),commandHash:hash,assignmentVersionId:uuid,targetVersion:z.number().int().positive(),characterId:uuid,packId:uuid,packVersionId:uuid,kind:z.enum(['SCHOOL','NODE']),schoolId:uuid,nodeId:uuid.nullable(),rank:z.number().int().positive().max(1000).nullable(),overrideReason:z.string().min(1).nullable(),previousAssignmentVersionId:uuid.optional(),prerequisiteFailures:z.array(spellPrerequisiteFailureSchema).optional()}).strict();
export function magicAwardEventEntities(type:string):readonly string[]{return (transferSpellPackEventTypes as readonly string[]).includes(type)?['SPELL_PACK']:(transferSpellAssignmentEventTypes as readonly string[]).includes(type)?['CHARACTER_SPELL_ASSIGNMENT']:(transferAwardEventTypes as readonly string[]).includes(type)?[type]:[];}
export function validateTransferMagicAwardEvent(input:unknown){
 const event=z.object({type:z.enum(transferMagicAwardEventTypes),entity_type:z.string(),entity_id:uuid.nullable(),action_id:uuid,membership_id:uuid,payload:z.unknown()}).passthrough().parse(input);
 if(magicAwardEventEntities(event.type)[0]!==event.entity_type||(event.type!=='achievement.command'&&event.entity_id===null))throw Error('CAMPAIGN_TRANSFER_MAGIC_EVENT_ENTITY');
 if(event.entity_type==='SPELL_PACK'){const payload=pack.parse(event.payload);if(payload.targetVersion!==payload.expectedVersion+1||Boolean(payload.previousVersionId)!==Boolean(payload.previousLifecycle))throw Error('CAMPAIGN_TRANSFER_SPELL_VERSION_METADATA');return {...event,payload};}
 if(event.entity_type==='CHARACTER_SPELL_ASSIGNMENT'){
  const payload=assignment.parse(event.payload);if((payload.kind==='SCHOOL'&&(payload.nodeId!==null||payload.rank!==null))||(payload.kind==='NODE'&&(payload.nodeId===null||payload.rank===null))||(payload.operation==='CREATE'?payload.targetVersion!==1:payload.targetVersion<2)||(event.type==='character_spell_assignment.assigned'&&payload.operation!=='CREATE')||(event.type==='character_spell_assignment.reassigned'&&payload.operation!=='APPEND')||((event.type==='character_spell_assignment.overridden')!==(payload.overrideReason!==null)))throw Error('CAMPAIGN_TRANSFER_SPELL_ASSIGNMENT_METADATA');return {...event,payload};
 }
 return {...event,payload:z.object({commandHash:hash}).strict().parse(event.payload)};
}
