import type { AssetDto } from "@arken/contracts";

export function tokenDefinitionAssets(assets: AssetDto[]) {
  return assets.filter((asset) => asset.kind === "TOKEN");
}
export function tokenGeneratorSources(assets: AssetDto[]) {
  return assets.filter((asset) => asset.kind === "IMAGE");
}
export function tokenAssetLabel(asset: AssetDto) {
  return `${asset.name} ? ${asset.kind === "TOKEN" ? "TOKEN" : "IMAGE"}`;
}
export function mergeAssets(assets: AssetDto[], additional?: AssetDto) {
  if (!additional) return assets;
  return [additional, ...assets.filter((asset) => asset.id !== additional.id)];
}
