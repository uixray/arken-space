import sharp from "sharp";
import { renderTokenAsset, type TokenAssetTransform } from "./storage.js";

// Test-only adapter: the actual production encoder, not a synthetic TOKEN
// response or a second implementation of its crop/frame algorithm.
sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 4 });

export async function tokenParitySource(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      // Asymmetric smooth coordinates expose crop, stretch, flip and zoom
      // mistakes without interpolation-dependent hard boundaries.
      pixels[offset] = Math.round(20 + (210 * x) / (width - 1));
      pixels[offset + 1] = Math.round(30 + (170 * y) / (height - 1));
      pixels[offset + 2] = Math.round(
        220 - (140 * (x + y)) / (width + height - 2),
      );
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

export async function tokenParityReference(
  source: Buffer,
  transform: TokenAssetTransform,
) {
  const bytes = await renderTokenAsset(source, transform);
  const metadata = await sharp(bytes).metadata();
  return { bytes, metadata };
}

export async function tokenPreviewDifference(
  screenshot: Buffer,
  reference: Buffer,
) {
  const actual = await sharp(screenshot).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const { width, height } = actual.info;
  const expected = await sharp(reference)
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer();
  let total = 0;
  let samples = 0;
  let maximum = 0;
  for (let y = 4; y < height - 4; y += 4) {
    for (let x = 4; x < width - 4; x += 4) {
      // Content inside the frame, away from the circular antialiased edge.
      if (Math.hypot(x / width - 0.5, y / height - 0.5) > 0.42) continue;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const difference = Math.abs(
          actual.data[offset + channel]! - expected[offset + channel]!,
        );
        total += difference;
        maximum = Math.max(maximum, difference);
        samples++;
      }
    }
  }
  const ringDifferences = [
    [0.5, 0.03],
    [0.97, 0.5],
    [0.5, 0.97],
    [0.03, 0.5],
  ].map(([x, y]) => {
    const offset =
      (Math.round(y! * height) * width + Math.round(x! * width)) * 4;
    return Math.max(
      ...[0, 1, 2].map((channel) =>
        Math.abs(actual.data[offset + channel]! - expected[offset + channel]!),
      ),
    );
  });
  return {
    width,
    height,
    samples,
    mean: total / samples,
    maximum,
    ringDifferences,
  };
}
