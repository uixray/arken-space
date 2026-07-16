import { createReadStream } from "node:fs";
import { mkdir, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { parseBuffer, parseFile } from "music-metadata";
import sharp from "sharp";
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

export async function assertStorageCapacity(
  existingBytes: number,
  incomingBytes: number,
) {
  if (existingBytes + incomingBytes > env.MEDIA_QUOTA_BYTES)
    throw new Error("MEDIA_QUOTA_EXCEEDED");
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
