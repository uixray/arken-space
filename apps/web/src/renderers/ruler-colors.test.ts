import { describe, expect, it } from "vitest";
import { cursorColorForMembership } from "./cursor-color";
import { rulerColorForMembership } from "./ruler-colors";

describe("UIX-509 safe ruler color fallback", () => {
  it("resolves unknown membership IDs deterministically from the shared cursor fallback", () => {
    const id = "campaign-member-not-in-palette";
    expect(rulerColorForMembership(id)).toBe(cursorColorForMembership(id));
    expect(rulerColorForMembership(id)).toBe(rulerColorForMembership(id));
  });

  it("keeps a local draft and realtime ruler aligned by membership ID, not display name", () => {
    const localDraft = { membershipId: "stable-member-1", displayName: "Local label" };
    const received = { membershipId: "stable-member-1", displayName: "Remote label" };
    expect(rulerColorForMembership(localDraft.membershipId)).toBe(
      rulerColorForMembership(received.membershipId),
    );
  });

  it("differs for this selected pair of membership IDs without claiming global uniqueness", () => {
    expect(rulerColorForMembership("member-a")).not.toBe(
      rulerColorForMembership("member-b"),
    );
  });

  it("remains deterministic for the empty fallback input", () => {
    expect(rulerColorForMembership("")).toBe(cursorColorForMembership(""));
  });
});
