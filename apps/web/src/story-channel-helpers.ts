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
  if (post.lifecycle === "DRAFT")
    return "\u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a";
  if (post.lifecycle === "ARCHIVED")
    return "\u0412 \u0430\u0440\u0445\u0438\u0432\u0435";
  if (post.lifecycle === "CORRECTED")
    return "\u0418\u0441\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e";
  return "\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u043d\u043e";
}
