import { describe, expect, it } from "vitest";
import type { AuthContext } from "./auth.js";
import {
  canAccessChatThread,
  canAccessStream,
  canPostToStream,
  chatBroadcastAudience,
  clampReadSequence,
  directThreadMemberIds,
  unknownPlayerDisplayName,
} from "./chat.js";

const player = { role: "PLAYER" } as AuthContext;
const gm = { role: "GM" } as AuthContext;

describe("chat stream policy", () => {
  it("lets members read STORY but keeps posting GM-only", () => {
    expect(canAccessStream(player, "STORY")).toBe(true);
    expect(canAccessStream(gm, "STORY")).toBe(true);
    expect(canPostToStream(player, "STORY")).toBe(false);
    expect(canPostToStream(gm, "STORY")).toBe(true);
    expect(canAccessStream(player, "TABLE")).toBe(true);
    expect(canAccessStream(player, "ROLLS")).toBe(true);
  });

  it("keeps direct threads participant-only without a GM bypass", () => {
    const thread = {
      type: "DIRECT",
      participantAMembershipId: "member-a",
      participantBMembershipId: "member-b",
    } as Parameters<typeof canAccessChatThread>[1];
    expect(
      canAccessChatThread({ membershipId: "member-a" } as AuthContext, thread),
    ).toBe(true);
    expect(
      canAccessChatThread({ membershipId: "member-b" } as AuthContext, thread),
    ).toBe(true);
    expect(
      canAccessChatThread(
        { membershipId: "member-c", role: "PLAYER" } as AuthContext,
        thread,
      ),
    ).toBe(false);
    expect(
      canAccessChatThread(
        { membershipId: "gm", role: "GM" } as AuthContext,
        thread,
      ),
    ).toBe(false);
    expect(directThreadMemberIds(thread)).toEqual(["member-a", "member-b"]);
  });

  it("clamps read cursors to latest and never moves backwards", () => {
    expect(clampReadSequence(10, 8, 20)).toBe(10);
    expect(clampReadSequence(10, 50, 20)).toBe(20);
    expect(clampReadSequence(10, 15, 20)).toBe(15);
    expect(clampReadSequence(15, 15, 20)).toBe(15);
  });

  it("keeps the unknown player fallback readable", () => {
    expect(unknownPlayerDisplayName).toBe(
      "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0439 \u0438\u0433\u0440\u043e\u043a",
    );
  });

  it("broadcasts PUBLIC STORY to the campaign while retaining GM_ONLY ACL", () => {
    expect(chatBroadcastAudience("PUBLIC")).toBe("CAMPAIGN");
    expect(chatBroadcastAudience("GM_ONLY")).toBe("GM_AND_AUTHOR");
  });
});
