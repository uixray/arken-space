import { describe, expect, it } from "vitest";
import type { AuthContext } from "./auth.js";
import {
  visibleCharacterMediaAssetIds,
  type SnapshotCharacterMediaAssetRow,
} from "./snapshot.js";

const campaignId = "00000000-0000-0000-0000-000000000001";
const ownerId = "00000000-0000-0000-0000-000000000002";
const otherId = "00000000-0000-0000-0000-000000000003";

function auth(
  membershipId: string,
  role: AuthContext["role"] = "PLAYER",
): AuthContext {
  return { campaignId, membershipId, role, displayName: "Test" };
}

function row(
  assetId: string,
  visibility: SnapshotCharacterMediaAssetRow["media"]["visibility"],
  overrides: Partial<SnapshotCharacterMediaAssetRow["media"]> = {},
): SnapshotCharacterMediaAssetRow {
  return {
    media: {
      assetId,
      campaignId,
      detachedAt: null,
      visibility,
      ...overrides,
    },
    characterOwnerMembershipId: ownerId,
  };
}

describe("snapshot character-media asset projection", () => {
  it("includes OWNER_GM for the character owner", () => {
    expect([
      ...visibleCharacterMediaAssetIds(auth(ownerId), [
        row("owner", "OWNER_GM"),
      ]),
    ]).toEqual(["owner"]);
  });

  it("includes PARTY for another campaign member", () => {
    expect([
      ...visibleCharacterMediaAssetIds(auth(otherId), [row("party", "PARTY")]),
    ]).toEqual(["party"]);
  });

  it("does not treat non-owner control as gallery ownership", () => {
    // Character controllers are deliberately absent from the ACL subject:
    // controlling a token/character does not grant OWNER_GM media access.
    expect(
      visibleCharacterMediaAssetIds(auth(otherId), [row("owner", "OWNER_GM")]),
    ).toEqual(new Set());
  });

  it("excludes GM_ONLY from players, detached rows, and foreign campaigns", () => {
    const rows = [
      row("gm-only", "GM_ONLY"),
      row("detached", "PARTY", { detachedAt: new Date() }),
      row("foreign", "PARTY", {
        campaignId: "00000000-0000-0000-0000-000000000099",
      }),
    ];
    expect(visibleCharacterMediaAssetIds(auth(ownerId), rows)).toEqual(
      new Set(),
    );
  });

  it("lets the GM view attached media without crossing campaign boundaries", () => {
    const rows = [
      row("gm-only", "GM_ONLY"),
      row("foreign", "GM_ONLY", {
        campaignId: "00000000-0000-0000-0000-000000000099",
      }),
    ];
    expect([
      ...visibleCharacterMediaAssetIds(auth(otherId, "GM"), rows),
    ]).toEqual(["gm-only"]);
  });
});
