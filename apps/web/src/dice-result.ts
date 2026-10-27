import type { DiceResult } from "@arken/contracts";
import {
  normalizeDiceFrameReference,
  normalizeDiceStyleFrame,
  parseDiceSemanticOutcome,
} from "./dice-outcome";

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const boundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const validTerm = (term: unknown) => {
  if (!term || typeof term !== "object" || Array.isArray(term)) return false;
  const candidate = term as Record<string, unknown>;
  return (
    boundedString(candidate.notation, 16) &&
    Array.isArray(candidate.rolls) &&
    candidate.rolls.length <= 100 &&
    candidate.rolls.every(finiteNumber) &&
    finiteNumber(candidate.subtotal)
  );
};

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
    (dice.poolTerms !== undefined &&
      (!Array.isArray(dice.poolTerms) ||
        dice.poolTerms.length !== 2 ||
        !dice.poolTerms.every(
          (pool) =>
            Array.isArray(pool) && pool.length <= 80 && pool.every(validTerm),
        ))) ||
    (dice.selectedPool !== undefined &&
      dice.selectedPool !== 0 &&
      dice.selectedPool !== 1)
  )
    return null;

  const semanticOutcome =
    dice.semanticOutcome === undefined
      ? undefined
      : parseDiceSemanticOutcome(dice.semanticOutcome);
  if (dice.semanticOutcome !== undefined && semanticOutcome === null)
    return null;

  const terms = dice.terms.every(validTerm);
  const modifiers = dice.modifiers.every((modifier) => {
    if (!modifier || typeof modifier !== "object" || Array.isArray(modifier))
      return false;
    const candidate = modifier as Record<string, unknown>;
    return (
      boundedString(candidate.source, 160) && finiteNumber(candidate.value)
    );
  });
  if (!terms || !modifiers) return null;
  const normalized: Record<string, unknown> = { ...dice };
  if (semanticOutcome !== undefined)
    normalized.semanticOutcome = semanticOutcome;
  if (dice.frame !== undefined)
    normalized.frame = normalizeDiceFrameReference(
      dice.frame,
      semanticOutcome ?? null,
    );
  if (dice.styleFrame !== undefined)
    normalized.styleFrame = normalizeDiceStyleFrame(dice.styleFrame);
  return normalized as unknown as DiceResult;
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
    ? `Итоги попыток: ${dice.poolTotals.join(" и ")} \u2192 выбран ${dice.poolTotals[dice.selectedPool ?? 0]}`
    : "";
  return [...terms, ...modifiers, pool].filter(Boolean).join(" \u00b7 ");
}
