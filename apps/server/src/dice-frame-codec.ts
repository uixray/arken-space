import { crc32 } from "node:zlib";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

/**
 * UIX-457 — рамки бросков: анимированный источник → лёгкий анимированный WebP
 * плюс статичный постер.
 *
 * Почему свой разбор APNG. `sharp`/libvips читает у APNG только первый кадр и
 * молча теряет анимацию; `ffmpeg` 5.1 из образа падает на части реальных рамок
 * («Not yet implemented») и сжимает их хуже исходника. Здесь APNG делится на
 * кадры по чанкам, каждый кадр декодирует `sharp` как обычный PNG, а сборку по
 * `dispose_op`/`blend_op` делает этот модуль. Кодирует снова `sharp`.
 *
 * Рамка в ленте — 58×58 CSS px, поэтому кадр уменьшается до 128 px: это ~2.2×
 * для retina, а вес на наборе из 24 рамок падает с 28 МБ до 8 МБ. Постер
 * нужен истории ленты и `prefers-reduced-motion`: анимирован только свежий
 * бросок, остальные карточки не должны крутить десятки анимаций.
 */

export const DICE_FRAME_SIZE = 128;
const MAX_CANVAS_SIDE = 1024;
const MAX_FRAMES = 300;
/** Декодированные пиксели всех кадров: ~64 МБ RGBA до уменьшения. */
const MAX_DECODED_PIXELS = 16_000_000;
const MIN_DELAY_MS = 20;
const MAX_ANIMATED_BYTES = 3 * 1024 * 1024;
const MAX_PENDING_JOBS = 2;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SOURCE_MIMES = new Set([
  "image/apng",
  "image/png",
  "image/webp",
  "image/gif",
  "image/jpeg",
]);

export interface DecodedAnimation {
  width: number;
  height: number;
  /** Полные RGBA-кадры холста, не дельты APNG. */
  frames: Buffer[];
  delaysMs: number[];
}

export interface EncodedDiceFrame {
  animated: Buffer;
  poster: Buffer;
  width: number;
  height: number;
  frameCount: number;
  durationMs: number;
}

interface PngChunk {
  type: string;
  data: Buffer;
}

interface ApngFrameControl {
  width: number;
  height: number;
  x: number;
  y: number;
  delayMs: number;
  dispose: 0 | 1 | 2;
  blend: 0 | 1;
  data: Buffer[];
}

function invalid(): never {
  throw new Error("INVALID_DICE_FRAME");
}

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function readPngChunks(buffer: Buffer): PngChunk[] {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE))
    invalid();
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) invalid();
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (
      crc32(buffer.subarray(offset + 4, offset + 8 + length)) >>> 0 !==
      buffer.readUInt32BE(offset + 8 + length)
    )
      invalid();
    chunks.push({
      type,
      data: buffer.subarray(offset + 8, offset + 8 + length),
    });
    offset = end;
    if (type === "IEND") return chunks;
  }
  return invalid();
}

function delayMs(numerator: number, denominator: number) {
  const ms = Math.round((numerator * 1000) / (denominator || 100));
  return Math.max(MIN_DELAY_MS, ms);
}

function assertBudget(width: number, height: number, frames: number) {
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_CANVAS_SIDE ||
    height > MAX_CANVAS_SIDE ||
    frames < 1 ||
    frames > MAX_FRAMES ||
    width * height * frames > MAX_DECODED_PIXELS
  )
    throw new Error("DICE_FRAME_TOO_LARGE");
}

/** Non-premultiplied source-over, как в спецификации APNG для `APNG_BLEND_OP_OVER`. */
function blendOver(
  canvas: Buffer,
  canvasWidth: number,
  pixels: Buffer,
  frame: ApngFrameControl,
) {
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const s = (y * frame.width + x) * 4;
      const d = ((y + frame.y) * canvasWidth + x + frame.x) * 4;
      const sourceAlpha = pixels[s + 3]!;
      if (frame.blend === 0 || sourceAlpha === 255) {
        pixels.copy(canvas, d, s, s + 4);
        continue;
      }
      if (sourceAlpha === 0) continue;
      const sa = sourceAlpha / 255;
      const da = canvas[d + 3]! / 255;
      const outAlpha = sa + da * (1 - sa);
      for (let channel = 0; channel < 3; channel++)
        canvas[d + channel] = Math.round(
          (pixels[s + channel]! * sa + canvas[d + channel]! * da * (1 - sa)) /
            outAlpha,
        );
      canvas[d + 3] = Math.round(outAlpha * 255);
    }
  }
}

function clearRegion(
  canvas: Buffer,
  canvasWidth: number,
  frame: ApngFrameControl,
) {
  for (let y = 0; y < frame.height; y++) {
    const start = ((y + frame.y) * canvasWidth + frame.x) * 4;
    canvas.fill(0, start, start + frame.width * 4);
  }
}

/**
 * Разбирает APNG в полные кадры холста. Обычный PNG без `acTL` возвращается
 * одним кадром — вызывающему не нужно отличать их заранее.
 */
export async function decodeApng(buffer: Buffer): Promise<DecodedAnimation> {
  const chunks = readPngChunks(buffer);
  const header = chunks[0];
  if (header?.type !== "IHDR" || header.data.length !== 13) invalid();
  const width = header.data.readUInt32BE(0);
  const height = header.data.readUInt32BE(4);
  const shared: PngChunk[] = [];
  const controls: ApngFrameControl[] = [];
  let current: ApngFrameControl | null = null;
  let seenImageData = false;
  let animated = false;
  let expectedSequence = 0;
  for (const chunk of chunks.slice(1)) {
    if (chunk.type === "IEND") break;
    if (chunk.type === "acTL") {
      animated = true;
      continue;
    }
    if (chunk.type === "fcTL") {
      if (chunk.data.length !== 26) invalid();
      if (chunk.data.readUInt32BE(0) !== expectedSequence++) invalid();
      const dispose = chunk.data[24]!;
      const blend = chunk.data[25]!;
      if (dispose > 2 || blend > 1) invalid();
      current = {
        width: chunk.data.readUInt32BE(4),
        height: chunk.data.readUInt32BE(8),
        x: chunk.data.readUInt32BE(12),
        y: chunk.data.readUInt32BE(16),
        delayMs: delayMs(
          chunk.data.readUInt16BE(20),
          chunk.data.readUInt16BE(22),
        ),
        dispose: dispose as 0 | 1 | 2,
        blend: blend as 0 | 1,
        data: [],
      };
      if (
        current.width < 1 ||
        current.height < 1 ||
        current.x + current.width > width ||
        current.y + current.height > height
      )
        invalid();
      controls.push(current);
      assertBudget(width, height, controls.length);
      continue;
    }
    if (chunk.type === "IDAT") {
      seenImageData = true;
      // IDAT до первого fcTL — картинка по умолчанию, не кадр анимации.
      if (current) current.data.push(chunk.data);
      continue;
    }
    if (chunk.type === "fdAT") {
      if (!current || chunk.data.length < 4) invalid();
      if (chunk.data.readUInt32BE(0) !== expectedSequence++) invalid();
      current.data.push(chunk.data.subarray(4));
      continue;
    }
    if (!seenImageData && !current) shared.push(chunk);
  }
  assertBudget(width, height, 1);
  if (!animated || controls.length === 0) {
    const pixels = await sharp(buffer, { limitInputPixels: MAX_DECODED_PIXELS })
      .ensureAlpha()
      .raw()
      .toBuffer();
    return { width, height, frames: [pixels], delaysMs: [0] };
  }
  const canvas = Buffer.alloc(width * height * 4);
  const frames: Buffer[] = [];
  const delaysMs: number[] = [];
  for (const [index, control] of controls.entries()) {
    if (control.data.length === 0) invalid();
    const frameHeader = Buffer.from(header.data);
    frameHeader.writeUInt32BE(control.width, 0);
    frameHeader.writeUInt32BE(control.height, 4);
    const png = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk("IHDR", frameHeader),
      ...shared.map((chunk) => pngChunk(chunk.type, chunk.data)),
      pngChunk("IDAT", Buffer.concat(control.data)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    const pixels = await sharp(png, { limitInputPixels: MAX_DECODED_PIXELS })
      .ensureAlpha()
      .raw()
      .toBuffer();
    if (pixels.length !== control.width * control.height * 4) invalid();
    // У первого кадра «вернуть предыдущее» означает «очистить» (APNG spec).
    const dispose = index === 0 && control.dispose === 2 ? 1 : control.dispose;
    const saved = dispose === 2 ? Buffer.from(canvas) : null;
    blendOver(canvas, width, pixels, control);
    frames.push(Buffer.from(canvas));
    delaysMs.push(control.delayMs);
    if (dispose === 1) clearRegion(canvas, width, control);
    else if (saved) saved.copy(canvas);
  }
  return { width, height, frames, delaysMs };
}

/** GIF, WebP и прочее, что `sharp` читает сам, в том же виде, что APNG. */
async function decodeWithSharp(buffer: Buffer): Promise<DecodedAnimation> {
  const input = sharp(buffer, {
    animated: true,
    limitInputPixels: MAX_DECODED_PIXELS,
  });
  const metadata = await input.metadata();
  const width = metadata.width;
  const pages = metadata.pages ?? 1;
  const height = metadata.pageHeight ?? metadata.height;
  if (!width || !height) invalid();
  assertBudget(width, height, pages);
  const strip = await input.ensureAlpha().raw().toBuffer();
  const frameBytes = width * height * 4;
  if (strip.length !== frameBytes * pages) invalid();
  const frames = Array.from({ length: pages }, (_, page) =>
    strip.subarray(page * frameBytes, (page + 1) * frameBytes),
  );
  const delaysMs =
    pages === 1
      ? [0]
      : frames.map((_, page) =>
          Math.max(MIN_DELAY_MS, metadata.delay?.[page] ?? 100),
        );
  return { width, height, frames, delaysMs };
}

export async function decodeDiceFrameSource(
  buffer: Buffer,
): Promise<DecodedAnimation> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !SOURCE_MIMES.has(detected.mime))
    throw new Error("UNSUPPORTED_IMAGE_TYPE");
  return detected.mime === "image/apng" || detected.mime === "image/png"
    ? decodeApng(buffer)
    : decodeWithSharp(buffer);
}

/** Кадр с наибольшей суммарной непрозрачностью: первый кадр часто пуст. */
export function pickPosterFrame(frames: Buffer[]) {
  let best = 0;
  let bestCoverage = -1;
  for (const [index, frame] of frames.entries()) {
    let coverage = 0;
    for (let offset = 3; offset < frame.length; offset += 4)
      coverage += frame[offset]!;
    if (coverage > bestCoverage) {
      best = index;
      bestCoverage = coverage;
    }
  }
  return best;
}

export async function encodeDiceFrame(
  decoded: DecodedAnimation,
): Promise<EncodedDiceFrame> {
  const scale = Math.min(
    1,
    DICE_FRAME_SIZE / Math.max(decoded.width, decoded.height),
  );
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  // Уменьшаем каждый кадр отдельно: resize по склеенной полосе кадров
  // сжимает всю полосу в один квадрат и теряет анимацию.
  const frames = await Promise.all(
    decoded.frames.map((frame) =>
      sharp(frame, {
        raw: { width: decoded.width, height: decoded.height, channels: 4 },
      })
        .resize(width, height, { fit: "fill" })
        .raw()
        .toBuffer(),
    ),
  );
  const posterIndex = pickPosterFrame(frames);
  const poster = await sharp(frames[posterIndex]!, {
    raw: { width, height, channels: 4 },
  })
    .webp({ quality: 80, alphaQuality: 100, effort: 4 })
    .toBuffer();
  const isAnimated = frames.length > 1;
  const animated = isAnimated
    ? await sharp(Buffer.concat(frames), {
        raw: {
          width,
          height: height * frames.length,
          channels: 4,
          pageHeight: height,
        },
      })
        .webp({
          quality: 75,
          alphaQuality: 100,
          effort: 4,
          loop: 0,
          delay: decoded.delaysMs,
        })
        .toBuffer()
    : poster;
  if (animated.length > MAX_ANIMATED_BYTES)
    throw new Error("DICE_FRAME_TOO_HEAVY");
  return {
    animated,
    poster,
    width,
    height,
    frameCount: frames.length,
    durationMs: isAnimated
      ? decoded.delaysMs.reduce((sum, delay) => sum + delay, 0)
      : 0,
  };
}

let activeJobs = 0;
const queue: Array<() => void> = [];

/**
 * Один тяжёлый перекод за раз: декод 150 кадров занимает секунды CPU в
 * основном процессе, и параллельные загрузки не должны ронять игру.
 */
export async function prepareDiceFrame(buffer: Buffer) {
  if (activeJobs >= 1) {
    if (queue.length >= MAX_PENDING_JOBS) throw new Error("PROCESSING_BUSY");
    // Слот передаётся ожидающему напрямую, счётчик не опускается до нуля.
    await new Promise<void>((resolve) => queue.push(resolve));
  } else activeJobs = 1;
  try {
    return await encodeDiceFrame(await decodeDiceFrameSource(buffer));
  } finally {
    const next = queue.shift();
    if (next) next();
    else activeJobs = 0;
  }
}
