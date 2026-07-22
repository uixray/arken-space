import { describe, expect, it } from "vitest";
import {
  chatStreamSchema,
  createChatMessageSchema,
  markChatThreadReadSchema,
} from "../packages/contracts/src/index.js";

describe("chat thread contracts", () => {
  const actionId = "00000000-0000-4000-8000-000000000001";
  const threadId = "00000000-0000-4000-8000-000000000002";

  it("exposes exactly the fixed campaign streams", () => {
    expect(chatStreamSchema.options).toEqual(["ROLLS", "STORY", "TABLE"]);
    expect(chatStreamSchema.safeParse("PRIVATE").success).toBe(false);
  });

  it("keeps ordinary messages backward compatible with the TABLE stream", () => {
    expect(
      createChatMessageSchema.parse({ actionId, body: "Hello" }),
    ).toMatchObject({
      stream: "TABLE",
    });
    expect(
      createChatMessageSchema.parse({ actionId, body: "Scene", threadId }),
    ).toMatchObject({ threadId });
    expect(
      createChatMessageSchema.safeParse({
        actionId,
        body: "Ambiguous",
        threadId,
        stream: "STORY",
      }).success,
    ).toBe(false);
  });

  it("marks a durable thread read at a non-negative sequence", () => {
    expect(markChatThreadReadSchema.parse({ threadId, sequence: 42 })).toEqual({
      threadId,
      sequence: 42,
    });
    expect(
      markChatThreadReadSchema.safeParse({ threadId, sequence: -1 }).success,
    ).toBe(false);
  });
});
