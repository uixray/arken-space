import type { EncounterDto, EncounterFocusRegion } from "@arken/contracts";
import { api } from "./api";

/**
 * UIX-311 Stage 4: shared request-building for the two encounter lifecycle
 * commands, reused by both the tactical-canvas and world-map GM entry
 * points (see EncounterConfirmDialog.tsx) so neither duplicates the
 * actionId/body shape the Stage 1 routes expect.
 */
export type StartEncounterInput =
  | {
      mode: "SCENE_REGION";
      sourceSceneId: string;
      sourceSceneRevision: number;
      focusRegion: EncounterFocusRegion;
    }
  | {
      mode: "LINKED_SCENE";
      sourceSceneId: string;
      sourceSceneRevision: number;
      targetSceneId: string;
      locationId?: string;
    };

export function startEncounter(
  input: StartEncounterInput,
): Promise<EncounterDto> {
  return api<EncounterDto>("/api/encounters/start", {
    method: "POST",
    body: JSON.stringify({ actionId: crypto.randomUUID(), ...input }),
  });
}

export function endEncounter(
  id: string,
  revision: number,
): Promise<EncounterDto> {
  return api<EncounterDto>(`/api/encounters/${id}/end`, {
    method: "POST",
    body: JSON.stringify({ actionId: crypto.randomUUID(), revision }),
  });
}
