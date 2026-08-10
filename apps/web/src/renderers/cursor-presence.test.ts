import { describe, expect, it } from "vitest";
import { applyCursorMoved, type CursorPresence } from "./cursor-presence";

const cursor = (
  membershipId: string,
  x: number,
  y = 0,
): CursorPresence => ({
  membershipId,
  displayName: membershipId,
  role: "PLAYER",
  sceneId: "scene-1",
  x,
  y,
});

describe("applyCursorMoved", () => {
  it("ignores the echo of the viewer's own cursor", () => {
    const current = [cursor("other", 10)];
    expect(applyCursorMoved(current, cursor("me", 50), "me")).toBe(current);
  });

  it("replaces a member's previous position rather than trailing it", () => {
    const after = applyCursorMoved([cursor("other", 10)], cursor("other", 90), "me");
    expect(after).toHaveLength(1);
    expect(after[0]?.x).toBe(90);
  });

  it("keeps other members' cursors while adding a new one", () => {
    const after = applyCursorMoved(
      [cursor("a", 1), cursor("b", 2)],
      cursor("c", 3),
      "me",
    );
    expect(after.map((item) => item.membershipId)).toEqual(["a", "b", "c"]);
  });

  it("keeps every cursor when the viewer's own id is not yet known", () => {
    // Before the snapshot loads there is no "me" to compare against; dropping
    // nothing is the safe direction, since a stray cursor is visible and
    // fixable while a silently missing one looks like the feature is broken.
    const after = applyCursorMoved([], cursor("someone", 5), undefined);
    expect(after).toHaveLength(1);
  });
});
