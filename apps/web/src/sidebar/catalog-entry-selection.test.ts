import { describe, expect, it } from "vitest";
import type { CatalogEntryDto, CharacterDto } from "@arken/contracts";
import { selectableCatalogEntries } from "./catalog-entry-selection";

function catalogEntry(overrides: Partial<CatalogEntryDto>): CatalogEntryDto {
  return {
    id: "catalog-1",
    kind: "SKILL",
    name: "Скрытность",
    description: "",
    data: {},
    revision: 0,
    ...overrides,
  };
}

function characterEntry(
  overrides: Partial<CharacterDto["entries"][number]>,
): CharacterDto["entries"][number] {
  return {
    id: "assigned-1",
    kind: "SKILL",
    name: "Скрытность",
    description: "",
    data: {},
    revision: 0,
    sourceCatalogEntryId: null,
    ...overrides,
  } as CharacterDto["entries"][number];
}

describe("selectableCatalogEntries (UIX-391 duplicate-assignment prevention)", () => {
  it("excludes a catalog entry already assigned to the character (matched by sourceCatalogEntryId)", () => {
    const catalog = [
      catalogEntry({ id: "cat-a", name: "Скрытность" }),
      catalogEntry({ id: "cat-b", name: "Взлом" }),
    ];
    const assigned = [
      characterEntry({ id: "own-1", sourceCatalogEntryId: "cat-a" }),
    ];
    const result = selectableCatalogEntries(catalog, assigned, "SKILL");
    expect(result.map((entry) => entry.id)).toEqual(["cat-b"]);
  });

  it("keeps offering a catalog entry that was assigned and then removed from the character", () => {
    const catalog = [catalogEntry({ id: "cat-a" })];
    // No character entries reference cat-a anymore (e.g. it was deleted from the sheet).
    const result = selectableCatalogEntries(catalog, [], "SKILL");
    expect(result.map((entry) => entry.id)).toEqual(["cat-a"]);
  });

  it("filters by kind, so an assigned ABILITY never hides a same-named SKILL catalog entry", () => {
    const catalog = [
      catalogEntry({ id: "cat-a", kind: "SKILL" }),
      catalogEntry({ id: "cat-b", kind: "ABILITY" }),
    ];
    const assigned = [
      characterEntry({
        id: "own-1",
        kind: "ABILITY",
        sourceCatalogEntryId: "cat-b",
      }),
    ];
    expect(
      selectableCatalogEntries(catalog, assigned, "SKILL").map((e) => e.id),
    ).toEqual(["cat-a"]);
    expect(
      selectableCatalogEntries(catalog, assigned, "ABILITY").map((e) => e.id),
    ).toEqual([]);
  });

  it("ignores character entries with no source catalog link (legacy/manual entries)", () => {
    const catalog = [catalogEntry({ id: "cat-a" })];
    const assigned = [
      characterEntry({ id: "own-1", sourceCatalogEntryId: null }),
    ];
    expect(
      selectableCatalogEntries(catalog, assigned, "SKILL").map((e) => e.id),
    ).toEqual(["cat-a"]);
  });
});
