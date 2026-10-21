import type { AssetKind } from "@arken/contracts";

/** User-facing labels only: asset kinds remain unchanged in API payloads. */
export const ASSET_KIND_LABELS = {
  MAP: "Карта",
  TOKEN: "Изображение токена",
  PORTRAIT: "Портрет персонажа",
  IMAGE: "Изображение",
  AUDIO: "Аудиофайл",
  DICE_FRAME: "Рамка бросков",
} satisfies Record<AssetKind, string>;
