import {expect,it} from "vitest";
import {createStoryPageLoadFence} from "./story-page-load-fence";
it("fences old page completions and failures after refresh, era or campaign changes",()=>{
 const fence=createStoryPageLoadFence(),first=fence.begin("campaignA:eraA"),refresh=fence.begin("campaignA:eraA");
 expect(first("campaignA:eraA")).toBe(false);expect(refresh("campaignA:eraA")).toBe(true);
 expect(refresh("campaignB:eraA")).toBe(false);expect(refresh("campaignA:eraB")).toBe(false);
 fence.invalidate();expect(refresh("campaignA:eraA")).toBe(false);
});
