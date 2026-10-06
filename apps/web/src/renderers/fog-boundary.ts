/** Cap only the cosmetic edge raster; the actual fog mask stays full-resolution. */
export function fogBoundaryPixelRatio(
  width: number,
  height: number,
  maxDimension = 2048,
): number {
  return Math.min(1, maxDimension / Math.max(1, width, height));
}

/** Draw only the exposed edge of the *final* fog mask, not each edit stroke. */
export function fogBoundaryPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(source.length);
  const opaque = (x: number, y: number) =>
    x >= 0 &&
    x < width &&
    y >= 0 &&
    y < height &&
    source[(y * width + x) * 4 + 3]! > 8;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (opaque(x, y)) continue;
      if (
        !opaque(x - 1, y) &&
        !opaque(x + 1, y) &&
        !opaque(x, y - 1) &&
        !opaque(x, y + 1)
      )
        continue;
      const index = (y * width + x) * 4;
      result[index] = 206;
      result[index + 1] = 217;
      result[index + 2] = 220;
      result[index + 3] = 56;
    }
  }
  return result;
}
