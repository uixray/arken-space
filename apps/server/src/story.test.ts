import { describe, expect, it } from "vitest";
import { isPlayerVisible, mergedContent } from "./story.js";

const post = (lifecycle: string, visibility: string) => ({
  title: "",
  body: "A story",
  entityLinks: [],
  lifecycle,
  visibility,
});

const media = [
  {
    contentId: "10000000-0000-4000-8000-000000000001",
    order: 0,
    altText: "Gate at dawn",
    caption: "",
  },
];

describe("story post policy", () => {
  it("projects only current public published/corrected posts to players", () => {
    expect(isPlayerVisible(post("DRAFT", "GM_ONLY") as never)).toBe(false);
    expect(isPlayerVisible(post("ARCHIVED", "GM_ONLY") as never)).toBe(false);
    expect(isPlayerVisible(post("PUBLISHED", "PUBLIC") as never)).toBe(true);
    expect(isPlayerVisible(post("CORRECTED", "PUBLIC") as never)).toBe(true);
    expect(isPlayerVisible(post("PUBLISHED", "GM_ONLY") as never)).toBe(false);
  });

  it("validates the merged update snapshot rather than accepting an empty patch result", () => {
    expect(() =>
      mergedContent(
        { ...post("DRAFT", "GM_ONLY"), body: "" } as never,
        { body: "", media: [] },
        [],
      ),
    ).toThrow("STORY_POST_EMPTY");

    expect(
      mergedContent(
        post("DRAFT", "GM_ONLY") as never,
        { title: "Updated" },
        media,
      ),
    ).toMatchObject({ title: "Updated", body: "A story", media });
  });

  it("rejects duplicate media and entity links after merging", () => {
    expect(() =>
      mergedContent(
        post("DRAFT", "GM_ONLY") as never,
        {
          media: [
            media[0]!,
            {
              ...media[0]!,
              contentId: "10000000-0000-4000-8000-000000000002",
            },
          ],
        },
        media,
      ),
    ).toThrow("STORY_MEDIA_INVALID");
    expect(() =>
      mergedContent(
        post("DRAFT", "GM_ONLY") as never,
        {
          entityLinks: [
            { kind: "SCENE", entityId: "10000000-0000-4000-8000-000000000003" },
            { kind: "SCENE", entityId: "10000000-0000-4000-8000-000000000003" },
          ],
        },
        media,
      ),
    ).toThrow("STORY_LINKS_INVALID");
  });
});
