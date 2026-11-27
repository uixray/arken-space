import {createHash} from "node:crypto";
import {readdir,readFile} from "node:fs/promises";
import {join,relative} from "node:path";
import type {Plugin} from "vite";

type Entry={url:string;size:number;sha256:string;type:string};
const types:Record<string,string>={ttf:"font/ttf",txt:"text/plain; charset=utf-8",html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",css:"text/css; charset=utf-8",json:"application/json",svg:"image/svg+xml",png:"image/png",webp:"image/webp",ico:"image/x-icon",woff:"font/woff",woff2:"font/woff2",wasm:"application/wasm",ogg:"audio/ogg",wav:"audio/wav",webmanifest:"application/manifest+json"};
export function offlineWorkerSource(entries:Entry[],version:string){
 return `"use strict";
const ENTRIES=${JSON.stringify(entries)},CACHE="arken-player-shell-${version}",PREFIX="arken-player-shell-";
const entries=new Map(ENTRIES.map(e=>[e.url,e]));
self.addEventListener("install",event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 for(const entry of ENTRIES){
  const response=await fetch(new Request(entry.url,{credentials:"omit",cache:"reload",redirect:"error"}));
  if(!response.ok||!response.body)throw Error("SHELL_FETCH_FAILED");
  const reader=response.body.getReader(),bytes=new Uint8Array(entry.size);let offset=0;
  for(;;){const part=await reader.read();if(part.done)break;if(offset+part.value.length>bytes.length){await reader.cancel();throw Error("SHELL_SIZE_MISMATCH");}bytes.set(part.value,offset);offset+=part.value.length;}
  if(offset!==entry.size)throw Error("SHELL_SIZE_MISMATCH");
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
  if(digest!==entry.sha256)throw Error("SHELL_INTEGRITY_FAILED");
  await cache.put(entry.url,new Response(bytes,{headers:{"Content-Type":entry.type}}));
 }
 // No skipWaiting: an update never replaces code underneath a running game.
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);
 // First navigation/reload opts into this shell; do not seize live clients.
})()));
self.addEventListener("message",event=>{
 if(event.data!=="SHELL_STATUS"||!event.ports[0])return;
 event.waitUntil((async()=>{
  let ready=false;
  try{if((await caches.keys()).includes(CACHE)){const cache=await caches.open(CACHE);ready=(await Promise.all(ENTRIES.map(e=>cache.match(e.url)))).every(Boolean);}}catch{}
  event.ports[0].postMessage({type:"SHELL_STATUS",ready,version:CACHE.slice(PREFIX.length)});event.ports[0].close();
 })());
});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin)return;
 const shell=request.mode==="navigate"&&url.pathname==="/local-session";
 const asset=!url.search&&entries.has(url.pathname)&&url.pathname!=="/index.html";
 if(!shell&&!asset)return; // API, account pages, Socket.IO and media never enter this cache.
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),response=await cache.match(shell?"/index.html":url.pathname);
  return response||new Response("Автономный интерфейс недоступен. Откройте приложение с сетью.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
 })());
});
`;
}

/** Build-bound public bytes only. A server-injected/private index cannot pass its hash. */
export function offlineShellPlugin():Plugin{
 let publicDir="";
 return {name:"arken-offline-player-shell",apply:"build",enforce:"post",
 configResolved(config){publicDir=config.publicDir;},
 generateBundle:{order:"post",async handler(_options,bundle){
  const files=new Map<string,Buffer>();
  for(const [name,item] of Object.entries(bundle)){
   if(name.endsWith(".map"))continue;
   files.set('/'+name,Buffer.from(item.type==="chunk"?item.code:item.source));
  }
  const walk=async(directory:string)=>{for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await walk(path);else if(entry.isFile())files.set('/'+relative(publicDir,path).replaceAll('\\','/'),await readFile(path));}};
  if(publicDir)await walk(publicDir);
  const manifest=JSON.stringify({id:"/local-session",name:"Аркспейс",short_name:"Аркспейс",lang:"ru",start_url:"/local-session",scope:"/",display:"standalone",background_color:"#181816",theme_color:"#181816",icons:[{src:"/assets/brand/arkpath-hat-white.png",sizes:"1254x1254",type:"image/png",purpose:"any"}]});
  files.set('/player.webmanifest',Buffer.from(manifest));
  if(!files.has('/index.html'))throw Error("OFFLINE_SHELL_INDEX_MISSING");
  let total=0;const entries:Entry[]=[];
  for(const [url,bytes] of [...files].sort(([a],[b])=>a<b?-1:a>b?1:0)){
   const type=types[url.split('.').at(-1)!];if(!type)throw Error("OFFLINE_SHELL_UNKNOWN_STATIC_TYPE: "+url);
   total+=bytes.length;if(bytes.length>16*1024*1024||total>64*1024*1024)throw Error("OFFLINE_SHELL_BUILD_TOO_LARGE");
   entries.push({url,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),type});
  }
  const version=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  this.emitFile({type:"asset",fileName:"player.webmanifest",source:manifest});
  this.emitFile({type:"asset",fileName:"player-offline-sw.js",source:offlineWorkerSource(entries,version)});
 }}
 };
}
