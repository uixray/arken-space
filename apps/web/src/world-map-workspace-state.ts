import type {
  AssetDto,
  WorldMapDto,
  WorldMapLocationDto,
  WorldMapsSnapshotDto,
} from "@arken/contracts";

export function selectedWorldMap(
  worldMaps: WorldMapsSnapshotDto | undefined,
  mapId: string | null,
): WorldMapDto | null {
  if (!worldMaps?.maps.length) return null;
  return (
    worldMaps.maps.find((map) => map.id === mapId) ?? worldMaps.maps[0] ?? null
  );
}

export function locationsOnWorldMap(
  worldMaps: WorldMapsSnapshotDto | undefined,
  mapId: string | null,
): WorldMapLocationDto[] {
  if (!mapId) return [];
  return (worldMaps?.locations ?? [])
    .filter((location) => location.mapId === mapId)
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

/** Never manufacture an asset URL: snapshot.assets is already viewer-filtered. */
export function authorizedWorldMapBackground(
  assets: AssetDto[],
  map: WorldMapDto | null,
): AssetDto | null {
  if (!map?.backgroundAssetId) return null;
  return assets.find((asset) => asset.id === map.backgroundAssetId) ?? null;
}

export function locationSceneNames(
  location: WorldMapLocationDto,
  scenes: Array<{ id: string; name: string }>,
) {
  return location.sceneIds
    .map((sceneId) => scenes.find((scene) => scene.id === sceneId))
    .filter((scene): scene is { id: string; name: string } => Boolean(scene));
}

/** Lifecycle is the client-side affordance boundary; the server remains authoritative. */
export function worldMapCapabilities(map: WorldMapDto | null) {
  return {
    canEditContent: map?.lifecycle === "DRAFT",
    canSetPartyPosition: map?.lifecycle === "PUBLISHED",
    isReadOnly: map?.lifecycle === "ARCHIVED",
  };
}
