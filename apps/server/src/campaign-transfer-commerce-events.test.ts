import {it,expect} from 'vitest';
import {creationCommandDefinitions} from '@arken/contracts';
import {validateTransferCommerceEvent,transferCreationEventTypes,transferEconomyEventTypes} from './campaign-transfer-commerce-events.js';
const action=crypto.randomUUID(),actor=crypto.randomUUID(),hash='a'.repeat(64);
const event={type:'creation.operation',entity_type:'creation',entity_id:null,action_id:action,membership_id:actor,payload:{requestHash:hash}};
it('explicit creation allowlist matches reviewed command definitions plus cancellation',()=>{expect(new Set(transferCreationEventTypes.filter(type=>type!=='creation.action.cancelled'))).toEqual(new Set(Object.values(creationCommandDefinitions).map(value=>value.type)));for(const type of transferCreationEventTypes)expect(()=>validateTransferCommerceEvent({...event,type})).not.toThrow();for(const type of transferEconomyEventTypes)expect(()=>validateTransferCommerceEvent({...event,type,entity_type:'economy',entity_id:action})).not.toThrow();});
it('rejects opaque receipt data, unknown types and swapped domains',()=>{for(const candidate of [{...event,payload:{requestHash:hash,privateRecipe:'secret'}},{...event,type:'creation.future'},{...event,entity_type:'economy'},{...event,entity_id:action}])expect(()=>validateTransferCommerceEvent(candidate)).toThrow();});
