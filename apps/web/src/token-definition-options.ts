import type { AssetDto } from "@arken/contracts";

const SUPPORTED_TOKEN_ASSET_KINDS = new Set(["IMAGE", "TOKEN"]);
export function tokenDefinitionAssets(assets: AssetDto[]) {
  return assets.filter((asset) => SUPPORTED_TOKEN_ASSET_KINDS.has(asset.kind));
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
