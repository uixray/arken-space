import {soundpadPackSchema,exactSnapshotSequence,type GameSnapshot,type LocalPeerResponse} from '@arken/contracts';
import {z} from 'zod';
const historyEntry=z.object({sequence:z.number().int().positive(),actorMembershipId:z.string().uuid(),type:z.string().max(128),targetType:z.string().max(128),targetId:z.string().uuid(),status:z.string().max(64),createdAt:z.string().max(64),nextDirection:z.enum(['undo','redo']).nullable()}).strict();
const archiveSchema=z.object({soundpad:z.object({packs:z.array(soundpadPackSchema).max(1000),playerPlaybackEnabled:z.boolean()}).strict().optional(),history:z.array(z.object({sceneId:z.string().uuid(),sequence:z.string(),entries:z.array(historyEntry).max(102)}).strict()).max(32)}).strict();
export type PlayerReadArchive=z.infer<typeof archiveSchema>;
/** Validate encrypted records too; never accept another campaign's names or
 * private actor history merely because the ciphertext decrypted successfully. */
export function parsePlayerReadArchive(snapshot:GameSnapshot,input:unknown):PlayerReadArchive{
 const archive=archiveSchema.parse(input),assets=new Set(snapshot.assets.map(asset=>asset.id));
 if(snapshot.me.role!=='PLAYER')throw Error('PLAYER_READ_ARCHIVE_SCOPE');
 if(archive.soundpad)for(const pack of archive.soundpad.packs){
  if(pack.campaignId!==snapshot.campaign.id||!pack.published||pack.audience!=='ALL_MEMBERS'||pack.sounds.some(sound=>sound.audience!=='ALL_MEMBERS'||!assets.has(sound.assetId)))throw Error('PLAYER_READ_ARCHIVE_SCOPE');
 }
 const active=new Set(snapshot.scenes.filter(scene=>scene.active).map(scene=>scene.id));
 for(const history of archive.history){
  if(!active.has(history.sceneId)||history.sequence!==exactSnapshotSequence(snapshot)||history.entries.some(entry=>entry.actorMembershipId!==snapshot.me.id))throw Error('PLAYER_READ_ARCHIVE_SCOPE');
 }
 return structuredClone(archive);
}
export function createPlayerReadArchive(){
 let soundpad:PlayerReadArchive['soundpad'],history:PlayerReadArchive['history']=[];
 return {
  observe(snapshot:GameSnapshot,response:LocalPeerResponse,sceneId?:string){
   // Each canonical SNAPSHOT carries the current authorized soundpad catalogue.
   soundpad=response.soundpad?structuredClone(response.soundpad):undefined;
   history=history.filter(entry=>entry.sequence===exactSnapshotSequence(snapshot)&&snapshot.scenes.some(scene=>scene.id===entry.sceneId&&scene.active));
   if(sceneId&&response.canvasHistory){const entries=JSON.parse(JSON.stringify(response.canvasHistory));history=[...history.filter(entry=>entry.sceneId!==sceneId),{sceneId,sequence:exactSnapshotSequence(snapshot),entries}];}
   const next={...(soundpad?{soundpad}:{}),history};
   try{return parsePlayerReadArchive(snapshot,next);}catch{soundpad=undefined;history=[];return {history:[]};}
  },
 };
}
