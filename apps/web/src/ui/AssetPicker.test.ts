import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssetDto } from "@arken/contracts";
import { AssetPicker } from "./AssetPicker";
import {
  computeArrowNavIndex,
  filterAssetsByName,
  resolveAssetSelection,
} from "./asset-picker-logic";

// UIX-390: the repo's vitest include glob (`apps/**/src/**/*.test.ts`) does
// not pick up `.tsx` specs (see RollButton.test.tsx, which currently isn't
// run by `pnpm test`), so this file stays `.test.ts` and uses
// `createElement` instead of JSX. The component itself has no
// `@gravity-ui/uikit` dependency, so no mocking is needed the way
// RollButton.test.tsx mocks Button.

function asset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id: "asset-1",
    kind: "PORTRAIT",
    name: "Portrait One",
    mimeType: "image/png",
    sizeBytes: 1024,
    width: 512,
    height: 512,
    durationSeconds: null,
    url: "/api/assets/asset-1/content",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("asset-picker-logic (pure helpers)", () => {
  it("filters assets by case-insensitive name match", () => {
    const assets = [
      asset({ id: "a", name: "Hero Portrait" }),
      asset({ id: "b", name: "Villain" }),
    ];
    expect(filterAssetsByName(assets, "hero")).toEqual([assets[0]]);
    expect(filterAssetsByName(assets, "")).toEqual(assets);
    expect(filterAssetsByName(assets, "zzz")).toEqual([]);
  });

  it("resolves a null value as no selection, never missing", () => {
    const assets = [asset()];
    expect(resolveAssetSelection(assets, null)).toEqual({
      selectedAsset: null,
      selectedMissing: false,
    });
  });

  it("resolves a matching id to its asset", () => {
    const target = asset({ id: "found" });
    expect(resolveAssetSelection([target], "found")).toEqual({
      selectedAsset: target,
      selectedMissing: false,
    });
  });

  it("flags a selected id that no longer exists as missing", () => {
    expect(
      resolveAssetSelection([asset({ id: "other" })], "deleted-id"),
    ).toEqual({
      selectedAsset: null,
      selectedMissing: true,
    });
  });

  it("computes wrap-around arrow navigation in both directions", () => {
    expect(computeArrowNavIndex("ArrowRight", 0, 3)).toBe(1);
    expect(computeArrowNavIndex("ArrowRight", 2, 3)).toBe(0);
    expect(computeArrowNavIndex("ArrowDown", 0, 3)).toBe(1);
    expect(computeArrowNavIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(computeArrowNavIndex("ArrowUp", 1, 3)).toBe(0);
  });

  it("ignores non-navigation keys and an empty list", () => {
    expect(computeArrowNavIndex("Enter", 0, 3)).toBeNull();
    expect(computeArrowNavIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("AssetPicker markup", () => {
  it("renders a thumbnail tile with an accessible name for each asset, never image-only", () => {
    const html = renderToStaticMarkup(
      createElement(AssetPicker, {
        assets: [asset({ id: "p1", name: "Гвардеец Марк" })],
        value: null,
        onChange: () => {},
      }),
    );
    expect(html).toContain("Гвардеец Марк");
    expect(html).toContain('aria-label="Гвардеец Марк"');
  });

  it("always renders an explicit no-selection tile, marked pressed when nothing is chosen", () => {
    const html = renderToStaticMarkup(
      createElement(AssetPicker, {
        assets: [asset()],
        value: null,
        onChange: () => {},
        noneLabel: "Без портрета",
      }),
    );
    expect(html).toContain("Без портрета");
    expect(html).toMatch(/asset-picker__tile--none"[^>]*aria-pressed="true"/);
  });

  it("marks the matching tile pressed when a value is selected", () => {
    const html = renderToStaticMarkup(
      createElement(AssetPicker, {
        assets: [asset({ id: "selected-id", name: "Selected" })],
        value: "selected-id",
        onChange: () => {},
      }),
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Selected"/);
  });

  it("shows an explicit warning when the selected asset id no longer exists", () => {
    const html = renderToStaticMarkup(
      createElement(AssetPicker, {
        assets: [asset({ id: "still-here" })],
        value: "deleted-asset-id",
        onChange: () => {},
      }),
    );
    expect(html).toContain("больше недоступно");
  });

  it("shows an empty-list message and no crash when there are zero assets", () => {
    const html = renderToStaticMarkup(
      createElement(AssetPicker, {
        assets: [],
        value: null,
        onChange: () => {},
      }),
    );
    expect(html).toContain("Нет доступных изображений.");
    // The "no selection" tile is still offered even with zero assets.
    expect(html).toContain("Без изображения");
  });

  it("renders a loading state distinct from the empty state", () => {
    const html = renderToStaticMarkup(
      createElement(AssetPicker, {
        assets: [],
        value: null,
        onChange: () => {},
        loading: true,
      }),
    );
    expect(html).toContain("Загрузка");
    expect(html).not.toContain("Нет доступных изображений.");
  });
});
