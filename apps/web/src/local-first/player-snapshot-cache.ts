import {parsePlayerReadArchive,type PlayerReadArchive} from "./player-read-archive";
import {exactSnapshotSequence,parseSnapshotSequence} from "@arken/contracts";
import {parsePlayerStoryArchive,type PlayerStoryArchive} from "./player-story-cache";
import {cacheSnapshotSignature,sameCacheMedia} from "./cache-snapshot-signature";
import {watchCacheValidity,notifyPlayerCacheChanged} from "./cache-validity-watch";
import {
  encodePlayerCacheBundle,
  decodePlayerCacheBundle,
  type PlayerCachedBundle,
} from "./player-cache-media";
import { z } from "zod";
import { localAuthoritySchema, type GameSnapshot } from "@arken/contracts";

const scopeSchema = z
  .object({
    authority: localAuthoritySchema,
    membershipId: z.string().uuid(),
    deviceId: z.string().uuid(),
  })
  .strict();
export type PlayerCacheScope = z.infer<typeof scopeSchema>;
const DATABASE = "arken-player-cache-v1",
  STORE = "snapshots",
  MAX_BYTES = 8 * 1024 * 1024;
const TTL = 12 * 60 * 60 * 1000;
// Snapshot keys begin with '['; encrypted small inventory records are separate
// keys in the same store, so saving/deleting both remains a single transaction.
const snapshotRange=()=>IDBKeyRange.bound("[","]",false,true);
const labelKey=(id:string)=>"label:"+id;
const labelSchema=z.object({name:z.string().min(1).max(256),player:z.string().max(256)}).strict();
export type PlayerCopySummary={scope:PlayerCacheScope;name:string;player:string;savedAt:number|null;legacy:boolean};
type Slot = {
  writeId?:string;
  generation: string;
  key: CryptoKey;
  version?: number|string;
  expiresAt?: number;
  iv?: Uint8Array<ArrayBuffer>;
  cipher?: ArrayBuffer;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(Error("PLAYER_CACHE_UNAVAILABLE"));
    request.onblocked = () => reject(Error("PLAYER_CACHE_UNAVAILABLE"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

/** Do not await WebCrypto inside an IndexedDB transaction: it may auto-commit.
 * Generation checks and deletion are instead performed atomically after crypto. */
function slotTransaction<T>(
  db: IDBDatabase,
  id: string,
  mode: IDBTransactionMode,
  operation: (slot: Slot | undefined, store: IDBObjectStore) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode),
      store = tx.objectStore(STORE),
      request = store.get(id);
    let value: T, failure: unknown;
    request.onsuccess = () => {
      try {
        value = operation(request.result as Slot | undefined, store);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(value);
    tx.onabort = tx.onerror = () =>
      reject(failure ?? Error("PLAYER_CACHE_UNAVAILABLE"));
  });
}

async function pruneExpired(db:IDBDatabase){
 const removed=await new Promise<number>((resolve,reject)=>{
  const tx=db.transaction(STORE,"readwrite"),request=tx.objectStore(STORE).openCursor(snapshotRange());let count=0,scanned=0;
  request.onsuccess=()=>{const cursor=request.result;if(!cursor||scanned++>=64)return;
   const slot=cursor.value as Slot;
   if(slot&&((typeof slot.expiresAt==="number"&&Number.isFinite(slot.expiresAt)&&slot.expiresAt<=Date.now())||(!slot.cipher&&slot.expiresAt===undefined))){cursor.delete();tx.objectStore(STORE).delete(labelKey(String(cursor.key)));count++;}
   cursor.continue();};
  tx.oncomplete=()=>resolve(count);tx.onerror=tx.onabort=()=>reject(Error("PLAYER_CACHE_UNAVAILABLE"));
 });
 if(removed)notifyPlayerCacheChanged();return removed;
}

function scopeId(input: PlayerCacheScope) {
  const { authority: a, membershipId, deviceId } = scopeSchema.parse(input);
  return JSON.stringify([
    1,
    a.campaignId,
    a.hostId,
    a.sessionId,
    a.epoch,
    membershipId,
    deviceId,
  ]);
}
function validateSnapshot(snapshot: GameSnapshot, scope: PlayerCacheScope) {
  if (
    snapshot?.me?.role !== "PLAYER" ||
    snapshot.me.id !== scope.membershipId ||
    snapshot.campaign?.id !== scope.authority.campaignId ||
    snapshot.snapshotVersion < 0
  )
    throw Error("PLAYER_CACHE_SCOPE_MISMATCH");
  exactSnapshotSequence(snapshot);
}
function storedSequence(version:number|string|undefined):bigint{
 if(version===undefined)return -1n;
 if(typeof version==="number"&&!Number.isSafeInteger(version))throw Error("PLAYER_CACHE_INVALID");
 return parseSnapshotSequence(String(version));
}
function aad(
  id: string,
  slot: Pick<Slot, "generation" | "version" | "expiresAt" | "writeId">,
) {
  const fields:unknown[]=[id,slot.generation,slot.version,slot.expiresAt];
  if(slot.writeId!==undefined)fields.push(slot.writeId); // Legacy ciphertext keeps its original AAD.
  return new TextEncoder().encode(JSON.stringify(fields));
}

/** Call only after an authenticated PLAYER handshake, and explicit device opt-in.
 * Non-extractable AES-GCM key lives in this origin's IndexedDB, not a password vault.
 * This protects raw stored payloads, NOT a compromised origin/browser/OS or XSS.
 * No credentials or private keys from the transport are accepted by this API. */
export interface PlayerSnapshotCache {
 save(snapshot:GameSnapshot,media?:ReadonlyMap<string,Blob>,story?:PlayerStoryArchive,reads?:PlayerReadArchive):Promise<void>;
 load():Promise<GameSnapshot|null>;
 loadBundle():Promise<PlayerCachedBundle|null>;
 forget():Promise<void>;
 watch(onInvalidated:()=>void,deadline?:number):()=>void;
 close():void;
}
export function openPlayerSnapshotCache(input:PlayerCacheScope):Promise<PlayerSnapshotCache>;
export function openPlayerSnapshotCache(input:PlayerCacheScope,existingOnly:true):Promise<PlayerSnapshotCache|null>;
export async function openPlayerSnapshotCache(input: PlayerCacheScope,existingOnly=false):Promise<PlayerSnapshotCache|null> {
  const scope = scopeSchema.parse(input),
    id = scopeId(scope),
    db = await openDatabase();
  let closed = false;
  const watchers=new Set<()=>void>();
  let writeTail: Promise<void> = Promise.resolve();
  let lastSaved:{signature:string;media:ReadonlyMap<string,Blob>|undefined;writeId:string;at:number}|undefined;
  try {
    await pruneExpired(db);
    const generated = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const selected = await slotTransaction(
      db,
      id,
      "readwrite",
      (current, store) => {
        if (current && (!current.expiresAt || current.expiresAt > Date.now()))
          return current;
        if(existingOnly){if(current)store.delete(id);return undefined;}
        const slot: Slot = { generation: crypto.randomUUID(), key: generated,expiresAt:Date.now()+TTL };
        if (current) store.put(slot, id);
        else {
          const count = store.count(snapshotRange());
          count.onsuccess = () => {
            if (count.result >= 32) store.transaction.abort();
            else store.put(slot, id);
          };
        }
        return slot;
      },
    );
    if(!selected){db.close();return null;}
    const check = () => {
      if (closed) throw Error("PLAYER_CACHE_CLOSED");
    };
    const forget = async () => {
      check();
      await slotTransaction(db, id, "readwrite", (current, store) => {
        if (current?.generation === selected.generation){store.delete(id);store.delete(labelKey(id));}
      });
      notifyPlayerCacheChanged();
    };
    const handle:PlayerSnapshotCache = {
      async save(snapshot: GameSnapshot, media?: ReadonlyMap<string, Blob>,story?:PlayerStoryArchive,reads?:PlayerReadArchive) {
        check();
        validateSnapshot(snapshot, scope);
        const frozen = JSON.parse(JSON.stringify(snapshot)) as GameSnapshot;
        if (
          new TextEncoder().encode(JSON.stringify(frozen)).byteLength >
          MAX_BYTES
        )
          throw Error("PLAYER_CACHE_TOO_LARGE");
        const captured = media || story || reads ? new Map(media) : undefined;
        const frozenReads=reads?parsePlayerReadArchive(frozen,reads):undefined;
        const frozenStory=story?parsePlayerStoryArchive(story):undefined;
        const version = exactSnapshotSequence(frozen),signature=cacheSnapshotSignature(frozen)+JSON.stringify(frozenStory??null)+JSON.stringify(frozenReads??null);
        const save = writeTail.then(async () => {
          check();
          const current=await slotTransaction(db,id,"readonly",value=>value);
          if(current?.generation!==selected.generation)throw Error("PLAYER_CACHE_REVOKED");
          if(storedSequence(current.version)>BigInt(version))return;
          if(lastSaved&&current.writeId===lastSaved.writeId&&current.cipher&&current.expiresAt&&current.expiresAt>Date.now()
            &&Date.now()>=lastSaved.at&&Date.now()-lastSaved.at<60000&&signature===lastSaved.signature&&sameCacheMedia(captured,lastSaved.media))return;
          const payload = captured
            ? await encodePlayerCacheBundle(frozen, captured,frozenStory,frozenReads)
            : frozen;
          const bytes = new TextEncoder().encode(JSON.stringify(payload));
          if (bytes.byteLength > 52 * 1024 * 1024)
            throw Error("PLAYER_CACHE_TOO_LARGE");
          const record: Slot = {
            writeId:crypto.randomUUID(),
            generation: selected.generation,
            key: selected.key,
            version,
            expiresAt: Date.now() + TTL,
            iv: crypto.getRandomValues(new Uint8Array(12)),
          };
          record.cipher = await crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv: record.iv!,
              additionalData: aad(id, record),
              tagLength: 128,
            },
            selected.key,
            bytes,
          );
          const label=labelSchema.parse({name:frozen.campaign.name,player:frozen.me.displayName});
          const labelBytes=new TextEncoder().encode(JSON.stringify(label));
          if(labelBytes.length>4096)throw Error("PLAYER_CACHE_LABEL_INVALID");
          const summary:Slot={generation:record.generation,key:record.key,version:record.version,expiresAt:record.expiresAt,writeId:record.writeId,iv:crypto.getRandomValues(new Uint8Array(12))};
          summary.cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv:summary.iv!,additionalData:labelAad(id,summary),tagLength:128},selected.key,labelBytes);
          check();
          const written=await slotTransaction(db, id, "readwrite", (current, store) => {
            if (current?.generation !== selected.generation)
              throw Error("PLAYER_CACHE_REVOKED");
            if (storedSequence(current.version)>BigInt(version)) return false;
            store.put(record, id);store.put(summary,labelKey(id));return true;
          });
          if(written)lastSaved={signature,media:captured,writeId:record.writeId!,at:Date.now()};
        });
        writeTail = save.catch(() => {});
        return save;
      },
      async loadBundle(): Promise<PlayerCachedBundle | null> {
        check();
        const record = await slotTransaction(
          db,
          id,
          "readonly",
          (current) => current,
        );
        if (!record || record.generation !== selected.generation) return null;
        if (!record.cipher) return null;
        if (!record.expiresAt || record.expiresAt <= Date.now()) {
          await forget();
          return null;
        }
        if (
          record.cipher.byteLength > 52 * 1024 * 1024 + 16 ||
          record.iv?.byteLength !== 12
        )
          throw Error("PLAYER_CACHE_INVALID");
        try {
          const bytes = await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: record.iv,
              additionalData: aad(id, record),
              tagLength: 128,
            },
            record.key,
            record.cipher,
          );
          check();
          const bundle = decodePlayerCacheBundle(
            JSON.parse(new TextDecoder().decode(bytes)),
          );
          const snapshot = bundle.snapshot;
          validateSnapshot(snapshot, scope);
          if (exactSnapshotSequence(snapshot) !== String(record.version))
            throw Error("PLAYER_CACHE_INVALID");
          // A concurrent clear/re-pair cannot resurrect an already decrypted copy.
          const generation = await slotTransaction(
            db,
            id,
            "readonly",
            (current) => current?.generation,
          );
          check();
          bundle.expiresAt=record.expiresAt;bundle.savedAt=record.expiresAt-TTL;
          return generation === selected.generation ? bundle : null;
        } catch {
          throw Error("PLAYER_CACHE_INVALID");
        }
      },
      async load(): Promise<GameSnapshot | null> {
        return (await this.loadBundle())?.snapshot ?? null;
      },
      forget,
      watch(onInvalidated,deadline){
        check();const stop=watchCacheValidity(async()=>{
          if(closed)return false;
          const current=await slotTransaction(db,id,"readonly",value=>value);
          return Boolean(current?.generation===selected.generation&&current.cipher&&current.expiresAt&&current.expiresAt>Date.now()&&(deadline===undefined||deadline>Date.now()));
        },onInvalidated);watchers.add(stop);return ()=>{stop();watchers.delete(stop);};
      },
      close() {
        closed = true;lastSaved=undefined;
        for(const stop of watchers)stop();watchers.clear();
        db.close();
      },
    };
    return handle;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Metadata inventory only; explicit local action, never grants network access. */
export async function listPlayerSnapshotCopies():Promise<PlayerCacheScope[]>{
 const db=await openDatabase();
 try{await pruneExpired(db);return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,"readonly"),request=tx.objectStore(STORE).openKeyCursor(snapshotRange()),scopes:PlayerCacheScope[]=[];
  request.onsuccess=()=>{const cursor=request.result;if(!cursor||scopes.length>=32)return;
   try{const [version,campaignId,hostId,sessionId,epoch,membershipId,deviceId]=JSON.parse(String(cursor.key));
    if(version===1){const parsed=scopeSchema.safeParse({authority:{campaignId,hostId,sessionId,epoch},membershipId,deviceId});if(parsed.success)scopes.push(parsed.data);}
   }catch{}cursor.continue();};
  tx.oncomplete=()=>resolve(scopes);tx.onerror=tx.onabort=()=>reject(Error("PLAYER_CACHE_UNAVAILABLE"));
 });}finally{db.close();}
}

function labelAad(id:string,slot:Slot){return new TextEncoder().encode("LABEL:"+new TextDecoder().decode(aad(id,slot)));}
/** Only small encrypted inventory entries are decrypted, never every media bundle. */
export async function listPlayerCopySummaries():Promise<PlayerCopySummary[]>{
 const scopes=await listPlayerSnapshotCopies(),db=await openDatabase();
 try{
  const records=await Promise.all(scopes.map(scope=>slotTransaction(db,labelKey(scopeId(scope)),"readonly",slot=>slot)));
  const result:PlayerCopySummary[]=[];
  for(let i=0;i<scopes.length;i++){
   const scope=scopes[i]!,record=records[i];let summary:PlayerCopySummary={scope,name:"Ранее сохранённая игра",player:"",savedAt:null,legacy:true};
   if(record?.cipher&&record.iv?.byteLength===12&&record.cipher.byteLength<=4112&&record.expiresAt&&record.expiresAt>Date.now()){
    try{
     const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:record.iv,additionalData:labelAad(scopeId(scope),record),tagLength:128},record.key,record.cipher);
     const label=labelSchema.parse(JSON.parse(new TextDecoder().decode(plain)));
     summary={scope,...label,savedAt:record.expiresAt-TTL,legacy:false};
    }catch{} // A malformed/foreign label cannot make the snapshot itself unreadable.
   }
   result.push(summary);
  }
  return result.sort((a,b)=>(b.savedAt??0)-(a.savedAt??0));
 }finally{db.close();}
}
