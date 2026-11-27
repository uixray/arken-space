import {expect,it} from "vitest";
import {installStoryMediaUrls,storyMediaUrl} from "./story-media-url";
it("isolates peer media from HTTP and restores cloud lookup on disposal",()=>{
 expect(storyMediaUrl("synthetic")).toBe("/api/story/media/synthetic");
 const release=installStoryMediaUrls(id=>id==="saved"?"blob:verified":"");
 try{expect(storyMediaUrl("saved")).toBe("blob:verified");expect(storyMediaUrl("missing")).toBe("");expect(()=>installStoryMediaUrls(()=>"foreign")).toThrow("ACTIVE");}
 finally{release();}
 expect(storyMediaUrl("synthetic")).toBe("/api/story/media/synthetic");
});
