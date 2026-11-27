import {resolveReadableStoryMedia} from "./story-media-content.js";
import { resolveReadableChatAttachment } from "./chat-attachment-content.js";
import { createHash } from "node:crypto";
import type { GameSnapshot, LocalAssetChunk } from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { resolveReadableAsset } from "./asset-routes.js";
import { openStoredFile } from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export const LOCAL_MEDIA_CHUNK_BYTES = 131072;
/** Every chunk rechecks membership/authority (gateway transaction) and current media ACL. */
export async function readLocalAssetChunk(
  db: Database,
  auth: AuthContext,
  command: {
    assetId: string;
    variant?: "poster";
    offset: number;
    version?: string;
  },
  snapshot: GameSnapshot,
): Promise<LocalAssetChunk> {
  const readable = await resolveReadableAsset(
    db,
    auth,
    command.assetId,
    command.variant,
    snapshot,
  );
  if (!readable) throw Error("ASSET_NOT_FOUND");
  return readBoundedLocalChunk(
    readable.storageKey,
    readable.asset.mimeType,
    command.assetId,
    command.offset,
    command.version,
    command.variant,
  );
}
export async function readLocalChatAttachmentChunk(
  db: Database,
  auth: AuthContext,
  command: { contentId: string; offset: number; version?: string },
): Promise<LocalAssetChunk> {
  const upload = await resolveReadableChatAttachment(
    db,
    auth,
    command.contentId,
  );
  if (!upload) throw Error("CHAT_ATTACHMENT_NOT_FOUND");
  return readBoundedLocalChunk(
    upload.storageKey,
    upload.mimeType,
    command.contentId,
    command.offset,
    command.version,
  );
}
export async function readLocalStoryMediaChunk(db:Database,auth:AuthContext,command:{contentId:string;offset:number;version?:string}):Promise<LocalAssetChunk>{
 const upload=await resolveReadableStoryMedia(db,auth,command.contentId);
 if(!upload)throw Error("STORY_MEDIA_NOT_FOUND");
 return readBoundedLocalChunk(upload.storageKey,upload.mimeType,command.contentId,command.offset,command.version);
}
async function readBoundedLocalChunk(
  storageKey: string,
  mimeType: string,
  id: string,
  offset: number,
  expectedVersion?: string,
  variant?: "poster",
): Promise<LocalAssetChunk> {
  // Legacy immutable keys keep their existing wire version. Imported files can
  // be repaired atomically under the same key: fence using the opened inode,
  // not a separate stat which could race replacement before opening the stream.
  const immutableVersion = createHash("sha256").update(storageKey).digest("hex");
  const repairable = storageKey.startsWith("import-media/");
  if (!repairable && expectedVersion && expectedVersion !== immutableVersion)
    throw Error("ASSET_VERSION_CHANGED");
  const file = await openStoredFile(
    storageKey,
    `bytes=${offset}-${offset + LOCAL_MEDIA_CHUNK_BYTES - 1}`,
  );
  try {
    const version = repairable
      ? createHash("sha256").update(storageKey+"\0"+file.cacheRevision).digest("hex")
      : immutableVersion;
    if (expectedVersion && expectedVersion !== version)
      throw Error("ASSET_VERSION_CHANGED");
    const buffers: Buffer[] = [];
    let length = 0;
    for await (const part of file.stream) {
      const bytes = Buffer.from(part);
      length += bytes.length;
      if (length > LOCAL_MEDIA_CHUNK_BYTES)
        throw Error("MEDIA_CHUNK_TOO_LARGE");
      buffers.push(bytes);
    }
    const bytes = Buffer.concat(buffers);
    return {
      assetId: id,
      ...(variant ? { variant: variant } : {}),
      offset: offset,
      total: file.size,
      version,
      mimeType: mimeType,
      base64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    file.stream.destroy();
  }
}
