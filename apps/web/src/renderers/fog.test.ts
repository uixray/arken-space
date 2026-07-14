import { describe, expect, it } from "vitest";
import { fogOpacity, isRectFullyRevealed } from "./fog";

describe("player fog invariants", () => {
  const reveals = [{ x: 100, y: 200, width: 80, height: 60 }];

  it("is fully opaque for players and remains translucent for the GM", () => {
    expect(fogOpacity("PLAYER")).toBe(1);
    expect(fogOpacity("GM")).toBe(0.35);
  });

  it("reveals another token only when its complete bounds are revealed", () => {
    expect(
      isRectFullyRevealed({ x: 110, y: 210, width: 20, height: 20 }, reveals),
    ).toBe(true);
    expect(
      isRectFullyRevealed({ x: 90, y: 210, width: 20, height: 20 }, reveals),
    ).toBe(false);
    expect(
      isRectFullyRevealed({ x: 170, y: 250, width: 20, height: 20 }, reveals),
    ).toBe(false);
  });
});
