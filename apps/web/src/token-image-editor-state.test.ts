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
