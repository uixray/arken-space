import { z } from "zod";
import type { LocalPeerResponse } from "@arken/contracts";

const chunkSchema = z
  .object({
    assetId: z.string().uuid(),
    variant: z.literal("poster").optional(),
    offset: z.number().int().nonnegative(),
    total: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    version: z.string().regex(/^[a-f0-9]{64}$/),
    mimeType: z.string().min(1).max(128),
    base64: z
      .string()
      .min(1)
      .max(174764)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type Command =
  | {
      kind: "ASSET_CHUNK";
      assetId: string;
      variant?: "poster";
      offset: number;
      version?: string;
    }
  | {
      kind: "CHAT_ATTACHMENT_CHUNK" | "STORY_MEDIA_CHUNK";
      contentId: string;
      offset: number;
      version?: string;
    };
/** Bounded reader; each chunk is authenticated by the current host authority. */
export async function readPeerMedia(
  request: (command: Command) => Promise<LocalPeerResponse>,
  assetId: string,
  variant?: "poster",
  signal?: AbortSignal,
  source: "ASSET" | "CHAT_ATTACHMENT" | "STORY_MEDIA" = "ASSET",
): Promise<Blob> {
  let offset = 0,
    total: number | undefined,
    version: string | undefined,
    mimeType: string | undefined;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  while (total === undefined || offset < total) {
    signal?.throwIfAborted();
    const response = await request(
      source === "ASSET"
        ? {
            kind: "ASSET_CHUNK",
            assetId,
            ...(variant ? { variant } : {}),
            offset,
            ...(version ? { version } : {}),
          }
        : {
            kind: source === "STORY_MEDIA" ? "STORY_MEDIA_CHUNK" : "CHAT_ATTACHMENT_CHUNK",
            contentId: assetId,
            offset,
            ...(version ? { version } : {}),
          },
    );
    signal?.throwIfAborted();
    const chunk = chunkSchema.parse(response.assetChunk);
    if (
      chunk.assetId !== assetId ||
      chunk.variant !== variant ||
      chunk.offset !== offset ||
      (version !== undefined &&
        (version !== chunk.version ||
          total !== chunk.total ||
          mimeType !== chunk.mimeType))
    )
      throw Error("PEER_MEDIA_SCOPE_CHANGED");
    const raw = atob(chunk.base64),
      bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    if (bytes.length !== Math.min(131072, chunk.total - offset))
      throw Error("PEER_MEDIA_LENGTH_INVALID");
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    signal?.throwIfAborted();
    if (hash !== chunk.sha256) throw Error("PEER_MEDIA_INTEGRITY_INVALID");
    total = chunk.total;
    version = chunk.version;
    mimeType = chunk.mimeType;
    parts.push(bytes);
    offset += bytes.length;
  }
  // Untrusted text/html or SVG must never become same-origin executable documents.
  if (
    !/^(image\/(png|jpeg|webp|gif|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i.test(
      mimeType!,
    )
  )
    throw Error("PEER_MEDIA_TYPE_FORBIDDEN");
  return new Blob(parts, { type: mimeType });
}
