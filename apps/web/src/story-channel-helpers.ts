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

/**
 * UIX-245: поле «День кампании». Пусто — `null` (у формы создания это «текущий
 * день», у правки — «вне хронологии»); `undefined` — ввод неверный.
 */
export function parseStoryWorldDay(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const day = Number(trimmed);
  return day >= 1 && day <= 1_000_000 ? day : undefined;
}

/** UIX-245: «День 12 · Эпоха пепла»; пустая строка — без игрового времени. */
export function storyWorldTimeLabel(post: StoryPostView) {
  // `== null`: старые записи и ответы без поля тоже идут как «без дня».
  const day = post.worldDay == null ? "" : `День ${post.worldDay}`;
  return [day, post.era ?? ""].filter(Boolean).join(" \u00b7 ");
}
