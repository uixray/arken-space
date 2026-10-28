import { describe, expect, it } from "vitest";
import type { CatalogEntryDto } from "@arken/contracts";
import {
  previewFormula,
  previewRollActionFormula,
} from "./catalog-entry-preview";

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

  it("formats negative skill values with an ASCII minus", () => {
    expect(previewFormula(catalogEntry({ skillValue: -3 }))).toBe("1d20 - 3");
  });

  it("formats negative resolved modifier totals with an ASCII minus", () => {
    const action = {
      id: "hit",
      kind: "HIT",
      label: "Попадание",
      dice: "1d20",
      order: 0,
      advantage: false,
      consumeUse: false,
      modifiers: [{ type: "CONSTANT", value: -2 }],
    } as Parameters<typeof previewRollActionFormula>[0];
    expect(previewRollActionFormula(action, undefined)).toBe("1d20 - 2");
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

  it("keeps unresolved modifier names instead of inventing a generic value", () => {
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
    expect(previewFormula(entry)).toBe("1d20 + magic");
  });

  it("treats a legacy roll action without modifiers as an empty modifier list", () => {
    const legacyAction = {
      id: "legacy-hit",
      kind: "HIT",
      label: "Попадание",
      dice: "1d20",
    } as Parameters<typeof previewRollActionFormula>[0];
    expect(previewRollActionFormula(legacyAction, undefined)).toBe("1d20");
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
