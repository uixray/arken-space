import type { WorldMapLocationKind } from "@arken/contracts";

/** Display copy only: location kinds remain unchanged in snapshots and mutations. */
export const WORLD_MAP_LOCATION_KIND_LABELS = {
  SETTLEMENT: "Поселение",
  LANDMARK: "Ориентир",
  REGION: "Регион",
  OTHER: "Другое",
} satisfies Record<WorldMapLocationKind, string>;
