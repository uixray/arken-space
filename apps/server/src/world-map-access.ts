import type { AuthContext } from "./auth.js";

export function canViewWorldMap(
  map: {
    lifecycle: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    visibility: "CAMPAIGN" | "GM_ONLY";
  },
  auth: AuthContext,
) {
  return (
    auth.role === "GM" ||
    (map.lifecycle === "PUBLISHED" && map.visibility === "CAMPAIGN")
  );
}

export function canViewWorldMapLocation(
  location: { visibility: "PUBLIC" | "DISCOVERED" | "GM_ONLY" },
  auth: AuthContext,
) {
  return auth.role === "GM" || location.visibility !== "GM_ONLY";
}
