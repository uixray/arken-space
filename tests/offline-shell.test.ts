import {expect,it} from "vitest";
import {createHash} from "node:crypto";
import {runInNewContext} from "node:vm";
import {offlineWorkerSource} from "../apps/web/build/offline-shell-plugin";

function worker(corrupt=false){
 const bytes=Buffer.from('shell'),entries=[{url:'/index.html',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),type:'text/html'}];
 const handlers=new Map<string,(event:any)=>void>(),data=new Map<string,Response>(),calls:Request[]=[];
 const caches={open:async()=>({put:async(key:string,response:Response)=>{data.set(key,response);},match:async(key:string)=>data.get(key)?.clone()}),keys:async()=>data.size?["arken-player-shell-test"]:[],delete:async()=>true};
 runInNewContext(offlineWorkerSource(entries,'test'),{self:{location:{origin:'http://localhost'},addEventListener:(name:string,handler:any)=>handlers.set(name,handler)},caches,crypto,Uint8Array,Response,URL,Map,Error,Request:class extends Request{constructor(url:string,options?:RequestInit){super(new URL(url,'http://localhost'),options);}},fetch:async(request:Request)=>{calls.push(request);return new Response(corrupt?'wrong':bytes,{headers:{'Set-Cookie':'PRIVATE'}});}});
 return {handlers,data,calls};
}
it("verifies exact public bytes and strips server response metadata",async()=>{
 const w=worker();let install:Promise<void>|undefined;w.handlers.get('install')!({waitUntil:(p:Promise<void>)=>{install=p;}});await install;
 expect(w.calls[0]?.credentials).toBe('omit');expect(w.data.get('/index.html')?.headers.has('Set-Cookie')).toBe(false);
 let response:Promise<Response>|undefined;w.handlers.get('fetch')!({request:{method:'GET',url:'http://localhost/local-session',mode:'navigate'},respondWith:(p:Promise<Response>)=>{response=p;}});
 expect(await (await response)!.text()).toBe('shell');
});
it("does not intercept account/API/socket routes or unknown query variants",()=>{
 const w=worker();for(const path of ['/api/bootstrap','/account','/socket.io/','/index.html?private=1']){
  let responded=false;w.handlers.get('fetch')!({request:{method:'GET',url:'http://localhost'+path,mode:'navigate'},respondWith:()=>{responded=true;}});expect(responded).toBe(false);
 }
});
it("refuses altered shell content instead of caching a login/private/error page",async()=>{
 const w=worker(true);let install:Promise<void>|undefined;w.handlers.get('install')!({waitUntil:(p:Promise<void>)=>{install=p;}});await expect(install).rejects.toThrow('SHELL_INTEGRITY_FAILED');expect(w.data.size).toBe(0);
});

it("reports ready only when every manifest resource exists in CacheStorage",async()=>{
 const w=worker();let pending:Promise<void>|undefined;w.handlers.get('install')!({waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;
 const messages:any[]=[];const event=()=>({data:'SHELL_STATUS',ports:[{postMessage:(data:any)=>messages.push(data),close:()=>{}}],waitUntil:(p:Promise<void>)=>{pending=p;}});
 w.handlers.get('message')!(event());await pending;expect(messages.at(-1)).toMatchObject({ready:true});
 w.data.delete('/index.html');w.handlers.get('message')!(event());await pending;expect(messages.at(-1)).toMatchObject({ready:false});
});
