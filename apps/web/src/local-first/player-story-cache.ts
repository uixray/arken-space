import {listStoryPostsSchema, storyEntityLinkSchema, storyPostMediaInputSchema} from "@arken/contracts";
import {z} from "zod";

// Strict player DTO: never serialize a GM editing projection or unknown metadata.
export const cachedStoryPageSchema=z.object({
 posts:z.array(z.object({
  id:z.string().uuid(),threadId:z.string().uuid(),authorMembershipId:z.string().uuid(),
  title:z.string().max(1000),body:z.string().max(200000),
  lifecycle:z.enum(["PUBLISHED","CORRECTED"]),revision:z.number().int().positive(),
  entityLinks:z.array(storyEntityLinkSchema).max(1000),
  media:z.array(storyPostMediaInputSchema.extend({fileName:z.string().max(1024),mimeType:z.string().max(256),sizeBytes:z.number().int().nonnegative(),width:z.number().int().positive().nullable(),height:z.number().int().positive().nullable(),createdAt:z.string().max(64)}).strict()).max(10),
  publishedAt:z.string().max(64),correctedAt:z.string().max(64).nullable(),
  worldDay:z.number().int().positive().nullable(),era:z.string().max(80).nullable(),
  linkTargets:z.array(storyEntityLinkSchema.extend({label:z.string().max(2000).nullable(),playerVisible:z.literal(true)}).strict()).max(1000),
  createdAt:z.string().max(64),updatedAt:z.string().max(64),
 }).strict()).max(50),
 nextCursor:z.string().min(1).max(256).nullable(),eras:z.array(z.string().max(80)).max(10000),
}).strict();
export type CachedStoryPage=z.infer<typeof cachedStoryPageSchema>;
export function storyPageCacheKey(input:unknown){
 const query=listStoryPostsSchema.parse(input);
 return JSON.stringify([query.limit,query.cursor??null,query.era??null]);
}
/** An exact fetched page is not a complete archive. Keep its opaque next cursor. */
export function freezePlayerStoryPage(input:unknown):CachedStoryPage{
 const page=cachedStoryPageSchema.parse(input);
 if(new Set(page.posts.map(post=>post.id)).size!==page.posts.length)throw Error("PLAYER_STORY_DUPLICATE_POST");
 if(new TextEncoder().encode(JSON.stringify(page)).byteLength>4*1024*1024)throw Error("PLAYER_STORY_PAGE_TOO_LARGE");
 return page;
}

/** Drop whole exact pages on any public inventory change: removing individual
 * posts would leave stale eras/cursors and falsely imply complete pagination. */
export function createPlayerStoryArchive(){
 let fingerprint:string|undefined;
 const pages=new Map<string,CachedStoryPage>();
 return {
  reconcile(next:unknown){
   const valid=typeof next==="string"&&/^[a-f0-9]{64}$/.test(next)?next:undefined;
   if(!valid||valid!==fingerprint)pages.clear();
   fingerprint=valid;
  },
  capture(query:unknown,page:unknown){
   if(!fingerprint)return false;
   const key=storyPageCacheKey(query),frozen=freezePlayerStoryPage(page);
   const candidate=new Map(pages);candidate.delete(key);candidate.set(key,frozen);
   while(candidate.size>32)candidate.delete(candidate.keys().next().value!);
   while(new TextEncoder().encode(JSON.stringify([...candidate])).byteLength>8*1024*1024&&candidate.size>1)candidate.delete(candidate.keys().next().value!);
   pages.clear();for(const [key,value]of candidate)pages.set(key,value);
   return true;
  },
  snapshot(){return fingerprint?parsePlayerStoryArchive({fingerprint,pages:[...pages].map(([key,page])=>({key,page}))}):undefined;},
  page(query:unknown){const page=pages.get(storyPageCacheKey(query));return page?freezePlayerStoryPage(page):undefined;},
  clear(){pages.clear();fingerprint=undefined;},
 };
}

const archiveSchema=z.object({fingerprint:z.string().regex(/^[a-f0-9]{64}$/),pages:z.array(z.object({key:z.string().max(1024),page:cachedStoryPageSchema}).strict()).max(32)}).strict();
export type PlayerStoryArchive=z.infer<typeof archiveSchema>;
export function parsePlayerStoryArchive(value:unknown):PlayerStoryArchive{
 const archive=archiveSchema.parse(value),keys=new Set<string>();
 for(const entry of archive.pages){
  const parts=z.tuple([z.number(),z.string().nullable(),z.string().nullable()]).parse(JSON.parse(entry.key));
  if(entry.key!==storyPageCacheKey({limit:parts[0],...(parts[1]?{cursor:parts[1]}:{}),...(parts[2]?{era:parts[2]}:{})})||keys.has(entry.key))throw Error("PLAYER_STORY_QUERY_INVALID");
  keys.add(entry.key);freezePlayerStoryPage(entry.page);
 }
 if(new TextEncoder().encode(JSON.stringify(archive)).byteLength>8*1024*1024)throw Error("PLAYER_STORY_ARCHIVE_TOO_LARGE");
 return archive;
}
export function storyArchiveMedia(archive?:PlayerStoryArchive){
 return new Set(archive?.pages.flatMap(entry=>entry.page.posts.flatMap(post=>post.media.map(item=>`/api/story/media/${item.contentId}`)))??[]);
}
