import { describe, expect, it } from "vitest";
import { formatDiceBreakdown, normalizeClientDiceResult } from "./dice-result";

const valid = {
  formula: "1d20",
  resolvedFormula: "1d20",
  terms: [{ notation: "1d20", rolls: [12], subtotal: 12 }],
  modifiers: [],
  total: 12,
};

describe("normalizeClientDiceResult", () => {
  it("keeps a bounded complete result", () => {
    expect(normalizeClientDiceResult(valid)).toEqual(valid);
  });

  it("rejects malformed or unbounded client payloads", () => {
    expect(normalizeClientDiceResult({ total: 20 })).toBeNull();
    expect(normalizeClientDiceResult({ ...valid, terms: {} })).toBeNull();
    expect(normalizeClientDiceResult({ ...valid, total: Infinity })).toBeNull();
    expect(
      normalizeClientDiceResult({
        ...valid,
        terms: [{ ...valid.terms[0], rolls: Array(101).fill(1) }],
      }),
    ).toBeNull();
  });
});

describe("formatDiceBreakdown", () => {
  it("shows both advantage pools and the selected result", () => {
    expect(
      formatDiceBreakdown({
        ...valid,
        total: 16,
        terms: [{ notation: "1d20", rolls: [16], subtotal: 16 }],
        rollMode: "ADVANTAGE",
        poolTotals: [7, 16],
        selectedPool: 1,
      }),
    ).toBe("1d20 (16) · Выпало: 7 и 16 → выбран 16");
  });
});
