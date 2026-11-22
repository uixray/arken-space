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
