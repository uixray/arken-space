import {storyLinkTargetsFor} from "./story-links.js";
import {createHash} from "node:crypto";
import {and,eq,or} from "drizzle-orm";
import {storyPostMedia,storyPosts,chatAttachmentUploads} from "@arken/db";
import type {AuthContext} from "./auth.js";
type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];
/** Shared HTTP/peer ACL: PLAYER sees only current published public revisions. */
export async function resolveReadableStoryMedia(db:Database,auth:AuthContext,contentId:string){
    const playerVisibility =
      auth.role === "GM"
        ? undefined
        : and(
            eq(storyPostMedia.revision, storyPosts.revision),
            eq(storyPosts.visibility, "PUBLIC"),
            or(
              eq(storyPosts.lifecycle, "PUBLISHED"),
              eq(storyPosts.lifecycle, "CORRECTED"),
            ),
          );
    const rows = await db
      .select({
        media: storyPostMedia,
        post: storyPosts,
        upload: chatAttachmentUploads,
      })
      .from(storyPostMedia)
      .innerJoin(
        storyPosts,
        and(
          eq(storyPosts.campaignId, storyPostMedia.campaignId),
          eq(storyPosts.id, storyPostMedia.postId),
        ),
      )
      .innerJoin(
        chatAttachmentUploads,
        and(
          eq(chatAttachmentUploads.campaignId, storyPostMedia.campaignId),
          eq(chatAttachmentUploads.contentId, storyPostMedia.contentId),
        ),
      )
      .where(
        and(
          eq(storyPostMedia.campaignId, auth.campaignId),
          eq(storyPostMedia.contentId, contentId),
          playerVisibility,
        ),
      )
      .limit(1);
    const item = rows[0];
    return item?.upload ?? null;
}

/** Bounded public inventory fingerprint. null explicitly disables archive retention
 * on an oversized library; it must never mean a known-empty archive. */
export async function readPlayerStoryFingerprint(db:Database,auth:AuthContext):Promise<string|null>{
 const rows=await db.select({id:storyPosts.id,revision:storyPosts.revision,updatedAt:storyPosts.updatedAt,entityLinks:storyPosts.entityLinks})
  .from(storyPosts).where(and(eq(storyPosts.campaignId,auth.campaignId),eq(storyPosts.visibility,"PUBLIC"),or(eq(storyPosts.lifecycle,"PUBLISHED"),eq(storyPosts.lifecycle,"CORRECTED"))))
  .orderBy(storyPosts.id).limit(10001);
 if(rows.length>10000)return null;
 const targets=await storyLinkTargetsFor(db,{...auth,role:"PLAYER"},rows);
 return createHash("sha256").update(JSON.stringify(rows.map(row=>({...row,linkTargets:targets.get(row.id)??[]})))).digest("hex");
}
