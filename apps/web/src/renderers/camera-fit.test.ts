import { describe, expect, it } from "vitest";
import {
  CAMERA_MAX_SCALE,
  CAMERA_MIN_SCALE,
  fitRect,
  type CameraFitRect,
} from "./camera-fit";

describe("fitRect", () => {
  it("identity case: region equal to the full scene matches fitMap's own math", () => {
    const rect: CameraFitRect = { x: 0, y: 0, width: 1600, height: 1200 };
    const viewport = { width: 1200, height: 800 };
    const result = fitRect(rect, viewport);

    // Same formula fitMap used before extraction: min(vw/w, vh/h) * 0.92,
    // clamped, then centered via (viewport - scaledRect) / 2.
    const expectedScale = Math.min(1200 / 1600, 800 / 1200) * 0.92;
    expect(result.scale).toBeCloseTo(expectedScale, 10);
    expect(result.position.x).toBeCloseTo(
      (viewport.width - rect.width * expectedScale) / 2,
      10,
    );
    expect(result.position.y).toBeCloseTo(
      (viewport.height - rect.height * expectedScale) / 2,
      10,
    );
  });

  it("centers and scales a sub-region within the scene", () => {
    const rect: CameraFitRect = { x: 400, y: 300, width: 400, height: 300 };
    const viewport = { width: 1000, height: 800 };
    const result = fitRect(rect, viewport);

    const expectedScale = Math.min(1000 / 400, 800 / 300) * 0.92;
    expect(result.scale).toBeCloseTo(expectedScale, 10);

    // The region's center (600, 450) should land at the viewport's center.
    const screenCenterX = result.position.x + 600 * result.scale;
    const screenCenterY = result.position.y + 450 * result.scale;
    expect(screenCenterX).toBeCloseTo(viewport.width / 2, 6);
    expect(screenCenterY).toBeCloseTo(viewport.height / 2, 6);
  });

  it("clamps extremely wide aspect ratios to the max scale bound", () => {
    const rect: CameraFitRect = { x: 0, y: 0, width: 10, height: 5 };
    const viewport = { width: 1200, height: 800 };
    const result = fitRect(rect, viewport);
    expect(result.scale).toBe(CAMERA_MAX_SCALE);
  });

  it("clamps extremely tall/narrow regions to the max scale bound", () => {
    const rect: CameraFitRect = { x: 0, y: 0, width: 5, height: 10 };
    const viewport = { width: 1200, height: 800 };
    const result = fitRect(rect, viewport);
    expect(result.scale).toBe(CAMERA_MAX_SCALE);
  });

  it("clamps huge regions relative to viewport to the min scale bound", () => {
    const rect: CameraFitRect = { x: 0, y: 0, width: 100000, height: 100000 };
    const viewport = { width: 1200, height: 800 };
    const result = fitRect(rect, viewport);
    expect(result.scale).toBe(CAMERA_MIN_SCALE);
  });

  it("centers a region near the scene's top-left edge (near-zero coordinates)", () => {
    const rect: CameraFitRect = { x: 0, y: 0, width: 200, height: 150 };
    const viewport = { width: 1000, height: 800 };
    const result = fitRect(rect, viewport);
    const screenCenterX = result.position.x + 100 * result.scale;
    const screenCenterY = result.position.y + 75 * result.scale;
    expect(screenCenterX).toBeCloseTo(viewport.width / 2, 6);
    expect(screenCenterY).toBeCloseTo(viewport.height / 2, 6);
  });

  it("centers a region near the scene's bottom-right edge (large offsets)", () => {
    const scene = { width: 2000, height: 1500 };
    const rect: CameraFitRect = {
      x: scene.width - 300,
      y: scene.height - 200,
      width: 300,
      height: 200,
    };
    const viewport = { width: 1000, height: 800 };
    const result = fitRect(rect, viewport);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const screenCenterX = result.position.x + centerX * result.scale;
    const screenCenterY = result.position.y + centerY * result.scale;
    expect(screenCenterX).toBeCloseTo(viewport.width / 2, 6);
    expect(screenCenterY).toBeCloseTo(viewport.height / 2, 6);
  });
});
