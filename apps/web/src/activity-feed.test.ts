import { describe, expect, it } from "vitest";
import type {
  ChatMessageDto,
  ChatThreadDto,
  StoryPostAdminDto,
} from "@arken/contracts";
import { buildActivityFeed, buildActivityTimeline } from "./activity-feed";

const message = (
  id: string,
  stream: "TABLE" | "STORY" | "ROLLS",
  createdAt: string,
  sequence: number,
) =>
  ({
    id,
    stream,
    createdAt,
    sequence,
    threadId: `${stream}-thread`,
  }) as ChatMessageDto;

const storyPost = (
  lifecycle: StoryPostAdminDto["lifecycle"],
  publishedAt: string | null,
) =>
  ({
    id: `post-${lifecycle}`,
    lifecycle,
    publishedAt,
    createdAt: "2026-07-25T10:00:00.000Z",
  }) as StoryPostAdminDto;

describe("buildActivityFeed", () => {
  it("joins authorized public streams chronologically and never projects direct messages", () => {
    const threads = [
      { id: "direct-thread", type: "DIRECT", stream: null },
    ] as ChatThreadDto[];
    const events = buildActivityFeed(
      [
        message("roll", "ROLLS", "2026-07-25T12:00:00.000Z", 3),
        {
          ...message("direct", "TABLE", "2026-07-25T09:00:00.000Z", 1),
          threadId: "direct-thread",
        },
        message("table", "TABLE", "2026-07-25T11:00:00.000Z", 2),
      ],
      threads,
      [
        storyPost("PUBLISHED", "2026-07-25T11:30:00.000Z"),
        storyPost("DRAFT", null),
        storyPost("ARCHIVED", "2026-07-25T11:45:00.000Z"),
      ],
    );
    expect(events.map((event) => event.id)).toEqual([
      "table",
      "post-PUBLISHED",
      "roll",
    ]);
  });

  it("adds stable date separators for the merged activity chronology", () => {
    const timeline = buildActivityTimeline(
      buildActivityFeed([
        message("first", "TABLE", "2026-07-24T12:00:00.000Z", 1),
        message("second", "ROLLS", "2026-07-25T12:00:00.000Z", 2),
      ]),
    );
    expect(timeline.filter((item) => item.type === "DATE")).toHaveLength(2);
    expect(timeline.filter((item) => item.type === "EVENT")).toHaveLength(2);
  });
});
