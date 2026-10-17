/** Server limit for drawing points (x/y numbers), see drawingPointsSchema. */
export const TEXTURE_STROKE_MAX_NUMBERS = 4096;

/**
 * UIX-706 pool 3: extends a texture brush stroke. Points closer than a quarter
 * of the brush width add nothing visible, so they are skipped; a stroke that
 * reaches the server limit is split — the caller commits `commit` and keeps
 * painting from `points`, which starts at the last committed point.
 */
export function nextTextureStrokePoints(
  points: number[],
  point: { x: number; y: number },
  brushWidth: number,
): { points: number[]; commit: number[] | null } {
  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];
  if (lastX === undefined || lastY === undefined)
    return { points: [point.x, point.y, point.x, point.y], commit: null };
  const step = Math.max(4, brushWidth / 4);
  if (Math.hypot(point.x - lastX, point.y - lastY) < step)
    return { points, commit: null };
  const next = [...points, point.x, point.y];
  if (next.length < TEXTURE_STROKE_MAX_NUMBERS)
    return { points: next, commit: null };
  return { points: [point.x, point.y, point.x, point.y], commit: next };
}
