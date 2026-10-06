import type Konva from "konva";

/** Konva Line does not expose patterned strokes; use the Canvas pattern API. */
export function paintFogBrushStroke(
  context: Konva.Context,
  points: ReadonlyArray<{ x: number; y: number }>,
  radius: number,
  image: CanvasImageSource | null | undefined,
  fallback: string,
) {
  if (!points.length) return;
  context.save();
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.setAttr(
    "strokeStyle",
    image ? (context.createPattern(image, "repeat") ?? fallback) : fallback,
  );
  context.setAttr("lineWidth", radius * 2);
  context.setAttr("lineCap", "round");
  context.setAttr("lineJoin", "round");
  context.stroke();
  context.restore();
}
