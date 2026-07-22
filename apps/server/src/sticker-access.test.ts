import { describe, expect, it } from "vitest";
import {
  isMatchingStickerReplay,
  invalidateStickerConsentClients,
  packAllowsSender,
  packAllowsViewer,
  revokedStickerTombstone,
  stickerAssetUrl,
  stickerMessageVisibility,
} from "./sticker-access.js";

const player = { id: "member-a", role: "PLAYER" as const };
const gm = { id: "gm", role: "GM" as const };
const base = {
  audience: "CAMPAIGN" as const,
  subject: "NPC" as const,
  subjectMembershipId: null,
};

describe("sticker access policy", () => {
  it("does not leak GM-only or entitlement-only packs to arbitrary players", () => {
    expect(
      packAllowsViewer({ ...base, audience: "GM_ONLY" }, player, true, true),
    ).toBe(false);
    expect(
      packAllowsViewer({ ...base, audience: "ENTITLED" }, player, false, true),
    ).toBe(false);
    expect(
      packAllowsViewer({ ...base, audience: "ENTITLED" }, player, true, true),
    ).toBe(true);
  });

  it("requires active likeness consent even for a GM", () => {
    const pack = {
      audience: "CAMPAIGN" as const,
      subject: "PLAYER" as const,
      subjectMembershipId: "member-a",
    };
    expect(packAllowsViewer(pack, gm, false, false)).toBe(false);
    expect(packAllowsViewer(pack, gm, false, true)).toBe(true);
    expect(packAllowsViewer(pack, player, false, false)).toBe(false);
  });

  it("separates viewing from sending", () => {
    expect(packAllowsSender({ sendPolicy: "GM_ONLY" }, player, true)).toBe(
      false,
    );
    expect(
      packAllowsSender({ sendPolicy: "ENTITLED_ONLY" }, player, false),
    ).toBe(false);
    expect(
      packAllowsSender({ sendPolicy: "ENTITLED_ONLY" }, player, true),
    ).toBe(true);
    expect(packAllowsSender({ sendPolicy: "GM_ONLY" }, gm, false)).toBe(true);
  });

  it("maps audience to persisted message visibility without leaking GM metadata", () => {
    expect(stickerMessageVisibility("CAMPAIGN")).toBe("PUBLIC");
    expect(stickerMessageVisibility("ENTITLED")).toBe("PUBLIC");
    expect(stickerMessageVisibility("GM_ONLY")).toBe("GM_ONLY");
  });

  it("accepts replay only for the same actor, event type, destination and sticker", () => {
    const expected = {
      membershipId: "member-a",
      threadId: "thread-a",
      stickerId: "sticker-a",
    };
    const valid = {
      membershipId: "member-a",
      type: "chat.created",
      payload: { threadId: "thread-a", stickerId: "sticker-a" },
    };
    expect(isMatchingStickerReplay(valid, expected)).toBe(true);
    expect(
      isMatchingStickerReplay({ ...valid, membershipId: "attacker" }, expected),
    ).toBe(false);
    expect(
      isMatchingStickerReplay({ ...valid, type: "dice.created" }, expected),
    ).toBe(false);
    expect(
      isMatchingStickerReplay(
        { ...valid, payload: { ...valid.payload, threadId: "thread-b" } },
        expected,
      ),
    ).toBe(false);
    expect(
      isMatchingStickerReplay(
        { ...valid, payload: { ...valid.payload, stickerId: "sticker-b" } },
        expected,
      ),
    ).toBe(false);
  });

  it("invalidates connected snapshots after consent commit", async () => {
    const calls: string[] = [];
    await invalidateStickerConsentClients(async (campaignId) => {
      calls.push(campaignId);
    }, "campaign-a");
    expect(calls).toEqual(["campaign-a"]);
  });

  it("uses a non-identifying emergency takedown tombstone", () => {
    expect(revokedStickerTombstone.name).toBe("Sticker unavailable");
    expect(revokedStickerTombstone.assetUrl).not.toContain("sticker-a");
  });

  it("uses only the dedicated sticker content route", () => {
    expect(stickerAssetUrl("sticker-id")).toBe(
      "/api/stickers/sticker-id/content",
    );
    expect(stickerAssetUrl("sticker-id")).not.toContain("/api/assets/");
  });
});
