import {it,expect} from 'vitest';import {playerSnapshot} from '../test-support/game-snapshot-fixtures';import {parsePlayerReadArchive,createPlayerReadArchive} from './player-read-archive';import {encodePlayerCacheBundle,decodePlayerCacheBundle} from './player-cache-media';
it('preserves actual saved catalogue metadata through the encrypted-bundle payload format',async()=>{
 const snapshot=playerSnapshot({assets:[]}),id=crypto.randomUUID();snapshot.campaign.id=crypto.randomUUID();const soundpad={packs:[{id,campaignId:snapshot.campaign.id,name:'Saved public catalogue',published:true,audience:'ALL_MEMBERS' as const,sortOrder:0,sounds:[]}],playerPlaybackEnabled:false};
 const reads=parsePlayerReadArchive(snapshot,{soundpad,history:[]});const encoded=await encodePlayerCacheBundle(snapshot,new Map(),undefined,reads);
 expect(encoded.format).toBe(4);expect(decodePlayerCacheBundle(encoded).reads).toEqual(reads);
 expect(()=>parsePlayerReadArchive(snapshot,{soundpad:{...soundpad,packs:[{...soundpad.packs[0],campaignId:crypto.randomUUID()}]},history:[]})).toThrow('SCOPE');
 expect(()=>parsePlayerReadArchive(snapshot,{soundpad:{...soundpad,packs:[{...soundpad.packs[0],audience:'GM_ONLY'}]},history:[]})).toThrow('SCOPE');
});
it('drops optional stale catalogue data instead of failing an acknowledged mutation',()=>{
 const snapshot=playerSnapshot({assets:[]}),archive=createPlayerReadArchive();const response={snapshot} as any;
 const soundpad={packs:[],playerPlaybackEnabled:true};expect(archive.observe(snapshot,{...response,soundpad}).soundpad).toEqual(soundpad);
 expect(archive.observe(snapshot,response).soundpad).toBeUndefined();
 expect(archive.observe(snapshot,{...response,soundpad:{packs:[{campaignId:'foreign'}]}})).toEqual({history:[]});
});
it('rejects foreign actor or stale scene history before it enters a copy',()=>{
 const snapshot=playerSnapshot();snapshot.campaign.id=crypto.randomUUID();const scene={id:crypto.randomUUID(),active:true};snapshot.scenes=[scene] as any;
 const entry={sequence:1,actorMembershipId:crypto.randomUUID(),type:'token.moved',targetType:'token',targetId:crypto.randomUUID(),status:'APPLIED',createdAt:new Date().toISOString(),nextDirection:'undo'};
 expect(()=>parsePlayerReadArchive(snapshot,{history:[{sceneId:scene.id,sequence:String(snapshot.snapshotVersion),entries:[entry]}]})).toThrow('SCOPE');
});

it('round-trips only the current player own history at the exact saved scene version',async()=>{
 const snapshot=playerSnapshot({assets:[]});snapshot.campaign.id=crypto.randomUUID();snapshot.me.id=crypto.randomUUID();const sceneId=crypto.randomUUID();snapshot.scenes=[{id:sceneId,active:true}] as any;
 const entry={sequence:4,actorMembershipId:snapshot.me.id,type:'token.moved',targetType:'token',targetId:crypto.randomUUID(),status:'APPLIED',createdAt:new Date().toISOString(),nextDirection:'undo' as const};
 const reads={history:[{sceneId,sequence:String(snapshot.snapshotVersion),entries:[entry]}]};
 const encoded=await encodePlayerCacheBundle(snapshot,new Map(),undefined,reads);expect(decodePlayerCacheBundle(encoded).reads?.history[0]?.entries).toEqual([entry]);
 expect(()=>parsePlayerReadArchive({...snapshot,snapshotVersion:snapshot.snapshotVersion+1},reads)).toThrow('SCOPE');
});
