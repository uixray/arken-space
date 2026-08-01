import { describe, expect, it } from "vitest";
import type { AssetDto } from "@arken/contracts";
import {
  mergeAssets,
  tokenAssetLabel,
  tokenDefinitionAssets,
  tokenGeneratorSources,
} from "./token-definition-options";
const asset = (id: string, kind: AssetDto["kind"], name = id): AssetDto => ({
  id,
  kind,
  name,
  mimeType: "image/webp",
  sizeBytes: 10,
  width: 100,
  height: 100,
  durationSeconds: null,
  url: `/assets/${id}`,
  createdAt: "2026-07-29T00:00:00.000Z",
});
describe("token definition asset options", () => {
  const assets = [
    asset("image", "IMAGE", "Portrait"),
    asset("token", "TOKEN", "Goblin"),
    asset("map", "MAP", "Dungeon"),
  ];
  it("offers IMAGE and TOKEN assets", () => {
    expect(tokenDefinitionAssets(assets).map(({ id }) => id)).toEqual([
      "image",
      "token",
    ]);
    expect(tokenAssetLabel(assets[0]!)).toBe("Portrait ? IMAGE");
  });
  it("uses only IMAGE assets as generator sources", () =>
    expect(tokenGeneratorSources(assets).map(({ id }) => id)).toEqual([
      "image",
    ]));
  it("merges a same-dialog upload without duplication", () =>
    expect(
      mergeAssets(assets, asset("image", "IMAGE", "New portrait")).map(
        ({ name }) => name,
      ),
    ).toEqual(["New portrait", "Goblin", "Dungeon"]));
});
