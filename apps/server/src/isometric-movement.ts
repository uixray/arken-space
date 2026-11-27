import {
  isometricSceneGeometrySchema,
  validateIsometricMove,
  type IsometricPlacement,
  type IsometricSceneGeometry,
  isometricFloorId,
} from "@arken/contracts";
import { and, eq } from "drizzle-orm";
import { scenes } from "@arken/db";
import type { CampaignCanvasDb } from "./campaign-pause-guard.js";
import { isometricRowIsPublished } from "./isometric-layers.js";

/** Prepared policy is kept server-side, not taken from a token move packet. */
export function prepareIsometricMovementPolicy(input: unknown): IsometricSceneGeometry {
  return isometricSceneGeometrySchema.parse(input);
}

export function isIsometricPolicyError(error: unknown): boolean {
  let item = error;
  for (let depth = 0; depth < 4 && item && typeof item === "object"; depth++) {
    const candidate = item as { message?: unknown; cause?: unknown };
    if (candidate.message === "ISOMETRIC_MOVEMENT_FORBIDDEN") return true;
    item = candidate.cause;
  }
  return false;
}

export type IsometricMovementDecision =
  | { allowed: true }
  | { allowed: false; reason: "MOVEMENT_FORBIDDEN" };

/**
 * Caller MUST first establish campaign/token control and lock the current scene
 * policy together with the token revision. The generic denial prevents probing
 * which hidden floor, obstacle or transition caused a rejection.
 *
 * This adapter uses CELL coordinates. Existing pixel/top-left token coordinates
 * must not be passed through without the explicit scene-coordinate adapter.
 */
export function authorizeIsometricMovement(
  policy: IsometricSceneGeometry,
  from: IsometricPlacement,
  to: IsometricPlacement,
  canEnterFloor: (floorId: string) => boolean,
): IsometricMovementDecision {
  if (!canEnterFloor(from.floorId) || !canEnterFloor(to.floorId)) {
    return { allowed: false, reason: "MOVEMENT_FORBIDDEN" };
  }
  const result = validateIsometricMove(policy, from, to);
  return result.allowed ? result : { allowed: false, reason: "MOVEMENT_FORBIDDEN" };
}

/** Adapter for the canonical pixel/top-left placement representation. */
export async function canvasIsometricMoveAllowed(
  db: CampaignCanvasDb,
  campaignId: string,
  current: { sceneId: string; x: number; y: number; width: number; height: number; levelId: string | null },
  target: { x: number; y: number; levelId: string | null },
  role: "GM" | "PLAYER" = "GM",
): Promise<boolean> {
  const [scene] = await db.select().from(scenes)
    .where(and(eq(scenes.id, current.sceneId), eq(scenes.campaignId, campaignId))).limit(1);
  if (!scene) return false;
  if (!["ISOMETRIC","THREE_D"].includes(scene.projection) || !scene.grid.isometric) return true;
  if (role !== "GM" && (!isometricRowIsPublished(scene, current.levelId) || !isometricRowIsPublished(scene, target.levelId))) return false;
  const parsed = isometricSceneGeometrySchema.safeParse(scene.grid.isometric);
  if (!parsed.success) return false;
  const policy = parsed.data, grid = scene.grid;
  const point = (p: { x: number; y: number; levelId: string | null }) => ({
    x: (p.x + current.width / 2 - grid.offsetX) / grid.size,
    y: (p.y + current.height - grid.offsetY) / grid.size, floorId: isometricFloorId(policy, p.levelId),
  });
  return validateIsometricMove(policy, point(current), point(target)).allowed;
}
