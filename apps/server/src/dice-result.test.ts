import { describe, expect, it } from "vitest";
import { normalizeDiceResult } from "./dice-result.js";

describe("normalizeDiceResult", () => {
  it("preserves a complete dice result", () => {
    expect(
      normalizeDiceResult({
        formula: "1d20 + agility",
        resolvedFormula: "1d20 + 3",
        terms: [{ notation: "1d20", rolls: [14], subtotal: 14 }],
        modifiers: [{ source: "agility", value: 3 }],
        total: 17,
        label: "Initiative",
      }),
    ).toMatchObject({ total: 17, terms: [{ rolls: [14] }] });
  });

  it("turns malformed legacy JSON into a non-dice message", () => {
    expect(normalizeDiceResult({ total: 20 })).toBeNull();
    expect(
      normalizeDiceResult({ terms: [], modifiers: [], total: Infinity }),
    ).toBeNull();
    expect(
      normalizeDiceResult({
        formula: "1d20",
        resolvedFormula: "1d20",
        terms: [
          {
            notation: "1d20",
            rolls: Array.from({ length: 101 }, () => 1),
            subtotal: 101,
          },
        ],
        modifiers: [],
        total: 101,
      }),
    ).toBeNull();
    expect(normalizeDiceResult(null)).toBeNull();
  });
});
