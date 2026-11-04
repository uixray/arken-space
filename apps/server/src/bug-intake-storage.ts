import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink, opendir, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.blob$/;
const MAX_LIMIT = 100 * 1024 * 1024;

// Do not expose a private storage path in error causes or logs.
function storageBusyError() {
  return new Error("BUG_STORAGE_BUSY");
}

function filePath(root: string, key: string) {
  if (!isAbsolute(root) || !KEY.test(key))
    throw new Error("INVALID_BUG_STORAGE_PATH");
  return join(root, key);
}
function limitBytes(limit: number) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_LIMIT)
    throw new Error("INVALID_BUG_FILE_LIMIT");
  return limit;
}

/** Explicit private root, never MEDIA_ROOT/public static storage. Caller supplies
 * an already authorized bounded source stream; no URL fetch or token handling.
 * Files remain opaque downloads, never rendered using source-declared MIME. */
export async function writeBugAttachment(
  root: string,
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
  maxTotalBytes: number,
) {
  limitBytes(maxBytes);
  if (
    !isAbsolute(root) ||
    !Number.isSafeInteger(maxTotalBytes) ||
    maxTotalBytes <= 0
  )
    throw new Error("INVALID_BUG_STORAGE_BUDGET");
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Exclusive cross-process writer lock, not a timer lease. Never steal a lock
  // merely because a large/slow download exceeded an assumed timeout.
  const lockPath = join(root, ".bug-intake-write.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw storageBusyError();
    throw error;
  }
  try {
    let used = 0;
    let entries = 0;
    const directory = await opendir(root);
    for await (const entry of directory) {
      if (entry.name === ".bug-intake-write.lock") continue;
      if (++entries > 100000) throw new Error("BUG_STORAGE_ENTRY_LIMIT");
      // Dedicated flat directory. Refuse symlinks/subdirectories rather than
      // accidentally omitting bytes or escaping the quota accounting boundary.
      const stat = await lstat(join(root, entry.name));
      if (!stat.isFile()) throw new Error("BUG_STORAGE_UNEXPECTED_ENTRY");
      used += stat.size;
      if (!Number.isSafeInteger(used) || used >= maxTotalBytes)
        throw new Error("BUG_STORAGE_QUOTA_EXCEEDED");
    }
    const available = Math.min(maxBytes, maxTotalBytes - used);
    return await writeBugAttachmentLocked(root, chunks, available);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function writeBugAttachmentLocked(
  root: string,
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
) {
  const limit = limitBytes(maxBytes);
  const storageKey = `${randomUUID()}.blob`;
  const path = filePath(root, storageKey);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const handle = await open(path, "wx", 0o600);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  let closed = false;
  try {
    for await (const chunk of chunks) {
      if (!(chunk instanceof Uint8Array))
        throw new Error("INVALID_BUG_FILE_CHUNK");
      if (chunk.byteLength > limit - sizeBytes)
        throw new Error("BUG_FILE_TOO_LARGE");
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        if (!bytesWritten) throw new Error("BUG_FILE_WRITE_FAILED");
        offset += bytesWritten;
      }
      hash.update(chunk);
      sizeBytes += chunk.byteLength;
    }
    if (!sizeBytes) throw new Error("BUG_FILE_EMPTY");
    await handle.sync();
    await handle.close();
    closed = true;
    return {
      storageKey,
      sha256: hash.digest("hex"),
      sizeBytes,
      mimeType: "application/octet-stream",
    };
  } catch (error) {
    if (!closed) await handle.close().catch(() => {});
    // Only this unique attempt's file; never historical or shared files.
    await unlink(path).catch(() => {});
    throw error;
  }
}

/** Validate bytes before operator download/transfer. Paths and original filenames
 * never come from source input. Max buffer is explicitly bounded. */
export async function readBugAttachment(
  root: string,
  stored: { storageKey: string; sha256: string; sizeBytes: number },
  maxBytes: number,
): Promise<Buffer> {
  const limit = limitBytes(maxBytes);
  if (
    !Number.isSafeInteger(stored.sizeBytes) ||
    stored.sizeBytes <= 0 ||
    stored.sizeBytes > limit ||
    !/^[0-9a-f]{64}$/.test(stored.sha256)
  )
    throw new Error("INVALID_BUG_FILE_METADATA");
  const handle = await open(filePath(root, stored.storageKey), "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== stored.sizeBytes)
      throw new Error("BUG_FILE_INTEGRITY_FAILED");
    const bytes = Buffer.alloc(stored.sizeBytes);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!bytesRead) throw new Error("BUG_FILE_INTEGRITY_FAILED");
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    const tail = await handle.read(extra, 0, 1, bytes.length);
    if (
      tail.bytesRead ||
      createHash("sha256").update(bytes).digest("hex") !== stored.sha256
    )
      throw new Error("BUG_FILE_INTEGRITY_FAILED");
    return bytes;
  } finally {
    await handle.close();
  }
}
