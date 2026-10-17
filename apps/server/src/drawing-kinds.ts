import type { DrawingPackId } from "@arken/contracts";
import type { drawings } from "@arken/db";

/** STAMP and TEXTURE (UIX-706 pool 3) drawings are GM-only, layered objects. */
export const LAYERED_DRAWING_KINDS: readonly unknown[] = ["STAMP", "TEXTURE"];
export const isStampDrawing = (drawing: typeof drawings.$inferSelect) =>
  LAYERED_DRAWING_KINDS.includes(drawing.kind);
export const isHiddenStamp = (drawing: typeof drawings.$inferSelect) =>
  isStampDrawing(drawing) && drawing.stampLayer === "GM";

export function drawingDto(drawing: typeof drawings.$inferSelect) {
  const common = {
    id: drawing.id,
    sceneId: drawing.sceneId,
    authorMembershipId: drawing.authorMembershipId,
    points: drawing.points,
    color: drawing.color,
    strokeWidth: drawing.strokeWidth,
    x: drawing.x,
    y: drawing.y,
    revision: drawing.revision,
    createdAt: drawing.createdAt,
    updatedAt: drawing.updatedAt,
  };
  if (!isStampDrawing(drawing)) return { ...common, kind: "FREEHAND" as const };
  return {
    ...common,
    kind: drawing.kind as "STAMP" | "TEXTURE",
    assetKey: drawing.stampAssetKey!,
    packId: drawing.stampPackId as DrawingPackId,
    size: drawing.stampSize!,
    rotation: drawing.stampRotation!,
    layer: drawing.stampLayer as "PUBLIC" | "GM",
  };
}
