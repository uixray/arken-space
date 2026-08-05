import { describe, expect, it } from "vitest";
import { rollFormulaWithMode } from "./dice.js";

function sequence(...values: number[]) {
  let index = 0;
  return (max: number) => (values[index++] ?? 0) % max;
}

describe("authoritative dice semantic outcome", () => {
  it("persists natural d20 semantics independently of modifiers", () => {
    const result = rollFormulaWithMode("1d20 + 9", {}, "NORMAL", sequence(0));
    expect(result.semanticOutcome).toEqual({
      kind: "CRITICAL_FAILURE",
      keptNaturalD20: 1,
    });
    expect(result.frame).toEqual({
      setKey: "ARKEN_CRITICAL_V1",
      frameKey: "critical-failure",
    });
  });

  it("uses the d20 in the selected whole pool for advantage", () => {
    const result = rollFormulaWithMode(
      "1d20",
      {},
      "ADVANTAGE",
      sequence(0, 19),
    );
    expect(result.selectedPool).toBe(1);
    expect(result.semanticOutcome).toEqual({
      kind: "CRITICAL_SUCCESS",
      keptNaturalD20: 20,
    });
  });

  it("does not assign a frame to non-critical or ambiguous d20 pools", () => {
    expect(
      rollFormulaWithMode("1d20", {}, "NORMAL", sequence(9)).frame,
    ).toBeNull();
    const ambiguous = rollFormulaWithMode(
      "1d20 + 1d20",
      {},
      "NORMAL",
      sequence(0, 19),
    );
    expect(ambiguous.semanticOutcome).toEqual({
      kind: "NORMAL",
      keptNaturalD20: null,
    });
    expect(ambiguous.frame).toBeNull();
  });
});
