import type { StoryPostAdminDto } from "@arken/contracts";
import type { StoryMediaDraft, StoryPostView } from "./StoryChannel";

export function isStoryAdminPost(
  post: StoryPostView,
): post is StoryPostAdminDto {
  return "gmNotes" in post;
}

export function storyPostMedia(post: StoryPostView) {
  return [...post.media]
    .filter((media) => media.mimeType.toLowerCase().startsWith("image/"))
    .sort((left, right) => left.order - right.order);
}

export function canCreateStoryDraft(input: {
  body: string;
  media: readonly Pick<StoryMediaDraft, "contentId">[];
}) {
  return Boolean(input.body.trim() || input.media.length);
}

export function storyPostStatus(post: StoryPostView) {
  if (post.lifecycle === "DRAFT") return "Черновик";
  if (post.lifecycle === "ARCHIVED") return "В архиве";
  if (post.lifecycle === "CORRECTED") return "Исправлено";
  return "Опубликовано";
}
