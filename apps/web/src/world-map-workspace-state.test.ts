import { describe, expect, it } from "vitest";
import type { AssetDto, WorldMapsSnapshotDto } from "@arken/contracts";
import {
  authorizedWorldMapBackground,
  locationsOnWorldMap,
  selectedWorldMap,
  worldMapCapabilities,
} from "./world-map-workspace-state";

const maps: WorldMapsSnapshotDto = {
  maps: [
    {
      id: "map-a",
      name: "А",
      scope: "WORLD",
      visibility: "CAMPAIGN",
      lifecycle: "PUBLISHED",
      backgroundAssetId: "asset-a",
      revision: 2,
    },
  ],
  locations: [
    {
      id: "z",
      mapId: "map-a",
      name: "Застава",
      kind: "LANDMARK",
      summary: "",
      visibility: "PUBLIC",
      x: 0.2,
      y: 0.3,
      revision: 1,
      sceneIds: [],
    },
    {
      id: "a",
      mapId: "map-a",
      name: "Арка",
      kind: "SETTLEMENT",
      summary: "",
      visibility: "PUBLIC",
      x: 0.4,
      y: 0.5,
      revision: 1,
      sceneIds: [],
    },
  ],
  partyPosition: null,
};

describe("world map projection helpers", () => {
  it("falls back to the first server-projected map when selection is stale", () => {
    expect(selectedWorldMap(maps, "removed")?.id).toBe("map-a");
  });
  it("scopes and sorts the textual list without recovering hidden locations", () => {
    expect(
      locationsOnWorldMap(maps, "map-a").map((location) => location.id),
    ).toEqual(["a", "z"]);
    expect(locationsOnWorldMap(maps, "other")).toEqual([]);
  });
  it("uses only an authorized background asset", () => {
    const asset = { id: "asset-a", url: "/safe-map", kind: "MAP" } as AssetDto;
    expect(
      authorizedWorldMapBackground([asset], selectedWorldMap(maps, "map-a"))
        ?.url,
    ).toBe("/safe-map");
    expect(
      authorizedWorldMapBackground([], selectedWorldMap(maps, "map-a")),
    ).toBeNull();
  });
  it("exposes lifecycle controls only in their allowed state", () => {
    const map = maps.maps[0]!;
    const draft = { ...map, lifecycle: "DRAFT" as const };
    const published = { ...map, lifecycle: "PUBLISHED" as const };
    const archived = { ...map, lifecycle: "ARCHIVED" as const };
    expect(worldMapCapabilities(draft)).toEqual({
      canEditContent: true,
      canSetPartyPosition: false,
      isReadOnly: false,
    });
    expect(worldMapCapabilities(published)).toEqual({
      canEditContent: false,
      canSetPartyPosition: true,
      isReadOnly: false,
    });
    expect(worldMapCapabilities(archived)).toEqual({
      canEditContent: false,
      canSetPartyPosition: false,
      isReadOnly: true,
    });
  });
});
