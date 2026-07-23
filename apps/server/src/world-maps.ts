import { eq } from "drizzle-orm";
import {
  campaigns,
  worldMapLocations,
  worldMapLocationScenes,
  worldMapPartyPosition,
  worldMaps,
} from "@arken/db";
import type { WorldMapsSnapshotDto } from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import {
  canViewWorldMap,
  canViewWorldMapLocation,
} from "./world-map-access.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/**
 * Builds the only world-map projection sent to clients.  In particular, this
 * never lets a player infer drafts, GM maps, GM notes, or inactive scene links.
 */
export async function buildWorldMapsSnapshot(
  db: Database,
  auth: AuthContext,
): Promise<{
  snapshot: WorldMapsSnapshotDto;
  backgroundAssetIds: Set<string>;
}> {
  const [mapRows, locationRows, linkRows, positionRows, campaignRows] =
    await Promise.all([
      db
        .select()
        .from(worldMaps)
        .where(eq(worldMaps.campaignId, auth.campaignId)),
      db
        .select()
        .from(worldMapLocations)
        .where(eq(worldMapLocations.campaignId, auth.campaignId)),
      db
        .select()
        .from(worldMapLocationScenes)
        .where(eq(worldMapLocationScenes.campaignId, auth.campaignId)),
      db
        .select()
        .from(worldMapPartyPosition)
        .where(eq(worldMapPartyPosition.campaignId, auth.campaignId))
        .limit(1),
      db
        .select({ activeSceneId: campaigns.activeSceneId })
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1),
    ]);

  const visibleMaps = mapRows.filter((map) => canViewWorldMap(map, auth));
  const visibleMapIds = new Set(visibleMaps.map((map) => map.id));
  const visibleLocations = locationRows.filter(
    (location) =>
      visibleMapIds.has(location.mapId) &&
      canViewWorldMapLocation(location, auth),
  );
  const visibleLocationIds = new Set(
    visibleLocations.map((location) => location.id),
  );
  const activeSceneId = campaignRows[0]?.activeSceneId ?? null;
  const sceneIdsByLocation = new Map<string, string[]>();
  for (const link of linkRows) {
    if (
      !visibleLocationIds.has(link.locationId) ||
      (auth.role !== "GM" && link.sceneId !== activeSceneId)
    )
      continue;
    const sceneIds = sceneIdsByLocation.get(link.locationId) ?? [];
    sceneIds.push(link.sceneId);
    sceneIdsByLocation.set(link.locationId, sceneIds);
  }
  const locations = visibleLocations.map((location) => ({
    id: location.id,
    mapId: location.mapId,
    name: location.name,
    kind: location.kind,
    summary: location.summary,
    visibility: location.visibility,
    x: location.x,
    y: location.y,
    revision: location.revision,
    sceneIds: sceneIdsByLocation.get(location.id) ?? [],
  }));
  const position = positionRows[0];
  const partyPosition =
    position &&
    visibleMapIds.has(position.mapId) &&
    visibleLocationIds.has(position.locationId)
      ? {
          mapId: position.mapId,
          locationId: position.locationId,
          revision: position.revision,
          updatedAt: position.updatedAt.toISOString(),
        }
      : null;

  return {
    snapshot: {
      maps: visibleMaps.map((map) => ({
        id: map.id,
        name: map.name,
        scope: map.scope,
        visibility: map.visibility,
        lifecycle: map.lifecycle,
        backgroundAssetId: map.backgroundAssetId,
        revision: map.revision,
      })),
      locations,
      ...(auth.role === "GM"
        ? {
            gmLocations: locations.map((location) => ({
              ...location,
              gmNotes:
                locationRows.find((row) => row.id === location.id)?.gmNotes ??
                "",
            })),
          }
        : {}),
      partyPosition,
    },
    backgroundAssetIds: new Set(
      visibleMaps.flatMap((map) =>
        map.backgroundAssetId ? [map.backgroundAssetId] : [],
      ),
    ),
  };
}

/** A content request is authorized only when its map is in the caller's projection. */
export { canViewWorldMap, canViewWorldMapLocation };

export async function canAccessWorldMapAsset(
  db: Database,
  auth: AuthContext,
  assetId: string,
) {
  const { backgroundAssetIds } = await buildWorldMapsSnapshot(db, auth);
  return backgroundAssetIds.has(assetId);
}
