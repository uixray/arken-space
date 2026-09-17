import { describe, expect, it } from "vitest";
import { visibleCharacterResourceAssetIds } from "./snapshot.js";

const campaignId = "00000000-0000-0000-0000-000000000001";

describe("snapshot character resource asset projection", () => {
  it("projects image ids from already-authorized visible characters", () => {
    expect(
      visibleCharacterResourceAssetIds(campaignId, [
        {
          campaignId,
          resources: {
            mana: { current: 3, imageAssetId: "mana-image" },
            stamina: { current: 4, imageAssetId: null },
          },
        },
      ]),
    ).toEqual(new Set(["mana-image"]));
  });

  it("does not project non-visible or cross-campaign character resources", () => {
    // A hidden character is not passed to this helper at all: buildSnapshot
    // calls it only with visibleCharacters. The foreign guard is defense in depth.
    expect(
      visibleCharacterResourceAssetIds(campaignId, [
        {
          campaignId: "00000000-0000-0000-0000-000000000099",
          resources: { secret: { current: 1, imageAssetId: "foreign" } },
        },
      ]),
    ).toEqual(new Set());
    expect(visibleCharacterResourceAssetIds(campaignId, [])).toEqual(new Set());
  });
});
