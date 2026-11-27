import {describe,it,expect} from "vitest";
import {createPlayerStoryArchive,freezePlayerStoryPage,storyPageCacheKey} from "./player-story-cache";
const id="11111111-1111-4111-8111-111111111111";
const post={id,threadId:id,authorMembershipId:id,title:"История",body:"Синтетическая статья",lifecycle:"PUBLISHED",revision:1,entityLinks:[],media:[],publishedAt:"2026-11-27",correctedAt:null,worldDay:1,era:null,linkTargets:[],createdAt:"2026-11-27",updatedAt:"2026-11-27"};
const page=()=>({posts:[{...post}],nextCursor:"opaque-cursor",eras:[]});
describe("player story archive boundary",()=>{
 it("canonicalizes server defaults and separates cursor/era/limit",()=>{
  expect(storyPageCacheKey({})).toBe(storyPageCacheKey({limit:"20"}));
  expect(new Set([{}, {cursor:"next"},{era:"Эпоха"},{limit:50}].map(storyPageCacheKey)).size).toBe(4);
  expect(()=>storyPageCacheKey({arbitrary:"field"})).toThrow();
 });
 it("freezes authorized metadata without claiming the archive ends",()=>{
  const source=page(),saved=freezePlayerStoryPage(source);source.posts[0]!.body="changed";
  expect(saved.posts[0]!.body).toBe(post.body);expect(saved.nextCursor).toBe("opaque-cursor");
 });
 it("rejects GM editing fields and unpublished lifecycle",()=>{
  for(const extra of [{gmNotes:"private"},{importProvenance:{}},{archivedAt:null},{lifecycle:"DRAFT"},{lifecycle:"ARCHIVED"}])
   expect(()=>freezePlayerStoryPage({...page(),posts:[{...post,...extra}]})).toThrow();
 });
 it("rejects hidden links, duplicate IDs and extra nested fields",()=>{
  expect(()=>freezePlayerStoryPage({...page(),posts:[post,post]})).toThrow("DUPLICATE_POST");
  expect(()=>freezePlayerStoryPage({...page(),posts:[{...post,linkTargets:[{kind:"CHARACTER",entityId:id,label:"secret",playerVisible:false}]}]})).toThrow();
  expect(()=>freezePlayerStoryPage({...page(),secret:true})).toThrow();
 });
});

it("invalidates whole exact pages including eras and cursor on visibility/revision change",()=>{
 const archive=createPlayerStoryArchive();expect(archive.capture({},page())).toBe(false);
 archive.reconcile("a".repeat(64));expect(archive.capture({},page())).toBe(true);
 archive.reconcile("a".repeat(64));expect(archive.page({})?.nextCursor).toBe("opaque-cursor");
 const returned=archive.page({})!;returned.posts[0]!.body="mutation";expect(archive.page({})!.posts[0]!.body).toBe(post.body);
 archive.reconcile("b".repeat(64));expect(archive.page({})).toBeUndefined();
 archive.capture({},page());archive.reconcile(null);expect(archive.page({})).toBeUndefined();expect(archive.capture({},page())).toBe(false);
 archive.reconcile("c".repeat(64));archive.capture({},page());archive.reconcile(undefined);expect(archive.page({})).toBeUndefined();
});
it("bounds exact-page count and isolates query variants",()=>{
 const archive=createPlayerStoryArchive();archive.reconcile("a".repeat(64));
 for(let i=0;i<33;i++)archive.capture({cursor:String(i)},page());
 expect(archive.page({cursor:"0"})).toBeUndefined();expect(archive.page({cursor:"32"})).toBeDefined();expect(archive.page({cursor:"32",era:"other"})).toBeUndefined();
});
