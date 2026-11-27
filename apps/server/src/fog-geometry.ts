import {
  fogGeometryBounds,
  simplifyFogBrush,
  validateFogPolygon,
  type FogBounds,
  type FogGeometry,
} from "@arken/contracts";
export class FogGeometryError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export function canonicalizeFogGeometry(
  input: FogGeometry,
  scene: { width: number; height: number; x?: number; y?: number },
  legacy = false,
): { geometry: FogGeometry; bbox: FogBounds } {
  let geometry = input;
  const left = scene.x ?? 0, top = scene.y ?? 0;
  const right = left + scene.width, bottom = top + scene.height;
  if (input.type === "BRUSH")
    geometry = {
      ...input,
      points: simplifyFogBrush(input.points, input.radius),
    };
  if (geometry.type === "POLYGON" && !validateFogPolygon(geometry.points))
    throw new FogGeometryError("FOG_POLYGON_INVALID");
  let bbox = fogGeometryBounds(geometry);
  // A brush follows points on the map but its radius naturally crosses the
  // edge. Preserve the full geometric bounds (used by visibility checks).
  if (geometry.type === "BRUSH") {
    if (
      geometry.points.some(
        (point) =>
          point.x < left ||
          point.y < top ||
          point.x > right ||
          point.y > bottom,
      )
    )
      throw new FogGeometryError("FOG_OUTSIDE_SCENE");
    return { geometry, bbox };
  }
  if (legacy && geometry.type === "RECT") {
    const l = Math.max(left, bbox.x),
      t = Math.max(top, bbox.y),
      r = Math.min(right, bbox.x + bbox.width),
      b = Math.min(bottom, bbox.y + bbox.height);
    if (r <= l || b <= t) throw new FogGeometryError("FOG_OUTSIDE_SCENE");
    geometry = { type: "RECT", x: l, y: t, width: r - l, height: b - t };
    bbox = fogGeometryBounds(geometry);
  } else if (
    bbox.x < left ||
    bbox.y < top ||
    bbox.x + bbox.width > right ||
    bbox.y + bbox.height > bottom
  )
    throw new FogGeometryError("FOG_OUTSIDE_SCENE");
  return { geometry, bbox };
}
