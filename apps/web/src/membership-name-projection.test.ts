import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";
import { describe, expect, it } from "vitest";
import {
  projectMembershipName,
  rebaseMembershipNames,
  retainMembershipNamePatch,
  type OrderedMembershipNamePatch,
} from "./membership-name-projection";
import { gmSnapshot, playerSnapshot } from "./test-support/game-snapshot-fixtures";

const player = { id: "target", role: "PLAYER" as const, displayName: "Before", revision: 2, characterId: null };
const patch = { membershipId: player.id, displayName: "After", revision: 3, sequence: 12 };
const contact = { membershipId: player.id, displayName: player.displayName };
const message: ChatMessageDto = {
  id: "older-page", membershipId: player.id, displayName: player.displayName,
  sequence: 1, threadId: "direct", visibility: "PUBLIC", kind: "TEXT",
  stream: null, dice: null, characterId: null, body: "Private example",
  createdAt: "2026-11-26T00:00:00.000Z",
};
const thread: GameSnapshot["chatThreads"][number] = {
  id: "direct", campaignId: "campaign", type: "DIRECT", stream: null,
  participants: [contact, { membershipId: "gm", displayName: "GM" }],
  createdAt: "", updatedAt: "",
};

describe("membership name projection", () => {
  it("changes own, roster, visible thread labels and loaded history without replacing unrelated state", () => {
    const before = playerSnapshot({ me: player, members: [player], messages: [message], chatThreads: [thread] });
    const after = projectMembershipName(before, patch);
    expect(after.me).toMatchObject({ displayName: "After", revision: 3 });
    expect(after.members[0]).toEqual(after.me);
    expect(after.messages[0]).toEqual({ ...message, displayName: "After" });
    expect(after.chatThreads[0]).toEqual({ ...thread, participants: [{ ...contact, displayName: "After" }, thread.participants[1]] });
    expect(after.tokens).toBe(before.tokens);
    expect(projectMembershipName(after, patch)).toBe(after);
    expect(projectMembershipName(after, { ...patch, revision: 2, displayName: "Old" })).toBe(after);
  });

  it("does not add another membership, thread, message or foreign revision to the player's projection", () => {
    const before = playerSnapshot({ directChatContacts: [contact] });
    const after = projectMembershipName(before, patch);
    expect(after.directChatContacts).toEqual([{ ...contact, displayName: "After" }]);
    for (const key of ["me", "members", "messages", "chatThreads"] as const)
      expect(after[key]).toBe(before[key]);
  });

  it("rebases only newer names without dropping a late snapshot or resurrecting lost visibility", () => {
    const pending = new Map<string, OrderedMembershipNamePatch>();
    expect(retainMembershipNamePatch(pending, 9, patch)).toBe(true);
    expect(retainMembershipNamePatch(pending, 9, { ...patch, sequence: 11, displayName: "Stale" })).toBe(false);
    expect(retainMembershipNamePatch(pending, 12, { ...patch, membershipId: "other" })).toBe(false);
    // An unrelated event was observed after the rename but this snapshot's
    // independently read roster still contains the old projection.
    const incoming = gmSnapshot({ snapshotVersion: 15, members: [player], directChatContacts: [contact] });
    const after = rebaseMembershipNames(incoming, pending, { [player.id]: 11 });
    expect(after.snapshotVersion).toBe(15);
    expect(after.members[0]).toMatchObject({ revision: 3, displayName: "After" });
    expect(after.chatThreads).toBe(incoming.chatThreads);
    expect(after.messages).toBe(incoming.messages);
    const canonical = projectMembershipName(incoming, patch);
    expect(rebaseMembershipNames(canonical, pending, { [player.id]: 12 })).toBe(canonical);
  });

  it("uses the verified name sequence without rolling back a newer roster revision", () => {
    const newerRoster = { ...player, revision: 4 };
    const incoming = playerSnapshot({
      me: newerRoster,
      members: [newerRoster],
      directChatContacts: [contact],
      messages: [message],
    });
    const pending = new Map([[patch.membershipId, patch]]);
    expect(projectMembershipName(incoming, patch)).toBe(incoming);
    const after = rebaseMembershipNames(incoming, pending, { [player.id]: 11 });
    expect(after.me).toMatchObject({ revision: 4, displayName: "After" });
    expect(after.members).toEqual([after.me]);
    expect(after.messages[0]?.displayName).toBe("After");
    expect(after.directChatContacts?.[0]?.displayName).toBe("After");
    expect(rebaseMembershipNames(incoming, pending, { [player.id]: 13 })).toBe(incoming);
  });
});
