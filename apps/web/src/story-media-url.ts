import {useSyncExternalStore} from "react";
let active:((id:string)=>string)|undefined,revision=0;
const listeners=new Set<()=>void>();
export function notifyStoryMediaUrls(){revision++;for(const listener of listeners)listener();}
export function installStoryMediaUrls(resolve:(id:string)=>string){
 if(active)throw Error("STORY_MEDIA_TRANSPORT_ACTIVE");active=resolve;notifyStoryMediaUrls();
 return ()=>{if(active===resolve){active=undefined;notifyStoryMediaUrls();}};
}
export function storyMediaUrl(id:string){return active?active(id):`/api/story/media/${id}`;}
export function useStoryMediaUrl(){
 useSyncExternalStore(callback=>{listeners.add(callback);return ()=>{listeners.delete(callback);};},()=>revision,()=>0);
 return storyMediaUrl;
}
