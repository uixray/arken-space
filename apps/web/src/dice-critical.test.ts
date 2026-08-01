import { describe, expect, it } from "vitest";
import type { DiceResult } from "@arken/contracts";
import { getDiceCritical } from "./dice-critical";

function result(
  terms: DiceResult["terms"],
  total = terms.reduce((sum, term) => sum + term.subtotal, 0),
): DiceResult {
  return {
    formula: "test",
    resolvedFormula: "test",
    terms,
    modifiers: [],
    total,
  };
}

describe("getDiceCritical", () => {
  it("marks a natural 1 as failure even when modifiers change the total", () => {
    expect(
      getDiceCritical(
        result([{ notation: "1d20", rolls: [1], subtotal: 1 }], 8),
      ),
    ).toEqual({
      kind: "failure",
      natural: 1,
      label: "Критический провал",
    });
  });

  it("marks a natural 20 as success even when modifiers change the total", () => {
    expect(
      getDiceCritical(
        result([{ notation: "1d20", rolls: [20], subtotal: 20 }], 25),
      ),
    ).toEqual({
      kind: "success",
      natural: 20,
      label: "Критический успех",
    });
  });

  it("uses the kept die for advantage and disadvantage", () => {
    expect(
      getDiceCritical(
        result([{ notation: "2d20kh1", rolls: [1, 20], subtotal: 20 }]),
      )?.kind,
    ).toBe("success");
    expect(
      getDiceCritical(
        result([{ notation: "2d20kl1", rolls: [20, 1], subtotal: 1 }]),
      )?.kind,
    ).toBe("failure");
  });

  it("ignores totals, non-d20 dice, and ambiguous d20 pools", () => {
    expect(
      getDiceCritical(
        result([{ notation: "1d8", rolls: [1], subtotal: 1 }], 20),
      ),
    ).toBeNull();
    expect(
      getDiceCritical(
        result([{ notation: "2d20", rolls: [1, 20], subtotal: 21 }]),
      ),
    ).toBeNull();
    expect(
      getDiceCritical(
        result([
          { notation: "1d20", rolls: [1], subtotal: 1 },
          { notation: "1d20", rolls: [20], subtotal: 20 },
        ]),
      ),
    ).toBeNull();
    expect(
      getDiceCritical(
        result([{ notation: "1d20", rolls: [12], subtotal: 12 }], 20),
      ),
    ).toBeNull();
  });
  it("trusts a persisted server semantic over legacy term inference", () => {
    expect(
      getDiceCritical({
        ...result([{ notation: "1d20", rolls: [1], subtotal: 1 }]),
        semanticOutcome: { kind: "NORMAL", keptNaturalD20: 1 },
        frame: null,
      }),
    ).toBeNull();
  });

});
