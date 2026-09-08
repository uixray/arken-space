import { worldMapLocationKindSchema } from "@arken/contracts";
import { describe, expect, it } from "vitest";
import { WORLD_MAP_LOCATION_KIND_LABELS } from "./world-map-labels";

describe("world location display labels", () => {
  it("covers every contract kind without renaming its key", () => {
    expect(Object.keys(WORLD_MAP_LOCATION_KIND_LABELS).sort()).toEqual(
      [...worldMapLocationKindSchema.options].sort(),
    );
    expect(WORLD_MAP_LOCATION_KIND_LABELS).toEqual({
      SETTLEMENT: "Поселение",
      LANDMARK: "Ориентир",
      REGION: "Регион",
      OTHER: "Другое",
    });
  });
});
