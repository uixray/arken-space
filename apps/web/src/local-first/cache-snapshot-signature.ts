import type {GameSnapshot} from "@arken/contracts";
/** Exclude only transport clock and the server's synthesized empty-audio clock.
 * Never deduplicate solely by event sequence: permissions/read markers can change
 * without a new game event. Every other field remains part of the comparison. */
export function cacheSnapshotSignature(snapshot:GameSnapshot){
 const emptyAudio=snapshot.audio.assetId===null&&!snapshot.audio.playing&&snapshot.audio.revision===0&&snapshot.audio.positionSeconds===0;
 return JSON.stringify({...snapshot,serverTime:"",audio:{...snapshot.audio,updatedAt:emptyAudio?"":snapshot.audio.updatedAt}});
}
/** Blobs are immutable; reference equality avoids reading their bytes each poll.
 * Recreated Blobs conservatively trigger a new encrypted write. */
export function sameCacheMedia(a:ReadonlyMap<string,Blob>|undefined,b:ReadonlyMap<string,Blob>|undefined){
 if(a===undefined||b===undefined)return a===b;
 if(a.size!==b.size)return false;
 for(const [key,blob] of a)if(b.get(key)!==blob)return false;
 return true;
}
