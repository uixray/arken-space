import { describe, expect, it } from "vitest";
import {
  nextTextureStrokePoints,
  TEXTURE_STROKE_MAX_NUMBERS,
} from "./texture-stroke";

describe("nextTextureStrokePoints (UIX-706 pool 3)", () => {
  it("starts with a valid two-point stroke, so a click paints a dab", () => {
    expect(nextTextureStrokePoints([], { x: 5, y: 7 }, 96)).toEqual({
      points: [5, 7, 5, 7],
      commit: null,
    });
  });

  it("skips points closer than a quarter of the brush width", () => {
    const start = [0, 0, 0, 0];
    expect(nextTextureStrokePoints(start, { x: 20, y: 0 }, 96).points).toBe(
      start,
    );
    expect(nextTextureStrokePoints(start, { x: 24, y: 0 }, 96).points).toEqual([
      0, 0, 0, 0, 24, 0,
    ]);
  });

  it("splits a stroke at the server point limit and continues from its end", () => {
    const full = Array.from(
      { length: TEXTURE_STROKE_MAX_NUMBERS - 2 },
      (_, index) => index * 10,
    );
    const result = nextTextureStrokePoints(full, { x: 1e6, y: 1e6 }, 8);
    expect(result.commit).toHaveLength(TEXTURE_STROKE_MAX_NUMBERS);
    expect(result.points).toEqual([1e6, 1e6, 1e6, 1e6]);
  });
});
