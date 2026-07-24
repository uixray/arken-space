import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  renderTokenAsset,
  resolveTokenCrop,
  TOKEN_ASSET_SIZE,
} from "./storage.js";

async function splitSource() {
  const left = await sharp({
    create: { width: 400, height: 400, channels: 3, background: "#ef3434" },
  })
    .png()
    .toBuffer();
  const right = await sharp({
    create: { width: 400, height: 400, channels: 3, background: "#294ee8" },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 800, height: 400, channels: 3, background: "#000" },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: 400, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function pixel(buffer: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 4)];
}

describe("UIX-255 token derivative storage", () => {
  it("clamps normalized crop centers to source bounds", () => {
    expect(resolveTokenCrop(800, 400, { cropX: 0, cropY: 0, zoom: 1 })).toEqual(
      {
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      },
    );
    expect(resolveTokenCrop(800, 400, { cropX: 1, cropY: 1, zoom: 2 })).toEqual(
      {
        left: 600,
        top: 200,
        width: 200,
        height: 200,
      },
    );
  });

  it("renders an exact circular 512px WebP with transparent corners", async () => {
    const source = await splitSource();
    const output = await renderTokenAsset(source, {
      cropX: 0,
      cropY: 0.5,
      zoom: 1,
      frame: "NONE",
    });
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({
      format: "webp",
      width: TOKEN_ASSET_SIZE,
      height: TOKEN_ASSET_SIZE,
      hasAlpha: true,
    });
    expect((await pixel(output, 0, 0))[3]).toBe(0);
    const center = await pixel(output, 256, 256);
    expect(center[0]).toBeGreaterThan(200);
    expect(center[2]).toBeLessThan(100);
  });

  it.each(["BRONZE", "SILVER", "OBSIDIAN"] as const)(
    "draws the programmatic %s ring without external media",
    async (frame) => {
      const output = await renderTokenAsset(await splitSource(), {
        cropX: 1,
        cropY: 0.5,
        zoom: 2,
        frame,
      });
      expect((await pixel(output, 0, 0))[3]).toBe(0);
      expect((await pixel(output, 256, 8))[3]).toBeGreaterThan(200);
      const center = await pixel(output, 256, 256);
      expect(center[2]).toBeGreaterThan(150);
      expect(center[0]).toBeLessThan(100);
    },
  );
});
