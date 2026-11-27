import {z} from 'zod';
const count=z.number().int().nonnegative().safe(),clock=z.object({battleActive:z.boolean(),battleCounter:count,revision:count}).strict();
const payload=z.object({commandHash:z.string().regex(/^[a-f0-9]{64}$/),clockBefore:clock,clockAfter:clock,transitionApplied:z.boolean(),recharged:count,initiativeBefore:count,initiativeAfter:count}).strict();
export const transferEncounterEventTypes=Object.freeze(['ENCOUNTER_STARTED','ENCOUNTER_ENDED'] as const);
export function encounterEventEntities(type:string):readonly string[]{return (transferEncounterEventTypes as readonly string[]).includes(type)?['ENCOUNTER']:[];}
export function validateTransferEncounterEvent(input:unknown){
 const event=z.object({type:z.enum(transferEncounterEventTypes),entity_type:z.literal('ENCOUNTER'),entity_id:z.string().uuid(),entity_revision:count,payload}).passthrough().parse(input),p=event.payload,b=p.clockBefore,a=p.clockAfter,started=event.type==='ENCOUNTER_STARTED';
 if(a.revision!==b.revision+1||a.battleActive!==started||p.transitionApplied!==(started?!b.battleActive:b.battleActive)||a.battleCounter!==b.battleCounter+(started&&!b.battleActive?1:0)||(started&&p.recharged!==0)||(!started&&p.initiativeAfter!==0))throw Error('CAMPAIGN_TRANSFER_ENCOUNTER_TRANSITION_INVALID');
 return {encounterIds:[event.entity_id.toLowerCase()]};
}
