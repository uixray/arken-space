import {it,expect} from 'vitest';import {validateTransferMediaEvent,transferMediaEventTypes} from './campaign-transfer-media-events.js';
const id=crypto.randomUUID(),asset=crypto.randomUUID(),action=crypto.randomUUID(),campaign=crypto.randomUUID(),stamp=new Date().toISOString(),hash='a'.repeat(64),etag='"'+hash+'"';
const state={assetId:asset,playing:false,positionSeconds:0,loop:false,startedAt:null,revision:1,updatedAt:stamp};
const cases:Record<string,{entity_type:string;entity_id:string;payload:unknown}>={
 'asset.created':{entity_type:'asset',entity_id:asset,payload:{assetId:asset,kind:'IMAGE',audioPurpose:null}},
 'asset.sprite_frame_created':{entity_type:'asset',entity_id:asset,payload:{assetId:asset,requestHash:hash,spriteStorageKey:'synthetic.webp'}},
 'asset.audio_purpose_changed':{entity_type:'asset',entity_id:asset,payload:{assetId:asset,audioPurpose:'MUSIC'}},
 'asset.deleted':{entity_type:'asset',entity_id:asset,payload:{assetId:asset,detachedUsageCount:0,detachedWorldContentCount:0}},
 'asset.replaced':{entity_type:'asset',entity_id:asset,payload:{assetId:asset,beforeVersion:etag,afterVersion:etag,contentSha256:hash,mimeType:'image/webp',sizeBytes:1,width:1,height:1,durationSeconds:null}},
 'AUDIO_COMMAND':{entity_type:'AUDIO_STATE',entity_id:campaign,payload:{command:{actionId:action,revision:0,command:'SELECT',assetId:asset},result:state}},
 'AUDIO_TRACK_COMMAND':{entity_type:'AUDIO_TRACK',entity_id:id,payload:{command:{actionId:action,command:'ADD_TRACK',assetId:asset},result:{...state,id,mixVolume:1,slotOrder:0}}},
 'STORY_ATTACHMENT_DELETE_REQUESTED':{entity_type:'STORY_ATTACHMENT',entity_id:id,payload:{contentId:asset,commandHash:hash,response:{deleted:true,contentId:asset}}},
};
it('covers all eight media types without making old file versions live dependencies',()=>{expect(new Set(Object.keys(cases))).toEqual(new Set(transferMediaEventTypes));for(const [type,value] of Object.entries(cases))expect(()=>validateTransferMediaEvent({type,action_id:action,...value}),type).not.toThrow();});
it('validates legacy audio, track removal and token derivation variants',()=>{for(const value of [
 {type:'AUDIO_COMMAND',entity_type:'AUDIO_STATE',entity_id:campaign,payload:{command:{actionId:action,assetId:asset,playing:false,positionSeconds:0,loop:false,startedAt:null},result:state}},
 {type:'AUDIO_TRACK_COMMAND',entity_type:'AUDIO_TRACK',entity_id:id,payload:{command:{actionId:action,revision:1,command:'REMOVE_TRACK',trackId:id},removedTrackId:id}},
 {type:'asset.created',entity_type:'asset',entity_id:asset,payload:{assetId:asset,kind:'TOKEN',sourceAssetId:id,transform:{cropX:.5,cropY:.5,zoom:1,frame:'NONE'}}},
 {type:'asset.created',entity_type:'asset',entity_id:asset,payload:{sourceAssetId:id}},
 ])expect(()=>validateTransferMediaEvent({action_id:action,...value})).not.toThrow();});
it('rejects opaque nested fields, traversal receipt paths and wrong audio identity',()=>{
 for(const value of [{...cases['asset.sprite_frame_created'],type:'asset.sprite_frame_created',payload:{assetId:asset,requestHash:hash,spriteStorageKey:'../secret'}},{...cases.AUDIO_COMMAND,type:'AUDIO_COMMAND',payload:{command:{actionId:id,revision:0,command:'SELECT',assetId:asset},result:state}},{...cases.AUDIO_COMMAND,type:'AUDIO_COMMAND',payload:{command:{actionId:action,revision:0,command:'SELECT',assetId:asset,private:'secret'},result:state}}])expect(()=>validateTransferMediaEvent({action_id:action,...value})).toThrow();
});
it('compares UUIDs canonically while retaining original event JSON outside validation',()=>{const event={type:'AUDIO_TRACK_COMMAND',action_id:action,entity_type:'AUDIO_TRACK',entity_id:id,payload:{command:{actionId:action.toUpperCase(),revision:1,command:'REMOVE_TRACK',trackId:id.toUpperCase()},removedTrackId:id.toUpperCase()}};expect(validateTransferMediaEvent(event).audioTrackIds).toEqual([id]);});
