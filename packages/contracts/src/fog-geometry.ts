import { z } from "zod";
export const fogPointSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
export type FogPoint = z.infer<typeof fogPointSchema>;
export const fogBoundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export type FogBounds = z.infer<typeof fogBoundsSchema>;
const rect = z
  .object({
    type: z.literal("RECT"),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive().max(16384),
    height: z.number().positive().max(16384),
  })
  .strict();
const circle = z
  .object({
    type: z.literal("CIRCLE"),
    center: fogPointSchema,
    radius: z.number().finite().min(1).max(512),
  })
  .strict();
const polygon = z
  .object({
    type: z.literal("POLYGON"),
    points: z.array(fogPointSchema).min(3).max(128),
  })
  .strict();
const brush = z
  .object({
    type: z.literal("BRUSH"),
    points: z.array(fogPointSchema).min(1).max(4096),
    radius: z.number().finite().min(1).max(512),
  })
  .strict();
export const fogGeometrySchema = z.discriminatedUnion("type", [
  rect,
  circle,
  polygon,
  brush,
]);
export type FogGeometry = z.infer<typeof fogGeometrySchema>;
export function fogGeometryBounds(g: FogGeometry): FogBounds {
  if (g.type === "RECT")
    return { x: g.x, y: g.y, width: g.width, height: g.height };
  if (g.type === "CIRCLE")
    return {
      x: g.center.x - g.radius,
      y: g.center.y - g.radius,
      width: g.radius * 2,
      height: g.radius * 2,
    };
  const pad = g.type === "BRUSH" ? g.radius : 0,
    xs = g.points.map((p) => p.x),
    ys = g.points.map((p) => p.y),
    x = Math.min(...xs) - pad,
    y = Math.min(...ys) - pad;
  return {
    x,
    y,
    width: Math.max(...xs) + pad - x,
    height: Math.max(...ys) + pad - y,
  };
}
const cross = (a: FogPoint, b: FogPoint, c: FogPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const on = (a: FogPoint, b: FogPoint, p: FogPoint) =>
  Math.abs(cross(a, b, p)) < 1e-9 &&
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);
const intersects = (a: FogPoint, b: FogPoint, c: FogPoint, d: FogPoint) => {
  const x1 = cross(a, b, c),
    x2 = cross(a, b, d),
    x3 = cross(c, d, a),
    x4 = cross(c, d, b);
  return (
    (x1 * x2 < 0 && x3 * x4 < 0) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  );
};
export function validateFogPolygon(p: FogPoint[]) {
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!,
      b = p[(i + 1) % p.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area) < 1e-6) return false;
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
      if (
        intersects(p[i]!, p[(i + 1) % p.length]!, p[j]!, p[(j + 1) % p.length]!)
      )
        return false;
    }
  return true;
}
function dist(p: FogPoint, a: FogPoint, b: FogPoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (!dx && !dy) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function rdp(p: FogPoint[], t: number): FogPoint[] {
  if (p.length <= 2) return p;
  let m = 0,
    n = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = dist(p[i]!, p[0]!, p.at(-1)!);
    if (d > m) {
      m = d;
      n = i;
    }
  }
  if (m <= t) return [p[0]!, p.at(-1)!];
  return [...rdp(p.slice(0, n + 1), t).slice(0, -1), ...rdp(p.slice(n), t)];
}
export function simplifyFogBrush(p: FogPoint[], radius: number) {
  let o = rdp(p, radius / 4);
  if (o.length > 256) {
    const s = (o.length - 1) / 255;
    o = Array.from({ length: 256 }, (_, i) => o[Math.round(i * s)]!);
  }
  return o;
}
export function fogGeometryContains(g: FogGeometry, p: FogPoint) {
  if (g.type === "RECT")
    return (
      p.x >= g.x && p.x <= g.x + g.width && p.y >= g.y && p.y <= g.y + g.height
    );
  if (g.type === "CIRCLE")
    return Math.hypot(p.x - g.center.x, p.y - g.center.y) <= g.radius;
  if (g.type === "BRUSH") {
    if (g.points.length === 1)
      return dist(p, g.points[0]!, g.points[0]!) <= g.radius;
    for (let i = 1; i < g.points.length; i++)
      if (dist(p, g.points[i - 1]!, g.points[i]!) <= g.radius) return true;
    return false;
  }
  let inside = false;
  for (let i = 0, j = g.points.length - 1; i < g.points.length; j = i++) {
    const a = g.points[i]!,
      b = g.points[j]!;
    if (on(a, b, p)) return true;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export interface FogCoverageOperation {
  operation: "REVEAL" | "COVER";
  geometry: FogGeometry;
  sequence: number;
}
export function evaluateFogCoverage(ops: FogCoverageOperation[], p: FogPoint) {
  let r = false;
  for (const op of [...ops].sort((a, b) => a.sequence - b.sequence))
    if (fogGeometryContains(op.geometry, p)) r = op.operation === "REVEAL";
  return r;
}
