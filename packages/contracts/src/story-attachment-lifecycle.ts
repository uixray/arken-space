import { z } from "zod";

export const storyAttachmentListItemSchema = z.object({
  contentId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  status: z.enum(["STAGED", "CLAIMED", "EXPIRED"]),
  storyRevisionCount: z.number().int().nonnegative(),
  storyReferences: z.array(
    z.object({
      postId: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      title: z.string(),
      lifecycle: z.enum(["DRAFT", "PUBLISHED", "CORRECTED", "ARCHIVED"]),
      visibility: z.enum(["PUBLIC", "GM_ONLY"]),
      isCurrent: z.boolean(),
    }),
  ),
  directChatReferenceCount: z.number().int().nonnegative(),
  cleanupPending: z.boolean(),
});
export const storyAttachmentListSchema = z.object({
  attachments: z.array(storyAttachmentListItemSchema),
});
export const storyAttachmentDeleteSchema = z.object({
  actionId: z.string().uuid(),
});
export type StoryAttachmentListItem = z.infer<
  typeof storyAttachmentListItemSchema
>;
