import { assetKindSchema } from "@arken/contracts";
import { describe, expect, it } from "vitest";
import { ASSET_KIND_LABELS } from "./asset-labels";

describe("asset kind labels", () => {
  it("covers every contract kind without changing the technical keys", () => {
    expect(Object.keys(ASSET_KIND_LABELS).sort()).toEqual(
      [...assetKindSchema.options].sort(),
    );
    expect(ASSET_KIND_LABELS).toEqual({
      MAP: "Карта",
      TOKEN: "Изображение токена",
      PORTRAIT: "Портрет персонажа",
      IMAGE: "Изображение",
      AUDIO: "Аудиофайл",
    });
  });
});
