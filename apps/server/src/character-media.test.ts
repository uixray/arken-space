import { describe, expect, it } from "vitest";
import {
  createCharacterMediaSchema,
  detachCharacterMediaSchema,
  reorderCharacterMediaSchema,
  updateCharacterMediaSchema,
} from "@arken/contracts";
import {
  canDetachCharacterMedia,
  canMutateCharacterMedia,
  canViewCharacterMedia,
  type CharacterMediaAuthContext,
  type CharacterMediaSubject,
} from "./character-media.js";

const owner = "00000000-0000-4000-8000-000000000001";
const otherPlayer = "00000000-0000-4000-8000-000000000002";
const gmMember = "00000000-0000-4000-8000-000000000003";

const gm: CharacterMediaAuthContext = { role: "GM", membershipId: gmMember };
const ownerAuth: CharacterMediaAuthContext = {
  role: "PLAYER",
  membershipId: owner,
};
const otherPlayerAuth: CharacterMediaAuthContext = {
  role: "PLAYER",
  membershipId: otherPlayer,
};

const subject = (
  visibility: CharacterMediaSubject["visibility"],
): CharacterMediaSubject => ({
  visibility,
  characterOwnerMembershipId: owner,
});

describe("character media ACL matrix", () => {
  it("lets the owner see their own default (owner+GM) media", () => {
    expect(canViewCharacterMedia(ownerAuth, subject("OWNER_GM"))).toBe(true);
  });

  it("lets the GM see everything, including GM-only media (AC8)", () => {
    expect(canViewCharacterMedia(gm, subject("OWNER_GM"))).toBe(true);
    expect(canViewCharacterMedia(gm, subject("PARTY"))).toBe(true);
    expect(canViewCharacterMedia(gm, subject("GM_ONLY"))).toBe(true);
  });

  it("blocks another player from private or GM-only media (AC3, AC8)", () => {
    expect(canViewCharacterMedia(otherPlayerAuth, subject("OWNER_GM"))).toBe(
      false,
    );
    expect(canViewCharacterMedia(otherPlayerAuth, subject("GM_ONLY"))).toBe(
      false,
    );
  });

  it("lets another player see PARTY-shared media", () => {
    expect(canViewCharacterMedia(otherPlayerAuth, subject("PARTY"))).toBe(
      true,
    );
  });

  it("hides GM-only media from the character's own owner (AC8)", () => {
    expect(canViewCharacterMedia(ownerAuth, subject("GM_ONLY"))).toBe(false);
    expect(canMutateCharacterMedia(ownerAuth, subject("GM_ONLY"))).toBe(
      false,
    );
  });

  it("restricts mutation to the owner and GM, never other players", () => {
    expect(canMutateCharacterMedia(ownerAuth, subject("OWNER_GM"))).toBe(
      true,
    );
    expect(canMutateCharacterMedia(ownerAuth, subject("PARTY"))).toBe(true);
    expect(canMutateCharacterMedia(gm, subject("GM_ONLY"))).toBe(true);
    expect(canMutateCharacterMedia(otherPlayerAuth, subject("PARTY"))).toBe(
      false,
    );
    expect(canMutateCharacterMedia(otherPlayerAuth, subject("OWNER_GM"))).toBe(
      false,
    );
  });

  it("gates detach with the same authority as mutate (owner or GM only)", () => {
    expect(canDetachCharacterMedia(ownerAuth, subject("PARTY"))).toBe(true);
    expect(canDetachCharacterMedia(gm, subject("GM_ONLY"))).toBe(true);
    expect(canDetachCharacterMedia(otherPlayerAuth, subject("PARTY"))).toBe(
      false,
    );
  });

  it("treats an unassigned character (no owner) as inaccessible to any player", () => {
    const unassigned: CharacterMediaSubject = {
      visibility: "OWNER_GM",
      characterOwnerMembershipId: null,
    };
    expect(canViewCharacterMedia(ownerAuth, unassigned)).toBe(false);
    expect(canViewCharacterMedia(gm, unassigned)).toBe(true);
  });
});

describe("character media contracts", () => {
  const actionId = "00000000-0000-4000-8000-000000000009";

  it("accepts a well-formed create payload and rejects unknown fields", () => {
    expect(
      createCharacterMediaSchema.safeParse({
        actionId,
        characterId: owner,
        assetId: owner,
        category: "CHARACTER_ART",
        caption: "A portrait",
      }).success,
    ).toBe(true);
    expect(
      createCharacterMediaSchema.safeParse({
        actionId,
        characterId: owner,
        assetId: owner,
        category: "CHARACTER_ART",
        extra: "nope",
      }).success,
    ).toBe(false);
    expect(
      createCharacterMediaSchema.safeParse({
        actionId,
        characterId: owner,
        assetId: owner,
        category: "NOT_A_CATEGORY",
      }).success,
    ).toBe(false);
  });

  it("requires revision on update, reorder and detach for CAS (AC13)", () => {
    expect(
      updateCharacterMediaSchema.safeParse({ actionId, caption: "x" }).success,
    ).toBe(false);
    expect(
      updateCharacterMediaSchema.safeParse({
        actionId,
        revision: 0,
        caption: "x",
      }).success,
    ).toBe(true);
    expect(
      reorderCharacterMediaSchema.safeParse({ actionId, ordering: 2 }).success,
    ).toBe(false);
    expect(
      reorderCharacterMediaSchema.safeParse({
        actionId,
        revision: 1,
        ordering: 2,
      }).success,
    ).toBe(true);
    expect(
      detachCharacterMediaSchema.safeParse({ actionId, revision: 0 }).success,
    ).toBe(true);
    expect(detachCharacterMediaSchema.safeParse({ actionId }).success).toBe(
      false,
    );
  });
});
