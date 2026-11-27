import {open,lstat,realpath,mkdir,link,unlink,readFile,type FileHandle} from 'node:fs/promises';import {join,dirname} from 'node:path';import {randomUUID} from 'node:crypto';
import {claimCampaignTransferDataDraft} from './campaign-transfer-data-draft.js';import {createCampaignTransferManifest} from './campaign-transfer-manifest.js';import {verifyCampaignTransferStructure} from './campaign-transfer-structure.js';
/** Consolidates only an owned draft. candidate-manifest.json is deliberately
 * NOT the final manifest.json commit marker: domain/import qualification,
 * archive authentication, recovery and publication are still separate gates. */
export async function assembleCampaignTransferStructuralCandidate(input:object){
 const draft=claimCampaignTransferDataDraft(input),root=draft.root,mediaFolder=join(root,'media'),sourceMedia=join(draft.mediaRoot,'media');
 for(const folder of [root,draft.mediaRoot,sourceMedia])if((await lstat(folder)).isSymbolicLink()||!(await lstat(folder)).isDirectory()||await realpath(folder)!==folder)throw Error('CAMPAIGN_TRANSFER_CANDIDATE_PATH_INVALID');
 if(await realpath(dirname(root))!==await realpath(dirname(draft.mediaRoot)))throw Error('CAMPAIGN_TRANSFER_CANDIDATE_PARENT_INVALID');
 await mkdir(mediaFolder,{mode:0o700});
 for(const media of draft.media){if(!/^[a-f0-9]{64}$/.test(media.sha256))throw Error('CAMPAIGN_TRANSFER_CANDIDATE_MEDIA_KEY_INVALID');const source=join(sourceMedia,media.sha256),before=await lstat(source,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size!==BigInt(media.bytes))throw Error('CAMPAIGN_TRANSFER_CANDIDATE_MEDIA_INVALID');await link(source,join(mediaFolder,media.sha256));}
 const manifest=createCampaignTransferManifest({format:'ARKEN_CAMPAIGN_TRANSFER',version:2,capturePolicyVersion:1,campaignId:draft.campaignId,sourceOwnerMembershipId:draft.sourceOwnerMembershipId,createdAt:draft.createdAt,source:draft.source,tables:draft.tables,media:draft.media,projections:draft.projectionsFile,mediaBindings:draft.mediaBindingsFile});
 await verifyCampaignTransferStructure(manifest,{campaignId:draft.campaignId,migrations:draft.source.migrations},async key=>{
  const file=join(root,key),before=await lstat(file);if(!before.isFile()||before.isSymbolicLink()||await realpath(file)!==file)throw Error('CAMPAIGN_TRANSFER_CANDIDATE_FILE_INVALID');return readFile(file);
 });
 const temporary=join(root,'part-'+randomUUID());let handle:FileHandle|undefined,owned=false;
 try{handle=await open(temporary,'wx',0o600);owned=true;await handle.writeFile(JSON.stringify(manifest)+'\n');await handle.sync();await handle.close();handle=undefined;await link(temporary,join(root,'candidate-manifest.json'));}
 finally{try{await handle?.close();}finally{if(owned)await unlink(temporary);}}
 return {state:'STRUCTURAL_CANDIDATE' as const,root,manifest};
}
