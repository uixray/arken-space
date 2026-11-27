import {expect,it,vi} from "vitest";
import {monitorOfflineShell,queryOfflineShell,type OfflineShellStatus} from "./offline-shell-status";
class Worker extends EventTarget{state:ServiceWorkerState="activated";}
class Registration extends EventTarget{active:Worker|null=new Worker();installing:Worker|null=null;waiting:Worker|null=null;}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
it("checks actual availability and observes waiting updates without activating them",async()=>{
 const registration=new Registration(),states:OfflineShellStatus[]=[],query=vi.fn(async()=>true);
 const stop=monitorOfflineShell(registration as unknown as ServiceWorkerRegistration,state=>states.push(state),query);
 await flush();expect(states.at(-1)).toEqual({phase:'READY',available:true});
 registration.waiting=new Worker();registration.waiting.state='installed';registration.dispatchEvent(new Event('updatefound'));await flush();expect(states.at(-1)).toEqual({phase:'UPDATE_WAITING',available:true});stop();
});
it("does not call an active worker ready when its cache is missing",async()=>{
 const registration=new Registration(),publish=vi.fn();const stop=monitorOfflineShell(registration as unknown as ServiceWorkerRegistration,publish,async()=>false);
 await flush();expect(publish).toHaveBeenLastCalledWith({phase:'UNAVAILABLE',available:false});stop();
});
it("preserves the available previous shell after an update fails",async()=>{
 const registration=new Registration(),publish=vi.fn();registration.installing=new Worker();registration.installing.state='installing';
 const stop=monitorOfflineShell(registration as unknown as ServiceWorkerRegistration,publish,async()=>true);await flush();expect(publish).toHaveBeenLastCalledWith({phase:'PREPARING',available:true});
 registration.installing.state='redundant';registration.installing.dispatchEvent(new Event('statechange'));await flush();expect(publish).toHaveBeenLastCalledWith({phase:'UPDATE_FAILED',available:true});stop();
});
it("ignores late availability results after disposal",async()=>{
 const registration=new Registration(),publish=vi.fn();let finish!:(ready:boolean)=>void;
 const stop=monitorOfflineShell(registration as unknown as ServiceWorkerRegistration,publish,()=>new Promise(resolve=>{finish=resolve;}));stop();finish(true);await flush();expect(publish).not.toHaveBeenCalled();
});
it("requires a valid status response from the worker",async()=>{
 const good={postMessage:(_message:unknown,ports:MessagePort[])=>ports[0]!.postMessage({type:'SHELL_STATUS',ready:true,version:'a'.repeat(64)})} as unknown as ServiceWorker;
 expect(await queryOfflineShell(good)).toBe(true);
 const bad={postMessage:(_message:unknown,ports:MessagePort[])=>ports[0]!.postMessage({type:'SHELL_STATUS',ready:true,version:'invalid'})} as unknown as ServiceWorker;
 expect(await queryOfflineShell(bad)).toBe(false);
});
