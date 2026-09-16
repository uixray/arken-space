import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOKEN_IMAGE_TRANSFORM,
  clampTokenImageTransform,
  nudgeTokenImageTransform,
  tokenImageTransformForKey,
} from "./token-image-editor-state";

describe("token image editor state", () => {
  it("keeps a square crop inside the source at every zoom", () => {
    expect(
      clampTokenImageTransform({
        zoom: 99,
        cropX: -5,
        cropY: 5,
        frame: "SILVER",
      }),
    ).toEqual({ zoom: 8, cropX: 0.0625, cropY: 0.9375, frame: "SILVER" });
    expect(
      clampTokenImageTransform({
        ...DEFAULT_TOKEN_IMAGE_TRANSFORM,
        cropX: 0,
        cropY: 1,
      }),
    ).toMatchObject({ cropX: 0.5, cropY: 0.5 });
  });

  it("uses the server's floored square crop for aspect-aware bounds", () => {
    const edge = { zoom: 1, cropX: 0, cropY: 1, frame: "NONE" } as const;
    // A 1200x800 landscape can pan horizontally at zoom 1, but its full
    // short axis leaves no vertical travel.
    expect(
      clampTokenImageTransform(edge, { width: 1200, height: 800 }),
    ).toEqual({
      zoom: 1,
      cropX: 1 / 3,
      cropY: 0.5,
      frame: "NONE",
    });
    // The same square crop reverses those axes for a portrait.
    const portrait = clampTokenImageTransform(edge, {
      width: 800,
      height: 1200,
    });
    expect(portrait).toMatchObject({
      zoom: 1,
      cropX: 0.5,
      frame: "NONE",
    });
    expect(portrait.cropY).toBeCloseTo(2 / 3, 14);
    expect(Math.round(portrait.cropY * 1200 - 800 / 2)).toBe(400);
    // Default callers retain the legacy square-source boundary.
    expect(clampTokenImageTransform(edge)).toMatchObject({
      cropX: 0.5,
      cropY: 0.5,
    });
  });

  it("nudges the focal point without changing visual options", () => {
    expect(
      nudgeTokenImageTransform(
        { zoom: 2, cropX: 0.5, cropY: 0.5, frame: "BRONZE" },
        1,
        -1,
      ),
    ).toEqual({ zoom: 2, cropX: 0.51, cropY: 0.49, frame: "BRONZE" });
  });

  it("uses one-percent arrow nudges, ten-percent Shift nudges, and reset", () => {
    const transform = {
      zoom: 2,
      cropX: 0.5,
      cropY: 0.5,
      frame: "OBSIDIAN",
    } as const;
    expect(tokenImageTransformForKey(transform, "ArrowLeft")).toMatchObject({
      cropX: 0.49,
      cropY: 0.5,
    });
    expect(
      tokenImageTransformForKey(transform, "ArrowLeft", true),
    ).toMatchObject({
      cropX: 0.4,
      cropY: 0.5,
    });
    expect(tokenImageTransformForKey(transform, "r")).toEqual(
      DEFAULT_TOKEN_IMAGE_TRANSFORM,
    );
    expect(
      tokenImageTransformForKey(DEFAULT_TOKEN_IMAGE_TRANSFORM, "Enter"),
    ).toBeNull();
  });
});
