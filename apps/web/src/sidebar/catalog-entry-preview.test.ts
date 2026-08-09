import { describe, expect, it } from "vitest";
import type { CatalogEntryDto } from "@arken/contracts";
import { previewFormula } from "./catalog-entry-preview";

function catalogEntry(data: CatalogEntryDto["data"]): CatalogEntryDto {
  return {
    id: "cat-1",
    kind: "SKILL",
    name: "Тест",
    description: "",
    data,
    revision: 0,
  };
}

describe("previewFormula (UIX-391 catalog picker row preview)", () => {
  it("shows a placeholder when the entry has no roll actions", () => {
    expect(previewFormula(catalogEntry({}))).toBe("Без броска");
    expect(previewFormula(catalogEntry({ rollActions: [] }))).toBe(
      "Без броска",
    );
  });

  it("previews a CHARACTERISTIC modifier as a humanizable raw stat-key formula", () => {
    const entry = catalogEntry({
      rollActions: [
        {
          id: "hit",
          kind: "HIT",
          label: "Попадание",
          dice: "1d20",
          order: 0,
          advantage: false,
          consumeUse: false,
          modifiers: [{ type: "CHARACTERISTIC", key: "agility" }],
        },
      ],
    });
    expect(previewFormula(entry)).toBe("1d20 + agility");
  });

  it("falls back to a generic label for a non-characteristic modifier", () => {
    const entry = catalogEntry({
      rollActions: [
        {
          id: "hit",
          kind: "HIT",
          label: "Попадание",
          dice: "1d20",
          order: 0,
          advantage: false,
          consumeUse: false,
          modifiers: [{ type: "ENTRY_VALUE", key: "magic" }],
        },
      ],
    });
    expect(previewFormula(entry)).toBe("1d20 + модификаторы");
  });

  it("shows bare dice notation when there is no modifier", () => {
    const entry = catalogEntry({
      rollActions: [
        {
          id: "hit",
          kind: "HIT",
          label: "Попадание",
          dice: "2d6",
          order: 0,
          advantage: false,
          consumeUse: false,
          modifiers: [],
        },
      ],
    });
    expect(previewFormula(entry)).toBe("2d6");
  });

  it("uses the lowest-order roll action when several exist", () => {
    const entry = catalogEntry({
      rollActions: [
        {
          id: "damage",
          kind: "DAMAGE",
          label: "Урон",
          dice: "1d8",
          order: 1,
          advantage: false,
          consumeUse: false,
          modifiers: [],
        },
        {
          id: "hit",
          kind: "HIT",
          label: "Попадание",
          dice: "1d20",
          order: 0,
          advantage: false,
          consumeUse: false,
          modifiers: [],
        },
      ],
    });
    expect(previewFormula(entry)).toBe("1d20");
  });
});
