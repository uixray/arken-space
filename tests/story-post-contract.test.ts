import { describe, expect, it } from "vitest";
import {
  createStoryPostSchema,
  dryRunTelegramStoryImportSchema,
  listStoryPostsSchema,
  storyPostLifecycleSchema,
  updateStoryPostSchema,
} from "../packages/contracts/src/index.js";

const actionId = "10000000-0000-4000-8000-000000000001";
const postId = "10000000-0000-4000-8000-000000000002";
const contentId = "10000000-0000-4000-8000-000000000003";
const locationId = "10000000-0000-4000-8000-000000000004";

describe("story post contracts", () => {
  it("keeps the review lifecycle explicit", () => {
    expect(storyPostLifecycleSchema.options).toEqual([
      "DRAFT",
      "PUBLISHED",
      "CORRECTED",
      "ARCHIVED",
    ]);
    expect(storyPostLifecycleSchema.safeParse("DELETED").success).toBe(false);
  });

  it("requires narrative content or media, with accessible, ordered media", () => {
    expect(
      createStoryPostSchema.safeParse({ actionId, body: "", media: [] }).success,
    ).toBe(false);

    const result = createStoryPostSchema.parse({
      actionId,
      body: "Врата открылись.",
      entityLinks: [{ kind: "LOCATION", entityId: locationId }],
      media: [
        {
          contentId,
          order: 0,
          altText: "Каменные врата на рассвете",
          caption: "Путь в крепость",
        },
      ],
    });
    expect(result.gmNotes).toBe("");
    expect(result.media[0]?.altText).toBe("Каменные врата на рассвете");
    expect(result.entityLinks).toHaveLength(1);
  });

  it("rejects duplicate media placement and entity references", () => {
    const common = {
      actionId,
      body: "Запись",
      media: [
        { contentId, order: 0, altText: "Первое" },
        {
          contentId: "10000000-0000-4000-8000-000000000005",
          order: 0,
          altText: "Второе",
        },
      ],
    };
    expect(createStoryPostSchema.safeParse(common).success).toBe(false);
    expect(
      createStoryPostSchema.safeParse({
        actionId,
        body: "Запись",
        entityLinks: [
          { kind: "LOCATION", entityId: locationId },
          { kind: "LOCATION", entityId: locationId },
        ],
      }).success,
    ).toBe(false);
  });

  it("makes updates explicit CAS commands rather than accepting an empty patch", () => {
    expect(
      updateStoryPostSchema.safeParse({
        actionId,
        postId,
        revision: 2,
      }).success,
    ).toBe(false);
    expect(
      updateStoryPostSchema.parse({
        actionId,
        postId,
        revision: 2,
        gmNotes: "Уточнить права на иллюстрацию",
      }),
    ).toMatchObject({ revision: 2 });
  });

  it("accepts only bounded, local review-first Telegram import input", () => {
    const record = {
      sourceMessageId: "telegram-42",
      sourceAuthor: "Эд",
      sourceTimestamp: "2026-07-24T05:00:00.000Z",
      body: "Архивная запись",
      media: [{ sourceMediaId: "photo-7", order: 0, caption: "Архив" }],
    };
    expect(
      dryRunTelegramStoryImportSchema.parse({ actionId, records: [record] }),
    ).toMatchObject({ records: [expect.objectContaining(record)] });
    expect(
      dryRunTelegramStoryImportSchema.safeParse({
        actionId,
        records: [record, { ...record, body: "Повтор" }],
      }).success,
    ).toBe(false);
  });

  it("uses an opaque cursor for independent story pagination", () => {
    expect(listStoryPostsSchema.parse({})).toEqual({ limit: 20 });
    expect(listStoryPostsSchema.parse({ cursor: "opaque-cursor", limit: "50" })).toEqual({
      cursor: "opaque-cursor",
      limit: 50,
    });
    expect(listStoryPostsSchema.safeParse({ cursor: "" }).success).toBe(false);
    expect(listStoryPostsSchema.safeParse({ limit: 51 }).success).toBe(false);
  });
});
