import { z } from "zod";

/** Coordinates here are cells on the logical floor, never image pixels. */
const coordinate = z.number().finite().min(-100000).max(100000);
const pointSchema = z.object({ x: coordinate, y: coordinate }).strict();
const cellSchema = z.object({
  x: z.number().int().min(-100000).max(100000),
  y: z.number().int().min(-100000).max(100000),
}).strict();

export const isometricTransformSchema = z.object({
  origin: pointSchema,
  axisX: pointSchema,
  axisY: pointSchema,
}).strict().refine(value => {
  const { axisX: a, axisY: b } = value;
  const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  return lengths >= 1 && Math.abs(a.x * b.y - a.y * b.x) / lengths >= 0.01;
}, { message: "Calibration must contain two independent floor axes" });

export const isometricFloorSchema = z.object({
  /** Player DTO hint only; server ACL always resolves null against floors[0]. */
  legacyNullLevel: z.boolean().optional(),
  id: z.string().uuid(),
  /** Display name is GM metadata; do not include it in a player geometry packet. */
  name: z.string().trim().min(1).max(80),
  elevationMeters: z.number().finite().min(-10000).max(10000),
  screenOffsetY: coordinate,
  bounds: z.object({
    x: z.number().int().min(-10000).max(10000),
    y: z.number().int().min(-10000).max(10000),
    width: z.number().int().min(1).max(1024),
    height: z.number().int().min(1).max(1024),
  }).strict(),
  blocked: z.array(cellSchema).max(16384),
}).strict();

export const isometricTransitionSchema = z.object({
  id: z.string().uuid(),
  from: cellSchema.extend({ floorId: z.string().uuid() }).strict(),
  to: cellSchema.extend({ floorId: z.string().uuid() }).strict(),
  bidirectional: z.boolean(),
}).strict();

export const isometricOccluderSchema = z.object({
  id: z.string().uuid(),
  floorId: z.string().uuid(),
  /** Source-image pixel polygon, clipped from the same background, not a URL. */
  polygon: z.array(pointSchema).min(3).max(64),
  /** Projected foot depth, relative to the scene image. */
  baselineY: coordinate,
}).strict();

export const isometricSceneGeometrySchema = z.object({
  version: z.literal(1),
  publishedFloorId: z.string().uuid().optional(),
  transform: isometricTransformSchema,
  metersPerCell: z.number().finite().positive().max(1000000),
  floors: z.array(isometricFloorSchema).min(1).max(16),
  transitions: z.array(isometricTransitionSchema).max(512),
  occluders: z.array(isometricOccluderSchema).max(512),
}).strict().superRefine((value, context) => {
  const floors = new Map(value.floors.map(floor => [floor.id, floor]));
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (value.publishedFloorId && !floors.has(value.publishedFloorId)) issue("Unknown published floor");
  if (floors.size !== value.floors.length) issue("Duplicate floor ID");
  if (new Set(value.transitions.map(item => item.id)).size !== value.transitions.length) issue("Duplicate transition ID");
  if (new Set(value.occluders.map(item => item.id)).size !== value.occluders.length) issue("Duplicate occluder ID");
  for (const floor of value.floors) {
    const cells = new Set<string>();
    for (const cell of floor.blocked) {
      const key = `${cell.x},${cell.y}`;
      if (cells.has(key) || !insideFloor(floor, cell)) issue("Invalid or duplicate blocked cell");
      cells.add(key);
    }
  }
  for (const transition of value.transitions) {
    if (transition.from.floorId === transition.to.floorId) issue("A transition must connect different floors");
    for (const endpoint of [transition.from, transition.to]) {
      const floor = floors.get(endpoint.floorId);
      if (!floor || !walkableCell(floor, endpoint)) issue("Transition endpoint must be walkable");
    }
  }
  for (const occluder of value.occluders) {
    if (!floors.has(occluder.floorId)) issue("Unknown occluder floor");
  }
});

export type IsometricPoint = z.infer<typeof pointSchema>;
export type IsometricTransform = z.infer<typeof isometricTransformSchema>;
export type IsometricFloor = z.infer<typeof isometricFloorSchema>;
export type IsometricSceneGeometry = z.infer<typeof isometricSceneGeometrySchema>;
export type IsometricPlacement = IsometricPoint & { floorId: string };

export function isometricFloorId(geometry: IsometricSceneGeometry, levelId: string | null | undefined): string {
  return levelId ?? geometry.floors[0]!.id;
}
export function isometricPublishedFloor(geometry: IsometricSceneGeometry): string {
  return geometry.publishedFloorId ?? geometry.floors[0]!.id;
}
export function isometricPlayerGeometry(geometry: IsometricSceneGeometry): IsometricSceneGeometry {
  const published = isometricPublishedFloor(geometry);
  return { ...geometry, publishedFloorId: published,
    floors: geometry.floors.filter(f => f.id === published).map(f => ({ ...f, name: "Ярус", blocked: [], legacyNullLevel: f.id === geometry.floors[0]!.id })),
    transitions: [], occluders: geometry.occluders.filter(o => o.floorId === published),
  };
}

export function insideFloor(floor: IsometricFloor, point: IsometricPoint): boolean {
  const b = floor.bounds;
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= b.x &&
    point.y >= b.y && point.x < b.x + b.width && point.y < b.y + b.height;
}

function walkableCell(floor: IsometricFloor, cell: IsometricPoint): boolean {
  return insideFloor(floor, cell) && !floor.blocked.some(item => item.x === cell.x && item.y === cell.y);
}

/** Only screen projection changes with height; the saved floor coordinates do not. */
export function projectIsometricPoint(
  transform: IsometricTransform, point: IsometricPoint, screenOffsetY = 0,
): IsometricPoint {
  return {
    x: transform.origin.x + transform.axisX.x * point.x + transform.axisY.x * point.y,
    y: transform.origin.y + transform.axisX.y * point.x + transform.axisY.y * point.y + screenOffsetY,
  };
}

export function unprojectIsometricPoint(
  transform: IsometricTransform, point: IsometricPoint, screenOffsetY = 0,
): IsometricPoint {
  const { axisX: a, axisY: b } = transform;
  const determinant = a.x * b.y - a.y * b.x;
  const scale = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (!Number.isFinite(determinant) || scale < 1 || Math.abs(determinant) / scale < 0.01) {
    throw new Error("INVALID_ISOMETRIC_TRANSFORM");
  }
  const x = point.x - transform.origin.x, y = point.y - transform.origin.y - screenOffsetY;
  return { x: (x * b.y - y * b.x) / determinant, y: (y * a.x - x * a.y) / determinant };
}

/** Three image clicks for logical (0,0), (1,0), (0,1), with no inferred scale. */
export function calibrateIsometricTransform(
  origin: IsometricPoint, xStep: IsometricPoint, yStep: IsometricPoint,
): IsometricTransform {
  return isometricTransformSchema.parse({
    origin,
    axisX: { x: xStep.x - origin.x, y: xStep.y - origin.y },
    axisY: { x: yStep.x - origin.x, y: yStep.y - origin.y },
  });
}

export type IsometricMoveResult =
  | { allowed: true }
  | { allowed: false; reason: "UNKNOWN_FLOOR" | "OUTSIDE_FLOOR" | "BLOCKED" | "TRANSITION_REQUIRED" | "TOO_FAR" };

/**
 * Authoritative point-footprint movement primitive. It traverses EVERY crossed
 * cell, including both sides of a corner: dragging cannot jump over a wall.
 * It deliberately does not implement teleport, token-size collision or ACLs.
 */
export function validateIsometricMove(
  geometry: IsometricSceneGeometry, from: IsometricPlacement, to: IsometricPlacement,
): IsometricMoveResult {
  const floor = geometry.floors.find(item => item.id === from.floorId);
  const targetFloor = geometry.floors.find(item => item.id === to.floorId);
  if (!floor || !targetFloor) return { allowed: false, reason: "UNKNOWN_FLOOR" };
  if (!insideFloor(floor, from) || !insideFloor(targetFloor, to)) return { allowed: false, reason: "OUTSIDE_FLOOR" };
  const start = { x: Math.floor(from.x), y: Math.floor(from.y) };
  const end = { x: Math.floor(to.x), y: Math.floor(to.y) };
  if (!walkableCell(floor, start) || !walkableCell(targetFloor, end)) return { allowed: false, reason: "BLOCKED" };
  if (floor.id !== targetFloor.id) {
    const at = (endpoint: { x: number; y: number; floorId: string }, placement: IsometricPlacement) =>
      endpoint.floorId === placement.floorId && endpoint.x === Math.floor(placement.x) && endpoint.y === Math.floor(placement.y);
    const connected = geometry.transitions.some(t =>
      (at(t.from, from) && at(t.to, to)) || (t.bidirectional && at(t.to, from) && at(t.from, to)));
    return connected ? { allowed: true } : { allowed: false, reason: "TRANSITION_REQUIRED" };
  }
  const blocked = new Set(floor.blocked.map(cell => `${cell.x},${cell.y}`));
  const clear = (x: number, y: number) => insideFloor(floor, { x, y }) && !blocked.has(`${x},${y}`);
  const dx = to.x - from.x, dy = to.y - from.y;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let x = start.x, y = start.y;
  let crossX = dx === 0 ? Infinity : ((stepX > 0 ? x + 1 : x) - from.x) / dx;
  let crossY = dy === 0 ? Infinity : ((stepY > 0 ? y + 1 : y) - from.y) / dy;
  // Bound work even when this helper is called with data outside the schema.
  for (let steps = 0; steps < 4096; steps++) {
    if (x === end.x && y === end.y) return { allowed: true };
    if (Math.abs(crossX - crossY) < 1e-10) {
      if (!clear(x + stepX, y) || !clear(x, y + stepY)) return { allowed: false, reason: "BLOCKED" };
      x += stepX; y += stepY; crossX += deltaX; crossY += deltaY;
    } else if (crossX < crossY) {
      x += stepX; crossX += deltaX;
    } else {
      y += stepY; crossY += deltaY;
    }
    if (!clear(x, y)) return { allowed: false, reason: "BLOCKED" };
  }
  return { allowed: false, reason: "TOO_FAR" };
}

/** Ruler distance is measured on the floor, never on the compressed artwork. */
export function isometricDistanceMeters(
  geometry: IsometricSceneGeometry, from: IsometricPlacement, to: IsometricPlacement,
  includeHeight = false,
): number | null {
  const a = geometry.floors.find(f => f.id === from.floorId);
  const b = geometry.floors.find(f => f.id === to.floorId);
  if (!a || !b || !insideFloor(a, from) || !insideFloor(b, to)) return null;
  if (!includeHeight && a.id !== b.id) return null;
  return Math.hypot(
    (to.x - from.x) * geometry.metersPerCell,
    (to.y - from.y) * geometry.metersPerCell,
    includeHeight ? b.elevationMeters - a.elevationMeters : 0,
  );
}

/** Rendering occlusion is NOT a visibility grant. Only already-visible tokens enter this list. */
export function isometricDepthOrder<T extends { id: string; footY: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.footY - b.footY || a.id.localeCompare(b.id, "en"));
}
