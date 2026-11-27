import {
  projectIsometricPoint,
  unprojectIsometricPoint,
  type IsometricPoint,
  type IsometricTransform,
} from "@arken/contracts";

export interface IsometricCamera {
  x: number;
  y: number;
  zoom: number;
}

function assertCamera(camera: IsometricCamera) {
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y) ||
      !Number.isFinite(camera.zoom) || camera.zoom <= 0) throw new Error("INVALID_ISOMETRIC_CAMERA");
}

/** Screen hit-testing and drag use the inverse of exactly the rendering matrix. */
export function isometricPointerToFloor(
  transform: IsometricTransform,
  camera: IsometricCamera,
  screen: IsometricPoint,
  floorOffsetY: number,
): IsometricPoint {
  assertCamera(camera);
  return unprojectIsometricPoint(transform, {
    x: (screen.x - camera.x) / camera.zoom,
    y: (screen.y - camera.y) / camera.zoom,
  }, floorOffsetY);
}

export function isometricFloorToPointer(
  transform: IsometricTransform,
  camera: IsometricCamera,
  point: IsometricPoint,
  floorOffsetY: number,
): IsometricPoint {
  assertCamera(camera);
  const projected = projectIsometricPoint(transform, point, floorOffsetY);
  return { x: projected.x * camera.zoom + camera.x, y: projected.y * camera.zoom + camera.y };
}

/** Four distinct neighbours on the diamond, even when screen directions tie. */
export function isometricDirectionalStep(
  transform: IsometricTransform,
  direction: "up" | "down" | "left" | "right",
): IsometricPoint {
  const a = transform.axisX, b = transform.axisY;
  const horizontalA = Math.abs(a.x) / Math.max(1e-12, Math.hypot(a.x, a.y));
  const horizontalB = Math.abs(b.x) / Math.max(1e-12, Math.hypot(b.x, b.y));
  const rightUsesX = horizontalA >= horizontalB;
  const rightAxis = rightUsesX ? a : b;
  const downAxis = rightUsesX ? b : a;
  const rightSign = rightAxis.x >= 0 ? 1 : -1;
  const downSign = downAxis.y >= 0 ? 1 : -1;
  const horizontal = direction === "left" || direction === "right";
  const sign = horizontal ? rightSign * (direction === "left" ? -1 : 1)
    : downSign * (direction === "up" ? -1 : 1);
  const usesX = horizontal ? rightUsesX : !rightUsesX;
  return usesX ? { x: sign, y: 0 } : { x: 0, y: sign };
}

/** Keep billboard sprites upright; only their feet are projected. */
export function isometricBillboardRect(foot: IsometricPoint, width: number, height: number) {
  return { x: foot.x - width / 2, y: foot.y - height, width, height };
}
