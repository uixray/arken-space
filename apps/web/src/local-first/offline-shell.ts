/// <reference types="vite/client" />
import {monitorOfflineShell,publishOfflineShellStatus} from "./offline-shell-status";
let stopMonitoring:(()=>void)|undefined;
/** Only public build assets enter the service-worker cache. Private state remains
 * in the separately scoped encrypted IndexedDB store. Registration never reloads. */
export async function registerPlayerOfflineShell(){
 if(!import.meta.env.PROD){publishOfflineShellStatus({phase:"DEVELOPMENT",available:false});return;}
 if(!isSecureContext||!("serviceWorker" in navigator)){publishOfflineShellStatus({phase:"UNSUPPORTED",available:false});return;}
 try{const registration=await navigator.serviceWorker.register('/player-offline-sw.js',{scope:'/',updateViaCache:'none'});stopMonitoring?.();stopMonitoring=monitorOfflineShell(registration);}
 catch{publishOfflineShellStatus({phase:'UNAVAILABLE',available:false});}
}
