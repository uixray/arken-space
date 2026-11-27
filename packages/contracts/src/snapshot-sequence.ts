type SnapshotVersion={snapshotVersion:number;snapshotSequence?:string};
const MAX_SEQUENCE=9223372036854775807n;
export function parseSnapshotSequence(value:string):bigint{
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(value))throw Error('SNAPSHOT_SEQUENCE_INVALID');
 const sequence=BigInt(value);if(sequence>MAX_SEQUENCE)throw Error('SNAPSHOT_SEQUENCE_INVALID');return sequence;
}
/** Legacy numeric field stays wire-compatible; exact identity is never rounded. */
export function exactSnapshotSequence(snapshot:SnapshotVersion):string{
 if(snapshot.snapshotSequence!==undefined){
  const sequence=parseSnapshotSequence(snapshot.snapshotSequence);
  if(Number(sequence)!==snapshot.snapshotVersion)throw Error('SNAPSHOT_SEQUENCE_MISMATCH');
  return snapshot.snapshotSequence;
 }
 if(!Number.isSafeInteger(snapshot.snapshotVersion)||snapshot.snapshotVersion<0)throw Error('SNAPSHOT_SEQUENCE_REQUIRED');
 return String(snapshot.snapshotVersion);
}
export function compareSnapshotSequence(a:SnapshotVersion,b:SnapshotVersion):number{
 const left=BigInt(exactSnapshotSequence(a)),right=BigInt(exactSnapshotSequence(b));return left<right?-1:left>right?1:0;
}

export function advanceSnapshotVersion(snapshot:SnapshotVersion,next:number):SnapshotVersion{
 const version=Math.max(snapshot.snapshotVersion,next);
 if(snapshot.snapshotSequence===undefined)return {snapshotVersion:version};
 return {snapshotVersion:version,snapshotSequence:version===snapshot.snapshotVersion?exactSnapshotSequence(snapshot):exactSnapshotSequence({snapshotVersion:version})};
}
