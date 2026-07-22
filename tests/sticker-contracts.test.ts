import { describe, expect, it } from "vitest";
import {
  createStickerMessageSchema,
  stickerPresentationSchema,
} from "../packages/contracts/src/index.js";
const actionId = "10000000-0000-4000-8000-000000000001",
  stickerId = "10000000-0000-4000-8000-000000000002",
  threadId = "10000000-0000-4000-8000-000000000003";
describe("sticker contracts", () => {
  it("accepts only a sticker catalog id and exactly one destination", () => {
    expect(
      createStickerMessageSchema.parse({ actionId, stickerId, threadId }),
    ).toEqual({ actionId, stickerId, threadId });
    expect(
      createStickerMessageSchema.parse({
        actionId,
        stickerId,
        stream: "TABLE",
      }),
    ).toEqual({ actionId, stickerId, stream: "TABLE" });
    expect(
      createStickerMessageSchema.safeParse({
        actionId,
        stickerId,
        threadId,
        assetId: stickerId,
      }).success,
    ).toBe(false);
    expect(
      createStickerMessageSchema.safeParse({
        actionId,
        stickerId,
        threadId,
        stream: "TABLE",
      }).success,
    ).toBe(false);
    expect(
      createStickerMessageSchema.safeParse({ actionId, stickerId }).success,
    ).toBe(false);
    expect(
      createStickerMessageSchema.safeParse({
        actionId,
        stickerId,
        stream: "ROLLS",
      }).success,
    ).toBe(false);
  });
  it("bounds immutable presentation fields", () => {
    expect(
      stickerPresentationSchema.safeParse({
        name: "Wave",
        altText: "waves",
        assetUrl: "/assets/safe",
        width: 128,
        height: 128,
      }).success,
    ).toBe(true);
    expect(
      stickerPresentationSchema.safeParse({
        name: "",
        altText: "x",
        assetUrl: "/x",
        width: 128,
        height: 128,
      }).success,
    ).toBe(false);
    expect(
      stickerPresentationSchema.safeParse({
        name: "x",
        altText: "x",
        assetUrl: "/x",
        width: 0,
        height: 128,
      }).success,
    ).toBe(false);
  });
});
