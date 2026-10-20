import { crc32 } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  DICE_FRAME_SIZE,
  decodeApng,
  decodeDiceFrameSource,
  encodeDiceFrame,
  pickPosterFrame,
  prepareDiceFrame,
} from "./dice-frame-codec.js";

/**
 * UIX-457: синтетические APNG собираются здесь же, байт в байт по спецификации.
 * Реальные рамки владельца в тесты не попадают: их права не подтверждены.
 */
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function readChunks(png: Buffer) {
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    chunks.push({
      type: png.toString("latin1", offset + 4, offset + 8),
      data: png.subarray(offset + 8, offset + 8 + length),
    });
    offset += 12 + length;
  }
  return chunks;
}

type Rgba = [number, number, number, number];

interface SyntheticFrame {
  width: number;
  height: number;
  x?: number;
  y?: number;
  color: Rgba;
  delay?: [number, number];
  dispose?: 0 | 1 | 2;
  blend?: 0 | 1;
}

async function solidPng(width: number, height: number, color: Rgba) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: {
        r: color[0],
        g: color[1],
        b: color[2],
        alpha: color[3] / 255,
      },
    },
  })
    .png()
    .toBuffer();
}

/** Холст `width×height`, первый кадр — IDAT (часть анимации), дальше fdAT. */
async function buildApng(
  width: number,
  height: number,
  frames: SyntheticFrame[],
  options: {
    breakSequence?: boolean;
    defaultImageOutsideAnimation?: boolean;
  } = {},
) {
  let sequence = 0;
  const parts: Buffer[] = [SIGNATURE];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  parts.push(chunk("IHDR", ihdr));
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  parts.push(chunk("acTL", actl));
  if (options.defaultImageOutsideAnimation) {
    const fallback = await solidPng(width, height, [0, 0, 255, 255]);
    for (const part of readChunks(fallback))
      if (part.type === "IDAT") parts.push(chunk("IDAT", part.data));
  }
  for (const [index, frame] of frames.entries()) {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(sequence++, 0);
    fctl.writeUInt32BE(frame.width, 4);
    fctl.writeUInt32BE(frame.height, 8);
    fctl.writeUInt32BE(frame.x ?? 0, 12);
    fctl.writeUInt32BE(frame.y ?? 0, 16);
    fctl.writeUInt16BE(frame.delay?.[0] ?? 1, 20);
    fctl.writeUInt16BE(frame.delay?.[1] ?? 10, 22);
    fctl[24] = frame.dispose ?? 0;
    fctl[25] = frame.blend ?? 0;
    parts.push(chunk("fcTL", fctl));
    const png = await solidPng(frame.width, frame.height, frame.color);
    for (const part of readChunks(png)) {
      if (part.type !== "IDAT") continue;
      if (index === 0 && !options.defaultImageOutsideAnimation)
        parts.push(chunk("IDAT", part.data));
      else {
        const seq = Buffer.alloc(4);
        seq.writeUInt32BE(
          options.breakSequence && index === frames.length - 1
            ? sequence + 5
            : sequence,
        );
        sequence += 1;
        parts.push(chunk("fdAT", Buffer.concat([seq, part.data])));
      }
    }
  }
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const pixel = (frame: Buffer, width: number, x: number, y: number) =>
  [...frame.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)] as Rgba;

describe("APNG decoding", () => {
  it("composes partial frames with dispose and blend operations", async () => {
    const apng = await buildApng(4, 4, [
      { width: 4, height: 4, color: [255, 0, 0, 255] },
      // OVER: полупрозрачный зелёный поверх красного в углу, затем BACKGROUND.
      {
        width: 2,
        height: 2,
        color: [0, 255, 0, 128],
        blend: 1,
        dispose: 1,
      },
      // PREVIOUS: белый в другом углу виден в своём кадре и откатывается.
      {
        width: 1,
        height: 1,
        x: 3,
        y: 3,
        color: [255, 255, 255, 255],
        dispose: 2,
      },
      { width: 1, height: 1, x: 1, y: 3, color: [0, 0, 0, 255] },
    ]);
    const decoded = await decodeApng(apng);
    expect(decoded.frames).toHaveLength(4);
    const [first, second, third, fourth] = decoded.frames;
    expect(pixel(first!, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    const blended = pixel(second!, 4, 0, 0);
    expect(blended[0]).toBeGreaterThan(100);
    expect(blended[1]).toBeGreaterThan(100);
    expect(blended[3]).toBe(255);
    // BACKGROUND очистил угол второго кадра до прозрачного.
    expect(pixel(third!, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(third!, 4, 3, 3)).toEqual([255, 255, 255, 255]);
    // PREVIOUS вернул угол к состоянию до третьего кадра.
    expect(pixel(fourth!, 4, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(pixel(fourth!, 4, 1, 3)).toEqual([0, 0, 0, 255]);
  });

  it("skips a default image that is not part of the animation", async () => {
    const decoded = await decodeApng(
      await buildApng(
        2,
        2,
        [
          { width: 2, height: 2, color: [255, 0, 0, 255] },
          { width: 2, height: 2, color: [0, 255, 0, 255] },
        ],
        { defaultImageOutsideAnimation: true },
      ),
    );
    expect(decoded.frames).toHaveLength(2);
    expect(pixel(decoded.frames[0]!, 2, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it("maps delays to milliseconds with a floor and the APNG zero-denominator rule", async () => {
    const decoded = await decodeApng(
      await buildApng(2, 2, [
        { width: 2, height: 2, color: [1, 1, 1, 255], delay: [3, 0] },
        { width: 2, height: 2, color: [2, 2, 2, 255], delay: [1, 1000] },
        { width: 2, height: 2, color: [3, 3, 3, 255], delay: [1, 4] },
      ]),
    );
    expect(decoded.delaysMs).toEqual([30, 20, 250]);
  });

  it("treats a plain PNG as one still frame", async () => {
    const decoded = await decodeDiceFrameSource(
      await solidPng(3, 2, [9, 8, 7, 255]),
    );
    expect(decoded).toMatchObject({ width: 3, height: 2, delaysMs: [0] });
    expect(decoded.frames).toHaveLength(1);
  });

  it("rejects corrupted, out-of-order and unsupported inputs", async () => {
    const valid = await buildApng(2, 2, [
      { width: 2, height: 2, color: [255, 0, 0, 255] },
      { width: 2, height: 2, color: [0, 255, 0, 255] },
    ]);
    const corrupted = Buffer.from(valid);
    corrupted[40] = corrupted[40]! ^ 0xff;
    await expect(decodeApng(corrupted)).rejects.toThrow("INVALID_DICE_FRAME");
    await expect(
      decodeApng(
        await buildApng(
          2,
          2,
          [
            { width: 2, height: 2, color: [255, 0, 0, 255] },
            { width: 2, height: 2, color: [0, 255, 0, 255] },
          ],
          { breakSequence: true },
        ),
      ),
    ).rejects.toThrow("INVALID_DICE_FRAME");
    await expect(
      decodeApng(
        await buildApng(2, 2, [
          { width: 2, height: 2, color: [255, 0, 0, 255] },
          { width: 2, height: 2, x: 1, color: [0, 255, 0, 255] },
        ]),
      ),
    ).rejects.toThrow("INVALID_DICE_FRAME");
    await expect(
      decodeDiceFrameSource(Buffer.from("not an image at all")),
    ).rejects.toThrow("UNSUPPORTED_IMAGE_TYPE");
  });

  it("refuses frame counts and canvases beyond the decoding budget", async () => {
    await expect(
      decodeApng(
        await buildApng(
          1,
          1,
          Array.from({ length: 301 }, () => ({
            width: 1,
            height: 1,
            color: [1, 2, 3, 255] as Rgba,
          })),
        ),
      ),
    ).rejects.toThrow("DICE_FRAME_TOO_LARGE");
    await expect(
      decodeDiceFrameSource(await solidPng(1025, 4, [1, 2, 3, 255])),
    ).rejects.toThrow("DICE_FRAME_TOO_LARGE");
  });
});

describe("dice frame encoding", () => {
  it("keeps every frame and the total duration at 128 px", async () => {
    const encoded = await encodeDiceFrame(
      await decodeApng(
        await buildApng(256, 256, [
          { width: 256, height: 256, color: [255, 0, 0, 255], delay: [1, 10] },
          { width: 256, height: 256, color: [0, 255, 0, 255], delay: [2, 10] },
          { width: 256, height: 256, color: [0, 0, 255, 255], delay: [3, 10] },
        ]),
      ),
    );
    expect(encoded).toMatchObject({
      width: DICE_FRAME_SIZE,
      height: DICE_FRAME_SIZE,
      frameCount: 3,
      durationMs: 600,
    });
    const animated = await sharp(encoded.animated, {
      animated: true,
    }).metadata();
    expect(animated).toMatchObject({
      format: "webp",
      width: DICE_FRAME_SIZE,
      pageHeight: DICE_FRAME_SIZE,
      pages: 3,
      loop: 0,
    });
    expect(animated.delay).toEqual([100, 200, 300]);
    const poster = await sharp(encoded.poster, { animated: true }).metadata();
    expect(poster).toMatchObject({ format: "webp", width: DICE_FRAME_SIZE });
    expect(poster.pages ?? 1).toBe(1);
  });

  it("does not upscale small frames and keeps their aspect ratio", async () => {
    const encoded = await encodeDiceFrame(
      await decodeDiceFrameSource(await solidPng(80, 40, [5, 5, 5, 255])),
    );
    expect(encoded).toMatchObject({ width: 80, height: 40, frameCount: 1 });
    expect(encoded.animated).toBe(encoded.poster);
  });

  it("reads animated GIF and WebP sources natively", async () => {
    const frames = await Promise.all(
      (
        [
          [255, 0, 0, 255],
          [0, 0, 255, 255],
        ] as Rgba[]
      ).map((color) =>
        sharp({
          create: {
            width: 16,
            height: 16,
            channels: 4,
            background: { r: color[0], g: color[1], b: color[2], alpha: 1 },
          },
        })
          .raw()
          .toBuffer(),
      ),
    );
    const strip = sharp(Buffer.concat(frames), {
      raw: { width: 16, height: 32, channels: 4, pageHeight: 16 },
    });
    for (const source of [
      await strip
        .clone()
        .gif({ delay: [120, 120], loop: 0 })
        .toBuffer(),
      await strip
        .clone()
        .webp({ delay: [120, 120], loop: 0 })
        .toBuffer(),
    ]) {
      const decoded = await decodeDiceFrameSource(source);
      expect(decoded.frames).toHaveLength(2);
      expect(decoded.delaysMs).toEqual([120, 120]);
    }
  });

  it("picks the most opaque frame as the poster", () => {
    const empty = Buffer.alloc(16);
    const full = Buffer.alloc(16, 255);
    const half = Buffer.alloc(16, 0);
    half[3] = 255;
    expect(pickPosterFrame([empty, half, full, half])).toBe(2);
  });

  it("runs end to end through the bounded queue", async () => {
    const source = await buildApng(32, 32, [
      { width: 32, height: 32, color: [0, 0, 0, 0] },
      { width: 32, height: 32, color: [200, 100, 0, 255] },
    ]);
    const results = await Promise.all([
      prepareDiceFrame(source),
      prepareDiceFrame(source),
      prepareDiceFrame(source),
    ]);
    for (const result of results) expect(result.frameCount).toBe(2);
    await expect(
      Promise.all(Array.from({ length: 4 }, () => prepareDiceFrame(source))),
    ).rejects.toThrow("PROCESSING_BUSY");
  });
});
