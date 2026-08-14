import { describe, expect, it } from "vitest";
import { entryDataSchema } from "@arken/contracts";
import { arkenSystem } from "@arken/system";
import {
  normalizeLegacyEntryData,
  normalizeLegacyFormula,
  normalizeLegacyStats,
} from "./entry-data.js";

describe("normalizeLegacyEntryData", () => {
  it.each([
    ["mind", "intelligence"],
    ["spirit", "willpower"],
  ])("maps legacy characteristic %s to %s", (legacy, canonical) => {
    const normalized = normalizeLegacyEntryData({
      rollActions: [
        {
          id: "observe",
          kind: "CUSTOM",
          label: "Observation",
          dice: "1d20",
          modifiers: [{ type: "CHARACTERISTIC", key: legacy }],
          order: 0,
          advantage: false,
          consumeUse: false,
        },
      ],
    });
    const parsed = entryDataSchema.parse(normalized);
    expect(parsed.rollActions?.[0]?.modifiers[0]).toEqual({
      type: "CHARACTERISTIC",
      key: canonical,
    });
  });
});

describe("normalizeLegacyStats", () => {
  it("keeps canonical values and fills missing aliases deterministically", () => {
    const stats = normalizeLegacyStats({ mind: 4, spirit: 5, intelligence: 9 });
    // Псевдонимы переехали в канонические ключи, а исходные исчезли.
    expect(stats).toMatchObject({ intelligence: 9, willpower: 5 });
    expect(stats.mind).toBeUndefined();
    expect(stats.spirit).toBeUndefined();
    // UIX-424: добираются все строки раскладки, а не три выписанных ключа.
    // Иначе бросок на характеристику, добавленную после создания персонажа,
    // отвечает «стат не найден».
    for (const stat of arkenSystem.stats)
      expect(Number.isFinite(stats[stat.key]), stat.key).toBe(true);
    expect(stats.luck).toBe(0);
    // Ключа, которого нет в системе, добор не выдумывает.
    expect(stats.knowledge).toBeUndefined();
  });
});

describe("normalizeLegacyFormula", () => {
  it("maps both legacy stat names without rewriting partial words", () => {
    expect(normalizeLegacyFormula("1d20 + mind + spirit + mastermind")).toBe(
      "1d20 + intelligence + willpower + mastermind",
    );
  });
});
