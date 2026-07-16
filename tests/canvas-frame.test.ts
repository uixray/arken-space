import { describe, expect, it } from "vitest";
import { fitFrameToWorld } from "../apps/server/src/routes.js";

describe("canvas map frame", () => {
  it("fits an image inside the world while preserving its aspect ratio", () => {
    expect(fitFrameToWorld(1600, 900, 1000, 1000)).toEqual({
      x: 0,
      y: 218.75,
      width: 1000,
      height: 562.5,
    });
    expect(fitFrameToWorld(900, 1600, 1000, 1000)).toEqual({
      x: 218.75,
      y: 0,
      width: 562.5,
      height: 1000,
    });
  });

  it("falls back to the world frame for legacy assets without dimensions", () => {
    expect(fitFrameToWorld(null, null, 1000, 600)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 600,
    });
  });
});
