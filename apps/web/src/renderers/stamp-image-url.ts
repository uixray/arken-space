import type { StampPackId } from "@arken/contracts";

/** UIX-706: built-in templates and campaign images are read from different
 * ACL-checked routes; a key is never resolved as a path by the client. */
export function stampImageUrl(packId: StampPackId, assetKey: string) {
  return packId === "campaign-image"
    ? `/api/assets/${encodeURIComponent(assetKey)}/content`
    : `/api/terrain-stamps/assets/${encodeURIComponent(assetKey)}`;
}
