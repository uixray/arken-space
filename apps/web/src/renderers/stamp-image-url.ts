import type { DrawingPackId } from "@arken/contracts";

/** UIX-706: built-in templates, built-in textures and campaign images are read
 * from different ACL-checked routes; a key is never resolved as a path. */
export function stampImageUrl(packId: DrawingPackId, assetKey: string) {
  if (packId === "campaign-image")
    return `/api/assets/${encodeURIComponent(assetKey)}/content`;
  return packId === "builtin-texture-v1"
    ? `/api/terrain-stamps/textures/${encodeURIComponent(assetKey)}`
    : `/api/terrain-stamps/assets/${encodeURIComponent(assetKey)}`;
}
