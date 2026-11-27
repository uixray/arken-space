import {notifyStoryMediaUrls} from "../story-media-url";
import {storyArchiveMedia,type PlayerStoryArchive,freezePlayerStoryPage} from "./player-story-cache";
import {snapshotMediaManifest} from "./player-cache-media";
import type { LocalPeerResponse } from "@arken/contracts";
import { readPeerMedia } from "./peer-media";

type Request = Parameters<typeof readPeerMedia>[0];
const MAX_SESSION_BYTES = 256 * 1024 * 1024;
const content = /^\/api\/assets\/([0-9a-f-]{36})\/content(?:\?[^#]*)?$/i;
/** Memory-only URLs; every snapshot removes revoked references before publication. */
export function createPeerMediaProjection(request: Request) {
  const controller = new AbortController(),
    cache = new Map<string, { url: string; size: number; blob:Blob; threadId?: string }>();
  const storyUrls=new Set<string>();
  let storyScope:string|undefined;
  let mediaRevision:string|undefined;
  let disposed = false,
    total = 0;
  const remove = (key: string) => {
    const entry = cache.get(key);
    if (entry) {
      URL.revokeObjectURL(entry.url);
      total -= entry.size;
      cache.delete(key);
      if(storyUrls.has(key))notifyStoryMediaUrls();
    }
  };
  const clear = () => {
    for (const key of [...cache.keys()]) remove(key);
  };
  const rewrite = <T>(value: T): T => {
    const visit = (input: unknown, field?: string): unknown => {
      if (
        typeof input === "string" &&
        (field === undefined || /url$/i.test(field) || field === "src") &&
        content.test(input)
      ) {
        const entry = cache.get(input);
        if (!entry) throw Error("PEER_MEDIA_NOT_AUTHORIZED");
        return entry.url;
      }
      if (Array.isArray(input)) return input.map((item) => visit(item, field));
      if (input && typeof input === "object") {
        const object = input as Record<string, unknown>,
          rewritten = Object.fromEntries(
            Object.entries(object).map(([key, item]) => [
              key,
              visit(item, key),
            ]),
          );
        if (field === "attachments" && typeof object.contentId === "string") {
          const entry = cache.get(
            `/api/chat/attachments/${object.contentId}/content`,
          );
          if (!entry) throw Error("PEER_ATTACHMENT_NOT_AUTHORIZED");
          return { ...rewritten, url: entry.url };
        }
        return rewritten;
      }
      return input;
    };
    return visit(value) as T;
  };
  return {
    async prepare(response: LocalPeerResponse): Promise<LocalPeerResponse> {
      if (disposed) throw Error("PEER_MEDIA_CLOSED");
      try {
        // World-map backgrounds are already projected campaign assets. The same
        // authenticated chunk reader and Blob lifecycle cover them as scene media.
        const nextRevision=response.mediaRevision;
        if(nextRevision!==undefined&&(typeof nextRevision!=="string"||!/^[a-f0-9]{64}$/.test(nextRevision)))throw Error("PEER_MEDIA_REVISION_INVALID");
        // Also clear when a previously revision-aware host stops providing it.
        if(nextRevision!==mediaRevision)clear();
        mediaRevision=nextRevision;
        const nextStoryScope=typeof response.storyFingerprint==="string"?response.storyFingerprint:undefined;
        if(nextStoryScope!==storyScope||!nextStoryScope){storyUrls.clear();notifyStoryMediaUrls();}
        storyScope=nextStoryScope;
        if(response.storyPage&&nextStoryScope){
          // Validate role-safe metadata before accepting any related content ID.
          const page=freezePlayerStoryPage(response.storyPage);
          for(const post of page.posts)for(const item of post.media)storyUrls.add(`/api/story/media/${item.contentId}`);
        }
        const urls = new Set(
          response.snapshot.assets.flatMap((asset) => [
            asset.url,
            ...(asset.posterUrl ? [asset.posterUrl] : []),
          ]),
        );
        for(const url of storyUrls)urls.add(url);
        const allowedThreads = new Set(
          (response.snapshot.chatThreads ?? []).map((thread) => thread.id),
        );
        const attachments = new Map<
          string,
          { contentId: string; threadId: string }
        >();
        const messages = [
          ...response.snapshot.messages,
          ...(response.chatHistory?.messages ?? []),
          ...(response.chatResult && !("duplicate" in response.chatResult)
            ? [response.chatResult]
            : []),
        ];
        for (const message of messages)
          for (const attachment of message.attachments ?? []) {
            if (!message.threadId || !allowedThreads.has(message.threadId))
              throw Error("PEER_ATTACHMENT_THREAD_FORBIDDEN");
            attachments.set(
              `/api/chat/attachments/${attachment.contentId}/content`,
              { contentId: attachment.contentId, threadId: message.threadId },
            );
          }
        for (const [key, entry] of cache)
          if (
            entry.threadId
              ? !allowedThreads.has(entry.threadId)
              : !urls.has(key)
          )
            remove(key);
        for (const url of urls) {
          if (cache.has(url)) continue;
          const storyMatch=/^\/api\/story\/media\/([0-9a-f-]{36})$/i.exec(url);
          if(storyMatch){
            const blob=await readPeerMedia(request,storyMatch[1]!,undefined,controller.signal,"STORY_MEDIA");
            controller.signal.throwIfAborted();
            if(total+blob.size>MAX_SESSION_BYTES)throw Error("PEER_MEDIA_SESSION_MEMORY_LIMIT");
            cache.set(url,{url:URL.createObjectURL(blob),size:blob.size,blob});total+=blob.size;notifyStoryMediaUrls();continue;
          }
          const match = content.exec(url);
          if (!match) throw Error("PEER_MEDIA_URL_UNSUPPORTED");
          const query = new URL(url, "https://peer.invalid").searchParams;
          const variant = query.get("variant");
          if (variant !== null && variant !== "poster")
            throw Error("PEER_MEDIA_VARIANT_INVALID");
          const blob = await readPeerMedia(
            request,
            match[1]!,
            variant ?? undefined,
            controller.signal,
          );
          controller.signal.throwIfAborted();
          if (total + blob.size > MAX_SESSION_BYTES)
            throw Error("PEER_MEDIA_SESSION_MEMORY_LIMIT");
          cache.set(url, { url: URL.createObjectURL(blob), size: blob.size, blob });
          total += blob.size;
        }
        for (const [key, attachment] of attachments) {
          if (cache.has(key)) continue;
          const blob = await readPeerMedia(
            request,
            attachment.contentId,
            undefined,
            controller.signal,
            "CHAT_ATTACHMENT",
          );
          controller.signal.throwIfAborted();
          if (total + blob.size > MAX_SESSION_BYTES)
            throw Error("PEER_MEDIA_SESSION_MEMORY_LIMIT");
          cache.set(key, {
            url: URL.createObjectURL(blob),
            size: blob.size,
            threadId: attachment.threadId,
            blob,
          });
          total += blob.size;
        }
        return rewrite(response);
      } catch (error) {
        clear();
        throw error;
      }
    },
    snapshotMedia(snapshot:LocalPeerResponse["snapshot"],story?:PlayerStoryArchive){
      const allowed=snapshotMediaManifest(snapshot);for(const url of storyArchiveMedia(story))allowed.add(url);
      return new Map([...cache].filter(([url])=>allowed.has(url)).map(([url,entry])=>[url,entry.blob]));
    },
    storyMediaUrl(id:string){return cache.get(`/api/story/media/${id}`)?.url??"";},
    rewrite,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      clear();storyUrls.clear();notifyStoryMediaUrls();
    },
  };
}
