import { z } from "zod";

/**
 * UIX-381: multi-segment ruler waypoints. Rulers are ephemeral (never
 * persisted -- there is no ruler DB table; see `apps/server/src/realtime.ts`'s
 * `ruler:update`/`ruler:clear` handlers), so the payload made a clean break
 * from the old two-point `{ startX, startY, endX, endY }` shape to an ordered
 * `points` array instead of adding dual-format support. A single segment is
 * just a 2-point polyline, so the old single-segment behavior is unaffected.
 *
 * The point cap mirrors `simplifyFogBrush`'s 256-point brush cap and the fog
 * polygon's 128-point cap in `fog-geometry.ts`: generous for any real
 * multi-leg route a GM would draw, small enough that a malicious/buggy
 * client can't force the server to fan out a huge broadcast payload.
 */
export const RULER_MAX_POINTS = 64;

export const rulerPointSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
export type RulerPoint = z.infer<typeof rulerPointSchema>;

export const rulerUpdateSchema = z.object({
  sceneId: z.string().uuid(),
  points: z.array(rulerPointSchema).min(2).max(RULER_MAX_POINTS),
});

/**
 * Grid-aware total distance across every segment of the polyline. Shared by
 * client (for the zero-latency local preview drawn while dragging, before
 * the server's broadcast echoes back) and server (the authoritative value
 * actually broadcast to every other participant) so the two can never drift
 * apart on the formula itself.
 */
export function rulerPolylineDistance(
  points: readonly RulerPoint[],
  gridSize: number,
): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    total += Math.hypot(dx, dy);
  }
  return total / gridSize;
}

/**
 * UIX-509: named ruler colours. A membership stores only the key (GM-assigned,
 * `null` = the hashed per-member fallback); the hex lives here so every client
 * draws the same colour. Dark entries get a light halo on the canvas.
 */
export const RULER_COLOR_PALETTE = {
  green: "#3fbf5f",
  lilac: "#c79bf2",
  orange: "#f08a24",
  purple: "#8b5cf6",
  black: "#111111",
  blue: "#3b82f6",
} as const;
export const rulerColorKeySchema = z.enum([
  "green",
  "lilac",
  "orange",
  "purple",
  "black",
  "blue",
]);
export type RulerColorKey = z.infer<typeof rulerColorKeySchema>;
export const memberRulerColorUpdateSchema = z
  .object({ rulerColor: rulerColorKeySchema.nullable() })
  .strict();
