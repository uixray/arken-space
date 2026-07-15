import { describe, expect, it } from "vitest";
import { DiceFormulaError, rollFormula } from "../apps/server/src/dice";
import { modifierSourceSchema } from "../packages/contracts/src";

describe("rollFormula", () => {
  it("rolls dice and resolves stat references on the server", () => {
    const values = [0, 5];
    const result = rollFormula(
      "2d6 + agility - 1",
      { agility: 3 },
      () => values.shift() ?? 0,
      "Манёвр",
    );
    expect(result.terms[0]?.rolls).toEqual([1, 6]);
    expect(result.modifiers).toEqual([
      { source: "agility", value: 3 },
      { source: "1", value: -1 },
    ]);
    expect(result.total).toBe(9);
    expect(result.label).toBe("Манёвр");
  });

  it("supports negative dice terms", () => {
    const result = rollFormula("10 - 1d4", {}, () => 2);
    expect(result.total).toBe(7);
    expect(result.terms[0]?.subtotal).toBe(-3);
  });

  it("supports approved keep-high advantage without evaluating code", () => {
    const rolls = [2, 17];
    const result = rollFormula(
      "2d20kh1 + agility",
      { agility: 3 },
      () => rolls.shift()! - 1,
    );
    expect(result).toMatchObject({
      total: 20,
      terms: [{ notation: "2d20kh1", rolls: [2, 17], subtotal: 17 }],
      modifiers: [{ source: "agility", value: 3 }],
    });
  });

  it("accepts only finite arithmetic modifier formulas and rejects code or references", () => {
    expect(
      modifierSourceSchema.parse({ type: "FORMULA", formula: "10-3+2" }),
    ).toEqual({ type: "FORMULA", formula: "10-3+2" });
    expect(() =>
      modifierSourceSchema.parse({ type: "FORMULA", formula: "magic+1" }),
    ).toThrow();
    expect(() =>
      modifierSourceSchema.parse({
        type: "FORMULA",
        formula: "globalThis.process.exit()",
      }),
    ).toThrow();
  });

  it("rejects unknown stats and unsafe dice sizes", () => {
    expect(() => rollFormula("2d6 + missing", {})).toThrow(DiceFormulaError);
    expect(() => rollFormula("101d6", {})).toThrow("от 1 до 100");
    expect(() => rollFormula("1d1001", {})).toThrow("от 2 до 1000");
  });
});
