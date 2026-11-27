import {
  chatAttachmentMetadataSchema,
  type LocalPeerResponse,
  localAttachmentUploadChunkSchema,
} from "@arken/contracts";
import { z } from "zod";
type Chunk = z.infer<typeof localAttachmentUploadChunkSchema>;
const ackSchema = z
  .object({
    uploadId: z.string().uuid(),
    nextOffset: z.number().int().positive(),
    attachment: chatAttachmentMetadataSchema.optional(),
  })
  .strict();
/** Sequential chunks stay under the RPC frame limit. No implicit retry or cloud fallback. */
export async function uploadPeerAttachment(
  file: File,
  request: (command: Chunk) => Promise<LocalPeerResponse>,
  isClosed: () => boolean,
) {
  if (!file.size || file.size > 100 * 1024 * 1024)
    throw Error("IMAGE_TOO_LARGE");
  if (isClosed()) throw Error("PEER_CLOSED");
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (isClosed()) throw Error("PEER_CLOSED");
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const uploadId = crypto.randomUUID();
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      if (isClosed()) throw Error("PEER_CLOSED");
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + 16384, bytes.length),
      );
      const base64 = btoa(String.fromCharCode(...chunk));
      const response = await request({
        kind: "CHAT_UPLOAD_CHUNK",
        uploadId,
        fileName: file.name.slice(0, 255) || "image",
        total: bytes.length,
        sha256,
        offset,
        base64,
      });
      if (isClosed()) throw Error("PEER_CLOSED");
      const ack = ackSchema.parse(response.upload);
      if (ack.uploadId !== uploadId || ack.nextOffset !== offset + chunk.length)
        throw Error("UPLOAD_ACK_MISMATCH");
      if (ack.attachment) {
        if (ack.nextOffset !== bytes.length)
          throw Error("UPLOAD_EARLY_COMPLETION");
        return ack.attachment;
      }
    }
    throw Error("UPLOAD_INCOMPLETE");
  } finally {
    bytes.fill(0);
  }
}
