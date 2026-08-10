import { useMemo } from "react";
import type {
  CharacterDto,
  WorldMapDto,
  WorldMapLocationDto,
} from "@arken/contracts";
import { api } from "./api";
import type { LocationDraft, MapDraft } from "./WorldMapsWorkspace";

/**
 * UIX-398 step A2 — world-map commands, plus the character archive/restore
 * pair that deliberately reuses the same runner.
 *
 * Like the scene domain, these close over nothing render-scoped: only
 * `runWorldMapMutation` and `runResult` (both stable since step A0) and the
 * module's `api`. So no "ref to latest" is needed here either — two domains
 * in, the plan's assumption that handlers would generally need one is looking
 * like the exception rather than the rule.
 *
 * Signatures were originally derived from `Sidebar`'s props. That stopped
 * working once step B moved these onto the context and removed them from
 * `Sidebar`: the Pick silently resolved to `unknown`. The context is the
 * contract now, so the shapes are stated here and the draft types come from
 * the workspace that owns them.
 */
export interface WorldMapActions {
  onCreateWorldMap: (input: MapDraft) => Promise<void>;
  onSetWorldMapDraftBackground: (
    map: WorldMapDto,
    assetId: string | null,
  ) => Promise<void>;
  onApproveWorldMapBackground: (map: WorldMapDto) => Promise<void>;
  onPublishWorldMap: (map: WorldMapDto) => Promise<void>;
  onArchiveWorldMap: (map: WorldMapDto) => Promise<void>;
  onArchiveCharacter: (character: CharacterDto) => Promise<void>;
  onRestoreCharacter: (character: CharacterDto) => Promise<void>;
  onLoadArchivedCharacters: () => Promise<CharacterDto[]>;
  onCreateWorldMapLocation: (
    input: LocationDraft & { mapId: string },
  ) => Promise<void>;
  onUpdateWorldMapLocation: (
    location: WorldMapLocationDto,
    input: LocationDraft,
  ) => Promise<void>;
  onLinkWorldMapLocationScene: (
    location: WorldMapLocationDto,
    sceneId: string,
  ) => Promise<void>;
  onUnlinkWorldMapLocationScene: (
    location: WorldMapLocationDto,
    sceneId: string,
  ) => Promise<void>;
  onSetWorldMapPartyPosition: (
    mapId: string,
    locationId: string,
    revision: number | null,
  ) => Promise<void>;
  onClearWorldMapPartyPosition: (revision: number) => Promise<void>;
}

const withAction = (body: Record<string, unknown> = {}) =>
  JSON.stringify({ ...body, actionId: crypto.randomUUID() });

export function useWorldMapActions(dependencies: {
  /** Stable — see `use-mutation-runners.ts`. */
  runWorldMapMutation: (action: () => Promise<unknown>) => Promise<void>;
  /** Stable — see `use-mutation-runners.ts`. */
  runResult: <T>(action: () => Promise<T>) => Promise<T>;
}): WorldMapActions {
  const { runWorldMapMutation, runResult } = dependencies;

  return useMemo<WorldMapActions>(
    () => ({
      onCreateWorldMap: (input) =>
        runWorldMapMutation(() =>
          api("/api/world-maps", { method: "POST", body: withAction(input) }),
        ),

      onSetWorldMapDraftBackground: (map, assetId) =>
        runWorldMapMutation(() =>
          api(`/api/world-maps/${map.id}/draft-background`, {
            method: "POST",
            body: withAction({
              backgroundAssetId: assetId,
              revision: map.revision,
            }),
          }),
        ),

      onApproveWorldMapBackground: (map) =>
        runWorldMapMutation(() =>
          api(`/api/world-maps/${map.id}/approve-background`, {
            method: "POST",
            body: withAction({ revision: map.revision }),
          }),
        ),

      onPublishWorldMap: (map) =>
        runWorldMapMutation(() =>
          api(`/api/world-maps/${map.id}/publish`, {
            method: "POST",
            body: withAction({ revision: map.revision }),
          }),
        ),

      onArchiveWorldMap: (map) =>
        runWorldMapMutation(() =>
          api(`/api/world-maps/${map.id}/archive`, {
            method: "POST",
            body: withAction({ revision: map.revision }),
          }),
        ),

      // UIX-393: characters are never hard-deleted; archive/restore is a
      // GM-only revision/CAS transition with the same conflict-reload shape as
      // the world-map lifecycle transitions above, so it reuses that runner
      // rather than duplicating the 409-reload logic under a new name.
      onArchiveCharacter: (character) =>
        runWorldMapMutation(() =>
          api(`/api/characters/${character.id}/archive`, {
            method: "POST",
            body: withAction({ revision: character.revision }),
          }),
        ),

      onRestoreCharacter: (character) =>
        runWorldMapMutation(() =>
          api(`/api/characters/${character.id}/restore`, {
            method: "POST",
            body: withAction({ revision: character.revision }),
          }),
        ),

      onLoadArchivedCharacters: () =>
        runResult(() => api<CharacterDto[]>("/api/characters/archived")),

      onCreateWorldMapLocation: (input) =>
        runWorldMapMutation(() =>
          api("/api/world-maps/locations", {
            method: "POST",
            body: withAction(input),
          }),
        ),

      onUpdateWorldMapLocation: (location, input) =>
        runWorldMapMutation(() =>
          api(`/api/world-maps/locations/${location.id}`, {
            method: "PATCH",
            body: withAction({ ...input, revision: location.revision }),
          }),
        ),

      onLinkWorldMapLocationScene: (location, sceneId) =>
        runWorldMapMutation(() =>
          api(`/api/world-maps/locations/${location.id}/scenes/${sceneId}`, {
            method: "POST",
            body: withAction(),
          }),
        ),

      onUnlinkWorldMapLocationScene: (location, sceneId) =>
        runWorldMapMutation(() =>
          api(`/api/world-maps/locations/${location.id}/scenes/${sceneId}`, {
            method: "DELETE",
            body: withAction(),
          }),
        ),

      onSetWorldMapPartyPosition: (mapId, locationId, revision) =>
        runWorldMapMutation(() =>
          api("/api/world-maps/party-position", {
            method: "POST",
            body: withAction({ mapId, locationId, revision }),
          }),
        ),

      onClearWorldMapPartyPosition: (revision) =>
        runWorldMapMutation(() =>
          api("/api/world-maps/party-position", {
            method: "DELETE",
            body: withAction({ revision }),
          }),
        ),
    }),
    [runWorldMapMutation, runResult],
  );
}
