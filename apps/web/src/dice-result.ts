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
    (dice.label !== undefined && !boundedString(dice.label, 100)) ||
    (dice.rollMode !== undefined &&
      !["NORMAL", "ADVANTAGE", "DISADVANTAGE"].includes(
        String(dice.rollMode),
      )) ||
    (dice.poolTotals !== undefined &&
      (!Array.isArray(dice.poolTotals) ||
        dice.poolTotals.length !== 2 ||
        !dice.poolTotals.every(finiteNumber))) ||
    (dice.selectedPool !== undefined &&
      dice.selectedPool !== 0 &&
      dice.selectedPool !== 1) ||
    (dice.semanticOutcome !== undefined &&
      (!dice.semanticOutcome ||
        typeof dice.semanticOutcome !== "object" ||
        !["NORMAL", "CRITICAL_FAILURE", "CRITICAL_SUCCESS"].includes(
          String((dice.semanticOutcome as Record<string, unknown>).kind),
        ))) ||
    (dice.frame !== undefined &&
      dice.frame !== null &&
      (typeof dice.frame !== "object" ||
        (dice.frame as Record<string, unknown>).setKey !==
          "ARKEN_CRITICAL_V1" ||
        !["critical-failure", "critical-success"].includes(
          String((dice.frame as Record<string, unknown>).frameKey),
        )))
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

export function formatDiceBreakdown(value: unknown) {
  const dice = normalizeClientDiceResult(value);
  if (!dice) return "";
  const terms = dice.terms.map(
    (term) => `${term.notation} (${term.rolls.join(", ")})`,
  );
  const modifiers = dice.modifiers
    .filter((modifier) => modifier.value !== 0)
    .map((modifier) =>
      modifier.value > 0 ? `+${modifier.value}` : String(modifier.value),
    );
  const pool = dice.poolTotals
    ? `Выпало: ${dice.poolTotals.join(" и ")} \u2192 выбран ${dice.poolTotals[dice.selectedPool ?? 0]}`
    : "";
  return [...terms, ...modifiers, pool].filter(Boolean).join(" \u00b7 ");
}
