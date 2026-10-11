import { describe, expect, it } from "vitest";
import type { AuthContext } from "./auth.js";
import {
  visibleSoundpadAssetIds,
  type SnapshotSoundpadAssetRow,
} from "./snapshot.js";

const campaignId = "00000000-0000-0000-0000-000000000001";
const auth: AuthContext = {
  campaignId,
  membershipId: "00000000-0000-0000-0000-000000000002",
  role: "PLAYER",
  displayName: "Player",
};

function row(
  overrides: Partial<SnapshotSoundpadAssetRow> = {},
): SnapshotSoundpadAssetRow {
  return {
    campaignId,
    packPublished: true,
    packAudience: "ALL_MEMBERS",
    soundAudience: "ALL_MEMBERS",
    assetId: "shared-clip",
    assetKind: "AUDIO",
    durationSeconds: 2.5,
    ...overrides,
  };
}

describe("snapshot soundpad asset projection", () => {
  it("includes an eligible clip from a published shared pack", () => {
    expect(visibleSoundpadAssetIds(auth, [row()])).toEqual(
      new Set(["shared-clip"]),
    );
  });

  it("excludes draft, GM-only, cross-campaign, non-audio, and invalid clips", () => {
    expect(
      visibleSoundpadAssetIds(auth, [
        row({ assetId: "draft", packPublished: false }),
        row({ assetId: "private-pack", packAudience: "GM_ONLY" }),
        row({ assetId: "private-sound", soundAudience: "GM_ONLY" }),
        row({
          assetId: "foreign",
          campaignId: "00000000-0000-0000-0000-000000000099",
        }),
        row({ assetId: "image", assetKind: "IMAGE" }),
        row({ assetId: "missing-duration", durationSeconds: null }),
        row({ assetId: "zero", durationSeconds: 0 }),
        row({ assetId: "too-long", durationSeconds: 10.01 }),
      ]),
    ).toEqual(new Set());
  });

  it("does not add soundpad-only asset access for GMs", () => {
    expect(
      visibleSoundpadAssetIds(authure(), [row()]),
    ).toEqual(new Set());
  });
});

function authure(): AuthContext {
  return { ...auth, role: "GM" };
}
