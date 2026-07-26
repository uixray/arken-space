import type {
  ChatMessageDto,
  ChatThreadDto,
  StoryPostAdminDto,
  StoryPostDto,
} from "@arken/contracts";

export type ActivityStoryPost = StoryPostDto | StoryPostAdminDto;

export type ActivityEvent =
  | {
      type: "MESSAGE";
      id: string;
      occurredAt: string;
      stream: "TABLE" | "STORY" | "ROLLS";
      message: ChatMessageDto;
    }
  | {
      type: "STORY_POST";
      id: string;
      occurredAt: string;
      post: ActivityStoryPost;
    };

export type ActivityTimelineItem =
  | { type: "DATE"; key: string; label: string }
  | { type: "EVENT"; event: ActivityEvent };

function isPublishedStoryPost(post: ActivityStoryPost) {
  return post.lifecycle === "PUBLISHED" || post.lifecycle === "CORRECTED";
}

function eventTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return [date.getFullYear(), date.getMonth(), date.getDate()].join("-");
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return "Без даты";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(date);
}

/**
 * The activity feed only joins server-authorized, non-direct records. Story
 * drafts and archived posts intentionally stay in the dedicated GM editor.
 */
export function buildActivityFeed(
  messages: readonly ChatMessageDto[],
  threads: readonly ChatThreadDto[] = [],
  posts: readonly ActivityStoryPost[] = [],
): ActivityEvent[] {
  const directThreadIds = new Set(
    threads
      .filter((thread) => thread.type === "DIRECT")
      .map((thread) => thread.id),
  );
  const messageEvents: ActivityEvent[] = messages
    .filter((message) => !directThreadIds.has(message.threadId))
    .map((message) => ({
      type: "MESSAGE",
      id: message.id,
      occurredAt: message.createdAt,
      stream: (message.stream ?? "TABLE") as "TABLE" | "STORY" | "ROLLS",
      message,
    }));
  const storyEvents: ActivityEvent[] = posts
    .filter(isPublishedStoryPost)
    .map((post) => ({
      type: "STORY_POST",
      id: post.id,
      occurredAt: post.publishedAt ?? post.createdAt,
      post,
    }));

  return [...messageEvents, ...storyEvents].sort((left, right) => {
    const timeDelta =
      eventTimestamp(left.occurredAt) - eventTimestamp(right.occurredAt);
    if (timeDelta !== 0) return timeDelta;
    if (left.type === "MESSAGE" && right.type === "MESSAGE")
      return left.message.sequence - right.message.sequence;
    return left.id.localeCompare(right.id);
  });
}

export function buildActivityTimeline(
  events: readonly ActivityEvent[],
): ActivityTimelineItem[] {
  const timeline: ActivityTimelineItem[] = [];
  let previousDate: string | null = null;
  for (const event of events) {
    const key = dateKey(event.occurredAt);
    if (key !== previousDate) {
      timeline.push({ type: "DATE", key, label: dateLabel(event.occurredAt) });
      previousDate = key;
    }
    timeline.push({ type: "EVENT", event });
  }
  return timeline;
}
