import {it,expect} from 'vitest';
import {exactSnapshotSequence,compareSnapshotSequence,advanceSnapshotVersion,parseSnapshotSequence} from '@arken/contracts';
it('distinguishes adjacent int64 versions that round to the same JS number',()=>{
 const a={snapshotVersion:Number('9007199254743015'),snapshotSequence:'9007199254743015'},b={snapshotVersion:Number('9007199254743016'),snapshotSequence:'9007199254743016'};
 expect(a.snapshotVersion).toBe(b.snapshotVersion);expect(compareSnapshotSequence(a,b)).toBe(-1);
 expect(exactSnapshotSequence(b)).toBe('9007199254743016');
});
it('preserves safe legacy copies and rejects rounded legacy or mismatched identities',()=>{
 expect(exactSnapshotSequence({snapshotVersion:12})).toBe('12');
 expect(()=>exactSnapshotSequence({snapshotVersion:9007199254743016})).toThrow('REQUIRED');
 expect(()=>exactSnapshotSequence({snapshotVersion:12,snapshotSequence:'13'})).toThrow('MISMATCH');
 for(const value of ['01','-1','9223372036854775808',12 as unknown as string])expect(()=>parseSnapshotSequence(value)).toThrow();
 expect(advanceSnapshotVersion({snapshotVersion:12,snapshotSequence:'12'},13)).toEqual({snapshotVersion:13,snapshotSequence:'13'});
});
