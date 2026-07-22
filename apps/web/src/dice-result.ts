import type { DiceResult } from "@arken/contracts";

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const boundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

export function normalizeClientDiceResult(value: unknown): DiceResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const dice = value as Record<string, unknown>;
  if (
    !boundedString(dice.formula, 160) ||
    !boundedString(dice.resolvedFormula, 512) ||
    !finiteNumber(dice.total) ||
    !Array.isArray(dice.terms) ||
    dice.terms.length > 80 ||
    !Array.isArray(dice.modifiers) ||
    dice.modifiers.length > 160 ||
    (dice.label !== undefined && !boundedString(dice.label, 100))
  )
    return null;

  const terms = dice.terms.every((term) => {
    if (!term || typeof term !== "object" || Array.isArray(term)) return false;
    const candidate = term as Record<string, unknown>;
    return (
      boundedString(candidate.notation, 16) &&
      Array.isArray(candidate.rolls) &&
      candidate.rolls.length <= 100 &&
      candidate.rolls.every(finiteNumber) &&
      finiteNumber(candidate.subtotal)
    );
  });
  const modifiers = dice.modifiers.every((modifier) => {
    if (!modifier || typeof modifier !== "object" || Array.isArray(modifier))
      return false;
    const candidate = modifier as Record<string, unknown>;
    return (
      boundedString(candidate.source, 160) && finiteNumber(candidate.value)
    );
  });
  return terms && modifiers ? (dice as unknown as DiceResult) : null;
}
