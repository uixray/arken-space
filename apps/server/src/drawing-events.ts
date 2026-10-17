import type { DrawingDto } from "@arken/contracts";
import type { drawings } from "@arken/db";
import { isStampDrawing } from "./drawing-kinds.js";
import { CAMPAIGN_IMAGE_STAMP_PACK_ID } from "./terrain-stamp-routes.js";

type DrawingRow = typeof drawings.$inferSelect;

/**
 * UIX-408 — видна ли этому сокету сцена, к которой относится канвас.
 *
 * Игроку видима ровно транслируемая сцена; мастеру — она же плюс та, которую
 * он рассматривает (`scene:view`). Та же выборка, что у снапшота, — иначе
 * событие и снапшот разошлись бы, а расхождение здесь означает туман сцены,
 * которой в снапшоте нет.
 */
export function canvasSceneVisibleTo(
  data: { auth?: { role: string }; viewedSceneId?: string | null },
  campaign: { activeSceneId: string | null },
  sceneId: string,
) {
  if (sceneId === campaign.activeSceneId) return true;
  return data.auth?.role === "GM" && data.viewedSceneId === sceneId;
}

/** The same filter buildSnapshot applies to `snapshot.drawings`. */
export function drawingVisibleTo(
  data: { auth?: { role: string }; viewedSceneId?: string | null },
  campaign: { activeSceneId: string | null },
  drawing: DrawingRow,
) {
  return (
    canvasSceneVisibleTo(data, campaign, drawing.sceneId) &&
    (data.auth?.role === "GM" ||
      !isStampDrawing(drawing) ||
      drawing.stampLayer === "PUBLIC")
  );
}

/** The `snapshot.drawings` entry of one row. */
export function drawingSnapshotDto(drawing: DrawingRow): DrawingDto {
  return {
    id: drawing.id,
    sceneId: drawing.sceneId,
    authorMembershipId: drawing.authorMembershipId,
    points: drawing.points,
    color: drawing.color,
    strokeWidth: drawing.strokeWidth,
    x: drawing.x,
    y: drawing.y,
    revision: drawing.revision,
    kind: drawing.kind as "FREEHAND" | "STAMP" | "TEXTURE",
    ...(isStampDrawing(drawing)
      ? {
          assetKey: drawing.stampAssetKey!,
          packId: drawing.stampPackId as DrawingDto["packId"],
          size: drawing.stampSize!,
          rotation: drawing.stampRotation!,
          layer: drawing.stampLayer as "PUBLIC" | "GM",
        }
      : {}),
  };
}

export interface DrawingChange {
  before: DrawingRow | null;
  after: DrawingRow | null;
  sequence: number;
  actionId: string;
  emittedAt: string;
}

interface DrawingEventSocket {
  data: { auth?: { role: string }; viewedSceneId?: string | null };
  emit(
    event: "drawing:upserted",
    envelope: {
      sequence: number;
      actionId: string;
      emittedAt: string;
      data: DrawingDto;
    },
  ): unknown;
  emit(
    event: "drawing:removed",
    envelope: {
      sequence: number;
      actionId: string;
      emittedAt: string;
      data: { drawingId: string; sceneId: string };
    },
  ): unknown;
}

/**
 * UIX-412: sends one drawing change as point events.
 *
 * A socket that sees the drawing after the change gets `drawing:upserted`; a
 * socket that saw it before and no longer does (deleted, or moved to the GM
 * layer) gets `drawing:removed`; everyone else gets nothing, so a hidden GM
 * stamp never reaches a player even as an id.
 *
 * A campaign image stamp also puts its image into `snapshot.assets` for
 * players; a point event cannot carry that, so those changes answer
 * "snapshot" and the caller falls back to the full broadcast.
 */
export function emitDrawingChange(
  sockets: readonly DrawingEventSocket[],
  campaign: { activeSceneId: string | null },
  change: DrawingChange,
): "sent" | "snapshot" {
  const { before, after } = change;
  if (
    [before, after].some(
      (drawing) =>
        drawing &&
        isStampDrawing(drawing) &&
        drawing.stampPackId === CAMPAIGN_IMAGE_STAMP_PACK_ID,
    )
  )
    return "snapshot";
  const base = {
    sequence: change.sequence,
    actionId: change.actionId,
    emittedAt: change.emittedAt,
  };
  for (const socket of sockets) {
    if (after && drawingVisibleTo(socket.data, campaign, after))
      socket.emit("drawing:upserted", {
        ...base,
        data: drawingSnapshotDto(after),
      });
    else if (before && drawingVisibleTo(socket.data, campaign, before))
      socket.emit("drawing:removed", {
        ...base,
        data: { drawingId: before.id, sceneId: before.sceneId },
      });
  }
  return "sent";
}
