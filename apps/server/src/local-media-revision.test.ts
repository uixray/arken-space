import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rename,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
const config=vi.hoisted(()=>({MEDIA_ROOT:''}));vi.mock('./env.js',()=>({env:config}));
import {readLocalMediaRevision} from './local-media-revision.js';
it('publishes stable opaque generations and invalidates missing/repaired markers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'arken-revision133-'));config.MEDIA_ROOT=root;
 const id=crypto.randomUUID(),parent=join(root,'import-media'),folder=join(parent,id),marker=join(folder,'complete.json'),next=join(folder,'next.json');
 const db={execute:vi.fn().mockResolvedValue([{id}])} as unknown as Parameters<typeof readLocalMediaRevision>[0];
 try{
  const pending=await readLocalMediaRevision(db,crypto.randomUUID());
  await mkdir(folder,{recursive:true});await writeFile(marker,'{"complete":true}');
  const first=await readLocalMediaRevision(db,crypto.randomUUID());
  expect(first).toMatch(/^[a-f0-9]{64}$/);expect(first).not.toBe(pending);
  expect(await readLocalMediaRevision(db,crypto.randomUUID())).toBe(first);
  await writeFile(next,'{"complete":true}');await rename(next,marker);
  const repaired=await readLocalMediaRevision(db,crypto.randomUUID());expect(repaired).not.toBe(first);
  await unlink(marker);expect(await readLocalMediaRevision(db,crypto.randomUUID())).toBe(pending);
  await mkdir(marker);await expect(readLocalMediaRevision(db,crypto.randomUUID())).rejects.toThrow('MARKER_INVALID');await rmdir(marker);
 }finally{await unlink(next).catch(()=>{});await unlink(marker).catch(()=>{});await rmdir(folder).catch(()=>{});await rmdir(parent).catch(()=>{});await rmdir(root);}
});
it('has a stable generation for campaigns without imported media',async()=>{
 const db={execute:vi.fn().mockResolvedValue([])} as unknown as Parameters<typeof readLocalMediaRevision>[0];
 expect(await readLocalMediaRevision(db,crypto.randomUUID())).toBe(await readLocalMediaRevision(db,crypto.randomUUID()));
});
