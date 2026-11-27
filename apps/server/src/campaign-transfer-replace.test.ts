import {mkdtemp,writeFile,open,rename as nativeRename,readFile,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {it,expect,vi} from 'vitest';
import {replaceCampaignTransferFile,CampaignTransferFileBusy} from './campaign-transfer-replace.js';
it('waits for a transient Windows reader without deleting either file',async()=>{
 let now=0;const rename=vi.fn().mockRejectedValueOnce(Object.assign(Error(),{code:'EPERM'})).mockResolvedValue(undefined);
 const wait=vi.fn(async(ms:number)=>{now+=ms;});
 await replaceCampaignTransferFile('source','target',3000,{rename,wait,now:()=>now,windows:true});
 expect(rename).toHaveBeenCalledTimes(2);expect(wait).toHaveBeenCalledWith(25);
});
it('uses one bounded deadline and reports persistent busy files',async()=>{
 let now=0;const rename=vi.fn().mockRejectedValue(Object.assign(Error(),{code:'EBUSY'}));
 const wait=vi.fn(async(ms:number)=>{now+=ms;});
 await expect(replaceCampaignTransferFile('s','t',100,{rename,wait,now:()=>now,windows:true})).rejects.toBeInstanceOf(CampaignTransferFileBusy);
 expect(now).toBe(100);expect(rename).toHaveBeenCalledTimes(4);
});
it('preserves non-sharing failures and POSIX failures without retry',async()=>{
 for(const windows of [true,false]){
  const error=Object.assign(Error('missing source'),{code:windows?'ENOENT':'EPERM'}),rename=vi.fn().mockRejectedValue(error),wait=vi.fn();
  await expect(replaceCampaignTransferFile('s','t',3000,{rename,wait,now:()=>0,windows})).rejects.toBe(error);
  expect(wait).not.toHaveBeenCalled();expect(rename).toHaveBeenCalledOnce();
 }
});

it('recovers after a real reader releases a Windows file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'arken-replace134-')),target=join(root,'target'),source=join(root,'source');
 let handle:Awaited<ReturnType<typeof open>>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await writeFile(target,'old');await writeFile(source,'new');handle=await open(target,'r');
  const rename=vi.fn(nativeRename);
  timer=setTimeout(()=>{void handle?.close();},100);
  await replaceCampaignTransferFile(source,target,performance.now()+3000,{rename,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),now:()=>performance.now(),windows:process.platform==='win32'});
  expect(await readFile(target,'utf8')).toBe('new');
  if(process.platform==='win32')expect(rename.mock.calls.length).toBeGreaterThan(1);
 }finally{if(timer)clearTimeout(timer);await handle?.close();await unlink(source).catch(()=>{});await unlink(target).catch(()=>{});await rmdir(root);}
});
