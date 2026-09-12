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

  it.each([
    ["opposite success", { kind: "CRITICAL_SUCCESS", keptNaturalD20: 1 }],
    ["opposite failure", { kind: "CRITICAL_FAILURE", keptNaturalD20: 20 }],
    ["missing natural", { kind: "CRITICAL_SUCCESS" }],
    ["string natural", { kind: "CRITICAL_FAILURE", keptNaturalD20: "1" }],
    ["out of range", { kind: "NORMAL", keptNaturalD20: 21 }],
    ["unknown kind", { kind: "OTHER", keptNaturalD20: 1 }],
    ["null", null],
    ["array", []],
  ])("does not infer a critical from malformed semantic: %s", (_, semantic) => {
    for (const natural of [1, 20]) {
      expect(
        getDiceCritical({
          ...result([{ notation: "1d20", rolls: [natural], subtotal: natural }]),
          semanticOutcome: semantic as DiceResult["semanticOutcome"],
        }),
      ).toBeNull();
    }
  });

  it.each([null, 1, 12, 20])(
    "keeps an explicit NORMAL override with kept natural %s",
    (keptNaturalD20) => {
      expect(
        getDiceCritical({
          ...result([{ notation: "1d20", rolls: [20], subtotal: 20 }]),
          semanticOutcome: { kind: "NORMAL", keptNaturalD20 },
        }),
      ).toBeNull();
    },
  );

  it("keeps natural semantics when frames are unavailable", () => {
    const dice = {
      ...result([{ notation: "1d20", rolls: [20], subtotal: 20 }], 1),
      semanticOutcome: {
        kind: "CRITICAL_SUCCESS",
        keptNaturalD20: 20,
      },
    } satisfies DiceResult;
    for (const frame of [
      undefined,
      null,
      { setKey: "UNKNOWN", frameKey: "not-published" },
    ]) {
      expect(
        getDiceCritical({ ...dice, frame: frame as DiceResult["frame"] }),
      ).toEqual({
        kind: "success",
        natural: 20,
        label: "Критический успех",
      });
    }
  });
});
