import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { parseBuffer, parseFile } from "music-metadata";
import sharp, { type Metadata, type OverlayOptions } from "sharp";
import type { TokenFramePreset } from "@arken/contracts";
import { env } from "./env.js";
import { randomToken } from "./security.js";

const imageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);
const audioMimes = new Set(["audio/mpeg", "audio/ogg", "application/ogg"]);

function validatedAudioDuration(durationSeconds: number | undefined) {
  if (
    durationSeconds === undefined ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 86400
  )
    throw new Error("INVALID_AUDIO_DURATION");
  return durationSeconds;
}

export interface StoredUpload {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export function mediaRoot() {
  return resolve(env.MEDIA_ROOT);
}

function storedPath(storageKey: string) {
  if (storageKey !== storageKey.replace(/[^a-zA-Z0-9._-]/g, ""))
    throw new Error("INVALID_STORAGE_KEY");
  const path = resolve(mediaRoot(), storageKey);
  const relation = relative(mediaRoot(), path);
  if (relation.startsWith("..") || isAbsolute(relation))
    throw new Error("INVALID_STORAGE_KEY");
  return path;
}

export async function removeStoredUpload(storageKey: string) {
  await unlink(storedPath(storageKey)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export function assertStorageQuota(
  existingBytes: number,
  incomingBytes: number,
) {
  if (existingBytes + incomingBytes > env.MEDIA_QUOTA_BYTES)
    throw new Error("MEDIA_QUOTA_EXCEEDED");
}

export async function assertStorageCapacity(
  existingBytes: number,
  incomingBytes: number,
) {
  assertStorageQuota(existingBytes, incomingBytes);
  await mkdir(mediaRoot(), { recursive: true });
  const disk = await statfs(mediaRoot());
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  if (freeBytes - incomingBytes < env.MIN_FREE_DISK_BYTES)
    throw new Error("LOW_DISK_SPACE");
}

export async function storeUpload(
  buffer: Buffer,
  family: "image" | "audio",
): Promise<StoredUpload> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) throw new Error("UNSUPPORTED_FILE_TYPE");
  await mkdir(mediaRoot(), { recursive: true });

  if (family === "image") {
    if (!imageMimes.has(detected.mime))
      throw new Error("UNSUPPORTED_IMAGE_TYPE");
    if (buffer.length > env.MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
    const pipeline = sharp(buffer, { limitInputPixels: 64_000_000 }).rotate();
    const metadata = await pipeline.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 64_000_000
    )
      throw new Error("IMAGE_DIMENSIONS_TOO_LARGE");
    const output = await pipeline.webp({ quality: 88, effort: 4 }).toBuffer();
    const storageKey = `${randomToken(18)}.webp`;
    await writeFile(resolve(mediaRoot(), storageKey), output, { flag: "wx" });
    return {
      storageKey,
      mimeType: "image/webp",
      sizeBytes: output.length,
      width: metadata.width,
      height: metadata.height,
      durationSeconds: null,
    };
  }

  if (!audioMimes.has(detected.mime)) throw new Error("UNSUPPORTED_AUDIO_TYPE");
  if (buffer.length > env.MAX_AUDIO_BYTES) throw new Error("AUDIO_TOO_LARGE");
  const extension = detected.mime === "audio/mpeg" ? ".mp3" : ".ogg";
  const metadata = await parseBuffer(
    buffer,
    { mimeType: detected.mime, size: buffer.length },
    { duration: true, skipCovers: true },
  );
  const durationSeconds = validatedAudioDuration(metadata.format.duration);
  const storageKey = `${randomToken(18)}${extension}`;
  await writeFile(resolve(mediaRoot(), storageKey), buffer, { flag: "wx" });
  return {
    storageKey,
    mimeType: detected.mime === "application/ogg" ? "audio/ogg" : detected.mime,
    sizeBytes: buffer.length,
    width: null,
    height: null,
    durationSeconds,
  };
}

export interface TokenAssetTransform {
  cropX: number;
  cropY: number;
  zoom: number;
  frame: TokenFramePreset;
}

export const TOKEN_ASSET_SIZE = 512;
const MAX_STORED_SOURCE_BYTES = 64 * 1024 * 1024;

export function resolveTokenCrop(
  width: number,
  height: number,
  transform: Pick<TokenAssetTransform, "cropX" | "cropY" | "zoom">,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("INVALID_SOURCE_DIMENSIONS");
  if (
    !Number.isFinite(transform.cropX) ||
    transform.cropX < 0 ||
    transform.cropX > 1 ||
    !Number.isFinite(transform.cropY) ||
    transform.cropY < 0 ||
    transform.cropY > 1 ||
    !Number.isFinite(transform.zoom) ||
    transform.zoom < 1 ||
    transform.zoom > 8
  )
    throw new Error("INVALID_TOKEN_TRANSFORM");
  const size = Math.max(
    1,
    Math.floor(Math.min(width, height) / transform.zoom),
  );
  const left = Math.max(
    0,
    Math.min(width - size, Math.round(transform.cropX * width - size / 2)),
  );
  const top = Math.max(
    0,
    Math.min(height - size, Math.round(transform.cropY * height - size / 2)),
  );
  return { left, top, width: size, height: size };
}

function autoOrientedDimensions(metadata: Metadata) {
  if (!metadata.width || !metadata.height)
    throw new Error("INVALID_SOURCE_DIMENSIONS");
  return metadata.orientation && metadata.orientation >= 5
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

function circleMaskSvg() {
  return Buffer.from(
    `<svg width="${TOKEN_ASSET_SIZE}" height="${TOKEN_ASSET_SIZE}" xmlns="http://www.w3.org/2000/svg"><circle cx="256" cy="256" r="255" fill="#fff"/></svg>`,
  );
}

const frameColors: Record<
  Exclude<TokenFramePreset, "NONE">,
  [string, string, string]
> = {
  BRONZE: ["#5b2f18", "#d79a52", "#f2c078"],
  SILVER: ["#505861", "#c7d0d8", "#f4f7fa"],
  OBSIDIAN: ["#090b10", "#313948", "#747f91"],
};

function frameSvg(frame: Exclude<TokenFramePreset, "NONE">) {
  const [shadow, middle, highlight] = frameColors[frame];
  return Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${highlight}"/><stop offset="0.48" stop-color="${middle}"/><stop offset="1" stop-color="${shadow}"/>
    </linearGradient></defs>
    <circle cx="256" cy="256" r="244" fill="none" stroke="${shadow}" stroke-width="23"/>
    <circle cx="256" cy="256" r="243" fill="none" stroke="url(#ring)" stroke-width="17"/>
    <circle cx="256" cy="256" r="237" fill="none" stroke="${highlight}" stroke-opacity=".62" stroke-width="2"/>
  </svg>`);
}

/** Render a deterministic 512x512 WebP derivative without changing the source. */
export async function renderTokenAsset(
  source: Buffer,
  transform: TokenAssetTransform,
) {
  const input = sharp(source, { limitInputPixels: 64_000_000 });
  const metadata = await input.metadata();
  const dimensions = autoOrientedDimensions(metadata);
  if (dimensions.width * dimensions.height > 64_000_000)
    throw new Error("IMAGE_DIMENSIONS_TOO_LARGE");
  const crop = resolveTokenCrop(dimensions.width, dimensions.height, transform);
  const overlays: OverlayOptions[] = [
    { input: circleMaskSvg(), blend: "dest-in" },
  ];
  if (transform.frame !== "NONE")
    overlays.push({ input: frameSvg(transform.frame), blend: "over" });
  return sharp(source, { limitInputPixels: 64_000_000 })
    .rotate()
    .extract(crop)
    .resize(TOKEN_ASSET_SIZE, TOKEN_ASSET_SIZE, { fit: "fill" })
    .ensureAlpha()
    .composite(overlays)
    .webp({ quality: 90, alphaQuality: 100, effort: 4 })
    .toBuffer();
}

export async function readStoredImage(storageKey: string) {
  const path = storedPath(storageKey);
  const info = await stat(path);
  if (info.size > MAX_STORED_SOURCE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  return readFile(path);
}

/** Persist a validated, already-rendered token derivative without re-encoding it. */
export async function storeGeneratedToken(
  buffer: Buffer,
): Promise<StoredUpload> {
  const detected = await fileTypeFromBuffer(buffer);
  const metadata = await sharp(buffer, {
    limitInputPixels: 64_000_000,
  }).metadata();
  if (
    detected?.mime !== "image/webp" ||
    metadata.width !== TOKEN_ASSET_SIZE ||
    metadata.height !== TOKEN_ASSET_SIZE ||
    !metadata.hasAlpha
  )
    throw new Error("INVALID_TOKEN_DERIVATIVE");
  await mkdir(mediaRoot(), { recursive: true });
  const storageKey = `${randomToken(18)}.webp`;
  await writeFile(storedPath(storageKey), buffer, { flag: "wx" });
  return {
    storageKey,
    mimeType: "image/webp",
    sizeBytes: buffer.length,
    width: TOKEN_ASSET_SIZE,
    height: TOKEN_ASSET_SIZE,
    durationSeconds: null,
  };
}

export async function inspectStoredAudioDuration(storageKey: string) {
  const metadata = await parseFile(storedPath(storageKey), {
    duration: true,
    skipCovers: true,
  });
  return validatedAudioDuration(metadata.format.duration);
}

export async function openStoredFile(
  storageKey: string,
  range: string | undefined,
) {
  const path = storedPath(storageKey);
  const info = await stat(path);
  if (!range)
    return {
      stream: createReadStream(path),
      size: info.size,
      start: 0,
      end: info.size - 1,
      partial: false,
    };

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) throw new Error("INVALID_RANGE");
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : info.size - 1;
  const end = Math.min(requestedEnd, info.size - 1);
  if (!Number.isFinite(start) || start < 0 || start > end)
    throw new Error("INVALID_RANGE");
  return {
    stream: createReadStream(path, { start, end }),
    size: info.size,
    start,
    end,
    partial: true,
  };
}

export function displayNameFromUpload(name: string) {
  const withoutExtension = name.slice(
    0,
    Math.max(0, name.length - extname(name).length),
  );
  const safe = Array.from(withoutExtension, (character) =>
    character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
      ? " "
      : character,
  ).join("");
  return safe.trim().slice(0, 100) || "Без названия";
}
