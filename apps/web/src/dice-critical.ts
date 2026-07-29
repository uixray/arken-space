import type { DiceResult } from "@arken/contracts";

export type DiceCritical = {
  kind: "failure" | "success";
  natural: 1 | 20;
  label: "Критический провал" | "Критический успех";
};

function keptNaturalD20(term: DiceResult["terms"][number]) {
  if (term.notation === "1d20" && term.rolls.length === 1) return term.rolls[0];
  if (term.notation === "2d20kh1" && term.rolls.length === 2)
    return Math.max(...term.rolls);
  if (term.notation === "2d20kl1" && term.rolls.length === 2)
    return Math.min(...term.rolls);
  return null;
}

/**
 * Returns a critical result only when one unambiguous, kept natural d20 can be
 * identified. Modifiers and the final total never influence critical status.
 */
export function getDiceCritical(dice: DiceResult): DiceCritical | null {
  // New history rows carry the server-authoritative semantic. The term-based
  // path remains solely for backwards compatibility with legacy stored rolls.
  if (dice.semanticOutcome?.kind === "CRITICAL_FAILURE")
    return { kind: "failure", natural: 1, label: "Критический провал" };
  if (dice.semanticOutcome?.kind === "CRITICAL_SUCCESS")
    return { kind: "success", natural: 20, label: "Критический успех" };
  if (dice.semanticOutcome?.kind === "NORMAL") return null;
  const naturals = dice.terms
    .map(keptNaturalD20)
    .filter((value): value is number => value !== null);
  if (naturals.length !== 1) return null;
  if (naturals[0] === 1)
    return { kind: "failure", natural: 1, label: "Критический провал" };
  if (naturals[0] === 20)
    return { kind: "success", natural: 20, label: "Критический успех" };
  return null;
}
