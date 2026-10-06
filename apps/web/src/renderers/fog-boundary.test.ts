import { describe, expect, it } from "vitest";
import { fogBoundaryPixelRatio, fogBoundaryPixels } from "./fog-boundary";

const alphaAt = (
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
) => pixels[(y * width + x) * 4 + 3];

describe("final fog boundary", () => {
  it("caps the decorative raster without changing the map-space boundary size", () => {
    expect(fogBoundaryPixelRatio(16_384, 16_384)).toBe(0.125);
    expect(fogBoundaryPixelRatio(4096, 2048)).toBe(0.5);
    expect(fogBoundaryPixelRatio(1024, 1024)).toBe(1);
  });
  it("outlines only the exposed edge of overlapping reveals", () => {
    const width = 12;
    const height = 9;
    const mask = new Uint8ClampedArray(width * height * 4);
    mask.fill(255);
    // Two overlapping rectangular reveals: their individual boundaries at
    // x=5 and x=3 must not survive inside the combined transparent region.
    for (const [left, right] of [
      [2, 6],
      [4, 9],
    ] as const) {
      for (let y = 2; y < 7; y += 1) {
        for (let x = left; x < right; x += 1) mask[(y * width + x) * 4 + 3] = 0;
      }
    }
    const edge = fogBoundaryPixels(mask, width, height);
    expect(alphaAt(edge, width, 2, 3)).toBe(56);
    expect(alphaAt(edge, width, 5, 3)).toBe(0);
    expect(alphaAt(edge, width, 8, 3)).toBe(56);
  });

  it("uses the final mask after a cover operation", () => {
    const width = 7;
    const height = 7;
    const mask = new Uint8ClampedArray(width * height * 4);
    mask.fill(255);
    for (let y = 1; y < 6; y += 1)
      for (let x = 1; x < 6; x += 1) mask[(y * width + x) * 4 + 3] = 0;
    mask[(3 * width + 3) * 4 + 3] = 255; // covered again
    const edge = fogBoundaryPixels(mask, width, height);
    expect(alphaAt(edge, width, 3, 2)).toBe(56);
    expect(alphaAt(edge, width, 3, 3)).toBe(0);
  });
});
