import type { Role } from "@arken/contracts";
import type { MapMoveTarget } from "./map-move-queue";

export type MapDeleteRequest = { sceneId: string; targets: MapMoveTarget[] };

/** Destructive intent includes revisions, unlike a continuing move selection. */
export function mapDeleteScope(
  request: MapDeleteRequest,
  role: Role,
  membershipId: string,
) {
  return JSON.stringify([
    role,
    membershipId,
    request.sceneId,
    request.targets
      .map((target) => [target.targetType, target.targetId, target.revision])
      .sort(),
  ]);
}
