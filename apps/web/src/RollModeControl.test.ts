import { describe, expect, it } from "vitest";
import { nextRollMode } from "./roll-mode";

describe("nextRollMode", () => {
  it("moves through modes with roving radio keyboard commands", () => {
    expect(nextRollMode("NORMAL", "ArrowRight")).toBe("ADVANTAGE");
    expect(nextRollMode("NORMAL", "ArrowLeft")).toBe("DISADVANTAGE");
    expect(nextRollMode("ADVANTAGE", "ArrowDown")).toBe("DISADVANTAGE");
    expect(nextRollMode("DISADVANTAGE", "ArrowUp")).toBe("ADVANTAGE");
    expect(nextRollMode("ADVANTAGE", "Home")).toBe("DISADVANTAGE");
    expect(nextRollMode("DISADVANTAGE", "End")).toBe("ADVANTAGE");
  });

  it("uses the ordinary option as the initial roving tab stop without creating an override", () => {
    expect(nextRollMode(undefined, "ArrowRight")).toBe("ADVANTAGE");
    expect(nextRollMode(undefined, "Enter")).toBeNull();
  });
});
