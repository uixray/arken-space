import { describe, expect, it } from "vitest";
import { entryDataSchema } from "@arken/contracts";
import { arkenSystem } from "@arken/system";
import {
  normalizeLegacyEntryData,
  normalizeLegacyFormula,
  normalizeLegacyStats,
} from "./entry-data.js";

describe("normalizeLegacyEntryData", () => {
  it("repairs legacy seeded action and uses fields into the current contract", () => {
    const normalized = normalizeLegacyEntryData({
      rollActions: [
        {
          id: "fire-bolt-roll",
          label: "Урон огнем",
          formula: "2d6 + intelligence",
        },
      ],
      uses: { current: 3, maximum: 3, rechargeRate: "LONG_REST" },
    });

    expect(entryDataSchema.parse(normalized)).toMatchObject({
      rollActions: [
        {
          id: "fire-bolt-roll",
          kind: "CUSTOM",
          label: "Урон огнем",
          dice: "2d6",
          modifiers: [{ type: "CHARACTERISTIC", key: "intelligence" }],
          order: 0,
          advantage: false,
          consumeUse: false,
        },
      ],
      uses: { current: 3, max: 3, recharge: "DAY" },
    });
  });

  it("keeps canonical fields authoritative and preserves short-rest recharge", () => {
    const normalized = normalizeLegacyEntryData({
      rollActions: [
        {
          id: "heal-roll",
          label: "Лечение",
          formula: "1d6 + intelligence",
          kind: "DAMAGE",
          dice: "1d8",
          modifiers: [{ type: "CONSTANT", value: 2 }],
        },
      ],
      uses: {
        current: 1,
        max: 4,
        maximum: 3,
        recharge: "WEEK",
        rechargeRate: "SHORT_REST",
      },
    });

    expect(entryDataSchema.parse(normalized)).toMatchObject({
      rollActions: [
        {
          kind: "DAMAGE",
          dice: "1d8",
          modifiers: [{ type: "CONSTANT", value: 2 }],
        },
      ],
      uses: { current: 1, max: 4, recharge: "WEEK" },
    });
    expect(
      (
        normalizeLegacyEntryData({
          uses: { current: 0, maximum: 2, rechargeRate: "SHORT_REST" },
        }) as { uses: { recharge: string } }
      ).uses.recharge,
    ).toBe("SHORT_REST");
  });
});

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
