import type { WorldContentDto } from "@arken/contracts";
import { api } from "./api";

export type CanonicalLocationOption = Pick<WorldContentDto, "id" | "name">;

export function fetchCanonicalLocationsForMap(): Promise<
  CanonicalLocationOption[]
> {
  return api<CanonicalLocationOption[]>("/api/world-content?type=LOCATION");
}
