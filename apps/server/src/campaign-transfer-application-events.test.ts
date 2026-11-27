import {it,expect} from 'vitest';
import {validateTransferApplicationEvent} from './campaign-transfer-application-events.js';
const message=crypto.randomUUID(),actor=crypto.randomUUID(),scene=crypto.randomUUID(),entry=crypto.randomUUID();
const area={type:'ability.area.applied',entity_type:'chat',entity_id:message,membership_id:actor,payload:{requestHash:'a'.repeat(64),messageId:message,entryId:entry,sceneId:scene,sharedRoll:3,effects:[],spent:null,undoReceipt:{version:1,entry:null,characters:[]}}};
it('keeps application and undo dependencies explicit',()=>{expect(validateTransferApplicationEvent(area).sceneIds).toEqual([scene]);expect(validateTransferApplicationEvent({...area,type:'entry.undo',payload:{originalMessageId:message}}).messageIds).toEqual([message,message]);});
it('rejects unknown payload fields, mismatched message id and receipt envelopes',()=>{
 for(const payload of [{...area.payload,privateThread:['secret']},{...area.payload,messageId:crypto.randomUUID()},{...area.payload,undoReceipt:{...area.payload.undoReceipt,unknownPrivate:'secret'}}])expect(()=>validateTransferApplicationEvent({...area,payload})).toThrow();
});
