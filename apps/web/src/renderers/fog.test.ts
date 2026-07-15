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

  it("applies reveal and cover rectangles in durable order", () => {
    const token = { x: 10, y: 10, width: 10, height: 10 };
    expect(
      isRectFullyRevealed(token, [
        { x: 0, y: 0, width: 100, height: 100, operation: "REVEAL" },
        { x: 5, y: 5, width: 30, height: 30, operation: "COVER" },
      ]),
    ).toBe(false);
    expect(
      isRectFullyRevealed(token, [
        { x: 0, y: 0, width: 100, height: 100, operation: "REVEAL" },
        { x: 5, y: 5, width: 30, height: 30, operation: "COVER" },
        { x: 8, y: 8, width: 20, height: 20, operation: "REVEAL" },
      ]),
    ).toBe(true);
  });

  it("uses exact union and partial-cover geometry for hit testing", () => {
    const token = { x: 0, y: 0, width: 20, height: 20 };
    expect(
      isRectFullyRevealed(token, [
        { x: 0, y: 0, width: 10, height: 20, operation: "REVEAL" },
        { x: 10, y: 0, width: 10, height: 20, operation: "REVEAL" },
      ]),
    ).toBe(true);
    expect(
      isRectFullyRevealed(token, [
        { x: 0, y: 0, width: 20, height: 20, operation: "REVEAL" },
        { x: 5, y: 5, width: 2, height: 2, operation: "COVER" },
      ]),
    ).toBe(false);
  });
});
