import type { EncounterPreflightResponse } from "@arken/contracts";
import { api } from "./api";

/**
 * UIX-311 Stage 3: fetch the LINKED_SCENE preflight warning for a candidate
 * destination scene, so the GM can be warned before committing to start the
 * encounter which campaign party members currently lack a controlled
 * PLAYER-layer token there. Token continuity itself is automatic
 * (transferRelativePosition, Stage 1) — this is a read-only warning surface,
 * never a manual token-placement flow, and it mutates nothing server-side.
 *
 * The server re-validates campaign ownership of `targetSceneId` and, if
 * `locationId` is given, the location-to-scene link (same checks as
 * POST /api/encounters/start), so this call can only ever reveal information
 * about scenes/locations the caller could legitimately target.
 */
export function fetchEncounterPreflight(
  targetSceneId: string,
  locationId?: string,
): Promise<EncounterPreflightResponse> {
  const query = new URLSearchParams({ targetSceneId });
  if (locationId) query.set("locationId", locationId);
  return api<EncounterPreflightResponse>(
    `/api/encounters/preflight?${query.toString()}`,
  );
}
