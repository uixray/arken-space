import { describe, expect, it } from "vitest";
import { entryDataSchema } from "@arken/contracts";
import {
  normalizeLegacyEntryData,
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
    expect(
      normalizeLegacyStats({ mind: 4, spirit: 5, intelligence: 9 }),
    ).toEqual({
      intelligence: 9,
      willpower: 5,
    });
  });
});
