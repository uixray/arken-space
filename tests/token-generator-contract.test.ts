import { describe, expect, it } from "vitest";
import {
  generateTokenAssetSchema,
  tokenFramePresetSchema,
} from "../packages/contracts/src/index.js";

describe("UIX-255 token generator contract", () => {
  it("accepts only the bounded transform and owned frame presets", () => {
    expect(
      generateTokenAssetSchema.parse({
        cropX: 0,
        cropY: 1,
        zoom: 8,
        frame: "OBSIDIAN",
        name: "The Gatekeeper",
      }),
    ).toEqual({
      cropX: 0,
      cropY: 1,
      zoom: 8,
      frame: "OBSIDIAN",
      name: "The Gatekeeper",
    });
    expect(tokenFramePresetSchema.options).toEqual([
      "NONE",
      "BRONZE",
      "SILVER",
      "OBSIDIAN",
    ]);
  });

  it.each([
    { cropX: -0.01, cropY: 0.5, zoom: 1, frame: "NONE" },
    { cropX: 0.5, cropY: 1.01, zoom: 1, frame: "NONE" },
    { cropX: 0.5, cropY: 0.5, zoom: 0.99, frame: "NONE" },
    { cropX: 0.5, cropY: 0.5, zoom: 8.01, frame: "NONE" },
    { cropX: 0.5, cropY: 0.5, zoom: 1, frame: "GOLD" },
    { cropX: 0.5, cropY: 0.5, zoom: 1, frame: "NONE", extra: true },
  ])("rejects an invalid or expanded transform: %j", (input) => {
    expect(generateTokenAssetSchema.safeParse(input).success).toBe(false);
  });
});
