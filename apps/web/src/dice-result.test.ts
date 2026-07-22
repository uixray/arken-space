import { describe, expect, it } from "vitest";
import { normalizeClientDiceResult } from "./dice-result";

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
