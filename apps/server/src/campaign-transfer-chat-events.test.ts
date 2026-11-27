import {expect,it} from 'vitest';
import {validateTransferChatDelivery} from './campaign-transfer-chat-events.js';
const dto={id:crypto.randomUUID(),sequence:1,membershipId:crypto.randomUUID(),displayName:'Synthetic',characterId:null,body:'Hello',visibility:'PUBLIC',kind:'TEXT',threadId:crypto.randomUUID(),stream:'TABLE',dice:null,createdAt:new Date().toISOString()};
it('validates delivery without admitting unknown opaque top-level data',()=>{expect(validateTransferChatDelivery(dto).body).toBe('Hello');expect(()=>validateTransferChatDelivery({...dto,privateMessages:['secret']})).toThrow();});
it('rejects unknown nested dice data even though runtime normalization would strip it',()=>{
 const dice={formula:'1d20',resolvedFormula:'1d20',terms:[],modifiers:[],total:10};expect(validateTransferChatDelivery({...dto,kind:'DICE',dice}).dice?.total).toBe(10);
 expect(()=>validateTransferChatDelivery({...dto,kind:'DICE',dice:{...dice,privateNotebook:'secret'}})).toThrow('FIELD_UNREVIEWED');
 expect(()=>validateTransferChatDelivery({...dto,kind:'DICE',dice:{...dice,modifiers:[{source:'test',value:1,private:'hidden'}]}})).toThrow('FIELD_UNREVIEWED');
});
