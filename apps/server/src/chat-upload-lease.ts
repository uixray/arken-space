import { randomUUID } from "node:crypto";
import { mkdir, open, rmdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const recordSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(uuid),
    campaignId: z.string().uuid(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ChatUploadLease = z.infer<typeof recordSchema>;

/** Storage keys are derived, never supplied by an on-disk record. */
export function chatLeaseStorageKey(id: string) {
  if (!uuid.test(id)) throw Error("INVALID_CHAT_LEASE");
  return `chat-files/${id}/content.webp`;
}

/** Create an exclusively owned directory and sync the journal BEFORE data writes.
 * This guarantees process-restart ordering, not physical power-loss durability. */
export async function createChatUploadLease(root: string, campaignId: string) {
  const lease = recordSchema.parse({
    version: 1,
    id: randomUUID(),
    campaignId,
    createdAt: new Date().toISOString(),
  });
  await mkdir(resolve(root, "chat-files"), { recursive: true });
  await mkdir(resolve(root, "chat-upload-leases"), { recursive: true });
  const directory = resolve(root, "chat-files", lease.id);
  await mkdir(directory); // EEXIST is never ownership.
  const marker = resolve(root, "chat-upload-leases", `${lease.id}.json`);
  let handle;
  try {
    handle = await open(marker, "wx", 0o600);
    await handle.writeFile(JSON.stringify(lease), "utf8");
    await handle.sync();
  } catch (error) {
    // Only an empty directory proved owned above may be removed here.
    await rmdir(directory).catch(() => {});
    throw error;
  } finally {
    await handle?.close();
  }
  return lease;
}

export async function writeChatUploadLease(
  root: string,
  lease: ChatUploadLease,
  bytes: Buffer,
) {
  recordSchema.parse(lease);
  const handle = await open(
    resolve(root, chatLeaseStorageKey(lease.id)),
    "wx",
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Called only after durable reference verification or proven cleanup. */
export async function finishChatUploadLease(root: string, id: string) {
  chatLeaseStorageKey(id);
  await unlink(resolve(root, "chat-upload-leases", `${id}.json`)).catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    },
  );
}

/** Bounded record reader; malformed/traversal/foreign-version records stay intact. */
export async function readChatUploadLease(root: string, fileName: string) {
  const id = fileName.endsWith(".json") ? fileName.slice(0, -5) : "";
  if (!uuid.test(id)) return null;
  const handle = await open(resolve(root, "chat-upload-leases", fileName), "r");
  try {
    const bytes = Buffer.alloc(2049);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 2048) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    } catch {
      return null;
    }
    const lease = recordSchema.safeParse(parsed);
    return lease.success && lease.data.id === id ? lease.data : null;
  } finally {
    await handle.close();
  }
}
