import { describe, expect, it } from "vitest";
import { cursorColorForMembership } from "./cursor-color";

describe("cursorColorForMembership", () => {
  it("is deterministic for the same membershipId", () => {
    const id = "10000000-0000-4000-8000-000000000002";
    expect(cursorColorForMembership(id)).toBe(cursorColorForMembership(id));
  });

  it("returns a valid hsl() string with a hue in range", () => {
    const color = cursorColorForMembership("member-a");
    const match = /^hsl\((\d+), 85%, 60%\)$/.exec(color);
    expect(match).not.toBeNull();
    const hue = Number(match?.[1]);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it("assigns different colors to different ids (spot check)", () => {
    expect(cursorColorForMembership("member-a")).not.toBe(
      cursorColorForMembership("member-b"),
    );
  });

  it("handles an empty string without throwing", () => {
    expect(() => cursorColorForMembership("")).not.toThrow();
  });
});
