import type { AssetDto } from "@arken/contracts";

/** Case-insensitive name filter used by the AssetPicker's search field. */
export function filterAssetsByName(assets: AssetDto[], query: string): AssetDto[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return assets;
  return assets.filter((asset) => asset.name.toLowerCase().includes(trimmed));
}

export interface AssetSelectionState {
  selectedAsset: AssetDto | null;
  /** True when `value` points at an asset id that isn't in `assets` (e.g. deleted). */
  selectedMissing: boolean;
}

/** Resolves the current selection against the eligible asset list. */
export function resolveAssetSelection(
  assets: AssetDto[],
  value: string | null,
): AssetSelectionState {
  if (!value) return { selectedAsset: null, selectedMissing: false };
  const selectedAsset = assets.find((asset) => asset.id === value) ?? null;
  return { selectedAsset, selectedMissing: !selectedAsset };
}

/**
 * Computes the tile index arrow-key navigation should move focus to, or null
 * if the key isn't a navigation key. Wraps around at both ends.
 */
export function computeArrowNavIndex(
  key: string,
  index: number,
  total: number,
): number | null {
  if (total <= 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % total;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + total) % total;
  return null;
}
