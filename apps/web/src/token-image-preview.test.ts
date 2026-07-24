import { describe, expect, it } from "vitest";
import { resolveTokenImagePreviewCrop } from "./token-image-preview";

describe("token image preview crop", () => {
  it("matches a centered landscape square crop", () => {
    const crop = resolveTokenImagePreviewCrop({
      width: 1600,
      height: 900,
      cropX: 0.5,
      cropY: 0.5,
      zoom: 1,
    });
    expect(crop.cropSize).toBe(900);
    expect(crop.left).toBe(350);
    expect(crop.top).toBe(0);
    expect(crop.imageWidthPercent).toBeCloseTo(177.7778);
    expect(crop.imageLeftPercent).toBeCloseTo(-38.8889);
  });

  it("matches a centered portrait square crop", () => {
    const crop = resolveTokenImagePreviewCrop({
      width: 900,
      height: 1600,
      cropX: 0.5,
      cropY: 0.5,
      zoom: 1,
    });
    expect(crop.left).toBe(0);
    expect(crop.top).toBe(350);
    expect(crop.imageHeightPercent).toBeCloseTo(177.7778);
    expect(crop.imageTopPercent).toBeCloseTo(-38.8889);
  });

  it("clamps an edge crop exactly as the server does", () => {
    const crop = resolveTokenImagePreviewCrop({
      width: 1600,
      height: 900,
      cropX: 0,
      cropY: 1,
      zoom: 2,
    });
    expect(crop.cropSize).toBe(450);
    expect(crop.left).toBe(0);
    expect(crop.top).toBe(450);
    expect(crop.imageLeftPercent).toBe(0);
    expect(crop.imageTopPercent).toBe(-100);
  });

  it("scales the crop dimensions with zoom", () => {
    expect(
      resolveTokenImagePreviewCrop({
        width: 1200,
        height: 800,
        cropX: 0.5,
        cropY: 0.5,
        zoom: 4,
      }),
    ).toMatchObject({
      cropSize: 200,
      imageWidthPercent: 600,
      imageHeightPercent: 400,
    });
  });
});
