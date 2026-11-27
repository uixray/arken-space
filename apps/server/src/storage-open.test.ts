import {mkdtemp,writeFile,rename,unlink,rmdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect,vi} from 'vitest';
const config=vi.hoisted(()=>({MEDIA_ROOT:''}));
vi.mock('./env.js',()=>({env:config}));
import {openStoredFile} from './storage.js';
it('pins revision/bytes and allows replacement after a Windows open-reader fence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'arken-storage132-'));config.MEDIA_ROOT=root;
 const path=join(root,'image.png'),replacement=join(root,'next.png');
 try{
  await writeFile(path,'old');const first=await openStoredFile('image.png',undefined);
  const bytes=async(stream:NodeJS.ReadableStream)=>{const chunks:Buffer[]=[];for await(const part of stream)chunks.push(Buffer.from(part));return Buffer.concat(chunks).toString();};
  await writeFile(replacement,'new');
  if(process.platform==='win32'){
   await expect(rename(replacement,path)).rejects.toMatchObject({code:'EPERM'});
   expect(await bytes(first.stream)).toBe('old');
   await rename(replacement,path);
  }else{
   await rename(replacement,path);
   expect(await bytes(first.stream)).toBe('old');
  }
  const second=await openStoredFile('image.png','bytes=0-2');
  expect(await bytes(second.stream)).toBe('new');
  expect(first.cacheRevision).not.toBe(second.cacheRevision);
  await expect(openStoredFile('image.png','bytes=99-100')).rejects.toThrow('INVALID_RANGE');
  await mkdir(join(root,'directory'));
  await expect(openStoredFile('directory',undefined)).rejects.toThrow();
  await rmdir(join(root,'directory'));
 }finally{await unlink(replacement).catch(()=>{});await unlink(path).catch(()=>{});await rmdir(root);}
});
