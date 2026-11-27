import {it,expect} from 'vitest';
import {validateTransferJournalRow} from './campaign-transfer-journal.js';
const scene=crypto.randomUUID(),target=crypto.randomUUID();
const base={type:'TOKEN_MOVE',target_type:'TOKEN',target_id:target,scene_id:scene,scope:'GM',before:{x:1,y:2,z:0,levelId:null},after:{x:3,y:4,z:0,levelId:null}};
it('retains movement undo/redo geometry in both public and GM history',()=>{
 for(const scope of ['GM','PUBLIC'])expect(validateTransferJournalRow({...base,scope}).sceneIds).toEqual([scene]);
});
it('rejects unsupported type, scope, mismatched target and opaque private snapshots',()=>{
 for(const row of [{...base,type:'CHAT_MESSAGE'},{...base,scope:'DIRECT'},{...base,target_type:'DRAWING'},{...base,before:{...base.before,privateMessages:['secret']}},{...base,after:null}])expect(()=>validateTransferJournalRow(row)).toThrow();
});
it('validates size, appearance, layer and condition variants',()=>{
 for(const [type,value] of [['TOKEN_RESIZE',{width:64,height:64}],['TOKEN_APPEARANCE',{baseColor:'#ffffff',frameColor:null}],['TOKEN_LAYER',{layer:'GM'}],['TOKEN_CONDITIONS',{conditions:[]}] ] as const)expect(validateTransferJournalRow({...base,type,before:value,after:value}).sceneIds).toEqual([scene]);
});
