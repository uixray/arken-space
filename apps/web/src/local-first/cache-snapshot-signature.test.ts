import {expect,it} from "vitest";
import {playerSnapshot} from "../test-support/game-snapshot-fixtures";
import {cacheSnapshotSignature,sameCacheMedia} from "./cache-snapshot-signature";
it("ignores only transport time and the synthesized empty audio timestamp",()=>{
 const snapshot=playerSnapshot();expect(cacheSnapshotSignature(snapshot)).toBe(cacheSnapshotSignature({...snapshot,serverTime:"later",audio:{...snapshot.audio,updatedAt:"later"}}));
 expect(cacheSnapshotSignature(snapshot)).not.toBe(cacheSnapshotSignature({...snapshot,me:{...snapshot.me,characterId:crypto.randomUUID()}}));
 const playing={...snapshot,audio:{...snapshot.audio,assetId:crypto.randomUUID(),playing:true}};
 expect(cacheSnapshotSignature(playing)).not.toBe(cacheSnapshotSignature({...playing,audio:{...playing.audio,updatedAt:"later"}}));
});
it("compares immutable media references and all URL versions",()=>{
 const blob=new Blob(["abc"],{type:"image/png"}),a=new Map([["url?v=1",blob]]);
 expect(sameCacheMedia(a,new Map(a))).toBe(true);expect(sameCacheMedia(a,new Map([["url?v=2",blob]]))).toBe(false);
 expect(sameCacheMedia(a,new Map([["url?v=1",new Blob(["abc"],{type:"image/png"})]]))).toBe(false);
 expect(sameCacheMedia(undefined,new Map())).toBe(false);
});
