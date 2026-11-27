import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm,realpath,link} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {writeCampaignTransferMarker} from './campaign-transfer-markers.js';
import {recoverCampaignTransferUploads} from './campaign-transfer-upload-recovery.js';
const base=resolve('.qa-temp'),roots:string[]=[];
async function root(){await mkdir(base,{recursive:true});const value=await mkdtemp(join(base,'transfer-recovery-'));roots.push(value);return value;}
afterEach(async()=>{vi.restoreAllMocks();for(const value of roots.splice(0)){if(dirname(value)!==base||await realpath(value)!==value)throw Error('UNSAFE_RECOVERY_TEST_CLEANUP');await rm(value,{recursive:true,force:true});}});
it('publishes complete markers without overwrite and replaces only the owned directory entry',async()=>{
 const folder=await root(),path=join(folder,'intent.json');await writeCampaignTransferMarker(path,{version:1,value:'original'});expect(JSON.parse(await readFile(path,'utf8'))).toEqual({version:1,value:'original'});
 await expect(writeCampaignTransferMarker(path,{value:'different'})).rejects.toMatchObject({code:'EEXIST'});expect(JSON.parse(await readFile(path,'utf8')).value).toBe('original');
 const retained=join(folder,'retained.json');await link(path,retained);await writeCampaignTransferMarker(path,{value:'complete'},true);expect(JSON.parse(await readFile(retained,'utf8')).value).toBe('original');expect(JSON.parse(await readFile(path,'utf8')).value).toBe('complete');expect((await readdir(folder)).filter(name=>name.startsWith('.part-'))).toHaveLength(0);
});
it('cleans only dead, matching upload owners and conservatively preserves live or unknown work',async()=>{
 const folder=await root(),instanceId=crypto.randomUUID(),other=crypto.randomUUID();
 for(const name of ['dead','live','foreign','unknown'])await mkdir(join(folder,'upload-'+name));
 for(const [name,pid,owner]of [['dead',12345,instanceId],['live',12346,instanceId],['foreign',12345,other]] as const)await writeFile(join(folder,'upload-'+name,'owner.json'),JSON.stringify({version:1,instanceId:owner,pid}));
 await writeFile(join(folder,'upload-dead','private-data'),'synthetic private draft');
 const kill=vi.spyOn(process,'kill').mockImplementation((pid,signal)=>{expect(signal).toBe(0);if(pid===12345)throw Object.assign(Error('dead'),{code:'ESRCH'});return true;});
 const report=await recoverCampaignTransferUploads(folder,instanceId);expect(report).toEqual({removed:1,live:1,preserved:2});expect((await readdir(folder)).sort()).toEqual(['upload-foreign','upload-live','upload-unknown']);expect(kill.mock.calls.every(call=>call[1]===0)).toBe(true);
});
it('treats inaccessible process identity as live rather than authorizing deletion',async()=>{
 const folder=await root(),instanceId=crypto.randomUUID();await mkdir(join(folder,'upload-private'));await writeFile(join(folder,'upload-private','owner.json'),JSON.stringify({version:1,instanceId,pid:12345}));
 vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(Error('protected'),{code:'EPERM'});});expect(await recoverCampaignTransferUploads(folder,instanceId)).toEqual({removed:0,live:1,preserved:0});expect(await readdir(folder)).toContain('upload-private');
});
