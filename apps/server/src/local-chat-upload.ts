import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { chatAttachmentUploads } from "@arken/db";
import {
  localAttachmentUploadChunkSchema,
  type LocalPeerBinding,
  type LocalPeerResponse,
} from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { env } from "./env.js";
import { stageChatAttachment } from "./chat-attachment-upload.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Chunk = import("zod").z.infer<typeof localAttachmentUploadChunkSchema>;
type Upload = NonNullable<LocalPeerResponse["upload"]>;
const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const TTL = 120000,
  MAX_MEMORY = 128 * 1024 * 1024;
type Entry = {
  buffer: Buffer;
  offset: number;
  expires: number;
  fingerprint: string;
  peer: string;
};
/** Authenticated caller only. One in-memory reservation per device, bounded host-wide.
 * No timers keep the server alive; sweep also runs at every new chunk. */
export class LocalChatUploadBuffer {
  private entries = new Map<string, Entry>();
  private reserved = 0;
  constructor(
    private now = () => Date.now(),
    private budget = MAX_MEMORY,
  ) {}
  sweep() {
    for (const [key, item] of this.entries)
      if (item.expires <= this.now()) this.remove(key);
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      entry.buffer.fill(0);
      this.reserved -= entry.buffer.length;
      this.entries.delete(key);
    }
  }
  accept(peer: string, command: Chunk): { nextOffset: number; bytes?: Buffer } {
    this.sweep();
    const key = peer + ":" + command.uploadId;
    const bytes = Buffer.from(command.base64, "base64");
    if (
      bytes.length < 1 ||
      bytes.length > 16384 ||
      bytes.toString("base64") !== command.base64
    )
      throw Error("UPLOAD_CHUNK_INVALID");
    if (
      command.total > env.MAX_IMAGE_BYTES ||
      command.offset + bytes.length > command.total
    )
      throw Error("IMAGE_TOO_LARGE");
    const fingerprint = JSON.stringify([
      command.total,
      command.fileName,
      command.sha256,
    ]);
    let entry = this.entries.get(key);
    if (!entry) {
      if (command.offset !== 0) throw Error("UPLOAD_RESTART_REQUIRED");
      // A new selection deliberately replaces this device's unfinished file.
      for (const [oldKey, old] of this.entries)
        if (old.peer === peer) this.remove(oldKey);
      if (this.entries.size >= 64) throw Error("UPLOAD_MEMORY_LIMIT");
      if (this.reserved + command.total > this.budget)
        throw Error("UPLOAD_MEMORY_LIMIT");
      entry = {
        buffer: Buffer.alloc(command.total),
        offset: 0,
        expires: this.now() + TTL,
        fingerprint,
        peer,
      };
      this.entries.set(key, entry);
      this.reserved += command.total;
    }
    if (entry.fingerprint !== fingerprint) throw Error("UPLOAD_CONFLICT");
    if (command.offset < entry.offset) {
      if (
        command.offset + bytes.length > entry.offset ||
        !entry.buffer
          .subarray(command.offset, command.offset + bytes.length)
          .equals(bytes)
      )
        throw Error("UPLOAD_CONFLICT");
      return { nextOffset: entry.offset };
    }
    if (command.offset !== entry.offset) throw Error("UPLOAD_OFFSET_INVALID");
    bytes.copy(entry.buffer, entry.offset);
    entry.offset += bytes.length;
    entry.expires = this.now() + TTL;
    if (entry.offset < command.total) return { nextOffset: entry.offset };
    if (digest(entry.buffer) !== command.sha256) {
      this.remove(key);
      throw Error("UPLOAD_HASH_MISMATCH");
    }
    const result = Buffer.from(entry.buffer);
    this.remove(key);
    return { nextOffset: command.total, bytes: result };
  }
}
const uploads = new LocalChatUploadBuffer();
const sweep = setInterval(() => uploads.sweep(), 30000);
sweep.unref();
/** Must run in withLocalPeer's campaign-fenced transaction. The receipt and staged
 * attachment commit together, before any complete acknowledgement is returned. */
export async function receiveLocalChatUpload(
  db: Database,
  auth: AuthContext,
  peer: LocalPeerBinding,
  input: Chunk,
  onStored: (key: string) => void,
): Promise<Upload> {
  const command = localAttachmentUploadChunkSchema.parse(input),
    requestHash = digest(JSON.stringify(command));
  const rows = await db.execute<{
    membership_id: string;
    device_id: string;
    session_id: string;
    epoch: number;
    request_hash: string;
    content_id: string;
  }>(
    sql`SELECT membership_id,device_id,session_id,epoch,request_hash,content_id FROM local_chat_upload_receipts WHERE campaign_id=${auth.campaignId} AND upload_id=${command.uploadId}`,
  );
  const receipt = rows[0];
  if (receipt) {
    if (
      receipt.membership_id !== auth.membershipId ||
      receipt.device_id !== peer.deviceId ||
      receipt.session_id !== peer.sessionId ||
      receipt.epoch !== peer.epoch ||
      receipt.request_hash !== requestHash
    )
      throw Error("UPLOAD_CONFLICT");
    const [row] = await db
      .select()
      .from(chatAttachmentUploads)
      .where(
        and(
          eq(chatAttachmentUploads.campaignId, auth.campaignId),
          eq(chatAttachmentUploads.contentId, receipt.content_id),
          eq(chatAttachmentUploads.uploadedByMembershipId, auth.membershipId),
        ),
      );
    if (!row || (row.status === "STAGED" && row.expiresAt <= new Date()))
      throw Error("UPLOAD_RESTART_REQUIRED");
    return {
      uploadId: command.uploadId,
      nextOffset: command.total,
      attachment: {
        contentId: row.contentId,
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        createdAt: row.createdAt.toISOString(),
      },
    };
  }
  const scope = JSON.stringify([
    auth.campaignId,
    auth.membershipId,
    peer.deviceId,
    peer.sessionId,
    peer.epoch,
  ]);
  const accepted = uploads.accept(scope, command);
  if (!accepted.bytes)
    return { uploadId: command.uploadId, nextOffset: accepted.nextOffset };
  try {
    const attachment = await stageChatAttachment(
      db,
      auth,
      accepted.bytes,
      command.fileName,
      onStored,
    );
    await db.execute(
      sql`INSERT INTO local_chat_upload_receipts(campaign_id,upload_id,membership_id,device_id,session_id,epoch,request_hash,content_id) VALUES(${auth.campaignId},${command.uploadId},${auth.membershipId},${peer.deviceId},${peer.sessionId},${peer.epoch},${requestHash},${attachment.contentId})`,
    );
    return {
      uploadId: command.uploadId,
      nextOffset: command.total,
      attachment,
    };
  } finally {
    accepted.bytes.fill(0);
  }
}
