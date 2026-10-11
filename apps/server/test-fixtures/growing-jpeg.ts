import sharp from "sharp";
import { expect } from "vitest";
export async function growingJpeg() {
  const pixels = Buffer.alloc(128 * 128 * 3);
  let seed = 12345;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  const source = await sharp(pixels, { raw: { width: 128, height: 128, channels: 3 } }).jpeg({ quality: 1 }).toBuffer();
  const encoded = await sharp(source).rotate().webp({ quality: 88, effort: 4 }).toBuffer();
  expect(encoded.length).toBeGreaterThan(source.length);
  return { source, encoded };
}
