import { describe, expect, it } from "vitest";
import { campaignReturnPath } from "./campaign-route";

const campaignId = "eb6a55c4-a821-4739-8d4a-a1028e9d9092";
const draftId = "8fde32df-8ec4-4a67-a436-57b6d34bd2b8";
const campaign = `/campaign/${campaignId}`;

describe("campaign return after login", () => {
  it("keeps the exact editor draft on the requested campaign", () => {
    expect(campaignReturnPath(`${campaign}?editor-pilot=${draftId}`)).toBe(
      `${campaign}?editor-pilot=${draftId}`,
    );
    expect(campaignReturnPath(campaign)).toBe(campaign);
  });

  it("rejects external destinations, malformed IDs, and extra parameters", () => {
    for (const candidate of [
      `https://elsewhere.invalid${campaign}`,
      `//elsewhere.invalid${campaign}`,
      `${campaign}?editor-pilot=unknown`,
      `${campaign}?editor-pilot=${draftId}&next=/account`,
      `${campaign}?editor-pilot=${draftId}#extra`,
    ])
      expect(campaignReturnPath(candidate)).toBeNull();
  });
});

it("keeps encyclopedia and Bionic selection together without forwarding arbitrary queries",()=>{
 const article="10000000-0000-4000-8000-000000000001";
 expect(campaignReturnPath(`${campaign}?article=${article}`)).toBe(`${campaign}?article=${article}`);
 expect(campaignReturnPath(`${campaign}?editor-pilot=${draftId}&article=${article}`)).toBe(`${campaign}?article=${article}&editor-pilot=${draftId}`);
 for(const query of [`article=${article}&article=${article}`,`article=${article}&token=secret`,`article=bad`,`editor-pilot=${draftId}&gm=secret`])expect(campaignReturnPath(`${campaign}?${query}`)).toBeNull();
});
