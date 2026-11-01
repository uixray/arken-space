import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Dedicated private directory, single server writer. Never touch unrelated files.
const NAME = /^performance-(\d{13})-[0-9a-f-]{36}\.jsonl$/;
export const JOURNAL_LIMIT = 64 * 1024 * 1024;
export const SEGMENT_LIMIT = 4 * 1024 * 1024;
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function createPerformanceJournal(options: {
  directory: string;
  minFreeBytes: number;
  now?: () => number;
  maxBytes?: number;
  segmentBytes?: number;
}) {
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes ?? JOURNAL_LIMIT;
  const segmentBytes = options.segmentBytes ?? SEGMENT_LIMIT;
  let tail = Promise.resolve();
  let pending = 0;
  let current: string | undefined;
  let currentSize = 0;
  let currentDay = "";

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (pending >= 128)
      return Promise.reject(new Error("PERFORMANCE_QUEUE_FULL"));
    pending++;
    const next = tail.then(work);
    tail = next
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        pending--;
      });
    return next;
  }

  async function prune(incoming = 0) {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const root = await lstat(options.directory);
    if (!root.isDirectory() || root.isSymbolicLink())
      throw new Error("PERFORMANCE_DIRECTORY_UNSAFE");
    const files = [];
    for (const name of await readdir(options.directory)) {
      const match = NAME.exec(name);
      if (!match) continue;
      const path = join(options.directory, name);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      files.push({ name, path, size: stat.size, created: Number(match[1]) });
    }
    files.sort((a, b) => a.created - b.created || a.name.localeCompare(b.name));
    let size = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (file.created > now() - RETENTION_MS && size + incoming <= maxBytes)
        continue;
      await unlink(file.path);
      size -= file.size;
      if (current === file.path) {
        current = undefined;
        currentSize = 0;
      }
    }
  }

  return {
    maintenance: () => enqueue(() => prune()),
    drain: () => tail,
    append: (record: Record<string, unknown>) => {
      const line = JSON.stringify(record) + "\n";
      const bytes = Buffer.byteLength(line);
      if (bytes > 8192 || bytes > maxBytes || bytes > segmentBytes)
        return Promise.reject(new Error("PERFORMANCE_RECORD_TOO_LARGE"));
      return enqueue(async () => {
        await prune(bytes);
        const disk = await statfs(options.directory);
        if (
          Number(disk.bavail) * Number(disk.bsize) - bytes <
          options.minFreeBytes
        )
          throw new Error("PERFORMANCE_DISK_RESERVE");
        const day = new Date(now()).toISOString().slice(0, 10);
        const fresh =
          !current || currentSize + bytes > segmentBytes || day !== currentDay;
        if (fresh) {
          current = join(
            options.directory,
            `performance-${now()}-${randomUUID()}.jsonl`,
          );
          currentSize = 0;
          currentDay = day;
        }
        try {
          // Never reopen an old process's possibly incomplete last line.
          const handle = await open(
            current!,
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_APPEND |
              (fresh ? constants.O_EXCL : 0) |
              (constants.O_NOFOLLOW ?? 0),
            0o600,
          );
          try {
            await handle.writeFile(line);
            await handle.sync();
          } finally {
            await handle.close();
          }
          currentSize += bytes;
        } catch (error) {
          // A partial write remains diagnosable; the next record starts a new segment.
          current = undefined;
          throw error;
        }
      });
    },
  };
}
