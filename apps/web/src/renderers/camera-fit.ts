/**
 * Pure camera-fit math shared by the "fit whole scene" button and the
 * UIX-311 SCENE_REGION camera-focus hint.
 *
 * Extracted from Orthographic2DRenderer's `fitMap` so both call sites use
 * the exact same scale/position formula: `fitMap` is just `fitRect` fed the
 * full scene bounds ({x:0, y:0, width: scene.width, height: scene.height}).
 */

export interface CameraFitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraFitViewport {
  width: number;
  height: number;
}

export interface CameraFitResult {
  scale: number;
  position: { x: number; y: number };
}

/** Matches the clamp + breathing-room margin already used by fitMap. */
export const CAMERA_MIN_SCALE = 0.25;
export const CAMERA_MAX_SCALE = 3;
export const CAMERA_FIT_PADDING = 0.92;

/** Pan without changing zoom so the center of a token lands at viewport center. */
export function centerRectAtScale(
  rect: CameraFitRect,
  viewport: CameraFitViewport,
  scale: number,
): CameraFitResult["position"] {
  return {
    x: viewport.width / 2 - (rect.x + rect.width / 2) * scale,
    y: viewport.height / 2 - (rect.y + rect.height / 2) * scale,
  };
}

/**
 * Computes the scale + position that centers and fits `rect` (world
 * coordinates) inside `viewport` (screen pixels), clamped to the same
 * zoom bounds as manual zoom/pan. Each client should call this with its
 * own viewport size — the result is never meant to be shared/broadcast,
 * only the source rect is.
 */
export function fitRect(
  rect: CameraFitRect,
  viewport: CameraFitViewport,
): CameraFitResult {
  const scale = Math.min(
    CAMERA_MAX_SCALE,
    Math.max(
      CAMERA_MIN_SCALE,
      Math.min(viewport.width / rect.width, viewport.height / rect.height) *
        CAMERA_FIT_PADDING,
    ),
  );
  return {
    scale,
    position: centerRectAtScale(rect, viewport, scale),
  };
}
