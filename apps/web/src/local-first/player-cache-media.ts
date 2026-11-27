import {parsePlayerReadArchive,type PlayerReadArchive} from "./player-read-archive";
import {parsePlayerStoryArchive,storyArchiveMedia,type PlayerStoryArchive} from "./player-story-cache";
import type { GameSnapshot } from "@arken/contracts";
import { z } from "zod";

const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const mime =
  /^(image\/(png|jpeg|webp|gif|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i;
const storedMedia = z
  .object({
    url: z.string().max(2048),
    mimeType: z.string().regex(mime),
    base64: z
      .string()
      .max(Math.ceil(MAX_MEDIA_BYTES / 3) * 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();
export type PlayerCachedBundle = {
  snapshot: GameSnapshot;
  story?:PlayerStoryArchive;
  reads?:PlayerReadArchive;
  savedAt?:number;
  expiresAt?:number;
  media: Map<string, Blob>;
};

/** Derived only from the currently authorized snapshot, not arbitrary URLs in text. */
export function snapshotMediaManifest(snapshot: GameSnapshot) {
  const urls = new Set(
    snapshot.assets.flatMap((asset) => [
      asset.url,
      ...(asset.posterUrl ? [asset.posterUrl] : []),
    ]),
  );
  const threads = new Set(
    (snapshot.chatThreads ?? []).map((thread) => thread.id),
  );
  for (const message of snapshot.messages)
    for (const attachment of message.attachments ?? []) {
      if (!message.threadId || !threads.has(message.threadId))
        throw Error("PLAYER_CACHE_ATTACHMENT_FORBIDDEN");
      urls.add(`/api/chat/attachments/${attachment.contentId}/content`);
    }
  return urls;
}
export async function encodePlayerCacheBundle(
  snapshot: GameSnapshot,
  media: ReadonlyMap<string, Blob>,
  story?:PlayerStoryArchive,
  reads?:PlayerReadArchive,
) {
  const frozenStory=story?parsePlayerStoryArchive(story):undefined;
  const allowed = snapshotMediaManifest(snapshot);
  for(const url of storyArchiveMedia(frozenStory))allowed.add(url);
  const
    entries: z.infer<typeof storedMedia>[] = [];
  let total = 0;
  for (const [url, blob] of media) {
    if (!allowed.has(url)) continue; // Removed references never enter the next copy.
    if (!mime.test(blob.type) || blob.size === 0)
      throw Error("PLAYER_CACHE_MEDIA_INVALID");
    total += blob.size;
    if (total > MAX_MEDIA_BYTES) throw Error("PLAYER_CACHE_MEDIA_TOO_LARGE");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    if(entries.length>=4096)throw Error("PLAYER_CACHE_MEDIA_TOO_LARGE");
    entries.push({ url, mimeType: blob.type, base64: btoa(binary) });
  }
  if(reads)return {format:4 as const,snapshot,media:entries,...(frozenStory?{story:frozenStory}:{}),reads:parsePlayerReadArchive(snapshot,reads)};
  return frozenStory?{format:3 as const,snapshot,media:entries,story:frozenStory}:{ format: 2 as const, snapshot, media: entries };
}
export function decodePlayerCacheBundle(value: unknown): PlayerCachedBundle {
  // Version-one encrypted snapshots remain readable.
  if (!value || typeof value !== "object" || !("format" in value))
    return { snapshot: value as GameSnapshot, media: new Map() };
  const parsed = z
    .object({
      format: z.union([z.literal(2),z.literal(3),z.literal(4)]),
      story:z.unknown().optional(),
      reads:z.unknown().optional(),
      snapshot: z.unknown(),
      media: z.array(storedMedia).max(4096),
    })
    .strict()
    .parse(value);
  if(parsed.format===2&&parsed.story!==undefined)throw Error("PLAYER_STORY_FORMAT_INVALID");
  if(parsed.format!==4&&parsed.reads!==undefined)throw Error("PLAYER_READ_ARCHIVE_FORMAT");
  if(parsed.format===3&&parsed.story===undefined)throw Error("PLAYER_STORY_FORMAT_INVALID");
  const story=parsed.story!==undefined?parsePlayerStoryArchive(parsed.story):undefined;
  const snapshot = parsed.snapshot as GameSnapshot,
    allowed = snapshotMediaManifest(snapshot);
  for(const url of storyArchiveMedia(story))allowed.add(url);
  const
    media = new Map<string, Blob>();
  let total = 0;
  for (const item of parsed.media) {
    if (!allowed.has(item.url) || media.has(item.url))
      throw Error("PLAYER_CACHE_MEDIA_SCOPE_MISMATCH");
    const binary = atob(item.base64);
    total += binary.length;
    if (total > MAX_MEDIA_BYTES) throw Error("PLAYER_CACHE_MEDIA_TOO_LARGE");
    media.set(
      item.url,
      new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))], {
        type: item.mimeType,
      }),
    );
  }
  return { snapshot, media,...(story?{story}:{}),...(parsed.format===4?{reads:parsePlayerReadArchive(snapshot,parsed.reads)}:{}) };
}
