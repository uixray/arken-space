import { describe, expect, it } from "vitest";
import type { StoryPostAdminDto } from "@arken/contracts";
import {
  canCreateStoryDraft,
  isStoryAdminPost,
  storyPostMedia,
  storyPostStatus,
} from "./story-channel-helpers";

const post: StoryPostAdminDto = {
  id: "00000000-0000-4000-8000-000000000001",
  threadId: "00000000-0000-4000-8000-000000000002",
  authorMembershipId: "00000000-0000-4000-8000-000000000003",
  title: "xxxxx",
  body: "xx xxxxxxxxx xxxxxxxxxx xxxxx.",
  lifecycle: "DRAFT",
  revision: 1,
  entityLinks: [],
  media: [
    {
      contentId: "00000000-0000-4000-8000-000000000004",
      order: 1,
      altText: "xxxxx",
      caption: "x xxxx",
      fileName: "tower.webp",
      mimeType: "image/webp",
      sizeBytes: 42,
      width: 640,
      height: 480,
      createdAt: "2026-07-24T12:00:00.000Z",
    },
    {
      contentId: "00000000-0000-4000-8000-000000000005",
      order: 0,
      altText: "xxxx",
      caption: "",
      fileName: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 42,
      width: null,
      height: null,
      createdAt: "2026-07-24T12:00:00.000Z",
    },
  ],
  publishedAt: null,
  correctedAt: null,
  createdAt: "2026-07-24T12:00:00.000Z",
  updatedAt: "2026-07-24T12:00:00.000Z",
  archivedAt: null,
  gmNotes: "xxxxxxxxx xxxxx",
};

describe("StoryChannel helpers", () => {
  it("keeps GM-only lifecycle metadata behind the admin type guard", () => {
    expect(isStoryAdminPost(post)).toBe(true);
    expect(storyPostStatus(post)).toBe(
      "\u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a",
    );
  });

  it("renders image media in explicit order only", () => {
    expect(storyPostMedia(post).map((item) => item.contentId)).toEqual([
      "00000000-0000-4000-8000-000000000004",
    ]);
  });

  it("requires body or media before a draft can be created", () => {
    expect(canCreateStoryDraft({ body: "", media: [] })).toBe(false);
    expect(canCreateStoryDraft({ body: "xxxxx", media: [] })).toBe(true);
    expect(
      canCreateStoryDraft({
        body: "",
        media: [{ contentId: "x" }],
      }),
    ).toBe(true);
  });
});
